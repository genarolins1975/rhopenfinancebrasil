import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "@/db/client";
import { accessException, accessGroup, accessGroupMember, auditEvent, employee, exclusiveAssignment, resource } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { type Policy, isEligible } from "@/modules/availability/rules";
import { loadResourcesOnDate } from "@/modules/availability/service";
import { enqueueOutbox } from "@/modules/notifications/outbox";
import { exclusivityEmail } from "@/modules/notifications/templates";
import { addDays, formatLocalDate, localToday } from "@/modules/shared/dates";
import { ConflictError, ForbiddenError, ValidationError } from "@/modules/shared/errors";
import { applyConflictDecisions, type ConflictDecision, type IncompatibleBooking, listActiveBookings } from "@/modules/office/conflicts";
import { type Actor, assertIsoDate, assertPermission, assertUuid, lockResources, readSettings, shareLockEmployee, withOfficeTx } from "@/modules/office/shared";

/*
 * Exclusividade da diretoria (DIR-001 a DIR-036). Toda mutação: locks na ordem documentada, prévia de impacto
 * revalidada dentro da transação, decisão explícita por reserva incompatível, auditoria e notificação (DIR-028).
 * Estado da atribuição é derivado da vigência; os triggers do banco impõem as regras de DIR-036.
 */

const MANAGE = "manage_executive_seat_assignments" as const;

export type AssignmentInput = {
  resourceId: string;
  mode: "individual" | "group";
  holderEmployeeId?: string | null;
  accessGroupId?: string | null;
  validFrom: string;
  validTo?: string | null;
  reason: string;
  /** Quem decidiu (pessoa ou área), distinto do ator da sessão (PAR-27). */
  responsible: string;
};

type PolicyOverride = (policy: Policy, date: string) => Policy;

/** Reservas ativas que ficariam incompatíveis sob uma política hipotética, avaliadas data a data com a regra única. */
async function findIncompatible(db: DbOrTx, filter: { resourceIds: string[]; employeeIds?: string[]; from: string; to: string | null }, override: PolicyOverride, why: string): Promise<IncompatibleBooking[]> {
  const bookings = await listActiveBookings(db, filter);
  const out: IncompatibleBooking[] = [];
  for (const b of bookings) {
    const [r] = await loadResourcesOnDate(db, b.date, { ids: [b.resourceId] });
    if (!r) continue;
    if (!isEligible(b.employeeId, override(r.policy, b.date))) out.push({ ...b, why });
  }
  return out;
}

async function groupMembersAll(db: DbOrTx, groupId: string) {
  return db.select().from(accessGroupMember).where(eq(accessGroupMember.groupId, groupId));
}

function membersOn(members: Array<{ employeeId: string; validFrom: string; validTo: string | null }>, date: string, exclude?: string): Set<string> {
  return new Set(members.filter((m) => m.validFrom <= date && (!m.validTo || m.validTo >= date) && m.employeeId !== exclude).map((m) => m.employeeId));
}

async function notify(tx: Tx, employeeId: string, aggregateId: string, key: string, text: string) {
  const [emp] = await tx.select({ email: employee.corporateEmail, name: employee.fullName }).from(employee).where(eq(employee.id, employeeId));
  if (!emp) return;
  await enqueueOutbox(tx, { eventType: "email.exclusivity", aggregateType: "exclusive_assignment", aggregateId, payload: { message: exclusivityEmail(emp.email, emp.name, text) }, idempotencyKey: key });
}

async function assertHolder(db: DbOrTx, holderEmployeeId: string) {
  const [h] = await db.select({ id: employee.id, status: employee.status, orgCondition: employee.orgCondition, name: employee.fullName }).from(employee).where(eq(employee.id, holderEmployeeId));
  if (!h) throw new ValidationError("Titular não encontrado.");
  if (h.status !== "active" || h.orgCondition !== "director") throw new ValidationError("Titular de atribuição individual precisa ser pessoa ativa com condição organizacional de diretor (PAR-23).");
  return h;
}

function validateAssignmentInput(input: AssignmentInput) {
  assertUuid(input.resourceId, "Mesa");
  assertIsoDate(input.validFrom, "Início");
  if (input.validTo) assertIsoDate(input.validTo, "Término");
  if (input.validTo && input.validTo < input.validFrom) throw new ValidationError("O término não pode ser anterior ao início.");
  if (!input.reason?.trim()) throw new ValidationError("Informe a justificativa.");
  if (!input.responsible?.trim()) throw new ValidationError("Informe o responsável pela decisão.");
  if (input.mode === "individual") {
    if (!input.holderEmployeeId) throw new ValidationError("Informe o titular.");
    assertUuid(input.holderEmployeeId, "Titular");
  } else {
    if (!input.accessGroupId) throw new ValidationError("Informe o grupo.");
    assertUuid(input.accessGroupId, "Grupo");
  }
}

export type AssignmentPreview = {
  resourceCode: string;
  startsOn: string;
  endsOn: string | null;
  /** Dias afetados dentro do horizonte visível (quatro semanas). */
  daysAffected: number;
  conflicts: IncompatibleBooking[];
  /** Sobreposição com outra atribuição não anulada impede. */
  overlap: { id: string; validFrom: string; validTo: string | null; mode: string } | null;
  /** Manutenção ou bloqueio vigente no período: informa, não impede. */
  periods: Array<{ status: string; startsOn: string; endsOn: string | null }>;
  blockers: string[];
  notifications: string[];
};

async function previewOne(db: DbOrTx, input: AssignmentInput, members: Array<{ employeeId: string; validFrom: string; validTo: string | null }>): Promise<AssignmentPreview> {
  const [r] = await db.select({ id: resource.id, code: resource.code, type: resource.type, retiredOn: resource.retiredOn }).from(resource).where(eq(resource.id, input.resourceId));
  if (!r) throw new ValidationError("Mesa não encontrada.");
  const blockers: string[] = [];
  if (r.type !== "desk") blockers.push("Só mesas recebem atribuição exclusiva.");
  if (r.retiredOn && r.retiredOn <= input.validFrom) blockers.push("Recurso desativado na data de início.");
  const [overlap] = await db
    .select({ id: exclusiveAssignment.id, validFrom: exclusiveAssignment.validFrom, validTo: exclusiveAssignment.validTo, mode: exclusiveAssignment.mode })
    .from(exclusiveAssignment)
    .where(and(eq(exclusiveAssignment.resourceId, input.resourceId), isNull(exclusiveAssignment.cancelledAt), sql`daterange(${exclusiveAssignment.validFrom}, ${exclusiveAssignment.validTo}, '[]') && daterange(${input.validFrom}::date, ${input.validTo ?? null}::date, '[]')`));
  if (overlap) blockers.push(`Já existe atribuição na mesa de ${formatLocalDate(overlap.validFrom)} ${overlap.validTo ? `até ${formatLocalDate(overlap.validTo)}` : "sem término"}. Encerre ou anule antes.`);
  const { resourceStatusPeriod } = await import("@/db/schema");
  const periods = await db
    .select({ status: resourceStatusPeriod.status, startsOn: resourceStatusPeriod.startsOn, endsOn: resourceStatusPeriod.endsOn })
    .from(resourceStatusPeriod)
    .where(and(eq(resourceStatusPeriod.resourceId, input.resourceId), sql`period_range(${resourceStatusPeriod.startsOn}, ${resourceStatusPeriod.endsOn}, ${resourceStatusPeriod.releasedOn}) && daterange(${input.validFrom}::date, ${input.validTo ?? null}::date, '[]')`));
  const hypothetical = { id: "preview", mode: input.mode, holderEmployeeId: input.holderEmployeeId ?? null, accessGroupId: input.accessGroupId ?? null, needsReview: false, validFrom: input.validFrom, validTo: input.validTo ?? null } as const;
  const conflicts = await findIncompatible(db, { resourceIds: [input.resourceId], from: input.validFrom, to: input.validTo ?? null }, (_p, date) => ({ assignment: hypothetical, exception: null, members: input.mode === "group" ? membersOn(members, date) : new Set() }), "uso exclusivo a partir do início da atribuição");
  const settings = await readSettings(db);
  const horizonEnd = addDays(localToday(), settings.bookingHorizonWeeks * 7);
  const end = input.validTo && input.validTo < horizonEnd ? input.validTo : horizonEnd;
  const daysAffected = Math.max(0, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${input.validFrom}T00:00:00Z`)) / 86_400_000) + 1);
  return {
    resourceCode: r.code,
    startsOn: input.validFrom,
    endsOn: input.validTo ?? null,
    daysAffected,
    conflicts,
    overlap: overlap ?? null,
    periods,
    blockers,
    notifications: input.mode === "individual" ? ["Titular", "RH"] : ["Integrantes ativos do grupo", "RH"],
  };
}

export async function previewAssignment(db: DbOrTx, actor: Actor, input: AssignmentInput): Promise<AssignmentPreview> {
  await assertPermission(db, actor, MANAGE);
  validateAssignmentInput(input);
  if (input.mode === "individual") await assertHolder(db, input.holderEmployeeId!);
  const members = input.mode === "group" ? await groupMembersAll(db, input.accessGroupId!) : [];
  return previewOne(db, input, members);
}

/** Travar, vincular ou agendar (DIR-004, DIR-016). Uma mesa por chamada; lote em `batchAssign`. */
export async function createAssignment(db: Db, actor: Actor, input: AssignmentInput, decisions: ConflictDecision[] = []): Promise<string> {
  const [id] = await batchAssign(db, actor, [input], decisions);
  return id;
}

/** Lote atômico (DIR-027): prévia consolidada revalidada por mesa; qualquer conflito sem decisão bloqueia tudo. */
export async function batchAssign(db: Db, actor: Actor, inputs: AssignmentInput[], decisions: ConflictDecision[] = []): Promise<string[]> {
  await assertPermission(db, actor, MANAGE);
  if (inputs.length === 0) throw new ValidationError("Selecione ao menos uma mesa.");
  if (new Set(inputs.map((i) => i.resourceId)).size !== inputs.length) throw new ValidationError("Cada mesa aparece uma única vez no lote.");
  for (const i of inputs) validateAssignmentInput(i);
  if (inputs.some((i) => i.validFrom < localToday())) throw new ValidationError("A vigência começa hoje ou depois.");
  for (const i of inputs) if (i.mode === "individual") await assertHolder(db, i.holderEmployeeId!);
  if (inputs.some((i) => i.mode === "individual") && new Set(inputs.filter((i) => i.mode === "individual").map((i) => i.holderEmployeeId)).size !== inputs.filter((i) => i.mode === "individual").length) {
    throw new ValidationError("Um titular recebe uma única mesa por lote.");
  }
  return withOfficeTx(db, async (tx) => {
    const targets = decisions.map((d) => d.targetResourceId).filter((v): v is string => !!v);
    await lockResources(tx, [...inputs.map((i) => i.resourceId), ...targets]);
    for (const i of inputs) {
      if (i.mode === "individual") await shareLockEmployee(tx, i.holderEmployeeId!);
      else await tx.execute(sql`select 1 from access_group where id = ${i.accessGroupId} for share`);
    }
    const ids: string[] = [];
    for (const i of inputs) {
      const members = i.mode === "group" ? await groupMembersAll(tx, i.accessGroupId!) : [];
      const preview = await previewOne(tx, i, members);
      if (preview.blockers.length) throw new ConflictError(preview.blockers.join(" "));
      await applyConflictDecisions(tx, actor, preview.conflicts, decisions.filter((d) => preview.conflicts.some((c) => c.bookingId === d.bookingId)), {
        excludeResourceIds: inputs.map((x) => x.resourceId),
        notice: `A mesa ${preview.resourceCode} passa a uso exclusivo da diretoria a partir de ${formatLocalDate(i.validFrom)}.`,
      });
      const [row] = await tx
        .insert(exclusiveAssignment)
        .values({ resourceId: i.resourceId, mode: i.mode, holderEmployeeId: i.mode === "individual" ? i.holderEmployeeId : null, accessGroupId: i.mode === "group" ? i.accessGroupId : null, validFrom: i.validFrom, validTo: i.validTo || null, reason: i.reason.trim(), responsible: i.responsible.trim(), createdBy: actor.employeeId })
        .returning({ id: exclusiveAssignment.id });
      ids.push(row.id);
      await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "exclusivity.assignment_created", entityType: "exclusive_assignment", entityId: row.id, after: { resourceId: i.resourceId, code: preview.resourceCode, mode: i.mode, holderEmployeeId: i.holderEmployeeId ?? null, accessGroupId: i.accessGroupId ?? null, validFrom: i.validFrom, validTo: i.validTo ?? null, responsible: i.responsible, conflictsDecided: preview.conflicts.length }, reason: i.reason, requestId: actor.requestId });
      if (i.mode === "individual") {
        await notify(tx, i.holderEmployeeId!, row.id, `exclusivity.created:${row.id}`, `A mesa ${preview.resourceCode} passa a ser sua mesa de uso exclusivo a partir de ${formatLocalDate(i.validFrom)}${i.validTo ? ` até ${formatLocalDate(i.validTo)}` : ", sem término definido"}. Reservar a mesa continua necessário para registrar os dias de utilização.`);
      }
    }
    return ids;
  });
}

export type TransferInput = { assignmentId: string; newHolderEmployeeId: string; from: string; reason: string; responsible: string };

export async function previewTransfer(db: DbOrTx, actor: Actor, input: TransferInput): Promise<AssignmentPreview & { newHolderElsewhere: IncompatibleBooking[] }> {
  await assertPermission(db, actor, MANAGE);
  assertUuid(input.assignmentId, "Atribuição");
  assertUuid(input.newHolderEmployeeId, "Novo titular");
  assertIsoDate(input.from, "Data da transferência");
  const [a] = await db.select().from(exclusiveAssignment).where(eq(exclusiveAssignment.id, input.assignmentId));
  if (!a) throw new ValidationError("Atribuição não encontrada.");
  if (a.mode !== "individual") throw new ValidationError("Só atribuição individual é transferida.");
  const holder = await assertHolder(db, input.newHolderEmployeeId);
  const [r] = await db.select({ code: resource.code }).from(resource).where(eq(resource.id, a.resourceId));
  const blockers: string[] = [];
  if (input.from < localToday()) blockers.push("A transferência começa hoje ou depois.");
  if (input.from <= a.validFrom) blockers.push("A transferência precisa começar depois do início da atribuição.");
  if (a.validTo && a.validTo < input.from) blockers.push("A transferência não pode começar depois do término.");
  if (holder.id === a.holderEmployeeId) blockers.push("O novo titular precisa ser outra pessoa.");
  const openExceptions = await db.select({ id: accessException.id, endsOn: accessException.endsOn }).from(accessException).where(and(eq(accessException.assignmentId, a.id), isNull(accessException.revokedAt), gte(accessException.endsOn, input.from)));
  if (openExceptions.length) blockers.push("Há liberação temporária que avança sobre a data da transferência. Revogue antes.");
  const hypothetical = { ...a, holderEmployeeId: input.newHolderEmployeeId, needsReview: false } as const;
  const conflicts = await findIncompatible(db, { resourceIds: [a.resourceId], from: input.from, to: a.validTo }, () => ({ assignment: hypothetical, exception: null, members: new Set() }), "titular anterior deixa de ser elegível na data da transferência");
  const newHolderElsewhere = (await listActiveBookings(db, { employeeIds: [input.newHolderEmployeeId], from: input.from, to: a.validTo })).map((b) => ({ ...b, why: "reserva do novo titular em outra mesa (informativa, não cancelada)" }));
  return { resourceCode: r?.code ?? "", startsOn: input.from, endsOn: a.validTo, daysAffected: 0, conflicts, overlap: null, periods: [], blockers, notifications: ["Titular anterior", "Novo titular", "RH"], newHolderElsewhere };
}

export async function transferAssignment(db: Db, actor: Actor, input: TransferInput, decisions: ConflictDecision[] = []): Promise<string> {
  const preview = await previewTransfer(db, actor, input);
  if (preview.blockers.length) throw new ConflictError(preview.blockers.join(" "));
  if (!input.reason?.trim() || !input.responsible?.trim()) throw new ValidationError("Informe motivo e responsável.");
  return withOfficeTx(db, async (tx) => {
    const [a] = await tx.select().from(exclusiveAssignment).where(eq(exclusiveAssignment.id, input.assignmentId));
    if (!a) throw new ValidationError("Atribuição não encontrada.");
    const targets = decisions.map((d) => d.targetResourceId).filter((v): v is string => !!v);
    await lockResources(tx, [a.resourceId, ...targets]);
    await shareLockEmployee(tx, input.newHolderEmployeeId);
    const again = await previewTransfer(tx, actor, input);
    await applyConflictDecisions(tx, actor, again.conflicts, decisions, { excludeResourceIds: [a.resourceId], notice: `A mesa ${again.resourceCode} foi transferida a outro titular a partir de ${formatLocalDate(input.from)}.` });
    const res = await tx.execute(sql`select transfer_assignment(${input.assignmentId}::uuid, ${input.newHolderEmployeeId}::uuid, ${input.from}::date, ${input.reason.trim()}, ${input.responsible.trim()}, ${actor.employeeId}::uuid) as id`);
    const newId = (res.rows[0] as { id: string }).id;
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "exclusivity.assignment_transferred", entityType: "exclusive_assignment", entityId: a.id, before: { holderEmployeeId: a.holderEmployeeId, validTo: a.validTo }, after: { successorId: newId, holderEmployeeId: input.newHolderEmployeeId, from: input.from, responsible: input.responsible }, reason: input.reason, requestId: actor.requestId });
    await notify(tx, a.holderEmployeeId!, a.id, `exclusivity.transferred_out:${a.id}`, `A mesa ${again.resourceCode} deixa de ser sua mesa de uso exclusivo a partir de ${formatLocalDate(input.from)}.`);
    await notify(tx, input.newHolderEmployeeId, newId, `exclusivity.transferred_in:${newId}`, `A mesa ${again.resourceCode} passa a ser sua mesa de uso exclusivo a partir de ${formatLocalDate(input.from)}.`);
    return newId;
  });
}

/** Encerrar grava só o término (DIR-036); a mesa volta ao conjunto compartilhado no dia seguinte; nada é cancelado. */
export async function endAssignment(db: Db, actor: Actor, input: { assignmentId: string; validTo: string; reason: string }): Promise<void> {
  await assertPermission(db, actor, MANAGE);
  assertUuid(input.assignmentId, "Atribuição");
  assertIsoDate(input.validTo, "Término");
  if (!input.reason?.trim()) throw new ValidationError("Informe o motivo.");
  await withOfficeTx(db, async (tx) => {
    const [a] = await tx.select().from(exclusiveAssignment).where(eq(exclusiveAssignment.id, input.assignmentId));
    if (!a) throw new ValidationError("Atribuição não encontrada.");
    if (a.cancelledAt) throw new ConflictError("Atribuição anulada.");
    if (a.validTo && a.validTo < localToday()) throw new ConflictError("Atribuição já encerrada.");
    if (input.validTo < a.validFrom) throw new ValidationError("O término não pode ser anterior ao início. Para atribuição agendada, anule.");
    await lockResources(tx, [a.resourceId]);
    await tx.update(exclusiveAssignment).set({ validTo: input.validTo, endedBy: actor.employeeId, endReason: "ended" }).where(eq(exclusiveAssignment.id, a.id));
    const [r] = await tx.select({ code: resource.code }).from(resource).where(eq(resource.id, a.resourceId));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "exclusivity.assignment_ended", entityType: "exclusive_assignment", entityId: a.id, before: { validTo: a.validTo }, after: { validTo: input.validTo }, reason: input.reason, requestId: actor.requestId });
    if (a.holderEmployeeId) await notify(tx, a.holderEmployeeId, a.id, `exclusivity.ended:${a.id}`, `A mesa ${r?.code ?? ""} deixa de ser de uso exclusivo após ${formatLocalDate(input.validTo)}. Suas reservas continuam válidas como reservas comuns.`);
  });
}

/** Anular: só atribuição agendada. Sucessora de transferência exige decisão sobre a mesa (DIR-036). */
export async function cancelAssignment(db: Db, actor: Actor, input: { assignmentId: string; reason: string; successorDecision?: "release" | "reopen" }): Promise<void> {
  await assertPermission(db, actor, MANAGE);
  assertUuid(input.assignmentId, "Atribuição");
  if (!input.reason?.trim()) throw new ValidationError("Informe o motivo.");
  await withOfficeTx(db, async (tx) => {
    const [a] = await tx.select().from(exclusiveAssignment).where(eq(exclusiveAssignment.id, input.assignmentId));
    if (!a) throw new ValidationError("Atribuição não encontrada.");
    if (a.validFrom <= localToday()) throw new ConflictError("Só atribuição agendada, ainda não iniciada, pode ser anulada. Para as demais, encerre.");
    await lockResources(tx, [a.resourceId]);
    if (a.transferredFromId) {
      if (!input.successorDecision) throw new ConflictError("Esta atribuição é sucessora de uma transferência. Decida: liberar a mesa ao conjunto compartilhado ou reabrir para o titular anterior.");
      const [pred] = await tx.select().from(exclusiveAssignment).where(eq(exclusiveAssignment.id, a.transferredFromId));
      await tx.update(exclusiveAssignment).set({ endReason: "transfer_cancelled" }).where(eq(exclusiveAssignment.id, a.transferredFromId));
      await tx.update(exclusiveAssignment).set({ cancelledAt: new Date(), cancelledBy: actor.employeeId, cancelReason: input.reason.trim() }).where(eq(exclusiveAssignment.id, a.id));
      if (input.successorDecision === "reopen" && pred?.holderEmployeeId) {
        // Reabrir: nova atribuição contígua para o titular anterior; a sucessora anulada já saiu da regra de sobreposição.
        await tx.insert(exclusiveAssignment).values({ resourceId: a.resourceId, mode: "individual", holderEmployeeId: pred.holderEmployeeId, validFrom: a.validFrom, validTo: a.validTo, reason: `reaberta após anulação da transferência: ${input.reason.trim()}`, responsible: pred.responsible, createdBy: actor.employeeId });
      }
    } else {
      await tx.update(exclusiveAssignment).set({ cancelledAt: new Date(), cancelledBy: actor.employeeId, cancelReason: input.reason.trim() }).where(eq(exclusiveAssignment.id, a.id));
    }
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "exclusivity.assignment_cancelled", entityType: "exclusive_assignment", entityId: a.id, after: { successorDecision: input.successorDecision ?? null }, reason: input.reason, requestId: actor.requestId });
    if (a.holderEmployeeId) await notify(tx, a.holderEmployeeId, a.id, `exclusivity.cancelled:${a.id}`, "A atribuição agendada da sua mesa de uso exclusivo foi anulada antes de começar.");
  });
}

/* Liberação temporária (DIR-013, DIR-014, PAR-26, PAR-35). */

export type ExceptionInput = { assignmentId: string; kind: "release_to_shared" | "release_to_employee"; beneficiaryEmployeeId?: string | null; startsOn: string; endsOn: string; reason: string };

export async function previewException(db: DbOrTx, actor: Actor, input: ExceptionInput): Promise<{ resourceCode: string; days: number; conflicts: IncompatibleBooking[]; periods: Array<{ status: string; startsOn: string; endsOn: string | null }>; blockers: string[] }> {
  await assertPermission(db, actor, MANAGE);
  assertUuid(input.assignmentId, "Atribuição");
  assertIsoDate(input.startsOn, "Início");
  assertIsoDate(input.endsOn, "Fim");
  const [a] = await db.select().from(exclusiveAssignment).where(eq(exclusiveAssignment.id, input.assignmentId));
  if (!a) throw new ValidationError("Atribuição não encontrada.");
  const [r] = await db.select({ code: resource.code }).from(resource).where(eq(resource.id, a.resourceId));
  const settings = await readSettings(db);
  const days = Math.round((Date.parse(`${input.endsOn}T00:00:00Z`) - Date.parse(`${input.startsOn}T00:00:00Z`)) / 86_400_000) + 1;
  const blockers: string[] = [];
  if (days < 1) blockers.push("O fim não pode ser anterior ao início.");
  if (days > settings.exceptionMaxDays) blockers.push(`Liberação acima de ${settings.exceptionMaxDays} dias: encerre a atribuição em vez de liberar.`);
  if (input.startsOn < localToday()) blockers.push("A liberação começa hoje ou depois.");
  if (input.startsOn < a.validFrom || (a.validTo && input.endsOn > a.validTo)) blockers.push("A liberação precisa caber na vigência da atribuição.");
  if (input.kind === "release_to_employee") {
    if (!input.beneficiaryEmployeeId) blockers.push("Informe a pessoa beneficiária.");
    else if (input.beneficiaryEmployeeId === a.holderEmployeeId) blockers.push("O titular não precisa de liberação para a própria mesa.");
  }
  const { resourceStatusPeriod } = await import("@/db/schema");
  const periods = await db
    .select({ status: resourceStatusPeriod.status, startsOn: resourceStatusPeriod.startsOn, endsOn: resourceStatusPeriod.endsOn })
    .from(resourceStatusPeriod)
    .where(and(eq(resourceStatusPeriod.resourceId, a.resourceId), sql`period_range(${resourceStatusPeriod.startsOn}, ${resourceStatusPeriod.endsOn}, ${resourceStatusPeriod.releasedOn}) && daterange(${input.startsOn}::date, ${input.endsOn}::date, '[]')`));
  const hypothetical = { id: "preview", kind: input.kind, beneficiaryEmployeeId: input.beneficiaryEmployeeId ?? null } as const;
  const conflicts = await findIncompatible(db, { resourceIds: [a.resourceId], from: input.startsOn, to: input.endsOn }, (p) => ({ ...p, exception: hypothetical }), "titular não reserva a mesa nas datas liberadas a outra pessoa (PAR-26)");
  return { resourceCode: r?.code ?? "", days, conflicts, periods, blockers };
}

export async function createException(db: Db, actor: Actor, input: ExceptionInput, decisions: ConflictDecision[] = []): Promise<string> {
  const preview = await previewException(db, actor, input);
  if (preview.blockers.length) throw new ConflictError(preview.blockers.join(" "));
  if (!input.reason?.trim()) throw new ValidationError("Informe o motivo.");
  return withOfficeTx(db, async (tx) => {
    const [a] = await tx.select().from(exclusiveAssignment).where(eq(exclusiveAssignment.id, input.assignmentId));
    if (!a) throw new ValidationError("Atribuição não encontrada.");
    const targets = decisions.map((d) => d.targetResourceId).filter((v): v is string => !!v);
    await lockResources(tx, [a.resourceId, ...targets]);
    if (input.beneficiaryEmployeeId) await shareLockEmployee(tx, input.beneficiaryEmployeeId);
    const again = await previewException(tx, actor, input);
    await applyConflictDecisions(tx, actor, again.conflicts, decisions, { excludeResourceIds: [a.resourceId], notice: "A mesa foi liberada temporariamente a outra pessoa." });
    const [row] = await tx
      .insert(accessException)
      .values({ assignmentId: a.id, resourceId: a.resourceId, kind: input.kind, beneficiaryEmployeeId: input.kind === "release_to_employee" ? input.beneficiaryEmployeeId : null, startsOn: input.startsOn, endsOn: input.endsOn, reason: input.reason.trim(), createdBy: actor.employeeId })
      .returning({ id: accessException.id });
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "exclusivity.exception_created", entityType: "access_exception", entityId: row.id, after: { assignmentId: a.id, resourceId: a.resourceId, kind: input.kind, beneficiaryEmployeeId: input.beneficiaryEmployeeId ?? null, startsOn: input.startsOn, endsOn: input.endsOn }, reason: input.reason, requestId: actor.requestId });
    if (a.holderEmployeeId) await notify(tx, a.holderEmployeeId, row.id, `exclusivity.exception:${row.id}`, `Sua mesa ${again.resourceCode} foi liberada ${input.kind === "release_to_shared" ? "ao conjunto compartilhado" : "a outra pessoa"} de ${formatLocalDate(input.startsOn)} a ${formatLocalDate(input.endsOn)}. Depois disso a exclusividade volta automaticamente.`);
    if (input.kind === "release_to_employee" && input.beneficiaryEmployeeId) await notify(tx, input.beneficiaryEmployeeId, row.id, `exclusivity.exception_beneficiary:${row.id}`, `A mesa ${again.resourceCode} foi liberada para você de ${formatLocalDate(input.startsOn)} a ${formatLocalDate(input.endsOn)}. Reserve os dias que for utilizar.`);
    return row.id;
  });
}

export async function previewRevokeException(db: DbOrTx, actor: Actor, exceptionId: string): Promise<{ conflicts: IncompatibleBooking[]; resourceCode: string }> {
  await assertPermission(db, actor, MANAGE);
  assertUuid(exceptionId, "Liberação");
  const [x] = await db.select().from(accessException).where(eq(accessException.id, exceptionId));
  if (!x) throw new ValidationError("Liberação não encontrada.");
  const [r] = await db.select({ code: resource.code }).from(resource).where(eq(resource.id, x.resourceId));
  const from = x.startsOn > localToday() ? x.startsOn : localToday();
  const conflicts = await findIncompatible(db, { resourceIds: [x.resourceId], from, to: x.endsOn }, (p) => ({ ...p, exception: null }), "reserva feita sob a liberação que está sendo revogada");
  return { conflicts, resourceCode: r?.code ?? "" };
}

export async function revokeException(db: Db, actor: Actor, input: { exceptionId: string; reason: string }, decisions: ConflictDecision[] = []): Promise<void> {
  if (!input.reason?.trim()) throw new ValidationError("Informe o motivo.");
  await withOfficeTx(db, async (tx) => {
    const [x] = await tx.select().from(accessException).where(eq(accessException.id, input.exceptionId));
    if (!x) throw new ValidationError("Liberação não encontrada.");
    if (x.revokedAt) throw new ConflictError("Liberação já revogada.");
    const targets = decisions.map((d) => d.targetResourceId).filter((v): v is string => !!v);
    await lockResources(tx, [x.resourceId, ...targets]);
    const again = await previewRevokeException(tx, actor, input.exceptionId);
    await applyConflictDecisions(tx, actor, again.conflicts, decisions, { excludeResourceIds: [x.resourceId], notice: "A liberação temporária da mesa foi revogada." });
    await tx.update(accessException).set({ revokedAt: new Date(), revokedBy: actor.employeeId, revokeReason: input.reason.trim() }).where(eq(accessException.id, x.id));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "exclusivity.exception_revoked", entityType: "access_exception", entityId: x.id, before: { startsOn: x.startsOn, endsOn: x.endsOn, kind: x.kind }, reason: input.reason, requestId: actor.requestId });
    if (x.beneficiaryEmployeeId) await notify(tx, x.beneficiaryEmployeeId, x.id, `exclusivity.exception_revoked:${x.id}`, `A liberação da mesa ${again.resourceCode} para você foi revogada.`);
  });
}

/* Grupo da diretoria (DIR-010, DIR-032). */

export async function listGroups(db: DbOrTx) {
  const groups = await db.select().from(accessGroup).orderBy(asc(accessGroup.code));
  const members = await db
    .select({ id: accessGroupMember.id, groupId: accessGroupMember.groupId, employeeId: accessGroupMember.employeeId, name: employee.fullName, status: employee.status, validFrom: accessGroupMember.validFrom, validTo: accessGroupMember.validTo, reason: accessGroupMember.reason })
    .from(accessGroupMember)
    .innerJoin(employee, eq(employee.id, accessGroupMember.employeeId))
    .orderBy(asc(employee.fullName));
  const today = localToday();
  return groups.map((g) => ({ ...g, members: members.filter((m) => m.groupId === g.id).map((m) => ({ ...m, state: m.validFrom > today ? "agendado" : m.validTo && m.validTo < today ? "encerrado" : "vigente" })) }));
}

export async function addGroupMember(db: Db, actor: Actor, input: { groupId: string; employeeId: string; validFrom: string; reason: string }): Promise<string> {
  await assertPermission(db, actor, MANAGE);
  assertUuid(input.groupId, "Grupo");
  assertUuid(input.employeeId, "Pessoa");
  assertIsoDate(input.validFrom, "Início");
  if (input.validFrom < localToday()) throw new ValidationError("A vigência começa hoje ou depois.");
  if (!input.reason?.trim()) throw new ValidationError("Informe o motivo.");
  const [emp] = await db.select({ status: employee.status, orgCondition: employee.orgCondition }).from(employee).where(eq(employee.id, input.employeeId));
  if (!emp || emp.status !== "active") throw new ValidationError("Só pessoa ativa entra no grupo.");
  if (emp.orgCondition !== "director") throw new ValidationError("Só pessoa com condição organizacional de diretor entra no grupo da diretoria (PAR-23).");
  return withOfficeTx(db, async (tx) => {
    await tx.execute(sql`select 1 from access_group where id = ${input.groupId} for update`);
    const [open] = await tx.select({ id: accessGroupMember.id }).from(accessGroupMember).where(and(eq(accessGroupMember.groupId, input.groupId), eq(accessGroupMember.employeeId, input.employeeId), or(isNull(accessGroupMember.validTo), gte(accessGroupMember.validTo, input.validFrom))));
    if (open) throw new ConflictError("A pessoa já integra o grupo neste período.");
    const [row] = await tx.insert(accessGroupMember).values({ groupId: input.groupId, employeeId: input.employeeId, validFrom: input.validFrom, addedBy: actor.employeeId, reason: input.reason.trim() }).returning({ id: accessGroupMember.id });
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "exclusivity.group_member_added", entityType: "access_group", entityId: input.groupId, after: { memberId: row.id, employeeId: input.employeeId, validFrom: input.validFrom }, reason: input.reason, requestId: actor.requestId });
    return row.id;
  });
}

export async function previewRemoveMember(db: DbOrTx, actor: Actor, input: { memberId: string; validTo: string }): Promise<{ conflicts: IncompatibleBooking[]; employeeName: string }> {
  await assertPermission(db, actor, MANAGE);
  assertUuid(input.memberId, "Integrante");
  assertIsoDate(input.validTo, "Término");
  const [m] = await db.select({ id: accessGroupMember.id, groupId: accessGroupMember.groupId, employeeId: accessGroupMember.employeeId, name: employee.fullName }).from(accessGroupMember).innerJoin(employee, eq(employee.id, accessGroupMember.employeeId)).where(eq(accessGroupMember.id, input.memberId));
  if (!m) throw new ValidationError("Integrante não encontrado.");
  const desks = await db.select({ resourceId: exclusiveAssignment.resourceId }).from(exclusiveAssignment).where(and(eq(exclusiveAssignment.accessGroupId, m.groupId), isNull(exclusiveAssignment.cancelledAt), or(isNull(exclusiveAssignment.validTo), gte(exclusiveAssignment.validTo, localToday()))));
  const conflicts = await findIncompatible(db, { resourceIds: [...new Set(desks.map((d) => d.resourceId))], employeeIds: [m.employeeId], from: addDays(input.validTo, 1), to: null }, (p) => ({ ...p, members: new Set([...p.members].filter((e) => e !== m.employeeId)) }), "integrante deixa o grupo antes da data da reserva");
  return { conflicts, employeeName: m.name };
}

export async function removeGroupMember(db: Db, actor: Actor, input: { memberId: string; validTo: string; reason: string }, decisions: ConflictDecision[] = []): Promise<void> {
  const preview = await previewRemoveMember(db, actor, input);
  if (!input.reason?.trim()) throw new ValidationError("Informe o motivo.");
  if (input.validTo < addDays(localToday(), -1)) throw new ValidationError("O término não pode ficar no passado.");
  await withOfficeTx(db, async (tx) => {
    const [m] = await tx.select().from(accessGroupMember).where(eq(accessGroupMember.id, input.memberId));
    if (!m) throw new ValidationError("Integrante não encontrado.");
    await tx.execute(sql`select 1 from access_group where id = ${m.groupId} for update`);
    const desks = await tx.select({ resourceId: exclusiveAssignment.resourceId }).from(exclusiveAssignment).where(and(eq(exclusiveAssignment.accessGroupId, m.groupId), isNull(exclusiveAssignment.cancelledAt), or(isNull(exclusiveAssignment.validTo), gte(exclusiveAssignment.validTo, localToday()))));
    const targets = decisions.map((d) => d.targetResourceId).filter((v): v is string => !!v);
    await lockResources(tx, [...desks.map((d) => d.resourceId), ...targets]);
    const again = await previewRemoveMember(tx, actor, input);
    await applyConflictDecisions(tx, actor, again.conflicts, decisions, { excludeResourceIds: desks.map((d) => d.resourceId), notice: "Sua participação no grupo da diretoria terminou antes desta data." });
    await tx.update(accessGroupMember).set({ validTo: input.validTo, removedBy: actor.employeeId, reason: input.reason.trim() }).where(eq(accessGroupMember.id, m.id));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "exclusivity.group_member_removed", entityType: "access_group", entityId: m.groupId, before: { memberId: m.id, employeeId: m.employeeId, validTo: m.validTo }, after: { validTo: input.validTo }, reason: input.reason, requestId: actor.requestId });
    void preview;
  });
}

/* Consultas para a tela. */

export type AssignmentRow = {
  id: string;
  resourceId: string;
  code: string;
  mode: "individual" | "group";
  holderEmployeeId: string | null;
  holderName: string | null;
  groupName: string | null;
  validFrom: string;
  validTo: string | null;
  state: "scheduled" | "active" | "ended" | "cancelled";
  needsReview: boolean;
  reason: string;
  responsible: string;
  endReason: string | null;
  transferredFromId: string | null;
  exceptions: Array<{ id: string; kind: string; beneficiaryName: string | null; startsOn: string; endsOn: string; revokedAt: Date | null; reason: string }>;
};

export async function listAssignments(db: DbOrTx, filter: { resourceId?: string; includeClosed?: boolean } = {}): Promise<AssignmentRow[]> {
  const today = localToday();
  const conds = [];
  if (filter.resourceId) conds.push(eq(exclusiveAssignment.resourceId, filter.resourceId));
  if (!filter.includeClosed) conds.push(isNull(exclusiveAssignment.cancelledAt), or(isNull(exclusiveAssignment.validTo), gte(exclusiveAssignment.validTo, today)));
  const rows = await db
    .select({ a: exclusiveAssignment, code: resource.code, holderName: employee.fullName, groupName: accessGroup.name, state: sql<string>`assignment_state(${exclusiveAssignment}, ${today}::date)` })
    .from(exclusiveAssignment)
    .innerJoin(resource, eq(resource.id, exclusiveAssignment.resourceId))
    .leftJoin(employee, eq(employee.id, exclusiveAssignment.holderEmployeeId))
    .leftJoin(accessGroup, eq(accessGroup.id, exclusiveAssignment.accessGroupId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(resource.code), desc(exclusiveAssignment.validFrom));
  const ids = rows.map((r) => r.a.id);
  const exceptions = ids.length
    ? await db
        .select({ x: accessException, beneficiaryName: employee.fullName })
        .from(accessException)
        .leftJoin(employee, eq(employee.id, accessException.beneficiaryEmployeeId))
        .where(inArray(accessException.assignmentId, ids))
        .orderBy(asc(accessException.startsOn))
    : [];
  return rows.map((r) => ({
    id: r.a.id,
    resourceId: r.a.resourceId,
    code: r.code,
    mode: r.a.mode,
    holderEmployeeId: r.a.holderEmployeeId,
    holderName: r.holderName,
    groupName: r.groupName,
    validFrom: r.a.validFrom,
    validTo: r.a.validTo,
    state: r.state as AssignmentRow["state"],
    needsReview: r.a.needsReview,
    reason: r.a.reason,
    responsible: r.a.responsible,
    endReason: r.a.endReason,
    transferredFromId: r.a.transferredFromId,
    exceptions: exceptions.filter((e) => e.x.assignmentId === r.a.id).map((e) => ({ id: e.x.id, kind: e.x.kind, beneficiaryName: e.beneficiaryName, startsOn: e.x.startsOn, endsOn: e.x.endsOn, revokedAt: e.x.revokedAt, reason: e.x.reason })),
  }));
}

/** Vínculos a revisar (DIR-018, DIR-032): consulta derivada, nunca lista alimentada por eventos. */
export async function needsReviewList(db: DbOrTx): Promise<Array<AssignmentRow & { why: string }>> {
  const rows = await listAssignments(db, {});
  const today = localToday();
  const out: Array<AssignmentRow & { why: string }> = [];
  for (const r of rows) {
    if (r.mode === "individual") {
      const [h] = await db.select({ status: employee.status }).from(employee).where(eq(employee.id, r.holderEmployeeId!));
      if (r.needsReview) out.push({ ...r, why: "marcada para revisão" });
      else if (!h || h.status !== "active") out.push({ ...r, why: `titular ${h?.status === "suspended" ? "suspenso" : "não ativo"}` });
    } else {
      const members = await db.select({ id: accessGroupMember.id }).from(accessGroupMember).where(and(sql`${accessGroupMember.groupId} = (select access_group_id from exclusive_assignment where id = ${r.id})`, lte(accessGroupMember.validFrom, today), or(isNull(accessGroupMember.validTo), gte(accessGroupMember.validTo, today))));
      if (members.length === 0 && r.state === "active") out.push({ ...r, why: "grupo sem integrante vigente" });
    }
  }
  return out;
}

/** Marcar ou desmarcar revisão de atribuição individual (durante a revisão ninguém é elegível). */
export async function setNeedsReview(db: Db, actor: Actor, input: { assignmentId: string; needsReview: boolean; reason: string }): Promise<void> {
  await assertPermission(db, actor, MANAGE);
  assertUuid(input.assignmentId, "Atribuição");
  if (!input.reason?.trim()) throw new ValidationError("Informe a nota.");
  await withOfficeTx(db, async (tx) => {
    const [a] = await tx.select().from(exclusiveAssignment).where(eq(exclusiveAssignment.id, input.assignmentId));
    if (!a) throw new ValidationError("Atribuição não encontrada.");
    if (a.mode !== "individual") throw new ValidationError("Só atribuição individual entra em revisão.");
    await lockResources(tx, [a.resourceId]);
    await tx.update(exclusiveAssignment).set({ needsReview: input.needsReview }).where(eq(exclusiveAssignment.id, a.id));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: input.needsReview ? "exclusivity.review_marked" : "exclusivity.review_cleared", entityType: "exclusive_assignment", entityId: a.id, reason: input.reason, requestId: actor.requestId });
  });
}

/**
 * Efeitos da desativação de uma pessoa no escritório (DIR-018, PAR-25), na mesma transação da desativação:
 * reservas futuras canceladas com comunicação; atribuições individuais marcadas para revisão; a mesa permanece restrita.
 */
export async function applyDeactivationEffects(tx: Tx, actor: Actor, employeeId: string, reason: string): Promise<{ bookingsCancelled: number; assignmentsFlagged: number }> {
  const today = localToday();
  const bookings = await listActiveBookings(tx, { employeeIds: [employeeId], from: today, to: null });
  await lockResources(tx, bookings.map((b) => b.resourceId));
  await applyConflictDecisions(
    tx,
    actor,
    bookings.map((b) => ({ ...b, why: "pessoa desativada" })),
    bookings.map((b) => ({ bookingId: b.bookingId, action: "cancel" as const, reason: `desativação: ${reason}` })),
    { excludeResourceIds: [], notice: "O acesso foi encerrado." },
  );
  const flagged = await tx
    .update(exclusiveAssignment)
    .set({ needsReview: true })
    .where(and(eq(exclusiveAssignment.holderEmployeeId, employeeId), eq(exclusiveAssignment.mode, "individual"), isNull(exclusiveAssignment.cancelledAt), or(isNull(exclusiveAssignment.validTo), gte(exclusiveAssignment.validTo, today))))
    .returning({ id: exclusiveAssignment.id });
  for (const f of flagged) {
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "exclusivity.review_marked", entityType: "exclusive_assignment", entityId: f.id, after: { needsReview: true, why: "titular desativado" }, reason, requestId: actor.requestId });
  }
  return { bookingsCancelled: bookings.length, assignmentsFlagged: flagged.length };
}

export async function history(db: DbOrTx, resourceId: string) {
  const assignments = await listAssignments(db, { resourceId, includeClosed: true });
  const ids = [resourceId, ...assignments.map((a) => a.id), ...assignments.flatMap((a) => a.exceptions.map((x) => x.id))];
  const own = await db
    .select({ id: auditEvent.id, action: auditEvent.action, entityType: auditEvent.entityType, entityId: auditEvent.entityId, reason: auditEvent.reason, createdAt: auditEvent.createdAt, actorEmployeeId: auditEvent.actorEmployeeId, after: auditEvent.after })
    .from(auditEvent)
    .where(and(inArray(auditEvent.entityId, ids), or(sql`${auditEvent.action} like 'exclusivity.%'`, sql`${auditEvent.action} like 'resource.%'`, sql`${auditEvent.action} like 'calendar.%'`)))
    .orderBy(desc(auditEvent.createdAt))
    .limit(100);
  // Decisões de conflito e reservas administrativas desta mesa: eventos cuja entidade é a reserva.
  const { deskBooking } = await import("@/db/schema");
  const bookingEvents = await db
    .select({ id: auditEvent.id, action: auditEvent.action, entityType: auditEvent.entityType, entityId: auditEvent.entityId, reason: auditEvent.reason, createdAt: auditEvent.createdAt, actorEmployeeId: auditEvent.actorEmployeeId, after: auditEvent.after })
    .from(auditEvent)
    .innerJoin(deskBooking, sql`${deskBooking.id}::text = ${auditEvent.entityId}`)
    .where(and(eq(deskBooking.resourceId, resourceId), sql`${auditEvent.action} in ('booking.cancelled_by_conflict', 'booking.reallocated', 'booking.cancelled_by_admin', 'booking.created_on_behalf')`))
    .orderBy(desc(auditEvent.createdAt))
    .limit(100);
  const events = [...own, ...bookingEvents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 100);
  const actorIds = [...new Set(events.map((e) => e.actorEmployeeId).filter((v): v is string => !!v))];
  const names = actorIds.length ? new Map((await db.select({ id: employee.id, name: employee.fullName }).from(employee).where(inArray(employee.id, actorIds))).map((r) => [r.id, r.name])) : new Map<string, string>();
  return { assignments, events: events.map((e) => ({ ...e, actorName: e.actorEmployeeId ? (names.get(e.actorEmployeeId) ?? null) : null })) };
}

export async function directors(db: DbOrTx) {
  return db.select({ id: employee.id, name: employee.fullName }).from(employee).where(and(eq(employee.status, "active"), eq(employee.orgCondition, "director"))).orderBy(asc(employee.fullName));
}

export function assertCanView(permissions: Set<string>) {
  if (!permissions.has("exclusive.view") && !permissions.has(MANAGE)) throw new ForbiddenError("Esta tela não está disponível para o seu perfil.");
}
