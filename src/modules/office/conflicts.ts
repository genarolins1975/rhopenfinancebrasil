import { and, asc, eq, gt, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db/client";
import { deskBooking, employee, resource, spaceBooking } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { enqueueOutbox } from "@/modules/notifications/outbox";
import { bookingChangedEmail, spaceBookingChangedEmail, waitlistChangedEmail } from "@/modules/notifications/templates";
import { formatLocalDate } from "@/modules/shared/dates";
import { ConflictError, ValidationError } from "@/modules/shared/errors";
import { explainFor } from "@/modules/availability/service";
import { type Actor, expireHolds } from "./shared";

/*
 * Diálogo de conflito (DIR-016, DIR-017, DIR-032, DIR-033): reservas incompatíveis nunca são canceladas em silêncio.
 * A prévia lista cada uma; a confirmação exige decisão por reserva; tudo é revalidado dentro da transação.
 */

export type IncompatibleBooking = {
  /** Mesa por dia (padrão) ou sala e cabine por intervalo; sala só admite cancelamento. */
  kind?: "desk" | "space";
  /** Horário local do intervalo, só em sala e cabine. */
  slot?: string;
  bookingId: string;
  resourceId: string;
  resourceCode: string;
  employeeId: string;
  employeeName: string;
  date: string;
  origin: string;
  status: "held" | "confirmed";
  why: string;
};

export type ConflictDecision = {
  bookingId: string;
  action: "cancel" | "realloc";
  reason: string;
  message?: string;
  targetResourceId?: string;
  /** Situação da reserva quando a decisão foi tomada na prévia; mudança exige nova prévia (oferta aceita ou retirada). */
  expectedStatus?: "held" | "confirmed";
};

/** Reservas ativas num conjunto de recursos e intervalo de datas (ou em todos os recursos, quando não filtrado). */
export async function listActiveBookings(db: DbOrTx, filter: { resourceIds?: string[]; employeeIds?: string[]; from: string; to: string | null }): Promise<Omit<IncompatibleBooking, "why">[]> {
  const conds = [gte(deskBooking.bookingDate, filter.from), or(eq(deskBooking.status, "confirmed"), and(eq(deskBooking.status, "held"), gt(deskBooking.holdExpiresAt, sql`now()`)))];
  if (filter.to) conds.push(lte(deskBooking.bookingDate, filter.to));
  if (filter.resourceIds) {
    if (filter.resourceIds.length === 0) return [];
    conds.push(inArray(deskBooking.resourceId, filter.resourceIds));
  }
  if (filter.employeeIds) {
    if (filter.employeeIds.length === 0) return [];
    conds.push(inArray(deskBooking.employeeId, filter.employeeIds));
  }
  const rows = await db
    .select({ bookingId: deskBooking.id, resourceId: deskBooking.resourceId, resourceCode: resource.code, employeeId: deskBooking.employeeId, employeeName: employee.fullName, date: deskBooking.bookingDate, origin: deskBooking.origin, status: deskBooking.status })
    .from(deskBooking)
    .innerJoin(resource, eq(resource.id, deskBooking.resourceId))
    .innerJoin(employee, eq(employee.id, deskBooking.employeeId))
    .where(and(...conds))
    .orderBy(asc(deskBooking.bookingDate), asc(resource.code));
  return rows.map((r) => ({ ...r, status: r.status as "held" | "confirmed" }));
}

/** Reservas de sala e cabine confirmadas que tocam o intervalo de datas (fim ainda no futuro). Só cancelamento. */
export async function listActiveSpaceBookings(db: DbOrTx, filter: { resourceIds?: string[]; employeeIds?: string[]; from: string; to: string | null }): Promise<Omit<IncompatibleBooking, "why">[]> {
  const conds = [eq(spaceBooking.status, "confirmed"), gt(sql`upper(${spaceBooking.period})`, sql`now()`), sql`upper(${spaceBooking.period}) > lower(local_day_range(${filter.from}::date))`];
  if (filter.to) conds.push(sql`lower(${spaceBooking.period}) < upper(local_day_range(${filter.to}::date))`);
  if (filter.resourceIds) {
    if (filter.resourceIds.length === 0) return [];
    conds.push(inArray(spaceBooking.resourceId, filter.resourceIds));
  }
  if (filter.employeeIds) {
    if (filter.employeeIds.length === 0) return [];
    conds.push(inArray(spaceBooking.employeeId, filter.employeeIds));
  }
  const rows = await db
    .select({ bookingId: spaceBooking.id, resourceId: spaceBooking.resourceId, resourceCode: resource.code, employeeId: spaceBooking.employeeId, employeeName: employee.fullName, lower: sql<string>`lower(${spaceBooking.period})`, upper: sql<string>`upper(${spaceBooking.period})` })
    .from(spaceBooking)
    .innerJoin(resource, eq(resource.id, spaceBooking.resourceId))
    .innerJoin(employee, eq(employee.id, spaceBooking.employeeId))
    .where(and(...conds))
    .orderBy(asc(sql`lower(${spaceBooking.period})`), asc(resource.code));
  const { formatSlot } = await import("@/modules/spaces/rules");
  const { localToday } = await import("@/modules/shared/dates");
  return rows.map((r) => {
    const start = new Date(r.lower);
    const end = new Date(r.upper);
    return { kind: "space" as const, slot: formatSlot({ start, end }), bookingId: r.bookingId, resourceId: r.resourceId, resourceCode: r.resourceCode, employeeId: r.employeeId, employeeName: r.employeeName, date: localToday(start), origin: "sala", status: "confirmed" as const };
  });
}

/** Mesas e salas juntas, para operações que atingem qualquer recurso (manutenção, bloqueio, desativação, fechamento). */
export async function listActiveBookingsAll(db: DbOrTx, filter: { resourceIds?: string[]; employeeIds?: string[]; from: string; to: string | null }): Promise<Omit<IncompatibleBooking, "why">[]> {
  return [...(await listActiveBookings(db, filter)), ...(await listActiveSpaceBookings(db, filter))];
}

/**
 * Aplica as decisões sobre as reservas incompatíveis, dentro da transação de quem chamou e depois dos locks.
 * Toda reserva incompatível precisa de decisão; decisão sobre reserva que não é mais incompatível é ignorada.
 * Realocação valida a mesa de destino para a pessoa na data com o mesmo serviço de disponibilidade.
 */
export async function applyConflictDecisions(tx: Tx, actor: Actor, conflicts: IncompatibleBooking[], decisions: ConflictDecision[], opts: { excludeResourceIds: string[]; notice: string; closingDay?: boolean }): Promise<void> {
  const byId = new Map(decisions.map((d) => [d.bookingId, d]));
  const missing = conflicts.filter((c) => !byId.has(c.bookingId));
  if (missing.length) {
    throw new ConflictError(`Há ${missing.length} reserva(s) incompatível(is) sem decisão. A prévia foi refeita; decida cada uma antes de confirmar.`);
  }
  for (const c of conflicts) {
    const d = byId.get(c.bookingId)!;
    if (!d.reason?.trim()) throw new ValidationError(`Informe o motivo para a reserva de ${formatLocalDate(c.date)} em ${c.resourceCode}.`);
    // Releitura sob lock da linha: a lista pode ter sido lida antes dos locks de pessoa e recurso (suspensão, aceite,
    // cancelamento concorrentes). Reserva que deixou de estar ativa não recebe decisão, email nem auditoria.
    const current = c.kind === "space"
      ? ((await tx.execute(sql`select status from space_booking where id = ${c.bookingId} for update`)).rows[0] as { status?: string } | undefined)
      : ((await tx.execute(sql`select status, hold_expires_at > now() as live from desk_booking where id = ${c.bookingId} for update`)).rows[0] as { status?: string; live?: boolean } | undefined);
    const active = current?.status === "confirmed" || (current?.status === "held" && (current as { live?: boolean }).live);
    if (!active) continue;
    if (d.expectedStatus && current?.status !== d.expectedStatus) {
      throw new ConflictError(`A reserva de ${formatLocalDate(c.date)} em ${c.resourceCode} mudou desde a prévia (${d.expectedStatus === "held" ? "a oferta da fila foi aceita" : "a situação mudou"}). A prévia foi refeita; decida de novo.`);
    }
    c.status = current?.status as "held" | "confirmed";
    const [emp] = await tx.select({ email: employee.corporateEmail, name: employee.fullName }).from(employee).where(eq(employee.id, c.employeeId));
    if (c.kind === "space") {
      if (d.action !== "cancel") throw new ValidationError("Reserva de sala ou cabine não é realocada: só cancelamento com comunicação.");
      await tx.update(spaceBooking).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: d.reason.trim() }).where(and(eq(spaceBooking.id, c.bookingId), eq(spaceBooking.status, "confirmed")));
      await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "space_booking.cancelled_by_conflict", entityType: "space_booking", entityId: c.bookingId, before: { resourceId: c.resourceId, date: c.date, slot: c.slot, employeeId: c.employeeId }, after: { status: "cancelled", why: c.why }, reason: d.reason, requestId: actor.requestId });
      if (emp) {
        await enqueueOutbox(tx, {
          eventType: "email.space_booking",
          aggregateType: "space_booking",
          aggregateId: c.bookingId,
          payload: { message: spaceBookingChangedEmail(emp.email, emp.name, `Sua reserva de ${c.resourceCode} em ${formatLocalDate(c.date)}, das ${c.slot ?? ""}, foi cancelada. ${opts.notice} ${d.message?.trim() ?? ""}`.trim()) },
          idempotencyKey: `space_booking.cancelled:${c.bookingId}`,
        });
      }
      continue;
    }
    if (c.status === "held") {
      // Retenção da fila (oferta aberta): nunca vira reserva por realocação, porque a pessoa não aceitou. A oferta é
      // retirada, a inscrição volta a esperar na posição original e a varredura oferece outra mesa.
      if (d.action !== "cancel") throw new ValidationError(`A oferta da fila de ${formatLocalDate(c.date)} em ${c.resourceCode} não é realocada: só retirada, com a pessoa de volta à fila.`);
      await tx
        .update(deskBooking)
        .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.employeeId, cancelReason: d.reason.trim() })
        .where(and(eq(deskBooking.id, c.bookingId), eq(deskBooking.status, "held")));
      const { withdrawOfferOfHold } = await import("@/modules/waitlist/service");
      await withdrawOfferOfHold(tx, actor, c.bookingId, d.reason.trim());
      await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "booking.cancelled_by_conflict", entityType: "desk_booking", entityId: c.bookingId, before: { resourceId: c.resourceId, date: c.date, employeeId: c.employeeId, status: "held" }, after: { status: "cancelled", why: c.why }, reason: d.reason, requestId: actor.requestId });
      // No fechamento de dia, o aviso único sai no encerramento da fila da data (closeQueueForDate).
      if (emp && !opts.closingDay) {
        await enqueueOutbox(tx, {
          eventType: "email.waitlist",
          aggregateType: "desk_booking",
          aggregateId: c.bookingId,
          payload: { message: waitlistChangedEmail(emp.email, emp.name, `A mesa ${c.resourceCode} oferecida a você para ${formatLocalDate(c.date)} deixou de estar disponível. ${opts.notice} Você continua na fila de espera dessa data. ${d.message?.trim() ?? ""}`.trim()) },
          idempotencyKey: `waitlist.withdrawn:${c.bookingId}`,
        });
      }
      continue;
    }
    if (d.action === "cancel") {
      await tx
        .update(deskBooking)
        .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.employeeId, cancelReason: d.reason.trim() })
        .where(and(eq(deskBooking.id, c.bookingId), inArray(deskBooking.status, ["held", "confirmed"])));
      await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "booking.cancelled_by_conflict", entityType: "desk_booking", entityId: c.bookingId, before: { resourceId: c.resourceId, date: c.date, employeeId: c.employeeId }, after: { status: "cancelled", why: c.why }, reason: d.reason, requestId: actor.requestId });
      if (emp) {
        await enqueueOutbox(tx, {
          eventType: "email.booking_changed",
          aggregateType: "desk_booking",
          aggregateId: c.bookingId,
          payload: { message: bookingChangedEmail(emp.email, emp.name, `Sua reserva de ${formatLocalDate(c.date)} na mesa ${c.resourceCode} foi cancelada. ${opts.notice} ${d.message?.trim() ?? ""}`.trim()) },
          idempotencyKey: `booking.cancelled:${c.bookingId}`,
        });
      }
      continue;
    }
    if (!d.targetResourceId) throw new ValidationError(`Escolha a mesa de destino para a reserva de ${formatLocalDate(c.date)}.`);
    if (opts.excludeResourceIds.includes(d.targetResourceId) || d.targetResourceId === c.resourceId) throw new ValidationError("A mesa de destino precisa ser outra, disponível para a pessoa.");
    // Antes de mover, a reserva atual sai do caminho para que o limite diário não bloqueie a própria realocação,
    // e a retenção vencida no destino é expirada antes de gravar (DIR-034).
    await tx.update(deskBooking).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.employeeId, cancelReason: `realocada: ${d.reason.trim()}` }).where(eq(deskBooking.id, c.bookingId));
    await expireHolds(tx, { resourceId: d.targetResourceId, employeeId: c.employeeId, date: c.date });
    const { availability, resource: target } = await explainFor(tx, c.employeeId, d.targetResourceId, c.date, { windowExempt: true });
    if (!availability.canBook || !target) throw new ConflictError(`A mesa de destino não está disponível para ${emp?.name ?? "a pessoa"} em ${formatLocalDate(c.date)}: ${availability.reason}. A prévia foi refeita.`);
    const [moved] = await tx
      .insert(deskBooking)
      .values({ resourceId: d.targetResourceId, employeeId: c.employeeId, bookingDate: c.date, status: "confirmed", origin: "admin_realloc", actorEmployeeId: actor.employeeId })
      .returning({ id: deskBooking.id });
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "booking.reallocated", entityType: "desk_booking", entityId: c.bookingId, before: { resourceId: c.resourceId, date: c.date }, after: { newBookingId: moved.id, resourceId: d.targetResourceId, why: c.why }, reason: d.reason, requestId: actor.requestId });
    if (emp) {
      await enqueueOutbox(tx, {
        eventType: "email.booking_changed",
        aggregateType: "desk_booking",
        aggregateId: moved.id,
        payload: { message: bookingChangedEmail(emp.email, emp.name, `Sua reserva de ${formatLocalDate(c.date)} foi movida da mesa ${c.resourceCode} para a mesa ${target.code}. ${opts.notice} ${d.message?.trim() ?? ""}`.trim()) },
        idempotencyKey: `booking.reallocated:${c.bookingId}`,
      });
    }
  }
}

/** Reservas ativas futuras que o painel de conflitos lista por consulta dinâmica (nunca por eventos). */
export async function pendingConflicts(db: DbOrTx, from: string) {
  const rows = await db
    .select({ bookingId: deskBooking.id, resourceCode: resource.code, employeeName: employee.fullName, date: deskBooking.bookingDate, status: deskBooking.status })
    .from(deskBooking)
    .innerJoin(resource, eq(resource.id, deskBooking.resourceId))
    .innerJoin(employee, eq(employee.id, deskBooking.employeeId))
    .where(
      and(
        gte(deskBooking.bookingDate, from),
        or(eq(deskBooking.status, "confirmed"), and(eq(deskBooking.status, "held"), isNotNull(deskBooking.holdExpiresAt), gt(deskBooking.holdExpiresAt, sql`now()`))),
        sql`not booking_remains_valid(${deskBooking.employeeId}, ${deskBooking.resourceId}, ${deskBooking.bookingDate})`,
      ),
    )
    .orderBy(asc(deskBooking.bookingDate));
  return rows;
}
