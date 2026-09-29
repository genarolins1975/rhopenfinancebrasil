import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "@/db/client";
import { deskBooking, employee, officeSettings, resource, waitlistEntry, waitlistOffer } from "@/db/schema";
import { loadAccess } from "@/modules/access/can";
import { recordAudit } from "@/modules/audit/audit";
import { enqueueOutbox } from "@/modules/notifications/outbox";
import { waitlistExpiredEmail } from "@/modules/notifications/templates";
import { formatLocalDate } from "@/modules/shared/dates";
import type { Permission } from "@/modules/access/permissions";
import { pgErrorOf } from "@/modules/shared/db-errors";
import { ConflictError, ForbiddenError, ValidationError } from "@/modules/shared/errors";
import { logger } from "@/modules/shared/logger";

export type Actor = { employeeId: string; userId: string; requestId?: string };

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Data ISO que existe no calendário (2026-02-30 não passa: `Date.parse` normalizaria para março). */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function assertIsoDate(value: string, label = "Data"): string {
  if (!isValidIsoDate(value)) throw new ValidationError(`${label} inválida.`);
  return value;
}

export function assertUuid(value: string, label = "Identificador"): string {
  if (!UUID_RE.test(value)) throw new ValidationError(`${label} inválido.`);
  return value;
}

/** Mensagens de domínio para as exceções levantadas pelas funções e triggers do banco (código P0001). */
const DB_RULE_MESSAGES: Record<string, string> = {
  booking_conflict: "Existem reservas incompatíveis com esta operação. Trate cada uma antes de confirmar.",
  booking_not_allowed: "A reserva não é permitida para esta pessoa, mesa e data.",
  assignment_starts_in_past: "A vigência de uma atribuição começa hoje ou depois.",
  assignment_created_closed: "Atribuição nova não nasce encerrada nem anulada.",
  assignment_cancelled_frozen: "Atribuição anulada não muda mais.",
  assignment_ended_frozen: "Atribuição encerrada não muda mais. Para reabrir, crie uma nova.",
  assignment_start_immutable: "O início não muda depois que a atribuição começou.",
  assignment_start_in_past: "O início não pode ficar no passado.",
  assignment_reopen_forbidden: "Término preenchido não volta a ficar em aberto. Para reabrir, crie uma nova atribuição.",
  assignment_end_in_past: "O término não pode ficar no passado.",
  assignment_cancel_only_before_start: "Só atribuição agendada, ainda não iniciada, pode ser anulada. Para as demais, encerre.",
  exception_outside_assignment: "A liberação precisa caber inteira na vigência da atribuição.",
  exception_resource_mismatch: "A liberação precisa ser da mesma mesa da atribuição.",
  exception_on_cancelled_assignment: "Atribuição anulada não recebe liberação.",
  exception_too_long: "A liberação temporária excede a duração máxima configurada. Acima disso, encerre a atribuição.",
  exception_starts_in_past: "A liberação começa hoje ou depois.",
  beneficiary_is_holder: "O titular não precisa de liberação para a própria mesa.",
  assignment_not_found: "Atribuição não encontrada.",
  assignment_not_active: "Só atribuição vigente ou agendada pode ser transferida.",
  transfer_requires_individual: "Só atribuição individual é transferida.",
  transfer_in_past: "A transferência começa hoje ou depois.",
  transfer_before_start: "A transferência precisa começar depois do início da atribuição.",
  transfer_after_end: "A transferência não pode começar depois do término da atribuição.",
  transfer_same_holder: "O novo titular precisa ser outra pessoa.",
  transfer_without_successor: "Transferência sem sucessora contígua. Nada foi aplicado.",
  successor_cancel_needs_decision: "Anular a sucessora de uma transferência exige decisão explícita sobre a mesa.",
  assignment_identity_immutable: "Mesa, modalidade e titular de uma atribuição não mudam. Transfira ou encerre e crie outra.",
  exception_identity_immutable: "Uma liberação não é editada: revogue e crie outra.",
  offer_inconsistent: "A oferta não corresponde a uma retenção válida da pessoa na mesa e data da inscrição.",
  offer_entry_not_waiting: "A inscrição já não está em espera.",
  offer_already_expired: "A oferta nasceria vencida.",
  offer_identity_immutable: "Inscrição, mesa e retenção de uma oferta não mudam.",
  offer_already_decided: "Esta oferta já foi decidida.",
  entry_identity_immutable: "Pessoa e data de uma inscrição não mudam.",
  entry_already_closed: "Esta inscrição já foi encerrada.",
  checkin_not_allowed: "A confirmação de uso vale só para a sua reserva confirmada, no dia da reserva.",
  checkin_immutable: "Uma confirmação de uso não é alterada.",
  entry_must_start_waiting: "Uma inscrição na fila começa em espera.",
  offer_incoherent: "Oferta, retenção e inscrição ficariam incoerentes. Nada foi aplicado.",
  entry_incoherent: "A inscrição ficaria sem a oferta correspondente. Nada foi aplicado.",
  hold_incoherent: "A retenção da fila só vira reserva com a oferta aceita. Nada foi aplicado.",
};

/** Converte erro do banco em erro de domínio: regra de trigger, exclusão, unicidade, deadlock ou tempo de lock. */
export function translateOfficeDbError(e: unknown): Error | null {
  const pg = pgErrorOf(e);
  if (!pg) return null;
  if (pg.code === "P0001" || pg.code === "P0002") {
    const key = String((pg as { message?: string }).message ?? "").trim();
    const known = DB_RULE_MESSAGES[key];
    if (known) return new ConflictError(known);
    return new ConflictError("A operação foi recusada por uma regra do banco. Nada foi aplicado.");
  }
  if (pg.code === "23P01") return new ConflictError("Já existe um registro vigente que se sobrepõe a este período.");
  if (pg.code === "23505") return new ConflictError("Já existe reserva ou registro equivalente para esta combinação.");
  if (pg.code === "40P01" || pg.code === "55P03") return new ConflictError("Outra operação está em andamento sobre o mesmo recurso. Tente de novo.");
  return null;
}

function isRetryable(e: unknown): boolean {
  const pg = pgErrorOf(e);
  return !!pg && (pg.code === "40P01" || pg.code === "55P03");
}

/**
 * Protocolo transacional do escritório: read committed, lock_timeout e statement_timeout locais (PAR-34),
 * até três tentativas em deadlock ou tempo de lock, erro de banco traduzido para domínio.
 */
export async function withOfficeTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '3s'`);
        await tx.execute(sql`set local statement_timeout = '15s'`);
        return fn(tx);
      });
    } catch (e) {
      if (isRetryable(e) && attempt < 3) {
        logger.warn({ attempt }, "nova tentativa da transação do escritório");
        await new Promise((r) => setTimeout(r, 50 * attempt));
        continue;
      }
      const translated = translateOfficeDbError(e);
      if (translated) throw translated;
      throw e;
    }
  }
}

/** Lock dos recursos em ordem crescente de id, em instrução separada (passo 5 do protocolo). */
export async function lockResources(tx: Tx, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return;
  for (const id of unique) assertUuid(id, "Recurso");
  await tx.select({ id: resource.id }).from(resource).where(inArray(resource.id, unique)).orderBy(asc(resource.id)).for("update");
}

/** `for share` na pessoa: serializa contra desativação e suspensão, que tomam `for update`. */
export async function shareLockEmployee(tx: Tx, employeeId: string): Promise<{ id: string; status: string; fullName: string }> {
  const rows = await tx.execute(sql`select id, status, full_name from employee where id = ${employeeId} for share`);
  const row = (rows.rows as Array<{ id: string; status: string; full_name: string }>)[0];
  if (!row) throw new ValidationError("Pessoa não encontrada.");
  return { id: row.id, status: row.status, fullName: row.full_name };
}

/**
 * Passos 3 e 4 do protocolo para operações que tratam reservas de terceiros: lock compartilhado de cada dia
 * e `for share` de cada pessoa envolvida, em ordem, antes dos recursos. Os triggers tomariam o dia e a chave da
 * pessoa depois do recurso, o que inverte a ordem contra desativação e fechamento de dia.
 */
export async function lockDaysAndPeople(tx: Tx, input: { dates: string[]; people: string[] }): Promise<void> {
  for (const d of [...new Set(input.dates)].sort()) await advisoryShareDay(tx, d);
  for (const p of [...new Set(input.people)].sort()) await shareLockEmployee(tx, p);
}

export async function advisoryShareDay(tx: Tx, date: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext(${"office_day:" + date}))`);
}

/**
 * Serializa as operações de uma pessoa numa data (inscrição na fila, reserva, semana, aceite), que só tomam `for share`
 * na pessoa. Tomado logo depois das pessoas e antes das pessoas em espera e dos recursos.
 */
export async function advisoryPersonDay(tx: Tx, employeeId: string, date: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`person_day:${employeeId}:${date}`}))`);
}

export async function advisoryExclusiveDay(tx: Tx, date: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"office_day:" + date}))`);
}

/**
 * Expiração preguiçosa de retenções vencidas da mesa e da pessoa na data (passo 6), sempre com os dois filtros.
 * Cascata para a oferta e a inscrição da fila (DIR-034): oferta vencida vira `expired`, a inscrição sai da fila e a pessoa
 * é avisada. Sem job: quem escreve expira antes de gravar. Devolve a quantidade expirada; quem chama e tem a mesa travada
 * oferece à próxima pessoa elegível (PAR-37).
 */
export async function expireHolds(tx: DbOrTx, filter: { resourceId?: string; employeeId?: string; date: string }): Promise<number> {
  const conds = [];
  if (filter.resourceId) conds.push(and(eq(deskBooking.resourceId, filter.resourceId), eq(deskBooking.bookingDate, filter.date)));
  if (filter.employeeId) conds.push(and(eq(deskBooking.employeeId, filter.employeeId), eq(deskBooking.bookingDate, filter.date)));
  if (conds.length === 0) return 0;
  const rows = await tx
    .update(deskBooking)
    .set({ status: "expired" })
    .where(and(eq(deskBooking.status, "held"), lte(deskBooking.holdExpiresAt, sql`now()`), or(...conds)))
    .returning({ id: deskBooking.id, resourceId: deskBooking.resourceId, employeeId: deskBooking.employeeId, date: deskBooking.bookingDate });
  if (rows.length === 0) return 0;
  await expireOffersOf(tx, rows);
  return rows.length;
}

/** Cascata da expiração: oferta aberta cuja retenção venceu, inscrição correspondente e aviso à pessoa. */
export async function expireOffersOf(tx: DbOrTx, holds: Array<{ id: string; resourceId: string; employeeId: string; date: string }>): Promise<void> {
  const offers = await tx
    .update(waitlistOffer)
    .set({ status: "expired", decidedAt: sql`now()` })
    .where(and(eq(waitlistOffer.status, "open"), inArray(waitlistOffer.holdBookingId, holds.map((h) => h.id))))
    .returning({ id: waitlistOffer.id, entryId: waitlistOffer.entryId, holdBookingId: waitlistOffer.holdBookingId });
  if (offers.length === 0) return;
  await tx
    .update(waitlistEntry)
    .set({ status: "expired", closedAt: sql`now()`, closeReason: "oferta vencida" })
    .where(and(eq(waitlistEntry.status, "offered"), inArray(waitlistEntry.id, offers.map((o) => o.entryId))));
  for (const o of offers) {
    const h = holds.find((x) => x.id === o.holdBookingId)!;
    const [r] = await tx.select({ code: resource.code }).from(resource).where(eq(resource.id, h.resourceId));
    await recordAudit(tx, { action: "waitlist.offer_expired", entityType: "waitlist_offer", entityId: o.id, before: { status: "open" }, after: { status: "expired", entryId: o.entryId, resourceId: h.resourceId, date: h.date } });
    const [emp] = await tx.select({ email: employee.corporateEmail, name: employee.fullName }).from(employee).where(eq(employee.id, h.employeeId));
    if (emp) {
      await enqueueOutbox(tx, { eventType: "email.waitlist", aggregateType: "waitlist_offer", aggregateId: o.id, payload: { message: waitlistExpiredEmail(emp.email, emp.name, r?.code ?? "", formatLocalDate(h.date)) }, idempotencyKey: `waitlist.expired:${o.id}` });
    }
  }
}

export async function assertPermission(db: DbOrTx, actor: Actor, permission: Permission): Promise<void> {
  const access = await loadAccess(db, actor.employeeId);
  if (!access.permissions.has(permission)) throw new ForbiddenError("Esta ação não está disponível para o seu perfil.");
}

export async function assertAnyPermission(db: DbOrTx, actor: Actor, permissions: Permission[]): Promise<Set<Permission>> {
  const access = await loadAccess(db, actor.employeeId);
  if (!permissions.some((p) => access.permissions.has(p))) throw new ForbiddenError("Esta ação não está disponível para o seu perfil.");
  return access.permissions;
}

export type OfficeSettings = {
  bookingOpenWeekday: number;
  bookingOpenTime: string;
  bookingHorizonWeeks: number;
  exceptionMaxDays: number;
  /** PAR-05: prazo da oferta da fila em minutos úteis. */
  offerMinutes: number;
  businessHoursStart: string;
  businessHoursEnd: string;
  /** PAR-06: liberação por falta de confirmação de uso, desativada por padrão. */
  checkinReleaseEnabled: boolean;
  checkinReleaseTime: string;
};

export async function readSettings(db: DbOrTx): Promise<OfficeSettings> {
  const rows = await db.select().from(officeSettings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;
  return {
    bookingOpenWeekday: Number(map.booking_open_weekday ?? 4),
    bookingOpenTime: String(map.booking_open_time ?? "10:00"),
    bookingHorizonWeeks: Number(map.booking_horizon_weeks ?? 4),
    exceptionMaxDays: Number(map.exception_max_days ?? 30),
    offerMinutes: Number(map.offer_minutes ?? 120),
    businessHoursStart: String(map.business_hours_start ?? "09:00"),
    businessHoursEnd: String(map.business_hours_end ?? "18:00"),
    checkinReleaseEnabled: map.checkin_release_enabled === true,
    checkinReleaseTime: String(map.checkin_release_time ?? "11:00"),
  };
}

export async function resourceIdsByCodes(db: DbOrTx, codes: string[]): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const rows = await db.select({ id: resource.id, code: resource.code }).from(resource).where(inArray(resource.code, codes));
  return new Map(rows.map((r) => [r.code, r.id]));
}

export async function employeeSummary(db: DbOrTx, id: string) {
  const [row] = await db.select({ id: employee.id, fullName: employee.fullName, status: employee.status, orgCondition: employee.orgCondition }).from(employee).where(eq(employee.id, id));
  return row ?? null;
}
