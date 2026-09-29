import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { employee, resource, spaceBooking } from "@/db/schema";
import { loadAccess } from "@/modules/access/can";
import { recordAudit } from "@/modules/audit/audit";
import { bookingWindow, weekStartOf } from "@/modules/availability/rules";
import { loadDayContext, loadResourcesOnDate } from "@/modules/availability/service";
import { enqueueOutbox } from "@/modules/notifications/outbox";
import { spaceBookingChangedEmail } from "@/modules/notifications/templates";
import { formatLocalDate, localToday } from "@/modules/shared/dates";
import { ConflictError, ForbiddenError, ValidationError } from "@/modules/shared/errors";
import { type Actor, advisoryShareDay, assertIsoDate, assertUuid, lockResources, readSettings, shareLockEmployee, withOfficeTx } from "@/modules/office/shared";
import { canSeeTitle, formatSlot, type Interval, intervalOf, intervalProblem, maxMinutesOf, overlaps, type TitleVisibility } from "./rules";

/*
 * Salas e cabines por intervalo (BKG-03, PAR-18). Intervalo semiaberto `[início, fim)` no mesmo dia local; adjacência
 * permitida; sobreposição recusada pelo serviço e, como segunda rede, pela constraint de exclusão. Título privado por
 * padrão: quem só precisa de disponibilidade vê "Reservada". Horizonte de reserva segue o parâmetro das mesas; a
 * abertura semanal (dia e hora) não se aplica a salas (DEC-26).
 */

export type SpaceSearchInput = { date: string; start: string; end: string; capacity?: number | null; attributes?: string[] };

export type AgendaItem = { id: string; start: Date; end: Date; slot: string; mine: boolean; title: string | null; employeeName: string | null };

export type SpaceItem = {
  resource: { id: string; code: string; type: "room" | "booth"; capacity: number | null; zoneName: string | null; attributes: Record<string, unknown>; verified: boolean; maxMinutes: number | null };
  /** Motivo do impedimento para o intervalo pedido, ou null quando reservável. */
  problem: string | null;
  agenda: AgendaItem[];
};

function parseSearch(input: SpaceSearchInput): { date: string; interval: Interval } {
  assertIsoDate(input.date);
  let interval: Interval;
  try {
    interval = intervalOf(input.date, input.start, input.end);
  } catch {
    throw new ValidationError("Horário inválido (HH:MM).");
  }
  return { date: input.date, interval };
}

async function horizonOk(db: DbOrTx, date: string, now: Date): Promise<{ ok: boolean; reason: string | null }> {
  const settings = await readSettings(db);
  const today = localToday(now);
  if (date < today) return { ok: false, reason: "data passada" };
  const w = bookingWindow(date, now, { ...settings, bookingOpenWeekday: 1, bookingOpenTime: "00:00" });
  // Só o horizonte conta para salas: a janela semanal foi neutralizada acima (abre segunda 00:00 da semana anterior).
  if (!w.open && weekStartOf(date) > weekStartOf(today)) return { ok: false, reason: `além do horizonte de ${settings.bookingHorizonWeeks} semana(s)` };
  return { ok: true, reason: null };
}

/** Quem o visitante gerencia diretamente (para títulos com visibilidade "gestor"). */
async function managedBy(db: DbOrTx, viewerId: string): Promise<Set<string>> {
  const rows = await db.select({ id: employee.id }).from(employee).where(and(eq(employee.managerEmployeeId, viewerId), eq(employee.status, "active")));
  return new Set(rows.map((r) => r.id));
}

async function agendaOn(db: DbOrTx, resourceIds: string[], date: string, viewer: { id: string; managesEmployeeIds: ReadonlySet<string>; namesVisible: boolean }): Promise<Map<string, AgendaItem[]>> {
  if (resourceIds.length === 0) return new Map();
  const rows = await db
    .select({ id: spaceBooking.id, resourceId: spaceBooking.resourceId, employeeId: spaceBooking.employeeId, title: spaceBooking.title, titleVisibility: spaceBooking.titleVisibility, lower: sql<string>`lower(${spaceBooking.period})`, upper: sql<string>`upper(${spaceBooking.period})`, employeeName: employee.fullName })
    .from(spaceBooking)
    .innerJoin(employee, eq(employee.id, spaceBooking.employeeId))
    .where(and(inArray(spaceBooking.resourceId, resourceIds), eq(spaceBooking.status, "confirmed"), sql`${spaceBooking.period} && local_day_range(${date}::date)`))
    .orderBy(asc(sql`lower(${spaceBooking.period})`));
  const out = new Map<string, AgendaItem[]>();
  for (const r of rows) {
    const start = new Date(r.lower);
    const end = new Date(r.upper);
    const mine = r.employeeId === viewer.id;
    const visible = canSeeTitle({ employeeId: r.employeeId, titleVisibility: r.titleVisibility as TitleVisibility }, viewer);
    const item: AgendaItem = { id: r.id, start, end, slot: formatSlot({ start, end }), mine, title: visible ? r.title : null, employeeName: mine || viewer.namesVisible || visible ? r.employeeName : null };
    if (!out.has(r.resourceId)) out.set(r.resourceId, []);
    out.get(r.resourceId)!.push(item);
  }
  return out;
}

/** Busca por data, horário, capacidade e atributos verificados; agenda legível; conflito de intervalo explicado. */
export async function searchSpaces(db: DbOrTx, viewerId: string, input: SpaceSearchInput, now = new Date()): Promise<{ items: SpaceItem[]; interval: Interval; dayProblem: string | null }> {
  const { date, interval } = parseSearch(input);
  const day = await loadDayContext(db, date, now);
  const horizon = await horizonOk(db, date, now);
  const dayProblem = !day.officeOpen ? (day.closedReason ? `escritório fechado: ${day.closedReason}` : "escritório fechado") : !horizon.ok ? horizon.reason : null;
  const resources = await loadResourcesOnDate(db, date, { types: ["room", "booth"] });
  const wanted = (input.attributes ?? []).filter(Boolean);
  const access = await loadAccess(db, viewerId);
  const viewer = { id: viewerId, managesEmployeeIds: await managedBy(db, viewerId), namesVisible: access.permissions.has("booking.admin.manage") };
  const agenda = await agendaOn(db, resources.map((r) => r.id), date, viewer);
  const items: SpaceItem[] = [];
  for (const r of resources) {
    if (r.retired) continue;
    const verified = !!(await db.select({ v: resource.attributesVerifiedAt }).from(resource).where(eq(resource.id, r.id)))[0]?.v;
    if (input.capacity && (r.capacity ?? 0) < input.capacity) continue;
    if (wanted.length && !(verified && wanted.every((k) => r.attributes[k] === true))) continue;
    const maxMinutes = maxMinutesOf(r.attributes);
    const own = agenda.get(r.id) ?? [];
    let problem: string | null = dayProblem;
    if (!problem && r.period) problem = r.period.status === "maintenance" ? `em manutenção${r.period.publicReason ? `: ${r.period.publicReason}` : ""}` : `bloqueada administrativamente${r.period.publicReason ? `: ${r.period.publicReason}` : ""}`;
    if (!problem) problem = intervalProblem(interval, { now, maxMinutes });
    if (!problem) {
      const clash = own.find((a) => overlaps({ start: a.start, end: a.end }, interval));
      if (clash) problem = `ocupada das ${clash.slot}`;
    }
    items.push({ resource: { id: r.id, code: r.code, type: r.type as "room" | "booth", capacity: r.capacity, zoneName: r.zoneName, attributes: r.attributes, verified, maxMinutes }, problem, agenda: own });
  }
  return { items, interval, dayProblem };
}

export type BookSpaceInput = { resourceId: string; date: string; start: string; end: string; title?: string | null; titleVisibility?: TitleVisibility; idempotencyKey: string };

/** Reserva de sala ou cabine: locks por dia e recurso, revalidação, sobreposição recusada com o horário ocupado. */
export async function bookSpace(db: Db, actor: Actor, input: BookSpaceInput): Promise<{ bookingId: string; created: boolean; resourceCode: string; slot: string }> {
  assertUuid(input.resourceId, "Recurso");
  const { date, interval } = parseSearch(input);
  if (!input.idempotencyKey || input.idempotencyKey.length > 120) throw new ValidationError("Chave de idempotência ausente.");
  const visibility: TitleVisibility = input.titleVisibility === "all" || input.titleVisibility === "manager" ? input.titleVisibility : "private";
  const title = input.title?.trim().slice(0, 120) || null;
  const access = await loadAccess(db, actor.employeeId);
  if (!access.permissions.has("booking.self.manage")) throw new ForbiddenError("Sua conta não pode reservar.");
  const now = new Date();
  return withOfficeTx(db, async (tx) => {
    const [existing] = await tx.select({ id: spaceBooking.id, resourceId: spaceBooking.resourceId }).from(spaceBooking).where(and(eq(spaceBooking.actorEmployeeId, actor.employeeId), eq(spaceBooking.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      const [r] = await tx.select({ code: resource.code }).from(resource).where(eq(resource.id, existing.resourceId));
      return { bookingId: existing.id, created: false, resourceCode: r?.code ?? "", slot: formatSlot(interval) };
    }
    await advisoryShareDay(tx, date);
    const person = await shareLockEmployee(tx, actor.employeeId);
    if (person.status !== "active") throw new ForbiddenError("Só pessoa ativa reserva.");
    await lockResources(tx, [input.resourceId]);
    const [r] = await loadResourcesOnDate(tx, date, { ids: [input.resourceId] });
    if (!r || (r.type !== "room" && r.type !== "booth")) throw new ValidationError("Sala ou cabine não encontrada.");
    if (r.retired) throw new ConflictError("Recurso desativado.");
    const day = await loadDayContext(tx, date, now);
    if (!day.officeOpen) throw new ConflictError(`Escritório fechado em ${formatLocalDate(date)}${day.closedReason ? `: ${day.closedReason}` : ""}.`);
    const horizon = await horizonOk(tx, date, now);
    if (!horizon.ok) throw new ConflictError(`Data fora do período de reserva: ${horizon.reason}.`);
    if (r.period) throw new ConflictError(r.period.status === "maintenance" ? "Recurso em manutenção nesta data." : "Recurso bloqueado nesta data.");
    const problem = intervalProblem(interval, { now, maxMinutes: maxMinutesOf(r.attributes) });
    if (problem) throw new ValidationError(`Intervalo inválido: ${problem}.`);
    const clash = await tx
      .select({ lower: sql<string>`lower(${spaceBooking.period})`, upper: sql<string>`upper(${spaceBooking.period})` })
      .from(spaceBooking)
      .where(and(eq(spaceBooking.resourceId, input.resourceId), eq(spaceBooking.status, "confirmed"), sql`${spaceBooking.period} && tstzrange(${interval.start.toISOString()}::timestamptz, ${interval.end.toISOString()}::timestamptz, '[)')`))
      .orderBy(asc(sql`lower(${spaceBooking.period})`));
    if (clash.length) throw new ConflictError(`${r.code} já está reservada das ${formatSlot({ start: new Date(clash[0].lower), end: new Date(clash[0].upper) })} em ${formatLocalDate(date)}. Escolha outro horário ou outro recurso.`);
    const [row] = await tx
      .insert(spaceBooking)
      .values({ resourceId: input.resourceId, employeeId: actor.employeeId, period: sql`tstzrange(${interval.start.toISOString()}::timestamptz, ${interval.end.toISOString()}::timestamptz, '[)')`, title, titleVisibility: visibility, actorEmployeeId: actor.employeeId, idempotencyKey: input.idempotencyKey })
      .returning({ id: spaceBooking.id });
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "space_booking.created", entityType: "space_booking", entityId: row.id, after: { resourceId: input.resourceId, date, slot: formatSlot(interval), titleVisibility: visibility }, requestId: actor.requestId });
    return { bookingId: row.id, created: true, resourceCode: r.code, slot: formatSlot(interval) };
  });
}

/** Cancelamento próprio ou administrativo (com motivo e comunicação). Reserva já encerrada não é cancelada. */
export async function cancelSpace(db: Db, actor: Actor, bookingId: string, input: { reason?: string; message?: string } = {}): Promise<{ resourceCode: string; slot: string; date: string }> {
  assertUuid(bookingId, "Reserva");
  return withOfficeTx(db, async (tx) => {
    const [b] = await tx
      .select({ id: spaceBooking.id, resourceId: spaceBooking.resourceId, employeeId: spaceBooking.employeeId, status: spaceBooking.status, lower: sql<string>`lower(${spaceBooking.period})`, upper: sql<string>`upper(${spaceBooking.period})`, code: resource.code })
      .from(spaceBooking)
      .innerJoin(resource, eq(resource.id, spaceBooking.resourceId))
      .where(eq(spaceBooking.id, bookingId));
    if (!b) throw new ValidationError("Reserva não encontrada.");
    const own = b.employeeId === actor.employeeId;
    const access = await loadAccess(tx, actor.employeeId);
    if (!own) {
      if (!access.permissions.has("booking.admin.manage")) throw new ForbiddenError("Cancelar reserva de outra pessoa exige permissão administrativa.");
      if (!input.reason?.trim()) throw new ValidationError("Informe o motivo do cancelamento administrativo.");
    } else if (!access.permissions.has("booking.self.manage")) {
      throw new ForbiddenError("Sua conta não pode alterar reservas.");
    }
    const interval = { start: new Date(b.lower), end: new Date(b.upper) };
    const date = localToday(interval.start);
    if (b.status !== "confirmed") throw new ConflictError("Esta reserva já não está ativa.");
    if (interval.end.getTime() <= Date.now()) throw new ConflictError("Reserva já encerrada não é cancelada.");
    await advisoryShareDay(tx, date);
    for (const p of [...new Set([b.employeeId, actor.employeeId])].sort()) await shareLockEmployee(tx, p);
    await lockResources(tx, [b.resourceId]);
    const [again] = await tx.select({ status: spaceBooking.status }).from(spaceBooking).where(eq(spaceBooking.id, bookingId));
    if (again?.status !== "confirmed") throw new ConflictError("Esta reserva já não está ativa.");
    await tx.update(spaceBooking).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: input.reason?.trim() || (own ? "cancelada pela própria pessoa" : null) }).where(eq(spaceBooking.id, bookingId));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: own ? "space_booking.cancelled" : "space_booking.cancelled_by_admin", entityType: "space_booking", entityId: bookingId, before: { status: "confirmed", resourceId: b.resourceId, employeeId: b.employeeId, date }, after: { status: "cancelled" }, reason: input.reason, requestId: actor.requestId });
    if (!own) {
      const [emp] = await tx.select({ email: employee.corporateEmail, name: employee.fullName }).from(employee).where(eq(employee.id, b.employeeId));
      if (emp) {
        await enqueueOutbox(tx, { eventType: "email.space_booking", aggregateType: "space_booking", aggregateId: bookingId, payload: { message: spaceBookingChangedEmail(emp.email, emp.name, `Sua reserva de ${b.code} em ${formatLocalDate(date)}, das ${formatSlot(interval)}, foi cancelada pela administração. ${input.message?.trim() ?? ""}`.trim()) }, idempotencyKey: `space_booking.cancelled:${bookingId}` });
      }
    }
    return { resourceCode: b.code, slot: formatSlot(interval), date };
  });
}

export type MySpaceBooking = { id: string; code: string; type: string; date: string; slot: string; start: Date; end: Date; title: string | null; titleVisibility: string; status: string };

export async function mySpaceBookings(db: DbOrTx, employeeId: string): Promise<{ upcoming: MySpaceBooking[]; past: MySpaceBooking[] }> {
  const base = () =>
    db
      .select({ id: spaceBooking.id, code: resource.code, type: resource.type, lower: sql<string>`lower(${spaceBooking.period})`, upper: sql<string>`upper(${spaceBooking.period})`, title: spaceBooking.title, titleVisibility: spaceBooking.titleVisibility, status: spaceBooking.status })
      .from(spaceBooking)
      .innerJoin(resource, eq(resource.id, spaceBooking.resourceId));
  const map = (r: { id: string; code: string; type: string; lower: string; upper: string; title: string | null; titleVisibility: string; status: string }): MySpaceBooking => {
    const start = new Date(r.lower);
    const end = new Date(r.upper);
    return { id: r.id, code: r.code, type: r.type, date: localToday(start), slot: formatSlot({ start, end }), start, end, title: r.title, titleVisibility: r.titleVisibility, status: r.status };
  };
  const upcoming = await base()
    .where(and(eq(spaceBooking.employeeId, employeeId), eq(spaceBooking.status, "confirmed"), gt(sql`upper(${spaceBooking.period})`, sql`now()`)))
    .orderBy(asc(sql`lower(${spaceBooking.period})`));
  const past = await base()
    .where(and(eq(spaceBooking.employeeId, employeeId), lt(sql`upper(${spaceBooking.period})`, sql`now()`)))
    .orderBy(desc(sql`lower(${spaceBooking.period})`))
    .limit(30);
  return { upcoming: upcoming.map(map), past: past.map(map) };
}

/** Reservas de sala de uma data para a administração: pessoa e horário; título só quando a visibilidade permite. */
export async function listSpaceBookingsAdmin(db: DbOrTx, viewerId: string, filter: { date: string }) {
  const rows = await db
    .select({ id: spaceBooking.id, code: resource.code, type: resource.type, employeeId: spaceBooking.employeeId, employeeName: employee.fullName, lower: sql<string>`lower(${spaceBooking.period})`, upper: sql<string>`upper(${spaceBooking.period})`, title: spaceBooking.title, titleVisibility: spaceBooking.titleVisibility })
    .from(spaceBooking)
    .innerJoin(resource, eq(resource.id, spaceBooking.resourceId))
    .innerJoin(employee, eq(employee.id, spaceBooking.employeeId))
    .where(and(eq(spaceBooking.status, "confirmed"), sql`${spaceBooking.period} && local_day_range(${filter.date}::date)`))
    .orderBy(asc(resource.code), asc(sql`lower(${spaceBooking.period})`));
  const viewer = { id: viewerId, managesEmployeeIds: await managedBy(db, viewerId) };
  return rows.map((r) => {
    const start = new Date(r.lower);
    const end = new Date(r.upper);
    return { id: r.id, code: r.code, type: r.type, employeeId: r.employeeId, employeeName: r.employeeName, slot: formatSlot({ start, end }), title: canSeeTitle({ employeeId: r.employeeId, titleVisibility: r.titleVisibility as TitleVisibility }, viewer) ? r.title : null };
  });
}
