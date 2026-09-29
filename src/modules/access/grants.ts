import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { employee, employeePermission, employeeRole } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { localToday } from "@/modules/shared/dates";
import { ForbiddenError, ValidationError } from "@/modules/shared/errors";
import { loadAccess } from "./can";
import { PRIVILEGED_ROLES, ROLES, PERMISSIONS, type Permission, type Role } from "./permissions";

export type Actor = { employeeId: string; userId: string; requestId?: string };

type GrantRoleInput = { targetEmployeeId: string; role: Role; validFrom?: string; validTo?: string | null; reason: string };
type GrantPermissionInput = { targetEmployeeId: string; permission: Permission; validFrom?: string; validTo?: string | null; reason: string };

/** Ninguém altera os próprios perfis ou permissões. */
function assertNotSelf(actor: Actor, targetEmployeeId: string) {
  if (actor.employeeId === targetEmployeeId) throw new ForbiddenError("Ninguém altera os próprios perfis ou permissões.");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateValidity(validFrom: string | undefined, validTo: string | null | undefined): { validFrom: string; validTo: string | null } {
  const from = validFrom ?? localToday();
  if (!ISO_DATE.test(from)) throw new ValidationError("Data de início inválida.");
  if (validTo != null && validTo !== "") {
    if (!ISO_DATE.test(validTo)) throw new ValidationError("Data de término inválida.");
    if (validTo < from) throw new ValidationError("O término não pode ser anterior ao início.");
    return { validFrom: from, validTo };
  }
  return { validFrom: from, validTo: null };
}

async function assertCanAssign(db: Db, actor: Actor, privileged: boolean) {
  const access = await loadAccess(db, actor.employeeId);
  if (privileged) {
    if (!access.permissions.has("role.assign.privileged")) throw new ForbiddenError("Conceder perfis privilegiados exige permissão específica.");
  } else if (!access.permissions.has("role.assign.standard") && !access.permissions.has("role.assign.privileged")) {
    throw new ForbiddenError("Conceder perfis exige permissão específica.");
  }
}

async function assertTargetExists(db: Db, targetEmployeeId: string) {
  const [t] = await db.select({ id: employee.id, status: employee.status }).from(employee).where(eq(employee.id, targetEmployeeId));
  if (!t) throw new ValidationError("Pessoa não encontrada.");
  if (t.status === "deactivated") throw new ValidationError("Pessoa desativada não recebe concessões.");
}

export async function grantRole(db: Db, actor: Actor, input: GrantRoleInput): Promise<string> {
  if (!(input.role in ROLES)) throw new ValidationError("Perfil inexistente.");
  assertNotSelf(actor, input.targetEmployeeId);
  const privileged = PRIVILEGED_ROLES.includes(input.role);
  await assertCanAssign(db, actor, privileged);
  await assertTargetExists(db, input.targetEmployeeId);
  if (!input.reason?.trim()) throw new ValidationError("Informe o motivo da concessão.");
  const validity = validateValidity(input.validFrom, input.validTo);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(employeeRole)
      .values({
        employeeId: input.targetEmployeeId,
        roleCode: input.role,
        validFrom: validity.validFrom,
        validTo: validity.validTo,
        grantedBy: actor.employeeId,
        reason: input.reason,
      })
      .returning({ id: employeeRole.id });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      action: "access.role.granted",
      entityType: "employee",
      entityId: input.targetEmployeeId,
      after: { role: input.role, ...validity },
      reason: input.reason,
      requestId: actor.requestId,
    });
    return row.id;
  });
}

export async function revokeRole(db: Db, actor: Actor, input: { targetEmployeeId: string; role: Role; reason: string }): Promise<void> {
  assertNotSelf(actor, input.targetEmployeeId);
  await assertCanAssign(db, actor, PRIVILEGED_ROLES.includes(input.role));
  if (!input.reason?.trim()) throw new ValidationError("Informe o motivo da revogação.");
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(employeeRole)
      .set({ revokedAt: new Date(), revokedBy: actor.employeeId })
      .where(and(eq(employeeRole.employeeId, input.targetEmployeeId), eq(employeeRole.roleCode, input.role), isNull(employeeRole.revokedAt)))
      .returning({ id: employeeRole.id });
    if (updated.length === 0) throw new ValidationError("Não há concessão ativa desse perfil.");
    await recordAudit(tx, {
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      action: "access.role.revoked",
      entityType: "employee",
      entityId: input.targetEmployeeId,
      before: { role: input.role },
      reason: input.reason,
      requestId: actor.requestId,
    });
  });
}

/** Permissão direta, sensível ou não, sempre exige `role.assign.privileged` (PAR-40). */
export async function grantPermission(db: Db, actor: Actor, input: GrantPermissionInput): Promise<string> {
  if (!(input.permission in PERMISSIONS)) throw new ValidationError("Permissão inexistente.");
  assertNotSelf(actor, input.targetEmployeeId);
  await assertCanAssign(db, actor, true);
  await assertTargetExists(db, input.targetEmployeeId);
  if (!input.reason?.trim()) throw new ValidationError("Informe o motivo da concessão.");
  const validity = validateValidity(input.validFrom, input.validTo);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(employeePermission)
      .values({
        employeeId: input.targetEmployeeId,
        permissionCode: input.permission,
        validFrom: validity.validFrom,
        validTo: validity.validTo,
        grantedBy: actor.employeeId,
        reason: input.reason,
      })
      .returning({ id: employeePermission.id });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      action: "access.permission.granted",
      entityType: "employee",
      entityId: input.targetEmployeeId,
      after: { permission: input.permission, ...validity },
      reason: input.reason,
      requestId: actor.requestId,
    });
    return row.id;
  });
}

export async function revokePermission(db: Db, actor: Actor, input: { targetEmployeeId: string; permission: Permission; reason: string }): Promise<void> {
  assertNotSelf(actor, input.targetEmployeeId);
  await assertCanAssign(db, actor, true);
  if (!input.reason?.trim()) throw new ValidationError("Informe o motivo da revogação.");
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(employeePermission)
      .set({ revokedAt: new Date(), revokedBy: actor.employeeId })
      .where(and(eq(employeePermission.employeeId, input.targetEmployeeId), eq(employeePermission.permissionCode, input.permission), isNull(employeePermission.revokedAt)))
      .returning({ id: employeePermission.id });
    if (updated.length === 0) throw new ValidationError("Não há concessão ativa dessa permissão.");
    await recordAudit(tx, {
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      action: "access.permission.revoked",
      entityType: "employee",
      entityId: input.targetEmployeeId,
      before: { permission: input.permission },
      reason: input.reason,
      requestId: actor.requestId,
    });
  });
}

/** Encerra todas as concessões de uma pessoa (desativação). Usado dentro da transação chamadora. */
export async function revokeAllGrants(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], targetEmployeeId: string, actorEmployeeId: string | null) {
  await tx
    .update(employeeRole)
    .set({ revokedAt: new Date(), revokedBy: actorEmployeeId })
    .where(and(eq(employeeRole.employeeId, targetEmployeeId), isNull(employeeRole.revokedAt)));
  await tx
    .update(employeePermission)
    .set({ revokedAt: new Date(), revokedBy: actorEmployeeId })
    .where(and(eq(employeePermission.employeeId, targetEmployeeId), isNull(employeePermission.revokedAt)));
}
