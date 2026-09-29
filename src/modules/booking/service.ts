import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "@/db/client";
import { deskBooking, employee, presenceIntent, resource, weekPlanRequest } from "@/db/schema";
import { loadAccess } from "@/modules/access/can";
import { recordAudit } from "@/modules/audit/audit";
import { explain, type Availability } from "@/modules/availability/rules";
import { loadDayContext, loadPerson, loadResourcesOnDate, personBookingOn } from "@/modules/availability/service";
import { enqueueOutbox } from "@/modules/notifications/outbox";
import { bookingChangedEmail, bookingOnBehalfEmail } from "@/modules/notifications/templates";
import { formatLocalDate, localToday } from "@/modules/shared/dates";
import { ConflictError, ForbiddenError, ValidationError } from "@/modules/shared/errors";
import { type Actor, advisoryShareDay, assertIsoDate, assertUuid, expireHolds, lockDaysAndPeople, lockResources, shareLockEmployee, withOfficeTx } from "@/modules/office/shared";
import { closeWaitingEntryOf, declineOfferOfHold, lockQueueCandidates, offerNext } from "@/modules/waitlist/service";

/*
 * Reservas de mesa por dia (PAR-02). Toda escrita segue o protocolo de docs/dados/modelo-de-dados.md:
 * locks por data, pessoa e recurso, expiração preguiçosa, releitura, revalidação com o serviço de
 * disponibilidade e gravação com auditoria. Os triggers deferidos do banco são a segunda rede.
 */

export type BookInput = {
  /** Beneficiário. Igual ao ator em reserva própria. */
  employeeId: string;
  resourceId: string;
  date: string;
  idempotencyKey: string;
  origin?: "self" | "on_behalf";
  accessExceptionId?: string | null;
};

export type BookResult = { bookingId: string; created: boolean; resourceCode: string };

/** Revalidação dentro da transação, depois dos locks, com os mesmos dados da leitura. */
async function revalidate(tx: Tx, employeeId: string, resourceId: string, date: string, windowExempt = false): Promise<{ availability: Availability; code: string }> {
  const person = await loadPerson(tx, employeeId);
  const day = await loadDayContext(tx, date);
  const personBooking = await personBookingOn(tx, employeeId, date);
  const [r] = await loadResourcesOnDate(tx, date, { ids: [resourceId] });
  if (!r) throw new ValidationError("Mesa não encontrada.");
  if (r.type !== "desk") throw new ValidationError("Salas e cabines são reservadas por intervalo, em outra tela.");
  return { availability: explain(person, r, { ...day, personBooking, windowExempt }), code: r.code };
}

export async function bookDesk(db: Db, actor: Actor, input: BookInput): Promise<BookResult> {
  assertUuid(input.employeeId, "Pessoa");
  assertUuid(input.resourceId, "Mesa");
  assertIsoDate(input.date);
  if (!input.idempotencyKey || input.idempotencyKey.length > 120) throw new ValidationError("Chave de idempotência ausente.");
  const onBehalf = input.employeeId !== actor.employeeId;
  const access = await loadAccess(db, actor.employeeId);
  if (onBehalf) {
    if (!access.permissions.has("booking.on_behalf.create")) throw new ForbiddenError("Reservar em nome de outra pessoa exige permissão própria.");
  } else if (!access.permissions.has("booking.self.manage")) {
    throw new ForbiddenError("Sua conta não pode reservar.");
  }
  // A oferta à fila (PAR-37) precisa sobreviver à recusa da reserva direta: a transação confirma e o erro sai depois.
  const outcome = await withOfficeTx(db, async (tx): Promise<BookResult | { offeredToQueue: string }> => {
    const [existing] = await tx.select({ id: deskBooking.id, resourceId: deskBooking.resourceId }).from(deskBooking).where(and(eq(deskBooking.actorEmployeeId, actor.employeeId), eq(deskBooking.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      const [r] = await tx.select({ code: resource.code }).from(resource).where(eq(resource.id, existing.resourceId));
      return { bookingId: existing.id, created: false, resourceCode: r?.code ?? "" };
    }
    await advisoryShareDay(tx, input.date);
    if (onBehalf) await shareLockEmployee(tx, actor.employeeId < input.employeeId ? actor.employeeId : input.employeeId);
    const beneficiary = await shareLockEmployee(tx, input.employeeId);
    if (onBehalf && actor.employeeId > input.employeeId) await shareLockEmployee(tx, actor.employeeId);
    // PAR-37: a fila vem antes de quem clicou. As candidatas são travadas antes do recurso; a mesa livre é oferecida
    // à primeira elegível e a reserva direta recebe conflito explícito.
    const candidates = (await lockQueueCandidates(tx, input.date)).filter((c) => c !== input.employeeId);
    await lockResources(tx, [input.resourceId]);
    await expireHolds(tx, { resourceId: input.resourceId, employeeId: input.employeeId, date: input.date });
    const offered = await offerNext(tx, { resourceId: input.resourceId, date: input.date, candidateIds: candidates, requestId: actor.requestId });
    const { availability, code } = await revalidate(tx, input.employeeId, input.resourceId, input.date);
    if (offered) return { offeredToQueue: code };
    if (!availability.canBook) throw new ConflictError(`Não foi possível reservar a mesa ${code} em ${formatLocalDate(input.date)}: ${availability.reason}.`);
    const [row] = await tx
      .insert(deskBooking)
      .values({
        resourceId: input.resourceId,
        employeeId: input.employeeId,
        bookingDate: input.date,
        status: "confirmed",
        origin: onBehalf ? "on_behalf" : "self",
        actorEmployeeId: actor.employeeId,
        idempotencyKey: input.idempotencyKey,
        accessExceptionId: input.accessExceptionId ?? null,
      })
      .returning({ id: deskBooking.id });
    await closeWaitingEntryOf(tx, actor, input.employeeId, input.date, "reserva direta feita");
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: onBehalf ? "booking.created_on_behalf" : "booking.created", entityType: "desk_booking", entityId: row.id, after: { resourceId: input.resourceId, employeeId: input.employeeId, date: input.date }, requestId: actor.requestId });
    if (onBehalf) {
      const [target] = await tx.select({ email: employee.corporateEmail }).from(employee).where(eq(employee.id, input.employeeId));
      const [who] = await tx.select({ name: employee.fullName }).from(employee).where(eq(employee.id, actor.employeeId));
      if (target) {
        await enqueueOutbox(tx, {
          eventType: "email.booking_on_behalf",
          aggregateType: "desk_booking",
          aggregateId: row.id,
          payload: { message: bookingOnBehalfEmail(target.email, beneficiary.fullName, code, formatLocalDate(input.date), who?.name ?? "O RH") },
          idempotencyKey: `booking.on_behalf:${row.id}`,
        });
      }
    }
    return { bookingId: row.id, created: true, resourceCode: code };
  });
  if ("offeredToQueue" in outcome) throw new ConflictError(`A mesa ${outcome.offeredToQueue} foi oferecida à próxima pessoa da fila de espera em ${formatLocalDate(input.date)} (a fila tem prioridade). Escolha outra mesa.`);
  return outcome;
}

/** Cancelamento próprio ou administrativo. Cancelar reserva do titular não altera a exclusividade (DIR-006). */
export async function cancelDesk(db: Db, actor: Actor, bookingId: string, input: { reason?: string; message?: string } = {}): Promise<{ resourceCode: string; date: string }> {
  assertUuid(bookingId, "Reserva");
  return withOfficeTx(db, async (tx) => {
    const [b] = await tx
      .select({ id: deskBooking.id, resourceId: deskBooking.resourceId, employeeId: deskBooking.employeeId, date: deskBooking.bookingDate, status: deskBooking.status, code: resource.code })
      .from(deskBooking)
      .innerJoin(resource, eq(resource.id, deskBooking.resourceId))
      .where(eq(deskBooking.id, bookingId));
    if (!b) throw new ValidationError("Reserva não encontrada.");
    const own = b.employeeId === actor.employeeId;
    const access = await loadAccess(tx, actor.employeeId);
    if (!own) {
      if (!access.permissions.has("booking.admin.manage")) throw new ForbiddenError("Cancelar reserva de outra pessoa exige permissão administrativa.");
      if (!input.reason?.trim()) throw new ValidationError("Informe o motivo do cancelamento administrativo.");
    } else if (!access.permissions.has("booking.self.manage")) {
      throw new ForbiddenError("Sua conta não pode alterar reservas.");
    }
    if (b.status !== "confirmed" && b.status !== "held") throw new ConflictError("Esta reserva já não está ativa.");
    if (b.date < localToday()) throw new ConflictError("Reserva de dia passado não é cancelada.");
    await advisoryShareDay(tx, b.date);
    // cancelled_by e a pessoa da reserva tomam chave da pessoa: antes do recurso, para não inverter contra a desativação.
    await lockDaysAndPeople(tx, { dates: [], people: [b.employeeId, actor.employeeId] });
    const candidates = (await lockQueueCandidates(tx, b.date)).filter((c) => c !== b.employeeId);
    await lockResources(tx, [b.resourceId]);
    // Releitura depois dos locks: cancelamento concorrente ou vencimento entre a leitura e o lock.
    const [now] = await tx.select({ status: deskBooking.status }).from(deskBooking).where(eq(deskBooking.id, bookingId));
    if (!now || (now.status !== "confirmed" && now.status !== "held")) throw new ConflictError("Esta reserva já não está ativa.");
    await tx
      .update(deskBooking)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.employeeId, cancelReason: input.reason?.trim() || (own ? "cancelada pela própria pessoa" : null) })
      .where(eq(deskBooking.id, bookingId));
    // Retenção da fila cancelada por aqui: a oferta e a inscrição acompanham.
    if (b.status === "held") await declineOfferOfHold(tx, actor, bookingId, input.reason?.trim() || "retenção cancelada");
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: own ? "booking.cancelled" : "booking.cancelled_by_admin", entityType: "desk_booking", entityId: bookingId, before: { status: b.status, resourceId: b.resourceId, date: b.date, employeeId: b.employeeId }, after: { status: "cancelled" }, reason: input.reason, requestId: actor.requestId });
    if (!own) {
      const [emp] = await tx.select({ email: employee.corporateEmail, name: employee.fullName }).from(employee).where(eq(employee.id, b.employeeId));
      if (emp) {
        await enqueueOutbox(tx, {
          eventType: "email.booking_changed",
          aggregateType: "desk_booking",
          aggregateId: bookingId,
          payload: { message: bookingChangedEmail(emp.email, emp.name, `Sua reserva de ${formatLocalDate(b.date)} na mesa ${b.code} foi cancelada pela administração. ${input.message?.trim() ?? ""}`.trim()) },
          idempotencyKey: `booking.cancelled:${bookingId}`,
        });
      }
    }
    // DIR-034 e PAR-37: a mesa liberada é oferecida à próxima pessoa elegível na mesma transação. Mesa exclusiva do
    // titular não é oferecida a quem não é elegível (DIR-025): a mesma função de disponibilidade decide.
    await offerNext(tx, { resourceId: b.resourceId, date: b.date, candidateIds: candidates, requestId: actor.requestId });
    return { resourceCode: b.code, date: b.date };
  });
}

export type WeekDayInput = { date: string; intent: "onsite" | "remote" | "not_informed"; resourceId?: string | null };
export type WeekPlanResult = { ok: boolean; applied: Array<{ date: string; resourceCode: string | null; bookingId: string | null }>; conflicts: Array<{ date: string; resourceCode: string | null; reason: string }> };

/**
 * Semana atômica e idempotente (PAR-04, BKG-02): intenção por dia e, quando escolhida, mesa por dia.
 * Tudo ou nada; em conflito, nada é gravado e os dias afetados voltam com a razão do serviço de disponibilidade.
 * Aceitar seleção menor é uma nova requisição com nova chave. Intenção não é reserva (REQ-25).
 */
export async function planWeek(db: Db, actor: Actor, input: { idempotencyKey: string; days: WeekDayInput[] }): Promise<WeekPlanResult> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 120) throw new ValidationError("Chave de idempotência ausente.");
  if (input.days.length === 0 || input.days.length > 7) throw new ValidationError("Selecione de um a sete dias.");
  for (const d of input.days) {
    assertIsoDate(d.date);
    if (d.resourceId) assertUuid(d.resourceId, "Mesa");
    if (d.resourceId && d.intent !== "onsite") throw new ValidationError("Só dia presencial recebe mesa.");
  }
  if (new Set(input.days.map((d) => d.date)).size !== input.days.length) throw new ValidationError("Cada dia aparece uma única vez.");
  const access = await loadAccess(db, actor.employeeId);
  if (!access.permissions.has("booking.self.manage")) throw new ForbiddenError("Sua conta não pode planejar a semana.");
  return withOfficeTx(db, async (tx) => {
    const [prior] = await tx.select().from(weekPlanRequest).where(and(eq(weekPlanRequest.employeeId, actor.employeeId), eq(weekPlanRequest.idempotencyKey, input.idempotencyKey)));
    if (prior?.result) return prior.result as WeekPlanResult;
    const withDesk = input.days.filter((d) => d.resourceId);
    for (const d of input.days) await advisoryShareDay(tx, d.date);
    await shareLockEmployee(tx, actor.employeeId);
    const candidatesByDate = new Map<string, string[]>();
    for (const d of withDesk) candidatesByDate.set(d.date, (await lockQueueCandidates(tx, d.date)).filter((c) => c !== actor.employeeId));
    await lockResources(tx, withDesk.map((d) => d.resourceId!));
    for (const d of withDesk) await expireHolds(tx, { resourceId: d.resourceId!, employeeId: actor.employeeId, date: d.date });
    const conflicts: WeekPlanResult["conflicts"] = [];
    const checks: Array<{ date: string; resourceId: string; code: string }> = [];
    for (const d of withDesk) {
      // PAR-37: mesa livre com fila em espera vai para a fila; o dia volta como conflito explícito.
      const offered = await offerNext(tx, { resourceId: d.resourceId!, date: d.date, candidateIds: candidatesByDate.get(d.date) ?? [], requestId: actor.requestId });
      const { availability, code } = await revalidate(tx, actor.employeeId, d.resourceId!, d.date);
      if (offered) {
        conflicts.push({ date: d.date, resourceCode: code, reason: "mesa oferecida à próxima pessoa da fila de espera (a fila tem prioridade)" });
        continue;
      }
      if (availability.code === "mine") continue; // já reservada nesta mesa: idempotente por dia
      if (!availability.canBook) conflicts.push({ date: d.date, resourceCode: code, reason: availability.reason });
      else checks.push({ date: d.date, resourceId: d.resourceId!, code });
    }
    if (conflicts.length) {
      const result: WeekPlanResult = { ok: false, applied: [], conflicts };
      // A requisição é registrada com o resultado de conflito, para que a repetição da mesma chave devolva o mesmo.
      await tx.insert(weekPlanRequest).values({ employeeId: actor.employeeId, idempotencyKey: input.idempotencyKey, payload: input.days, result }).onConflictDoNothing();
      return result;
    }
    const [req] = await tx.insert(weekPlanRequest).values({ employeeId: actor.employeeId, idempotencyKey: input.idempotencyKey, payload: input.days }).returning({ id: weekPlanRequest.id });
    const applied: WeekPlanResult["applied"] = [];
    for (const d of input.days) {
      await tx
        .insert(presenceIntent)
        .values({ employeeId: actor.employeeId, date: d.date, intent: d.intent })
        .onConflictDoUpdate({ target: [presenceIntent.employeeId, presenceIntent.date], set: { intent: d.intent, updatedAt: new Date() } });
      const c = checks.find((x) => x.date === d.date);
      if (!c) {
        applied.push({ date: d.date, resourceCode: null, bookingId: null });
        continue;
      }
      const [row] = await tx
        .insert(deskBooking)
        .values({ resourceId: c.resourceId, employeeId: actor.employeeId, bookingDate: d.date, status: "confirmed", origin: "week_plan", actorEmployeeId: actor.employeeId, weekPlanRequestId: req.id })
        .returning({ id: deskBooking.id });
      applied.push({ date: d.date, resourceCode: c.code, bookingId: row.id });
      await closeWaitingEntryOf(tx, actor, actor.employeeId, d.date, "reserva feita pelo planejamento da semana");
    }
    const result: WeekPlanResult = { ok: true, applied, conflicts: [] };
    await tx.update(weekPlanRequest).set({ result }).where(eq(weekPlanRequest.id, req.id));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "week_plan.applied", entityType: "week_plan_request", entityId: req.id, after: { days: input.days.length, bookings: checks.length }, requestId: actor.requestId });
    return result;
  });
}

export async function listMyBookings(db: DbOrTx, employeeId: string, from = localToday()) {
  const upcoming = await db
    .select({ id: deskBooking.id, date: deskBooking.bookingDate, status: deskBooking.status, origin: deskBooking.origin, code: resource.code, resourceId: deskBooking.resourceId, holdExpiresAt: deskBooking.holdExpiresAt })
    .from(deskBooking)
    .innerJoin(resource, eq(resource.id, deskBooking.resourceId))
    .where(and(eq(deskBooking.employeeId, employeeId), gte(deskBooking.bookingDate, from), inArray(deskBooking.status, ["confirmed", "held"])))
    .orderBy(asc(deskBooking.bookingDate));
  const past = await db
    .select({ id: deskBooking.id, date: deskBooking.bookingDate, status: deskBooking.status, origin: deskBooking.origin, code: resource.code })
    .from(deskBooking)
    .innerJoin(resource, eq(resource.id, deskBooking.resourceId))
    .where(and(eq(deskBooking.employeeId, employeeId), lt(deskBooking.bookingDate, from)))
    .orderBy(desc(deskBooking.bookingDate))
    .limit(30);
  return { upcoming: upcoming.filter((b) => b.status === "confirmed" || (b.holdExpiresAt && b.holdExpiresAt > new Date())), past };
}

export async function weekOverview(db: DbOrTx, employeeId: string, dates: string[]) {
  const intents = await db.select().from(presenceIntent).where(and(eq(presenceIntent.employeeId, employeeId), inArray(presenceIntent.date, dates)));
  const bookings = await db
    .select({ date: deskBooking.bookingDate, code: resource.code, id: deskBooking.id })
    .from(deskBooking)
    .innerJoin(resource, eq(resource.id, deskBooking.resourceId))
    .where(and(eq(deskBooking.employeeId, employeeId), inArray(deskBooking.bookingDate, dates), eq(deskBooking.status, "confirmed")));
  return dates.map((date) => ({ date, intent: intents.find((i) => i.date === date)?.intent ?? "not_informed", booking: bookings.find((b) => b.date === date) ?? null }));
}

/** Mesa habitual do titular: atribuição individual vigente hoje (DIR-009). */
export async function habitualDesk(db: DbOrTx, employeeId: string, today = localToday()) {
  const { exclusiveAssignment } = await import("@/db/schema");
  const [row] = await db
    .select({ code: resource.code, resourceId: resource.id, validTo: exclusiveAssignment.validTo })
    .from(exclusiveAssignment)
    .innerJoin(resource, eq(resource.id, exclusiveAssignment.resourceId))
    .where(and(eq(exclusiveAssignment.holderEmployeeId, employeeId), eq(exclusiveAssignment.mode, "individual"), sql`${exclusiveAssignment.cancelledAt} is null`, sql`${exclusiveAssignment.validFrom} <= ${today}::date`, sql`(${exclusiveAssignment.validTo} is null or ${exclusiveAssignment.validTo} >= ${today}::date)`));
  return row ?? null;
}

export async function listBookingsAdmin(db: DbOrTx, filter: { date: string }) {
  return db
    .select({ id: deskBooking.id, code: resource.code, employeeName: employee.fullName, employeeId: deskBooking.employeeId, status: deskBooking.status, origin: deskBooking.origin, holdExpiresAt: deskBooking.holdExpiresAt })
    .from(deskBooking)
    .innerJoin(resource, eq(resource.id, deskBooking.resourceId))
    .innerJoin(employee, eq(employee.id, deskBooking.employeeId))
    .where(and(eq(deskBooking.bookingDate, filter.date), inArray(deskBooking.status, ["confirmed", "held"])))
    .orderBy(asc(resource.code));
}
