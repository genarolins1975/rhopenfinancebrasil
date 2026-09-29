import { and, asc, eq, gt, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "@/db/client";
import { deskBooking, employee, officeCalendar, resource, waitlistEntry, waitlistOffer, zone } from "@/db/schema";
import { loadAccess } from "@/modules/access/can";
import { recordAudit } from "@/modules/audit/audit";
import { explainFor, loadDayContext, personBookingOn } from "@/modules/availability/service";
import { enqueueOutbox } from "@/modules/notifications/outbox";
import { bookingChangedEmail, waitlistOfferEmail, waitlistRemovedEmail } from "@/modules/notifications/templates";
import { formatLocal, formatLocalDate, localToday } from "@/modules/shared/dates";
import { ConflictError, ForbiddenError, ValidationError } from "@/modules/shared/errors";
import { pgErrorOf } from "@/modules/shared/db-errors";
import { logger } from "@/modules/shared/logger";
import { type Actor, advisoryPersonDay, advisoryShareDay, assertIsoDate, assertUuid, expireHolds, lockResources, readSettings, shareLockEmployee, withOfficeTx } from "@/modules/office/shared";
import { offerExpiresAt } from "./rules";

/*
 * Fila de espera (REQ-26, DIR-025, DIR-034, PAR-05, PAR-30, PAR-37). A oferta é uma retenção (`desk_booking` held) criada
 * na transação que liberou a mesa; a próxima pessoa elegível recebe a oferta antes de qualquer reserva direta. Oferta
 * vencida não trava mesa nem pessoa: a leitura ignora e a escrita expira antes de gravar. O job é conveniência.
 *
 * Ordem de locks (docs/dados/modelo-de-dados.md): dia (compartilhado) → pessoas (`for share`), inclusive as candidatas
 * da fila na data, tomadas antes do recurso → recurso (`for update`) → expiração preguiçosa → oferta. Candidatas que
 * entraram na fila depois da foto não são consideradas nesta transação; a varredura do worker as atende em seguida.
 */

export type Preferences = { zoneCode?: string | null };

export type OfferMade = { offerId: string; entryId: string; employeeId: string; holdBookingId: string; resourceId: string; expiresAt: Date };

/** Pessoas em espera na data, travadas `for share` em ordem, antes do recurso. Devolve os ids para `offerNext`. */
export async function lockQueueCandidates(tx: Tx, date: string): Promise<string[]> {
  const rows = await tx
    .select({ employeeId: waitlistEntry.employeeId })
    .from(waitlistEntry)
    .where(and(eq(waitlistEntry.date, date), eq(waitlistEntry.status, "waiting")))
    .orderBy(asc(waitlistEntry.employeeId));
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  for (const id of ids) await shareLockEmployee(tx, id);
  return ids;
}

async function businessHours(db: DbOrTx, from: Date) {
  const settings = await readSettings(db);
  const start = localToday(from);
  const closed = await db
    .select({ date: officeCalendar.date })
    .from(officeCalendar)
    .where(and(eq(officeCalendar.isOpen, false), gte(officeCalendar.date, start)));
  return { settings, cfg: { start: settings.businessHoursStart, end: settings.businessHoursEnd, closedDates: new Set(closed.map((c) => c.date)) } };
}

/** Mesa de uso exclusivo (individual ou de grupo) livre e reservável para a pessoa na data, ou null. Só leitura. */
export async function ownExclusiveFree(db: DbOrTx, employeeId: string, date: string): Promise<string | null> {
  const rows = await db.execute(sql`
    select a.resource_id from exclusive_assignment a
     where a.cancelled_at is null and a.valid_from <= ${date}::date and (a.valid_to is null or a.valid_to >= ${date}::date)
       and ((a.mode = 'individual' and a.holder_employee_id = ${employeeId}::uuid)
         or (a.mode = 'group' and exists (select 1 from access_group_member m where m.group_id = a.access_group_id and m.employee_id = ${employeeId}::uuid
                                             and m.valid_from <= ${date}::date and (m.valid_to is null or m.valid_to >= ${date}::date))))
     order by a.resource_id`);
  for (const r of rows.rows as Array<{ resource_id: string }>) {
    const { availability } = await explainFor(db, employeeId, r.resource_id, date);
    if (availability.canBook) return r.resource_id;
  }
  return null;
}

async function closeEntryWithNotice(tx: Tx, entryId: string, employeeId: string, date: string, reason: string, text: string): Promise<void> {
  const [closed] = await tx.update(waitlistEntry).set({ status: "cancelled", closedAt: new Date(), closeReason: reason }).where(and(eq(waitlistEntry.id, entryId), eq(waitlistEntry.status, "waiting"))).returning({ id: waitlistEntry.id });
  if (!closed) return;
  await recordAudit(tx, { action: "waitlist.left", entityType: "waitlist_entry", entityId: entryId, after: { status: "cancelled", why: reason, date } });
  const [emp] = await tx.select({ email: employee.corporateEmail, name: employee.fullName }).from(employee).where(eq(employee.id, employeeId));
  if (emp) await enqueueOutbox(tx, { eventType: "email.waitlist", aggregateType: "waitlist_entry", aggregateId: entryId, payload: { message: bookingChangedEmail(emp.email, emp.name, text) }, idempotencyKey: `waitlist.closed:${entryId}` });
}

/** Fechamento do dia (DIR-033): inscrições em espera da data são encerradas com aviso; a fila não sobrevive a dia fechado. */
export async function closeQueueForDate(tx: Tx, actor: Actor, date: string, reason: string): Promise<number> {
  const rows = await tx.select({ id: waitlistEntry.id, employeeId: waitlistEntry.employeeId }).from(waitlistEntry).where(and(eq(waitlistEntry.date, date), eq(waitlistEntry.status, "waiting")));
  for (const r of rows) {
    await closeEntryWithNotice(tx, r.id, r.employeeId, date, `escritório fechado: ${reason}`, `O escritório estará fechado em ${formatLocalDate(date)} (${reason}). Sua inscrição na fila de espera dessa data foi encerrada.`);
  }
  void actor;
  return rows.length;
}

/** Vencimento de uma oferta feita agora para a data (PAR-05): minutos úteis, limitado ao fim do dia da reserva. */
export async function offerExpiry(db: DbOrTx, date: string, now = new Date()): Promise<Date | null> {
  const { settings, cfg } = await businessHours(db, now);
  return offerExpiresAt(now, date, settings.offerMinutes, cfg);
}

function activeBookingWhere() {
  return or(eq(deskBooking.status, "confirmed"), and(eq(deskBooking.status, "held"), gt(deskBooking.holdExpiresAt, sql`now()`)));
}

/**
 * Oferece a mesa livre à primeira pessoa elegível entre as candidatas já travadas (FIFO por inscrição). Quem chama já
 * tomou o dia, as pessoas e o recurso, e expirou retenções vencidas. Devolve null quando não há elegível, quando a
 * mesa não está livre ou quando não há tempo mínimo de oferta no dia.
 */
export async function offerNext(
  tx: Tx,
  input: {
    resourceId: string;
    date: string;
    candidateIds: string[];
    offeredBy?: string | null;
    requestId?: string;
    /** Reserva direta de quem pode estar na fila: só concorrem as inscrições anteriores à dele (PAR-37). */
    aheadOfEmployeeId?: string;
  },
): Promise<OfferMade | null> {
  if (input.candidateIds.length === 0) return null;
  const [r] = await tx.select({ id: resource.id, code: resource.code, type: resource.type }).from(resource).where(eq(resource.id, input.resourceId));
  if (!r || r.type !== "desk") return null;
  const [taken] = await tx.select({ id: deskBooking.id }).from(deskBooking).where(and(eq(deskBooking.resourceId, input.resourceId), eq(deskBooking.bookingDate, input.date), activeBookingWhere()));
  if (taken) return null;
  let entries = await tx
    .select({ id: waitlistEntry.id, employeeId: waitlistEntry.employeeId, createdAt: waitlistEntry.createdAt })
    .from(waitlistEntry)
    .where(and(eq(waitlistEntry.date, input.date), eq(waitlistEntry.status, "waiting"), inArray(waitlistEntry.employeeId, input.candidateIds)))
    .orderBy(asc(waitlistEntry.createdAt), asc(waitlistEntry.id));
  if (input.aheadOfEmployeeId) {
    const [own] = await tx
      .select({ id: waitlistEntry.id, createdAt: waitlistEntry.createdAt })
      .from(waitlistEntry)
      .where(and(eq(waitlistEntry.employeeId, input.aheadOfEmployeeId), eq(waitlistEntry.date, input.date), eq(waitlistEntry.status, "waiting")));
    if (own) entries = entries.filter((e) => e.createdAt.getTime() < own.createdAt.getTime() || (e.createdAt.getTime() === own.createdAt.getTime() && e.id < own.id));
  }
  for (const e of entries) {
    // Quem tem mesa de uso exclusivo livre para si na data (titular ou integrante) não consome mesa compartilhada da fila.
    const own = await ownExclusiveFree(tx, e.employeeId, input.date);
    if (own && own !== input.resourceId) {
      await closeEntryWithNotice(tx, e.id, e.employeeId, input.date, "mesa de uso exclusivo disponível", "Sua mesa de uso exclusivo está disponível nesta data. Reserve por ela no Portal do Colaborador; a inscrição na fila foi encerrada.");
      continue;
    }
    // DIR-025: a mesma função de disponibilidade da reserva direta decide; mesa exclusiva sem exceção nunca é oferecida.
    const { availability } = await explainFor(tx, e.employeeId, input.resourceId, input.date);
    if (availability.code === "daily_limit" || availability.code === "mine") {
      // A pessoa conseguiu mesa por outro caminho (reserva simultânea à inscrição): a inscrição deixa de fazer sentido.
      await tx.update(waitlistEntry).set({ status: "cancelled", closedAt: new Date(), closeReason: "já tem reserva na data" }).where(and(eq(waitlistEntry.id, e.id), eq(waitlistEntry.status, "waiting")));
      continue;
    }
    if (!availability.canBook) continue;
    const expiresAt = await offerExpiry(tx, input.date);
    if (!expiresAt) return null;
    // Ponto de salvamento por candidata: a inscrição pode ter sido encerrada ou a pessoa pode ter reservado outra mesa
    // numa transação concorrente (só `for share` na pessoa). Nesses casos, a candidata é pulada sem derrubar quem liberou a mesa.
    let made: OfferMade | null = null;
    try {
      made = await tx.transaction(async (sp) => {
        const [claimed] = await sp.update(waitlistEntry).set({ status: "offered" }).where(and(eq(waitlistEntry.id, e.id), eq(waitlistEntry.status, "waiting"))).returning({ id: waitlistEntry.id });
        if (!claimed) return null;
        const [hold] = await sp
          .insert(deskBooking)
          .values({ resourceId: input.resourceId, employeeId: e.employeeId, bookingDate: input.date, status: "held", origin: "waitlist_offer", actorEmployeeId: input.offeredBy ?? e.employeeId, holdExpiresAt: expiresAt })
          .returning({ id: deskBooking.id });
        const [offer] = await sp.insert(waitlistOffer).values({ entryId: e.id, resourceId: input.resourceId, holdBookingId: hold.id, offeredBy: input.offeredBy ?? null, expiresAt }).returning({ id: waitlistOffer.id });
        return { offerId: offer.id, entryId: e.id, employeeId: e.employeeId, holdBookingId: hold.id, resourceId: input.resourceId, expiresAt };
      });
    } catch (err) {
      const code = pgErrorOf(err)?.code;
      if (code === "23505") continue;
      throw err;
    }
    if (!made) continue;
    await recordAudit(tx, { actorEmployeeId: input.offeredBy ?? null, action: input.offeredBy ? "waitlist.offered_manually" : "waitlist.offered", entityType: "waitlist_offer", entityId: made.offerId, after: { entryId: e.id, employeeId: e.employeeId, resourceId: input.resourceId, date: input.date, expiresAt }, requestId: input.requestId });
    const [emp] = await tx.select({ email: employee.corporateEmail, name: employee.fullName }).from(employee).where(eq(employee.id, e.employeeId));
    if (emp) {
      await enqueueOutbox(tx, { eventType: "email.waitlist", aggregateType: "waitlist_offer", aggregateId: made.offerId, payload: { message: waitlistOfferEmail(emp.email, emp.name, r.code, formatLocalDate(input.date), formatLocal(expiresAt)) }, idempotencyKey: `waitlist.offered:${made.offerId}` });
    }
    return made;
  }
  return null;
}

/**
 * Inscrição na fila para uma data (PAR-30: negada a quem tem reserva ativa; DEC-25: negada quando há mesa disponível
 * para a pessoa, porque a fila existe para quem ficou sem mesa). Repetir a inscrição devolve a existente.
 */
export async function joinWaitlist(db: Db, actor: Actor, input: { date: string; preferences?: Preferences }): Promise<{ entryId: string; created: boolean }> {
  assertIsoDate(input.date);
  if (input.date < localToday()) throw new ValidationError("A fila vale para hoje ou datas futuras.");
  const access = await loadAccess(db, actor.employeeId);
  if (!access.permissions.has("booking.self.manage")) throw new ForbiddenError("Sua conta não pode entrar na fila.");
  const preferences: Preferences = { zoneCode: input.preferences?.zoneCode?.trim() || null };
  return withOfficeTx(db, async (tx) => {
    await advisoryShareDay(tx, input.date);
    const person = await shareLockEmployee(tx, actor.employeeId);
    if (person.status !== "active") throw new ForbiddenError("Só pessoa ativa entra na fila.");
    await advisoryPersonDay(tx, actor.employeeId, input.date);
    await expireHolds(tx, { employeeId: actor.employeeId, date: input.date });
    const [existing] = await tx
      .select({ id: waitlistEntry.id })
      .from(waitlistEntry)
      .where(and(eq(waitlistEntry.employeeId, actor.employeeId), eq(waitlistEntry.date, input.date), inArray(waitlistEntry.status, ["waiting", "offered"])));
    if (existing) return { entryId: existing.id, created: false };
    const day = await loadDayContext(tx, input.date);
    if (!day.officeOpen) throw new ConflictError(`Escritório fechado em ${formatLocalDate(input.date)}.`);
    if (!day.window.open) throw new ConflictError(`Reservas para ${formatLocalDate(input.date)} ainda não abriram; a fila abre junto com elas.`);
    if (await personBookingOn(tx, actor.employeeId, input.date)) throw new ConflictError("Você já tem reserva nesta data. A fila é para quem ficou sem mesa (PAR-30).");
    const { availableDesksFor } = await import("@/modules/workplace/service");
    const free = await availableDesksFor(tx, actor.employeeId, input.date);
    if (free.length > 0) throw new ConflictError(`Há ${free.length} mesa(s) disponível(is) para você em ${formatLocalDate(input.date)}. Reserve diretamente; a fila é para quando não há mesa.`);
    const [row] = await tx
      .insert(waitlistEntry)
      .values({ employeeId: actor.employeeId, date: input.date, preferences })
      .onConflictDoNothing({ target: [waitlistEntry.employeeId, waitlistEntry.date], where: sql`status in ('waiting', 'offered')` })
      .returning({ id: waitlistEntry.id });
    if (!row) {
      const [again] = await tx.select({ id: waitlistEntry.id }).from(waitlistEntry).where(and(eq(waitlistEntry.employeeId, actor.employeeId), eq(waitlistEntry.date, input.date), inArray(waitlistEntry.status, ["waiting", "offered"])));
      return { entryId: again.id, created: false };
    }
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "waitlist.joined", entityType: "waitlist_entry", entityId: row.id, after: { date: input.date, preferences }, requestId: actor.requestId });
    return { entryId: row.id, created: true };
  });
}

async function loadEntry(db: DbOrTx, entryId: string) {
  const [e] = await db.select().from(waitlistEntry).where(eq(waitlistEntry.id, entryId));
  if (!e) throw new ValidationError("Inscrição não encontrada.");
  return e;
}

async function openOfferOf(db: DbOrTx, entryId: string) {
  const [o] = await db.select().from(waitlistOffer).where(and(eq(waitlistOffer.entryId, entryId), eq(waitlistOffer.status, "open")));
  return o ?? null;
}

/**
 * Sair da fila ou recusar a oferta aberta (a pessoa, ou quem tem `waitlist.admin` com motivo). Recusar libera a mesa
 * e a oferta segue para a próxima pessoa elegível na mesma transação.
 */
export async function leaveWaitlist(db: Db, actor: Actor, entryId: string, input: { reason?: string } = {}): Promise<{ date: string; declined: boolean }> {
  assertUuid(entryId, "Inscrição");
  const entry = await loadEntry(db, entryId);
  const own = entry.employeeId === actor.employeeId;
  if (!own) {
    const access = await loadAccess(db, actor.employeeId);
    if (!access.permissions.has("waitlist.admin")) throw new ForbiddenError("Retirar outra pessoa da fila exige permissão própria.");
    if (!input.reason?.trim()) throw new ValidationError("Informe o motivo.");
  }
  return withOfficeTx(db, async (tx) => {
    await advisoryShareDay(tx, entry.date);
    for (const p of [...new Set([entry.employeeId, actor.employeeId])].sort()) await shareLockEmployee(tx, p);
    const candidates = await lockQueueCandidates(tx, entry.date);
    const before = await openOfferOf(tx, entryId);
    if (before) await lockResources(tx, [before.resourceId]);
    if (before) await expireHolds(tx, { resourceId: before.resourceId, employeeId: entry.employeeId, date: entry.date });
    const current = await loadEntry(tx, entryId);
    if (current.status !== "waiting" && current.status !== "offered") throw new ConflictError("Esta inscrição já foi encerrada.");
    const offer = await openOfferOf(tx, entryId);
    if (offer && !before) {
      // Uma oferta nasceu entre a leitura e os locks: a mesa não está travada por esta transação. A pessoa vê a oferta e decide.
      throw new ConflictError("Uma mesa acabou de ser oferecida a você nesta data. Veja a oferta em Minhas reservas e aceite ou recuse.");
    }
    const reason = input.reason?.trim() || (own ? (offer ? "oferta recusada pela própria pessoa" : "saída da fila pela própria pessoa") : null);
    if (offer) {
      await tx.update(deskBooking).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.employeeId, cancelReason: reason }).where(and(eq(deskBooking.id, offer.holdBookingId), eq(deskBooking.status, "held")));
      await tx.update(waitlistOffer).set({ status: "declined", decidedAt: new Date() }).where(and(eq(waitlistOffer.id, offer.id), eq(waitlistOffer.status, "open")));
    }
    // Atualização condicionada ao estado lido: uma oferta concorrente (sem lock de recurso aqui) não é sobrescrita.
    const [closed] = await tx
      .update(waitlistEntry)
      .set({ status: "cancelled", closedAt: new Date(), closedBy: actor.employeeId, closeReason: reason })
      .where(and(eq(waitlistEntry.id, entryId), eq(waitlistEntry.status, offer ? "offered" : "waiting")))
      .returning({ id: waitlistEntry.id });
    if (!closed) throw new ConflictError("A inscrição mudou enquanto você saía (uma mesa pode ter sido oferecida). Veja Minhas reservas e tente de novo.");
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: offer ? "waitlist.offer_declined" : "waitlist.left", entityType: "waitlist_entry", entityId: entryId, before: { status: current.status, employeeId: entry.employeeId, date: entry.date }, after: { status: "cancelled", offerId: offer?.id ?? null }, reason, requestId: actor.requestId });
    if (!own) {
      // Retirada pela administração nunca é silenciosa: a pessoa recebe o motivo.
      const [emp] = await tx.select({ email: employee.corporateEmail, name: employee.fullName }).from(employee).where(eq(employee.id, entry.employeeId));
      if (emp) {
        await enqueueOutbox(tx, { eventType: "email.waitlist", aggregateType: "waitlist_entry", aggregateId: entryId, payload: { message: waitlistRemovedEmail(emp.email, emp.name, formatLocalDate(entry.date), reason ?? "") }, idempotencyKey: `waitlist.removed:${entryId}` });
      }
    }
    if (offer) await offerNext(tx, { resourceId: offer.resourceId, date: entry.date, candidateIds: candidates.filter((c) => c !== entry.employeeId), requestId: actor.requestId });
    return { date: entry.date, declined: !!offer };
  });
}

/** Recusa pela oferta (a tela da pessoa conhece a oferta, não a inscrição). */
export async function declineOffer(db: Db, actor: Actor, offerId: string): Promise<{ date: string }> {
  assertUuid(offerId, "Oferta");
  const [o] = await db.select({ entryId: waitlistOffer.entryId, employeeId: waitlistEntry.employeeId }).from(waitlistOffer).innerJoin(waitlistEntry, eq(waitlistEntry.id, waitlistOffer.entryId)).where(eq(waitlistOffer.id, offerId));
  if (!o || o.employeeId !== actor.employeeId) throw new ValidationError("Oferta não encontrada.");
  const r = await leaveWaitlist(db, actor, o.entryId);
  return { date: r.date };
}

/** Aceitar a oferta: a retenção vira reserva confirmada, com revalidação depois dos locks (DIR-034). */
export async function acceptOffer(db: Db, actor: Actor, offerId: string): Promise<{ bookingId: string; resourceCode: string; date: string }> {
  assertUuid(offerId, "Oferta");
  const [o] = await db
    .select({ id: waitlistOffer.id, entryId: waitlistOffer.entryId, resourceId: waitlistOffer.resourceId, holdBookingId: waitlistOffer.holdBookingId, employeeId: waitlistEntry.employeeId, date: waitlistEntry.date })
    .from(waitlistOffer)
    .innerJoin(waitlistEntry, eq(waitlistEntry.id, waitlistOffer.entryId))
    .where(eq(waitlistOffer.id, offerId));
  // Oferta de outra pessoa é tratada como inexistente: nada sobre ela é revelado.
  if (!o || o.employeeId !== actor.employeeId) throw new ValidationError("Oferta não encontrada.");
  const access = await loadAccess(db, actor.employeeId);
  if (!access.permissions.has("booking.self.manage")) throw new ForbiddenError("Sua conta não pode reservar.");
  // O desfecho "mesa deixou de valer" é gravado (retenção cancelada, oferta recusada) e só depois do commit vira erro.
  const outcome = await withOfficeTx(db, async (tx) => {
    await advisoryShareDay(tx, o.date);
    await shareLockEmployee(tx, actor.employeeId);
    await advisoryPersonDay(tx, actor.employeeId, o.date);
    await lockResources(tx, [o.resourceId]);
    await expireHolds(tx, { resourceId: o.resourceId, employeeId: actor.employeeId, date: o.date });
    const [offer] = await tx.select({ status: waitlistOffer.status, expiresAt: waitlistOffer.expiresAt }).from(waitlistOffer).where(eq(waitlistOffer.id, offerId));
    if (!offer || offer.status !== "open" || offer.expiresAt.getTime() <= Date.now()) throw new ConflictError("A oferta venceu ou já foi decidida. Se ainda precisar de mesa, entre na fila de novo.");
    const [hold] = await tx.select({ status: deskBooking.status }).from(deskBooking).where(eq(deskBooking.id, o.holdBookingId));
    const valid = await tx.execute(sql`select booking_remains_valid(${actor.employeeId}::uuid, ${o.resourceId}::uuid, ${o.date}::date) as ok`);
    if (hold?.status !== "held" || !(valid.rows[0] as { ok: boolean }).ok) {
      await tx.update(deskBooking).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.employeeId, cancelReason: "mesa deixou de valer antes do aceite" }).where(and(eq(deskBooking.id, o.holdBookingId), eq(deskBooking.status, "held")));
      await tx.update(waitlistOffer).set({ status: "declined", decidedAt: new Date() }).where(eq(waitlistOffer.id, offerId));
      await tx.update(waitlistEntry).set({ status: "cancelled", closedAt: new Date(), closeReason: "mesa deixou de valer antes do aceite" }).where(eq(waitlistEntry.id, o.entryId));
      await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "waitlist.offer_declined", entityType: "waitlist_entry", entityId: o.entryId, after: { status: "cancelled", offerId, why: "mesa deixou de valer antes do aceite" }, requestId: actor.requestId });
      return { ok: false as const };
    }
    await tx.update(deskBooking).set({ status: "confirmed", holdExpiresAt: null }).where(eq(deskBooking.id, o.holdBookingId));
    await tx.update(waitlistOffer).set({ status: "accepted", decidedAt: new Date() }).where(eq(waitlistOffer.id, offerId));
    const [acc] = await tx.update(waitlistEntry).set({ status: "accepted", closedAt: new Date(), closedBy: actor.employeeId, closeReason: "oferta aceita" }).where(and(eq(waitlistEntry.id, o.entryId), eq(waitlistEntry.status, "offered"))).returning({ id: waitlistEntry.id });
    if (!acc) throw new ConflictError("A inscrição foi encerrada antes do aceite. Nada foi alterado.");
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "waitlist.offer_accepted", entityType: "desk_booking", entityId: o.holdBookingId, before: { status: "held" }, after: { status: "confirmed", offerId, resourceId: o.resourceId, date: o.date }, requestId: actor.requestId });
    const [r] = await tx.select({ code: resource.code }).from(resource).where(eq(resource.id, o.resourceId));
    return { ok: true as const, bookingId: o.holdBookingId, resourceCode: r?.code ?? "", date: o.date };
  });
  if (!outcome.ok) throw new ConflictError("A mesa deixou de estar disponível para você antes do aceite. Entre na fila de novo se precisar.");
  return { bookingId: outcome.bookingId, resourceCode: outcome.resourceCode, date: outcome.date };
}

/** Oferta manual pela administração (`waitlist.admin`): mesma elegibilidade, mesmo prazo, ator registrado. */
export async function offerManually(db: Db, actor: Actor, input: { entryId: string; resourceId: string }): Promise<OfferMade> {
  assertUuid(input.entryId, "Inscrição");
  assertUuid(input.resourceId, "Mesa");
  const access = await loadAccess(db, actor.employeeId);
  if (!access.permissions.has("waitlist.admin")) throw new ForbiddenError("Oferecer mesa pela fila exige permissão própria.");
  const entry = await loadEntry(db, input.entryId);
  return withOfficeTx(db, async (tx) => {
    await advisoryShareDay(tx, entry.date);
    for (const p of [...new Set([entry.employeeId, actor.employeeId])].sort()) await shareLockEmployee(tx, p);
    await lockResources(tx, [input.resourceId]);
    await expireHolds(tx, { resourceId: input.resourceId, employeeId: entry.employeeId, date: entry.date });
    const current = await loadEntry(tx, input.entryId);
    if (current.status !== "waiting") throw new ConflictError("A inscrição já não está em espera.");
    // Oferta manual só de mesa do conjunto compartilhado, com a mesma resposta para qualquer pessoa: a tela da fila não
    // pode servir para descobrir quem é titular ou integrante de mesa exclusiva (exclusive.holder.view).
    const cls = await tx.execute(sql`select desk_class(${input.resourceId}::uuid, ${entry.date}::date) as c`);
    if ((cls.rows[0] as { c: string | null }).c !== "shared") throw new ConflictError("Só mesa do conjunto compartilhado, operacional na data, é oferecida manualmente pela fila.");
    const made = await offerNext(tx, { resourceId: input.resourceId, date: entry.date, candidateIds: [entry.employeeId], offeredBy: actor.employeeId, requestId: actor.requestId });
    if (!made) {
      const { availability } = await explainFor(tx, entry.employeeId, input.resourceId, entry.date);
      throw new ConflictError(`Não foi possível oferecer esta mesa à pessoa: ${availability.canBook ? "sem tempo mínimo de oferta no dia" : availability.reason}.`);
    }
    return made;
  });
}

/** Reserva direta feita: a inscrição em espera da pessoa na data deixa de fazer sentido e é encerrada. */
export async function closeWaitingEntryOf(tx: Tx, actor: Actor, employeeId: string, date: string, reason: string): Promise<void> {
  const rows = await tx
    .update(waitlistEntry)
    .set({ status: "cancelled", closedAt: new Date(), closedBy: actor.employeeId, closeReason: reason })
    .where(and(eq(waitlistEntry.employeeId, employeeId), eq(waitlistEntry.date, date), eq(waitlistEntry.status, "waiting")))
    .returning({ id: waitlistEntry.id });
  for (const r of rows) {
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "waitlist.left", entityType: "waitlist_entry", entityId: r.id, after: { status: "cancelled", why: reason }, requestId: actor.requestId });
  }
}

/** Retenção cancelada pelo caminho comum de cancelamento: a oferta é recusada e a inscrição encerrada. */
export async function declineOfferOfHold(tx: Tx, actor: Actor, holdBookingId: string, reason: string): Promise<void> {
  const [offer] = await tx.update(waitlistOffer).set({ status: "declined", decidedAt: new Date() }).where(and(eq(waitlistOffer.holdBookingId, holdBookingId), eq(waitlistOffer.status, "open"))).returning({ id: waitlistOffer.id, entryId: waitlistOffer.entryId });
  if (!offer) return;
  await tx.update(waitlistEntry).set({ status: "cancelled", closedAt: new Date(), closedBy: actor.employeeId, closeReason: reason }).where(and(eq(waitlistEntry.id, offer.entryId), eq(waitlistEntry.status, "offered")));
  await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "waitlist.offer_declined", entityType: "waitlist_entry", entityId: offer.entryId, after: { status: "cancelled", offerId: offer.id, why: reason }, reason, requestId: actor.requestId });
}

/**
 * Oferta retirada por decisão administrativa (manutenção, bloqueio, fechamento de dia, exclusividade, desativação de
 * titular): a retenção já foi cancelada por quem chama; a oferta vence e a inscrição volta a esperar, sem perder a posição.
 */
export async function withdrawOfferOfHold(tx: Tx, actor: Actor, holdBookingId: string, reason: string): Promise<void> {
  const [offer] = await tx.update(waitlistOffer).set({ status: "expired", decidedAt: new Date() }).where(and(eq(waitlistOffer.holdBookingId, holdBookingId), eq(waitlistOffer.status, "open"))).returning({ id: waitlistOffer.id, entryId: waitlistOffer.entryId });
  if (!offer) return;
  await tx.update(waitlistEntry).set({ status: "waiting" }).where(and(eq(waitlistEntry.id, offer.entryId), eq(waitlistEntry.status, "offered")));
  await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "waitlist.offer_withdrawn", entityType: "waitlist_offer", entityId: offer.id, after: { entryId: offer.entryId, status: "expired", entry: "waiting" }, reason, requestId: actor.requestId });
}

/** Desativação ou suspensão: a pessoa sai da fila e as ofertas abertas são recusadas. Quem chama já travou pessoa e recursos. */
export async function closeQueueForPerson(tx: Tx, actor: Actor, employeeId: string, reason: string): Promise<{ entriesClosed: number; releasedDesks: Array<{ resourceId: string; date: string }> }> {
  const entries = await tx.select({ id: waitlistEntry.id, date: waitlistEntry.date, status: waitlistEntry.status }).from(waitlistEntry).where(and(eq(waitlistEntry.employeeId, employeeId), inArray(waitlistEntry.status, ["waiting", "offered"])));
  const released: Array<{ resourceId: string; date: string }> = [];
  for (const e of entries) {
    const offer = await openOfferOf(tx, e.id);
    if (offer) {
      const [hold] = await tx.update(deskBooking).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.employeeId, cancelReason: reason }).where(and(eq(deskBooking.id, offer.holdBookingId), eq(deskBooking.status, "held"))).returning({ id: deskBooking.id });
      await tx.update(waitlistOffer).set({ status: "declined", decidedAt: new Date() }).where(and(eq(waitlistOffer.id, offer.id), eq(waitlistOffer.status, "open")));
      if (hold) released.push({ resourceId: offer.resourceId, date: e.date });
    }
    await tx.update(waitlistEntry).set({ status: "cancelled", closedAt: new Date(), closedBy: actor.employeeId, closeReason: reason }).where(and(eq(waitlistEntry.id, e.id), inArray(waitlistEntry.status, ["waiting", "offered"])));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "waitlist.left", entityType: "waitlist_entry", entityId: e.id, before: { status: e.status, employeeId, date: e.date }, after: { status: "cancelled", why: "pessoa desativada ou suspensa" }, reason, requestId: actor.requestId });
  }
  return { entriesClosed: entries.length, releasedDesks: released };
}

/** Datas com inscrições ou ofertas abertas da pessoa (para o preview da desativação travar os dias antes da pessoa). */
export async function queueDatesOf(db: DbOrTx, employeeId: string): Promise<string[]> {
  const rows = await db.select({ date: waitlistEntry.date }).from(waitlistEntry).where(and(eq(waitlistEntry.employeeId, employeeId), inArray(waitlistEntry.status, ["waiting", "offered"])));
  return [...new Set(rows.map((r) => r.date))];
}

/** Mesas que a administração pode oferecer manualmente à pessoa: disponíveis para ela e da classe compartilhada. */
export async function manualOfferOptions(db: DbOrTx, employeeId: string, date: string): Promise<Array<{ id: string; code: string }>> {
  const { stateForPerson } = await import("@/modules/availability/service");
  const { items } = await stateForPerson(db, employeeId, date, { types: ["desk"] });
  return items.filter((i) => i.availability.canBook && i.deskClass === "shared").map((i) => ({ id: i.resource.id, code: i.resource.code }));
}

/* Leitura. */

export type MyQueueItem = {
  entryId: string;
  date: string;
  status: "waiting" | "offered";
  createdAt: Date;
  offer: { id: string; resourceCode: string; expiresAt: Date } | null;
};

/** Inscrições vivas da pessoa: `offered` só conta com oferta aberta e não vencida (leitura ignora retenção vencida). */
export async function myQueue(db: DbOrTx, employeeId: string, from = localToday()): Promise<MyQueueItem[]> {
  const rows = await db
    .select({ entryId: waitlistEntry.id, date: waitlistEntry.date, status: waitlistEntry.status, createdAt: waitlistEntry.createdAt, offerId: waitlistOffer.id, offerStatus: waitlistOffer.status, expiresAt: waitlistOffer.expiresAt, code: resource.code })
    .from(waitlistEntry)
    .leftJoin(waitlistOffer, and(eq(waitlistOffer.entryId, waitlistEntry.id), eq(waitlistOffer.status, "open")))
    .leftJoin(resource, eq(resource.id, waitlistOffer.resourceId))
    .where(and(eq(waitlistEntry.employeeId, employeeId), gte(waitlistEntry.date, from), inArray(waitlistEntry.status, ["waiting", "offered"])))
    .orderBy(asc(waitlistEntry.date));
  const now = Date.now();
  const out: MyQueueItem[] = [];
  for (const r of rows) {
    if (r.status === "offered" && (!r.offerId || !r.expiresAt || r.expiresAt.getTime() <= now)) continue;
    out.push({ entryId: r.entryId, date: r.date, status: r.status as "waiting" | "offered", createdAt: r.createdAt, offer: r.offerId && r.expiresAt ? { id: r.offerId, resourceCode: r.code ?? "", expiresAt: r.expiresAt } : null });
  }
  return out;
}

export type QueueRow = {
  entryId: string;
  employeeId: string;
  employeeName: string;
  date: string;
  status: string;
  createdAt: Date;
  preferences: Preferences;
  /** `exclusive`: a mesa ofertada é de classe exclusiva na data; a tela oculta o código a quem não tem exclusive.holder.view. */
  offer: { id: string; resourceCode: string; expiresAt: Date; status: string; live: boolean; exclusive: boolean } | null;
};

/** Fila de uma data para a administração: posição por ordem de inscrição; ofertas com situação e prazo. */
export async function listQueue(db: DbOrTx, filter: { date: string }): Promise<QueueRow[]> {
  const rows = await db
    .select({ entryId: waitlistEntry.id, employeeId: waitlistEntry.employeeId, employeeName: employee.fullName, date: waitlistEntry.date, status: waitlistEntry.status, createdAt: waitlistEntry.createdAt, preferences: waitlistEntry.preferences })
    .from(waitlistEntry)
    .innerJoin(employee, eq(employee.id, waitlistEntry.employeeId))
    .where(eq(waitlistEntry.date, filter.date))
    .orderBy(asc(waitlistEntry.createdAt));
  if (rows.length === 0) return [];
  const offers = await db
    .select({ id: waitlistOffer.id, entryId: waitlistOffer.entryId, expiresAt: waitlistOffer.expiresAt, status: waitlistOffer.status, code: resource.code, offeredAt: waitlistOffer.offeredAt, exclusive: sql<boolean>`desk_class(${waitlistOffer.resourceId}, ${filter.date}::date) = 'exclusive'` })
    .from(waitlistOffer)
    .innerJoin(resource, eq(resource.id, waitlistOffer.resourceId))
    .where(inArray(waitlistOffer.entryId, rows.map((r) => r.entryId)))
    .orderBy(asc(waitlistOffer.offeredAt));
  const now = Date.now();
  const lastOffer = new Map<string, (typeof offers)[number]>();
  for (const o of offers) lastOffer.set(o.entryId, o);
  return rows.map((r) => {
    const o = lastOffer.get(r.entryId);
    return {
      ...r,
      preferences: (r.preferences ?? {}) as Preferences,
      offer: o ? { id: o.id, resourceCode: o.code, expiresAt: o.expiresAt, status: o.status, live: o.status === "open" && o.expiresAt.getTime() > now, exclusive: !!o.exclusive } : null,
    };
  });
}

/** Demanda não atendida: inscrições em espera por data a partir de hoje (indicador com numerador explícito). */
export async function unmetDemand(db: DbOrTx, from = localToday(), days = 14): Promise<Array<{ date: string; waiting: number; offered: number }>> {
  const rows = await db
    .select({ date: waitlistEntry.date, status: waitlistEntry.status, n: sql<number>`count(*)::int` })
    .from(waitlistEntry)
    .where(and(gte(waitlistEntry.date, from), lte(waitlistEntry.date, sql`${from}::date + ${days}::int`), inArray(waitlistEntry.status, ["waiting", "offered"])))
    .groupBy(waitlistEntry.date, waitlistEntry.status)
    .orderBy(asc(waitlistEntry.date));
  const by = new Map<string, { date: string; waiting: number; offered: number }>();
  for (const r of rows) {
    const cur = by.get(r.date) ?? { date: r.date, waiting: 0, offered: 0 };
    if (r.status === "waiting") cur.waiting += r.n;
    else cur.offered += r.n;
    by.set(r.date, cur);
  }
  return [...by.values()];
}

/** Zonas conhecidas para preferência (opcional; a preferência é informativa e não filtra a oferta automática). */
export async function zoneOptions(db: DbOrTx): Promise<Array<{ code: string; name: string }>> {
  return db.select({ code: zone.code, name: zone.name }).from(zone).orderBy(asc(zone.name));
}

/* Varreduras do worker: conveniência, nunca requisito de correção (DIR-034). */

/** Expira ofertas vencidas (uma por transação, em ordem de recurso) e passa a mesa à próxima pessoa elegível (REQ-26). */
export async function expireDueOffers(db: Db, limit = 50): Promise<number> {
  const due = await db
    .select({ id: waitlistOffer.id, resourceId: waitlistOffer.resourceId, employeeId: waitlistEntry.employeeId, date: waitlistEntry.date })
    .from(waitlistOffer)
    .innerJoin(waitlistEntry, eq(waitlistEntry.id, waitlistOffer.entryId))
    .where(and(eq(waitlistOffer.status, "open"), lte(waitlistOffer.expiresAt, sql`now()`)))
    .orderBy(asc(waitlistOffer.resourceId))
    .limit(limit);
  let n = 0;
  for (const o of due) {
    try {
      await withOfficeTx(db, async (tx) => {
        await advisoryShareDay(tx, o.date);
        await shareLockEmployee(tx, o.employeeId);
        const candidates = await lockQueueCandidates(tx, o.date);
        await lockResources(tx, [o.resourceId]);
        const expired = await expireHolds(tx, { resourceId: o.resourceId, employeeId: o.employeeId, date: o.date });
        if (expired > 0) await offerNext(tx, { resourceId: o.resourceId, date: o.date, candidateIds: candidates });
      });
      n += 1;
    } catch (e) {
      logger.warn({ offerId: o.id, err: e instanceof Error ? e.message : String(e) }, "falha ao expirar oferta; nova varredura no próximo ciclo");
    }
  }
  return n;
}

/**
 * Mesas livres com fila em espera: oferece na ordem de inscrição. Cobre liberações que não passam pelo cancelamento
 * (fim de manutenção, dia reaberto, inscrição posterior à foto de candidatas). Limitado por ciclo.
 */
export async function offerFreeDesks(db: Db, limit = 20): Promise<number> {
  const today = localToday();
  const waiting = await db
    .select({ id: waitlistEntry.id, employeeId: waitlistEntry.employeeId, date: waitlistEntry.date, preferences: waitlistEntry.preferences })
    .from(waitlistEntry)
    .where(and(eq(waitlistEntry.status, "waiting"), gte(waitlistEntry.date, today)))
    .orderBy(asc(waitlistEntry.date), asc(waitlistEntry.createdAt))
    .limit(200);
  const { stateForPerson } = await import("@/modules/availability/service");
  let made = 0;
  const takenThisRound = new Set<string>();
  for (const w of waiting) {
    if (made >= limit) break;
    const { items } = await stateForPerson(db, w.employeeId, w.date, { types: ["desk"] });
    const free = items.filter((i) => i.availability.canBook && !takenThisRound.has(`${i.resource.id}:${w.date}`)).map((i) => ({ id: i.resource.id, code: i.resource.code, own: i.availability.exclusiveMine }));
    if (free.length === 0) continue;
    const pref = ((w.preferences ?? {}) as Preferences).zoneCode;
    // A mesa de uso exclusivo da própria pessoa, quando livre para ela, vem antes de qualquer compartilhada.
    const chosen = free.find((f) => f.own) ?? (pref ? await preferZone(db, free, pref) : null) ?? free[0];
    try {
      const r = await withOfficeTx(db, async (tx) => {
        await advisoryShareDay(tx, w.date);
        await shareLockEmployee(tx, w.employeeId);
        await lockResources(tx, [chosen.id]);
        await expireHolds(tx, { resourceId: chosen.id, employeeId: w.employeeId, date: w.date });
        return offerNext(tx, { resourceId: chosen.id, date: w.date, candidateIds: [w.employeeId] });
      });
      if (r) {
        made += 1;
        takenThisRound.add(`${chosen.id}:${w.date}`);
      }
    } catch (e) {
      logger.warn({ entryId: w.id, err: e instanceof Error ? e.message : String(e) }, "falha ao oferecer mesa livre; nova varredura no próximo ciclo");
    }
  }
  return made;
}

async function preferZone(db: DbOrTx, free: Array<{ id: string; code: string }>, zoneCode: string) {
  const rows = await db.select({ id: resource.id }).from(resource).innerJoin(zone, eq(zone.id, resource.zoneId)).where(and(inArray(resource.id, free.map((f) => f.id)), eq(zone.code, zoneCode)));
  const ids = new Set(rows.map((r) => r.id));
  return free.find((f) => ids.has(f.id)) ?? null;
}

/** Varredura completa, chamada pelo worker a cada ciclo. */
export async function runWaitlistSweep(db: Db): Promise<{ expired: number; offered: number }> {
  const expired = await expireDueOffers(db);
  const offered = await offerFreeDesks(db);
  return { expired, offered };
}
