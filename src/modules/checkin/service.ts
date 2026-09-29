import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { checkin, deskBooking, employee, resource, spaceBooking } from "@/db/schema";
import { loadAccess } from "@/modules/access/can";
import { recordAudit } from "@/modules/audit/audit";
import { enqueueOutbox } from "@/modules/notifications/outbox";
import { bookingChangedEmail } from "@/modules/notifications/templates";
import { formatLocalDate, localToday, TZ } from "@/modules/shared/dates";
import { formatSlot } from "@/modules/spaces/rules";
import { ForbiddenError, ValidationError } from "@/modules/shared/errors";
import { logger } from "@/modules/shared/logger";
import { type Actor, advisoryShareDay, assertUuid, lockResources, readSettings, shareLockEmployee, withOfficeTx } from "@/modules/office/shared";
import { lockQueueCandidates, offerNext } from "@/modules/waitlist/service";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/*
 * Confirmação de uso (REQ-15, DIR-006, PAR-06): declaração da própria pessoa sobre a própria reserva confirmada, no dia
 * da reserva, pelo portal ou pelo QR da mesa. Nunca é prova de presença, ponto ou produtividade. Não libera nem remove
 * exclusividade. A liberação automática por falta de confirmação existe como parâmetro, desativada por padrão, e
 * jamais toca mesa com política exclusiva.
 */

export type ConfirmUseInput = { bookingId?: string; spaceBookingId?: string; resourceCode?: string; method: "portal" | "qr" };
export type ConfirmUseResult = { kind: "desk" | "space"; bookingId: string; resourceCode: string; date: string; already: boolean; slot?: string };

const CODE_RE = /^[A-Z0-9-]{2,12}$/i;

const slotOf = (s: { lower: string; upper: string }) => formatSlot({ start: new Date(s.lower), end: new Date(s.upper) });

/** Reserva confirmada da própria pessoa hoje (por id ou pelo código do recurso do QR). Reserva alheia é inexistente. */
async function resolveOwnBookingToday(db: DbOrTx, employeeId: string, input: ConfirmUseInput): Promise<{ kind: "desk" | "space"; id: string; code: string; slot?: string }> {
  const today = localToday();
  if (input.bookingId) {
    assertUuid(input.bookingId, "Reserva");
    const [b] = await db
      .select({ id: deskBooking.id, code: resource.code })
      .from(deskBooking)
      .innerJoin(resource, eq(resource.id, deskBooking.resourceId))
      .where(and(eq(deskBooking.id, input.bookingId), eq(deskBooking.employeeId, employeeId), eq(deskBooking.status, "confirmed"), eq(deskBooking.bookingDate, today)));
    if (b) return { kind: "desk", id: b.id, code: b.code };
    throw new ValidationError("Reserva não encontrada para você hoje.");
  }
  if (input.spaceBookingId) {
    assertUuid(input.spaceBookingId, "Reserva");
    const [s] = await db
      .select({ id: spaceBooking.id, code: resource.code, lower: sql<string>`lower(${spaceBooking.period})`, upper: sql<string>`upper(${spaceBooking.period})` })
      .from(spaceBooking)
      .innerJoin(resource, eq(resource.id, spaceBooking.resourceId))
      .where(and(eq(spaceBooking.id, input.spaceBookingId), eq(spaceBooking.employeeId, employeeId), eq(spaceBooking.status, "confirmed"), sql`${spaceBooking.period} && local_day_range(local_today())`));
    if (s) return { kind: "space", id: s.id, code: s.code, slot: slotOf(s) };
    throw new ValidationError("Reserva não encontrada para você hoje.");
  }
  if (input.resourceCode && CODE_RE.test(input.resourceCode)) {
    const code = input.resourceCode.toUpperCase();
    const [b] = await db
      .select({ id: deskBooking.id, code: resource.code })
      .from(deskBooking)
      .innerJoin(resource, eq(resource.id, deskBooking.resourceId))
      .where(and(eq(resource.code, code), eq(deskBooking.employeeId, employeeId), eq(deskBooking.status, "confirmed"), eq(deskBooking.bookingDate, today)));
    if (b) return { kind: "desk", id: b.id, code: b.code };
    // Sala pelo QR: só a reserva em andamento ou a que começa em até 15 minutos (T-05, N6); a em andamento vem primeiro,
    // mesmo já confirmada, para que uma segunda leitura responda "já confirmado" em vez de confirmar a próxima.
    const [s] = await db
      .select({ id: spaceBooking.id, code: resource.code, lower: sql<string>`lower(${spaceBooking.period})`, upper: sql<string>`upper(${spaceBooking.period})` })
      .from(spaceBooking)
      .innerJoin(resource, eq(resource.id, spaceBooking.resourceId))
      .where(and(eq(resource.code, code), eq(spaceBooking.employeeId, employeeId), eq(spaceBooking.status, "confirmed"), sql`${spaceBooking.period} && local_day_range(local_today())`, sql`upper(${spaceBooking.period}) > now()`, sql`lower(${spaceBooking.period}) <= now() + interval '15 minutes'`))
      .orderBy(asc(sql`lower(${spaceBooking.period})`));
    if (s) return { kind: "space", id: s.id, code: s.code, slot: slotOf(s) };
    const [r] = await db.select({ type: resource.type }).from(resource).where(eq(resource.code, code));
    if (r && r.type !== "desk") throw new ValidationError(`Você não tem reserva confirmada em ${code} em andamento ou começando nos próximos 15 minutos.`);
    throw new ValidationError(`Você não tem reserva confirmada em ${code} hoje.`);
  }
  throw new ValidationError("Informe a reserva ou o código do recurso.");
}

/** Declara o uso. Idempotente: repetir devolve a confirmação já registrada. Nada muda em política ou disponibilidade. */
export async function confirmUse(db: Db, actor: Actor, input: ConfirmUseInput): Promise<ConfirmUseResult> {
  const access = await loadAccess(db, actor.employeeId);
  if (!access.permissions.has("booking.self.manage")) throw new ForbiddenError("Sua conta não pode confirmar uso.");
  if (input.method !== "portal" && input.method !== "qr") throw new ValidationError("Método inválido.");
  return withOfficeTx(db, async (tx) => {
    await shareLockEmployee(tx, actor.employeeId);
    const target = await resolveOwnBookingToday(tx, actor.employeeId, input);
    // A linha da reserva serializa a confirmação contra a liberação por falta de confirmação (PAR-06) e o cancelamento.
    const locked = target.kind === "desk"
      ? await tx.execute(sql`select status from desk_booking where id = ${target.id} for update`)
      : await tx.execute(sql`select status from space_booking where id = ${target.id} for update`);
    if ((locked.rows[0] as { status?: string } | undefined)?.status !== "confirmed") throw new ValidationError("Reserva não encontrada para você hoje.");
    const values = target.kind === "desk" ? { deskBookingId: target.id } : { spaceBookingId: target.id };
    const [row] = await tx
      .insert(checkin)
      .values({ ...values, method: input.method, actorEmployeeId: actor.employeeId })
      .onConflictDoNothing()
      .returning({ id: checkin.id });
    if (row) {
      await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "booking.use_confirmed", entityType: target.kind === "desk" ? "desk_booking" : "space_booking", entityId: target.id, after: { method: input.method, checkinId: row.id }, requestId: actor.requestId });
    }
    return { kind: target.kind, bookingId: target.id, resourceCode: target.code, date: localToday(), already: !row, slot: target.slot };
  });
}

/** Confirmações de uso de um conjunto de reservas de mesa (para listas). */
export async function usageOfDeskBookings(db: DbOrTx, bookingIds: string[]): Promise<Map<string, { declaredAt: Date; method: "portal" | "qr" }>> {
  if (bookingIds.length === 0) return new Map();
  const rows = await db.select({ id: checkin.deskBookingId, declaredAt: checkin.declaredAt, method: checkin.method }).from(checkin).where(inArray(checkin.deskBookingId, bookingIds));
  return new Map(rows.filter((r) => r.id).map((r) => [r.id!, { declaredAt: r.declaredAt, method: r.method }]));
}

export async function usageOfSpaceBookings(db: DbOrTx, bookingIds: string[]): Promise<Map<string, { declaredAt: Date; method: "portal" | "qr" }>> {
  if (bookingIds.length === 0) return new Map();
  const rows = await db.select({ id: checkin.spaceBookingId, declaredAt: checkin.declaredAt, method: checkin.method }).from(checkin).where(inArray(checkin.spaceBookingId, bookingIds));
  return new Map(rows.filter((r) => r.id).map((r) => [r.id!, { declaredAt: r.declaredAt, method: r.method }]));
}

/** Reserva de mesa da própria pessoa hoje num recurso (tela do QR). */
export async function ownBookingTodayOn(db: DbOrTx, employeeId: string, resourceCode: string): Promise<{ kind: "desk" | "space"; id: string; code: string; slot?: string; confirmedAt: Date | null } | null> {
  try {
    const t = await resolveOwnBookingToday(db, employeeId, { resourceCode, method: "qr" });
    const usage = t.kind === "desk" ? await usageOfDeskBookings(db, [t.id]) : await usageOfSpaceBookings(db, [t.id]);
    return { ...t, confirmedAt: usage.get(t.id)?.declaredAt ?? null };
  } catch {
    return null;
  }
}

/** Endereço que o QR impresso na mesa carrega: o servidor resolve a reserva da sessão, nunca o QR. */
export function qrUrlFor(baseUrl: string, resourceCode: string): string {
  return `${baseUrl.replace(/\/$/, "")}/escritorio/qr/${encodeURIComponent(resourceCode)}`;
}

/**
 * Aviso de prazo (PAR-06, PAR-44) só para quem será de fato atingido: liberação ativa, antes do limite de hoje, reserva
 * confirmada de hoje em mesa compartilhada e nenhuma confirmação de uso de mesa hoje. Devolve o horário limite ou null.
 */
export async function pendingUseConfirmation(db: DbOrTx, employeeId: string, now = new Date()): Promise<string | null> {
  const settings = await readSettings(db);
  if (!settings.checkinReleaseEnabled) return null;
  if (format(new TZDate(now, TZ), "HH:mm") >= settings.checkinReleaseTime) return null;
  const today = localToday(now);
  const rows = await db.execute(sql`
    select 1 from desk_booking b
     where b.employee_id = ${employeeId}::uuid and b.booking_date = ${today}::date and b.status = 'confirmed'
       and desk_class(b.resource_id, b.booking_date) = 'shared'
       and not exists (select 1 from checkin c join desk_booking o on o.id = c.desk_booking_id
                        where o.employee_id = b.employee_id and o.booking_date = b.booking_date)`);
  return rows.rows.length ? settings.checkinReleaseTime : null;
}

/**
 * PAR-06: liberação automática por falta de confirmação de uso. Desativada por padrão. Quando ativada, depois do
 * horário configurado, cancela reservas confirmadas de hoje sem confirmação em mesas de classe compartilhada, com
 * comunicação e auditoria, e oferece a mesa à fila. Mesa com política exclusiva nunca é tocada (DIR-006).
 */
export async function releaseUnconfirmed(db: Db, now = new Date()): Promise<number> {
  const settings = await readSettings(db);
  if (!settings.checkinReleaseEnabled) return 0;
  const local = new TZDate(now, TZ);
  if (format(local, "HH:mm") < settings.checkinReleaseTime) return 0;
  const today = localToday(now);
  const [h, m] = settings.checkinReleaseTime.split(":").map(Number);
  const [y, mo, d] = today.split("-").map(Number);
  // Instante limite do dia: só reserva que já estava confirmada antes dele pode ser liberada (T-03). Oferta aceita conta
  // do aceite; reserva feita ou aceita depois do limite nunca é liberada nesse dia.
  const deadline = new TZDate(y, mo - 1, d, h, m, 0, 0, TZ);
  const due = await db
    .select({ id: deskBooking.id, resourceId: deskBooking.resourceId, employeeId: deskBooking.employeeId, code: resource.code })
    .from(deskBooking)
    .innerJoin(resource, eq(resource.id, deskBooking.resourceId))
    .leftJoin(checkin, eq(checkin.deskBookingId, deskBooking.id))
    .where(
      and(
        eq(deskBooking.bookingDate, today),
        eq(deskBooking.status, "confirmed"),
        isNull(checkin.id),
        sql`desk_class(${deskBooking.resourceId}, ${today}::date) = 'shared'`,
        sql`coalesce((select o.decided_at from waitlist_offer o where o.hold_booking_id = ${deskBooking.id} and o.status = 'accepted'), ${deskBooking.createdAt}) < ${deadline.toISOString()}::timestamptz`,
        // Quem já declarou uso em outra reserva de mesa do dia (realocação depois da confirmação) não perde a mesa (T-04).
        sql`not exists (select 1 from checkin c join desk_booking o on o.id = c.desk_booking_id where o.employee_id = ${deskBooking.employeeId} and o.booking_date = ${today}::date)`,
      ),
    )
    .limit(100);
  let n = 0;
  for (const b of due) {
    try {
      await withOfficeTx(db, async (tx) => {
        await advisoryShareDay(tx, today);
        await shareLockEmployee(tx, b.employeeId);
        const candidates = (await lockQueueCandidates(tx, today)).filter((c) => c !== b.employeeId);
        await lockResources(tx, [b.resourceId]);
        const [again] = await tx.select({ status: deskBooking.status }).from(deskBooking).where(eq(deskBooking.id, b.id)).for("update");
        const [confirmed] = await tx.execute(sql`select c.id from checkin c join desk_booking o on o.id = c.desk_booking_id where o.employee_id = ${b.employeeId}::uuid and o.booking_date = ${today}::date limit 1`).then((r) => r.rows as Array<{ id: string }>);
        const cls = await tx.execute(sql`select desk_class(${b.resourceId}::uuid, ${today}::date) as c`);
        if (again?.status !== "confirmed" || confirmed || (cls.rows[0] as { c: string }).c !== "shared") return;
        const reason = `sem confirmação de uso até ${settings.checkinReleaseTime} (liberação automática, PAR-06)`;
        await tx.update(deskBooking).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: null, cancelReason: reason }).where(eq(deskBooking.id, b.id));
        await recordAudit(tx, { action: "booking.released_unconfirmed", entityType: "desk_booking", entityId: b.id, before: { status: "confirmed", resourceId: b.resourceId, employeeId: b.employeeId, date: today }, after: { status: "cancelled" }, reason });
        const [emp] = await tx.select({ email: employee.corporateEmail, name: employee.fullName }).from(employee).where(eq(employee.id, b.employeeId));
        if (emp) {
          await enqueueOutbox(tx, { eventType: "email.booking_changed", aggregateType: "desk_booking", aggregateId: b.id, payload: { message: bookingChangedEmail(emp.email, emp.name, `Sua reserva de hoje (${formatLocalDate(today)}) na mesa ${b.code} foi liberada por falta de confirmação de uso até ${settings.checkinReleaseTime}. Se você está no escritório, reserve outra mesa disponível.`) }, idempotencyKey: `booking.released_unconfirmed:${b.id}` });
        }
        await offerNext(tx, { resourceId: b.resourceId, date: today, candidateIds: candidates });
        n += 1;
      });
    } catch (e) {
      logger.warn({ bookingId: b.id, err: e instanceof Error ? e.message : String(e) }, "falha na liberação por falta de confirmação; próxima varredura");
    }
  }
  return n;
}
