import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { area, authTwoFactor, authUser, employee, employeeOrgAssignment, employeeSensitive, employmentPeriod, invitation } from "@/db/schema";
import { hasPrivilegedGrantAnyTime, loadAccess } from "@/modules/access/can";
import type { Permission } from "@/modules/access/permissions";
import { revokeAllGrants } from "@/modules/access/grants";
import { recordAudit } from "@/modules/audit/audit";
import { authContext } from "@/modules/identity/auth";
import { createInvitation, revokeActiveInvitations } from "@/modules/identity/invitations";
import { addDays, localToday } from "@/modules/shared/dates";
import { safeErrorInfo, withDbErrors } from "@/modules/shared/db-errors";
import { withOfficeTx } from "@/modules/office/shared";
import { ConflictError, ForbiddenError, ValidationError } from "@/modules/shared/errors";
import { logger } from "@/modules/shared/logger";
import { cpfHmac, formatCpf, normalizeCpf, protectCpf } from "./cpf";

export type Actor = { employeeId: string; userId: string; requestId?: string };

export type NewEmployeeInput = {
  fullName: string;
  corporateEmail: string;
  cpf: string;
  areaId?: string | null;
  jobTitle?: string | null;
  managerEmployeeId?: string | null;
  orgCondition: "standard" | "director";
  hireDate: string;
  sendInvitation?: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Referências vindas do formulário: formato e existência conferidos antes do banco. */
async function assertReferences(db: DbOrTx, refs: { areaId?: string | null; managerEmployeeId?: string | null }, selfId?: string) {
  if (refs.areaId) {
    if (!UUID_RE.test(refs.areaId)) throw new ValidationError("Área inválida.");
    const [a] = await db.select({ id: area.id }).from(area).where(eq(area.id, refs.areaId));
    if (!a) throw new ValidationError("Área inválida.");
  }
  if (refs.managerEmployeeId) {
    if (!UUID_RE.test(refs.managerEmployeeId)) throw new ValidationError("Gestor inválido.");
    if (selfId && refs.managerEmployeeId === selfId) throw new ValidationError("A pessoa não pode ser gestora de si mesma.");
    const [m] = await db.select({ id: employee.id, status: employee.status }).from(employee).where(eq(employee.id, refs.managerEmployeeId));
    if (!m || m.status === "deactivated") throw new ValidationError("Gestor inválido.");
  }
}

/** Suspender ou desativar quem tem concessão privilegiada vigente exige `role.assign.privileged`. */
/**
 * Pessoa com concessão privilegiada vigente só é tocada por quem pode gerir privilégios: situação,
 * email de convidada, convites (reenvio e revogação), reativação e readmissão. Fecha a tomada de conta
 * por troca de email de convidada privilegiada e a reativação de administrador suspenso por RH comum.
 */
async function assertMayChangeStatusOf(db: DbOrTx, actor: Actor, targetEmployeeId: string) {
  // Inclui concessão com início futuro: ela não vale hoje, mas define quem a pessoa será ao aceitar o convite.
  if (!(await hasPrivilegedGrantAnyTime(db, targetEmployeeId))) return;
  const mine = await loadAccess(db, actor.employeeId);
  if (!mine.permissions.has("role.assign.privileged")) {
    throw new ForbiddenError("Alterar pessoa com perfil privilegiado exige permissão para gerir perfis privilegiados.");
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

async function assertPermission(db: DbOrTx, actor: Actor, permission: Permission): Promise<void> {
  const access = await loadAccess(db, actor.employeeId);
  if (!access.permissions.has(permission)) throw new ForbiddenError();
}

export function validateNewEmployee(input: NewEmployeeInput): { cpf: string; email: string } {
  if (!input.fullName?.trim() || input.fullName.trim().length < 3) throw new ValidationError("Informe o nome completo.");
  const email = input.corporateEmail?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) throw new ValidationError("Informe um email corporativo válido.");
  const cpf = normalizeCpf(input.cpf ?? "");
  if (!cpf) throw new ValidationError("CPF inválido. Confira os 11 dígitos.");
  if (!ISO_DATE.test(input.hireDate ?? "")) throw new ValidationError("Informe a data de admissão.");
  return { cpf, email };
}

/** Cadastro individual. Duplicidade de CPF ou email responde de forma genérica, sem revelar de quem é. */
export async function createEmployee(db: Db, actor: Actor, input: NewEmployeeInput): Promise<{ employeeId: string; invitationUrl?: string }> {
  await assertPermission(db, actor, "employee.manage");
  const { cpf, email } = validateNewEmployee(input);
  await assertReferences(db, input);
  return withDbErrors(() => db.transaction(async (tx) => {
    const hmac = cpfHmac(cpf);
    const [dupCpf] = await tx.select({ id: employeeSensitive.employeeId }).from(employeeSensitive).where(eq(employeeSensitive.cpfHmac, hmac));
    const [dupEmail] = await tx.select({ id: employee.id }).from(employee).where(eq(employee.corporateEmail, email));
    if (dupCpf || dupEmail) throw new ConflictError("Já existe cadastro com estes dados. Procure a pessoa na lista antes de cadastrar de novo.");

    const [emp] = await tx
      .insert(employee)
      .values({
        fullName: input.fullName.trim(),
        corporateEmail: email,
        areaId: input.areaId || null,
        jobTitle: input.jobTitle?.trim() || null,
        managerEmployeeId: input.managerEmployeeId || null,
        orgCondition: input.orgCondition,
        status: "invited",
      })
      .returning({ id: employee.id });
    const protectedCpf = protectCpf(cpf, emp.id);
    await tx.insert(employeeSensitive).values({ employeeId: emp.id, ...protectedCpf });
    await tx.insert(employmentPeriod).values({ employeeId: emp.id, hireDate: input.hireDate });
    await tx.insert(employeeOrgAssignment).values({
      employeeId: emp.id,
      areaId: input.areaId || null,
      managerEmployeeId: input.managerEmployeeId || null,
      jobTitle: input.jobTitle?.trim() || null,
      orgCondition: input.orgCondition,
      validFrom: input.hireDate,
      createdBy: actor.employeeId,
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      action: "employee.created",
      entityType: "employee",
      entityId: emp.id,
      after: { fullName: input.fullName.trim(), corporateEmail: email, orgCondition: input.orgCondition, hireDate: input.hireDate },
      requestId: actor.requestId,
    });
    let invitationUrl: string | undefined;
    if (input.sendInvitation !== false) {
      const inv = await createInvitation(tx, actor, emp.id);
      invitationUrl = inv.url;
    }
    return { employeeId: emp.id, invitationUrl };
  }));
}

export async function resendInvitation(db: Db, actor: Actor, employeeId: string): Promise<void> {
  await assertPermission(db, actor, "employee.manage");
  await assertMayChangeStatusOf(db, actor, employeeId);
  await db.transaction(async (tx) => {
    await createInvitation(tx, actor, employeeId);
  });
}

export async function revokeInvitation(db: Db, actor: Actor, employeeId: string, reason: string): Promise<void> {
  await assertPermission(db, actor, "employee.manage");
  if (!reason?.trim()) throw new ValidationError("Informe o motivo.");
  await assertMayChangeStatusOf(db, actor, employeeId);
  await db.transaction(async (tx) => {
    const n = await revokeActiveInvitations(tx, employeeId);
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "invitation.revoked", entityType: "employee", entityId: employeeId, after: { revoked: n }, reason, requestId: actor.requestId });
  });
}

export type UpdateEmployeeInput = {
  fullName?: string;
  corporateEmail?: string;
  areaId?: string | null;
  jobTitle?: string | null;
  managerEmployeeId?: string | null;
  orgCondition?: "standard" | "director";
  reason?: string;
};

/**
 * Edição do cadastro. Perfis não mudam aqui. Email de pessoa ativa não muda aqui:
 * só pelo fluxo de troca com confirmação no endereço antigo. Email de pessoa convidada
 * muda e revoga os convites.
 */
export async function updateEmployee(db: Db, actor: Actor, employeeId: string, patch: UpdateEmployeeInput): Promise<void> {
  await assertPermission(db, actor, "employee.manage");
  await assertReferences(db, patch, employeeId);
  await withDbErrors(() => db.transaction(async (tx) => {
    const [current] = await tx.select().from(employee).where(eq(employee.id, employeeId)).for("update");
    if (!current) throw new ValidationError("Pessoa não encontrada.");
    if (current.status === "deactivated") throw new ValidationError("Pessoa desativada não é editada. Use readmissão.");
    const set: Partial<typeof employee.$inferInsert> = { updatedAt: new Date() };
    if (patch.fullName !== undefined) {
      if (patch.fullName.trim().length < 3) throw new ValidationError("Informe o nome completo.");
      set.fullName = patch.fullName.trim();
    }
    let invitationsRevoked = 0;
    if (patch.corporateEmail !== undefined) {
      const email = patch.corporateEmail.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw new ValidationError("Informe um email corporativo válido.");
      if (email !== current.corporateEmail) {
        if (current.status !== "invited" || current.userId) {
          throw new ValidationError("O email de pessoa com acesso definido só muda pelo fluxo de troca com confirmação, feito pela própria pessoa.");
        }
        // O email de convidada define quem aceita o convite: se ela já tem privilégio, só quem gere privilégios muda.
        await assertMayChangeStatusOf(tx, actor, employeeId);
        const [dup] = await tx.select({ id: employee.id }).from(employee).where(eq(employee.corporateEmail, email));
        if (dup) throw new ConflictError("Já existe cadastro com estes dados.");
        set.corporateEmail = email;
        invitationsRevoked = await revokeActiveInvitations(tx, employeeId);
      }
    }
    const orgChanged =
      (patch.areaId !== undefined && (patch.areaId || null) !== current.areaId) ||
      (patch.jobTitle !== undefined && (patch.jobTitle?.trim() || null) !== current.jobTitle) ||
      (patch.managerEmployeeId !== undefined && (patch.managerEmployeeId || null) !== current.managerEmployeeId) ||
      (patch.orgCondition !== undefined && patch.orgCondition !== current.orgCondition);
    if (orgChanged) {
      const selfOrgChange =
        actor.employeeId === employeeId &&
        ((patch.areaId !== undefined && (patch.areaId || null) !== current.areaId) ||
          (patch.managerEmployeeId !== undefined && (patch.managerEmployeeId || null) !== current.managerEmployeeId) ||
          (patch.orgCondition !== undefined && patch.orgCondition !== current.orgCondition));
      if (selfOrgChange) throw new ForbiddenError("Ninguém altera a própria área, gestor ou condição organizacional.");
      if (patch.managerEmployeeId && patch.managerEmployeeId === employeeId) throw new ValidationError("A pessoa não pode ser gestora de si mesma.");
      set.areaId = patch.areaId !== undefined ? patch.areaId || null : current.areaId;
      set.jobTitle = patch.jobTitle !== undefined ? patch.jobTitle?.trim() || null : current.jobTitle;
      set.managerEmployeeId = patch.managerEmployeeId !== undefined ? patch.managerEmployeeId || null : current.managerEmployeeId;
      set.orgCondition = patch.orgCondition ?? current.orgCondition;
      const today = localToday();
      await tx
        .update(employeeOrgAssignment)
        .set({ validTo: addDays(today, -1) })
        .where(and(eq(employeeOrgAssignment.employeeId, employeeId), isNull(employeeOrgAssignment.validTo), sql`${employeeOrgAssignment.validFrom} < ${today}`));
      await tx
        .delete(employeeOrgAssignment)
        .where(and(eq(employeeOrgAssignment.employeeId, employeeId), isNull(employeeOrgAssignment.validTo), eq(employeeOrgAssignment.validFrom, today)));
      await tx.insert(employeeOrgAssignment).values({
        employeeId,
        areaId: set.areaId ?? null,
        managerEmployeeId: set.managerEmployeeId ?? null,
        jobTitle: set.jobTitle ?? null,
        orgCondition: set.orgCondition ?? "standard",
        validFrom: today,
        createdBy: actor.employeeId,
        reason: patch.reason ?? null,
      });
    }
    await tx.update(employee).set(set).where(eq(employee.id, employeeId));
    // Troca de gestor zera a autorização do Meu time pelo trigger employee_manager_changed (DEC-37, migração 0015).
    await recordAudit(tx, {
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      action: "employee.updated",
      entityType: "employee",
      entityId: employeeId,
      before: { fullName: current.fullName, corporateEmail: current.corporateEmail, areaId: current.areaId, jobTitle: current.jobTitle, managerEmployeeId: current.managerEmployeeId, orgCondition: current.orgCondition },
      after: { ...set, invitationsRevoked },
      reason: patch.reason,
      requestId: actor.requestId,
    });
  }));
}

async function revokeIdentitySessions(userId: string | null) {
  if (!userId) return;
  const ctx = await authContext();
  await ctx.internalAdapter.deleteUserSessions(userId);
}

/** Suspensão: login bloqueado, sessões revogadas, concessões e cadastro inalterados. */
export async function suspendEmployee(db: Db, actor: Actor, employeeId: string, reason: string): Promise<void> {
  await assertPermission(db, actor, "employee.manage");
  if (actor.employeeId === employeeId) throw new ForbiddenError("Ninguém altera o próprio status.");
  if (!reason?.trim()) throw new ValidationError("Informe o motivo.");
  await assertMayChangeStatusOf(db, actor, employeeId);
  const userId = await withOfficeTx(db, async (tx) => {
    const [current] = await tx.select().from(employee).where(eq(employee.id, employeeId)).for("update");
    if (!current) throw new ValidationError("Pessoa não encontrada.");
    if (current.status !== "active") throw new ValidationError("Só pessoa ativa pode ser suspensa.");
    await tx.update(employee).set({ status: "suspended", updatedAt: new Date() }).where(eq(employee.id, employeeId));
    // Pessoa suspensa sai da fila; ofertas abertas são recusadas e a mesa volta pela varredura (sem lock de recurso aqui).
    const { closeQueueForPerson } = await import("@/modules/waitlist/service");
    await closeQueueForPerson(tx, actor, employeeId, `suspensão: ${reason}`);
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "employee.suspended", entityType: "employee", entityId: employeeId, before: { status: "active" }, after: { status: "suspended" }, reason, requestId: actor.requestId });
    return current.userId;
  });
  await revokeSessionsAfterCommit(db, employeeId, userId);
}

export async function reactivateEmployee(db: Db, actor: Actor, employeeId: string, reason: string): Promise<void> {
  await assertPermission(db, actor, "employee.manage");
  if (!reason?.trim()) throw new ValidationError("Informe o motivo.");
  await assertMayChangeStatusOf(db, actor, employeeId);
  await withOfficeTx(db, async (tx) => {
    const [current] = await tx.select().from(employee).where(eq(employee.id, employeeId)).for("update");
    if (!current) throw new ValidationError("Pessoa não encontrada.");
    if (current.status !== "suspended") throw new ValidationError("Só pessoa suspensa pode ser reativada.");
    await tx.update(employee).set({ status: "active", updatedAt: new Date() }).where(eq(employee.id, employeeId));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "employee.reactivated", entityType: "employee", entityId: employeeId, before: { status: "suspended" }, after: { status: "active" }, reason, requestId: actor.requestId });
  });
}

/**
 * Desativação: sessões revogadas, convites invalidados, concessões encerradas, período de vínculo fechado.
 * Reservas, atendimentos e mesas vinculadas entram na Etapa 2 com regras próprias (PAR-25).
 */
export async function deactivateEmployee(db: Db, actor: Actor, employeeId: string, input: { reason: string; exitDate?: string }): Promise<void> {
  await assertPermission(db, actor, "employee.manage");
  if (actor.employeeId === employeeId) throw new ForbiddenError("Ninguém desativa a si mesmo.");
  if (!input.reason?.trim()) throw new ValidationError("Informe o motivo.");
  const exitDate = input.exitDate ?? localToday();
  if (!ISO_DATE.test(exitDate)) throw new ValidationError("Data de saída inválida.");
  await assertMayChangeStatusOf(db, actor, employeeId);
  const userId = await withOfficeTx(db, async (tx) => {
    // Desativações são serializadas entre si antes de qualquer outro lock: cada uma trava a própria pessoa (for update) e
    // depois as candidatas da fila (for share), e duas pessoas na fila da mesma data formariam ciclo (segunda revisão).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('employee_deactivation'))`);
    // Ordem do protocolo: dias das reservas envolvidas, depois a pessoa (for update), depois terceiros e recursos.
    const { deactivationOfficePreview, applyDeactivationEffects } = await import("@/modules/exclusivity/service");
    const { lockDaysAndPeople } = await import("@/modules/office/shared");
    const eff = await deactivationOfficePreview(tx, employeeId);
    await lockDaysAndPeople(tx, { dates: [...[...eff.ownBookings, ...eff.thirdPartyBookings].map((b) => b.date), ...eff.queueDates], people: [] });
    const [current] = await tx.select().from(employee).where(eq(employee.id, employeeId)).for("update");
    if (!current) throw new ValidationError("Pessoa não encontrada.");
    if (current.status === "deactivated") throw new ValidationError("Pessoa já desativada.");
    const [open] = await tx.select({ hireDate: employmentPeriod.hireDate }).from(employmentPeriod).where(and(eq(employmentPeriod.employeeId, employeeId), isNull(employmentPeriod.exitDate)));
    if (open && exitDate < open.hireDate) throw new ValidationError("A data de saída não pode ser anterior à admissão.");
    await tx.update(employee).set({ status: "deactivated", deactivatedAt: new Date(), deactivatedBy: actor.employeeId, updatedAt: new Date() }).where(eq(employee.id, employeeId));
    // Escritório (DIR-018, PAR-25): reservas futuras canceladas com comunicação; vínculos exclusivos marcados para revisão.
    const office = await applyDeactivationEffects(tx, actor, employeeId, input.reason, exitDate);
    await revokeActiveInvitations(tx, employeeId);
    await revokeAllGrants(tx, employeeId, actor.employeeId);
    const { resetShareWithManager } = await import("@/modules/team/service");
    await resetShareWithManager(tx, employeeId);
    await tx
      .update(employmentPeriod)
      .set({ exitDate, reason: input.reason })
      .where(and(eq(employmentPeriod.employeeId, employeeId), isNull(employmentPeriod.exitDate)));
    await tx
      .update(employeeOrgAssignment)
      .set({ validTo: exitDate })
      .where(and(eq(employeeOrgAssignment.employeeId, employeeId), isNull(employeeOrgAssignment.validTo)));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "employee.deactivated", entityType: "employee", entityId: employeeId, before: { status: current.status }, after: { status: "deactivated", exitDate, ...office }, reason: input.reason, requestId: actor.requestId });
    return current.userId;
  });
  await revokeSessionsAfterCommit(db, employeeId, userId);
}

/** Revogação após o commit, com registro em outbox para nova tentativa se falhar. */
async function revokeSessionsAfterCommit(db: Db, employeeId: string, userId: string | null) {
  if (!userId) return;
  try {
    await revokeIdentitySessions(userId);
  } catch (e) {
    logger.error({ employeeId, err: safeErrorInfo(e) }, "falha ao revogar sessões; reagendado pela outbox");
    const { enqueueOutbox } = await import("@/modules/notifications/outbox");
    await enqueueOutbox(db, {
      eventType: "identity.revoke_sessions",
      aggregateType: "employee",
      aggregateId: employeeId,
      payload: { userId },
      idempotencyKey: `identity.revoke_sessions:${userId}:${Date.now()}`,
    });
  }
}

/** Readmissão: mesmo cadastro, novo período, novo convite, credenciais e segundo fator zerados (PAR-36). */
export async function readmitEmployee(db: Db, actor: Actor, employeeId: string, input: { hireDate: string; reason: string }): Promise<void> {
  await assertPermission(db, actor, "employee.manage");
  if (!input.reason?.trim()) throw new ValidationError("Informe o motivo.");
  if (!ISO_DATE.test(input.hireDate)) throw new ValidationError("Informe a data de admissão.");
  // Pessoa desativada não tem concessão vigente (a desativação revogou todas): a readmissão devolve a pessoa sem perfis.
  const ctx = await authContext();
  await withOfficeTx(db, async (tx) => {
    const [current] = await tx.select().from(employee).where(eq(employee.id, employeeId)).for("update");
    if (!current) throw new ValidationError("Pessoa não encontrada.");
    if (current.status !== "deactivated") throw new ValidationError("Só pessoa desativada pode ser readmitida.");
    if (current.userId) {
      await ctx.internalAdapter.deleteUserSessions(current.userId);
      await tx.delete(authTwoFactor).where(eq(authTwoFactor.userId, current.userId));
      await tx.update(authUser).set({ twoFactorEnabled: false }).where(eq(authUser.id, current.userId));
      // A identidade antiga é descartada: a pessoa define nova senha pelo convite.
      await tx.update(employee).set({ userId: null }).where(eq(employee.id, employeeId));
      await tx.delete(authUser).where(eq(authUser.id, current.userId));
    }
    await tx.update(employee).set({ status: "invited", deactivatedAt: null, deactivatedBy: null, updatedAt: new Date() }).where(eq(employee.id, employeeId));
    await tx.insert(employmentPeriod).values({ employeeId, hireDate: input.hireDate, reason: input.reason });
    await tx.insert(employeeOrgAssignment).values({
      employeeId,
      areaId: current.areaId,
      managerEmployeeId: current.managerEmployeeId,
      jobTitle: current.jobTitle,
      orgCondition: current.orgCondition,
      validFrom: input.hireDate,
      createdBy: actor.employeeId,
      reason: "readmissão",
    });
    const { resetShareWithManager } = await import("@/modules/team/service");
    await resetShareWithManager(tx, employeeId);
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "employee.readmitted", entityType: "employee", entityId: employeeId, after: { hireDate: input.hireDate }, reason: input.reason, requestId: actor.requestId });
    await createInvitation(tx, actor, employeeId);
  });
}

/** Revelação do CPF: permissão própria, motivo obrigatório, auditoria sempre. */
export async function revealCpf(db: Db, actor: Actor, employeeId: string, reason: string): Promise<string> {
  await assertPermission(db, actor, "cpf.reveal");
  if (!reason?.trim() || reason.trim().length < 5) throw new ValidationError("Informe o motivo da consulta.");
  const [row] = await db.select({ ciphertext: employeeSensitive.cpfCiphertext }).from(employeeSensitive).where(eq(employeeSensitive.employeeId, employeeId));
  if (!row) throw new ValidationError("Pessoa sem CPF cadastrado.");
  const { revealCpf: decrypt } = await import("./cpf");
  const cpf = decrypt(row.ciphertext, employeeId);
  await recordAudit(db, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "cpf.revealed", entityType: "employee", entityId: employeeId, reason, requestId: actor.requestId });
  return formatCpf(cpf);
}

export type EmployeeListItem = {
  id: string;
  fullName: string;
  corporateEmail: string;
  areaName: string | null;
  jobTitle: string | null;
  orgCondition: "standard" | "director";
  status: "invited" | "active" | "suspended" | "deactivated";
  hasActiveInvitation: boolean;
};

export async function listEmployees(db: DbOrTx, filters: { q?: string; status?: string; page?: number; pageSize?: number } = {}): Promise<{ items: EmployeeListItem[]; total: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const conds = [];
  if (filters.status && ["invited", "active", "suspended", "deactivated"].includes(filters.status)) conds.push(eq(employee.status, filters.status as never));
  if (filters.q?.trim()) {
    const like = `%${escapeLike(filters.q.trim())}%`;
    conds.push(or(ilike(employee.fullName, like), ilike(employee.corporateEmail, like)));
  }
  const where = conds.length ? and(...conds) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(employee).where(where);
  const rows = await db
    .select({
      id: employee.id,
      fullName: employee.fullName,
      corporateEmail: employee.corporateEmail,
      areaName: area.name,
      jobTitle: employee.jobTitle,
      orgCondition: employee.orgCondition,
      status: employee.status,
      hasActiveInvitation: sql<boolean>`exists (select 1 from ${invitation} i where i.employee_id = ${employee.id} and i.used_at is null and i.revoked_at is null and i.expires_at > now())`,
    })
    .from(employee)
    .leftJoin(area, eq(area.id, employee.areaId))
    .where(where)
    .orderBy(asc(employee.fullName))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items: rows, total };
}

export async function getEmployee(db: DbOrTx, employeeId: string) {
  // Id fora do formato nunca chega ao banco: vira "não encontrado" sem erro de driver no log.
  if (!UUID_RE.test(employeeId)) return null;
  const [row] = await db
    .select({
      id: employee.id,
      userId: employee.userId,
      fullName: employee.fullName,
      corporateEmail: employee.corporateEmail,
      areaId: employee.areaId,
      areaName: area.name,
      jobTitle: employee.jobTitle,
      managerEmployeeId: employee.managerEmployeeId,
      orgCondition: employee.orgCondition,
      status: employee.status,
      createdAt: employee.createdAt,
      cpfSuffix: employeeSensitive.cpfSuffix,
      twoFactorEnabled: authUser.twoFactorEnabled,
    })
    .from(employee)
    .leftJoin(area, eq(area.id, employee.areaId))
    .leftJoin(employeeSensitive, eq(employeeSensitive.employeeId, employee.id))
    .leftJoin(authUser, eq(authUser.id, employee.userId))
    .where(eq(employee.id, employeeId));
  if (!row) return null;
  const periods = await db.select().from(employmentPeriod).where(eq(employmentPeriod.employeeId, employeeId)).orderBy(desc(employmentPeriod.hireDate));
  const orgHistory = await db.select().from(employeeOrgAssignment).where(eq(employeeOrgAssignment.employeeId, employeeId)).orderBy(desc(employeeOrgAssignment.validFrom));
  const invitations = await db
    .select({ id: invitation.id, expiresAt: invitation.expiresAt, usedAt: invitation.usedAt, revokedAt: invitation.revokedAt, sentAt: invitation.sentAt, deliveryStatus: invitation.deliveryStatus, expired: sql<boolean>`${invitation.expiresAt} <= now()` })
    .from(invitation)
    .where(eq(invitation.employeeId, employeeId))
    .orderBy(desc(invitation.createdAt));
  return { ...row, periods, orgHistory, invitations };
}

export async function getEmployeeByUserId(db: DbOrTx, userId: string) {
  const [row] = await db.select().from(employee).where(eq(employee.userId, userId));
  return row ?? null;
}

export async function listAreas(db: DbOrTx) {
  return db.select().from(area).orderBy(asc(area.name));
}

export async function ensureArea(tx: DbOrTx, name: string): Promise<string> {
  const code = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const [existing] = await tx.select({ id: area.id }).from(area).where(eq(area.code, code));
  if (existing) return existing.id;
  const [row] = await tx.insert(area).values({ code, name: name.trim() }).returning({ id: area.id });
  return row.id;
}
