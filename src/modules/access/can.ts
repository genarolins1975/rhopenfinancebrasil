import { and, eq, isNull, lte, or, sql, inArray, gte } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { authUser, employee, employeePermission, employeeRole, rolePermission } from "@/db/schema";
import { localToday } from "@/modules/shared/dates";
import { mfaWaived } from "@/modules/shared/env";
import { ADMIN_AREA_PERMISSIONS, PRIVILEGED_ROLES, isSensitivePermission, type Permission, type Role } from "./permissions";

export type Access = {
  employeeId: string;
  status: "invited" | "active" | "suspended" | "deactivated";
  twoFactorEnabled: boolean;
  /** Perfis concedidos e vigentes, independentemente de segundo fator. */
  grantedRoles: Role[];
  /** Perfis que produzem efeito agora (PAR-33: privilegiado exige conta ativa com segundo fator). */
  effectiveRoles: Role[];
  permissions: Set<Permission>;
  hasPrivilegedGrant: boolean;
  mfaRequired: boolean;
};

/**
 * Carrega perfis, concessões diretas e permissões efetivas de uma pessoa, sempre do banco.
 * Negação por padrão: pessoa fora de `active` não tem permissão alguma.
 */
export async function loadAccess(db: DbOrTx, employeeId: string, today = localToday()): Promise<Access> {
  const [emp] = await db
    .select({ id: employee.id, status: employee.status, twoFactorEnabled: authUser.twoFactorEnabled })
    .from(employee)
    .leftJoin(authUser, eq(authUser.id, employee.userId))
    .where(eq(employee.id, employeeId));
  const empty = (status: Access["status"], twoFactorEnabled: boolean): Access => ({
    employeeId,
    status,
    twoFactorEnabled,
    grantedRoles: [],
    effectiveRoles: [],
    permissions: new Set(),
    hasPrivilegedGrant: false,
    mfaRequired: false,
  });
  if (!emp) return empty("deactivated", false);
  const twoFactorEnabled = emp.twoFactorEnabled === true;

  const vigente = <T extends { validFrom: unknown; validTo: unknown; revokedAt: unknown }>(t: T) =>
    and(isNull(t.revokedAt as never), lte(t.validFrom as never, today), or(isNull(t.validTo as never), gte(t.validTo as never, today)));

  const roleRows = await db
    .select({ code: employeeRole.roleCode })
    .from(employeeRole)
    .where(and(eq(employeeRole.employeeId, employeeId), vigente(employeeRole)));
  const grantedRoles = roleRows.map((r) => r.code as Role);
  const directRows = await db
    .select({ code: employeePermission.permissionCode })
    .from(employeePermission)
    .where(and(eq(employeePermission.employeeId, employeeId), vigente(employeePermission)));
  const hasSensitiveDirect = directRows.some((d) => isSensitivePermission(d.code as Permission));
  // Segundo fator obrigatório para perfil privilegiado ou permissão sensível direta (PAR-33).
  const hasPrivilegedGrant = grantedRoles.some((r) => PRIVILEGED_ROLES.includes(r)) || hasSensitiveDirect;
  // Demonstração com o segundo fator dispensado (DEC-46): o privilégio vale sem ele e nada exige o cadastro.
  const privilegedAllowed = twoFactorEnabled || mfaWaived();
  const mfaRequired = hasPrivilegedGrant && !privilegedAllowed;

  if (emp.status !== "active") {
    return { ...empty(emp.status, twoFactorEnabled), grantedRoles, hasPrivilegedGrant, mfaRequired };
  }

  // Toda pessoa ativa é colaboradora: o perfil básico é implícito e não depende de concessão nem de segundo fator.
  const effectiveRoles = Array.from(new Set<Role>(["employee", ...grantedRoles.filter((r) => privilegedAllowed || !PRIVILEGED_ROLES.includes(r))]));

  const permissions = new Set<Permission>();
  if (effectiveRoles.length > 0) {
    const rp = await db
      .select({ code: rolePermission.permissionCode })
      .from(rolePermission)
      .where(inArray(rolePermission.roleCode, effectiveRoles));
    for (const r of rp) permissions.add(r.code as Permission);
  }
  for (const d of directRows) {
    const p = d.code as Permission;
    if (isSensitivePermission(p) && !privilegedAllowed) continue;
    permissions.add(p);
  }

  return {
    employeeId,
    status: emp.status,
    twoFactorEnabled,
    grantedRoles,
    effectiveRoles,
    permissions,
    hasPrivilegedGrant,
    mfaRequired,
  };
}

/**
 * Pessoa tem concessão privilegiada não revogada e não expirada, inclusive com início futuro.
 * Serve às proteções de alvo (quem pode tocar a pessoa), não à autorização (o que a pessoa pode fazer hoje).
 */
export async function hasPrivilegedGrantAnyTime(db: DbOrTx, employeeId: string, today = localToday()): Promise<boolean> {
  const alive = <T extends { validTo: unknown; revokedAt: unknown }>(t: T) => and(isNull(t.revokedAt as never), or(isNull(t.validTo as never), gte(t.validTo as never, today)));
  const roles = await db.select({ code: employeeRole.roleCode }).from(employeeRole).where(and(eq(employeeRole.employeeId, employeeId), alive(employeeRole)));
  if (roles.some((r) => PRIVILEGED_ROLES.includes(r.code as Role))) return true;
  const perms = await db.select({ code: employeePermission.permissionCode }).from(employeePermission).where(and(eq(employeePermission.employeeId, employeeId), alive(employeePermission)));
  return perms.some((p) => isSensitivePermission(p.code as Permission));
}

export async function can(db: DbOrTx, employeeId: string, permission: Permission): Promise<boolean> {
  const access = await loadAccess(db, employeeId);
  return access.permissions.has(permission);
}

export function canEnterAdminArea(access: Access): boolean {
  return ADMIN_AREA_PERMISSIONS.some((p) => access.permissions.has(p));
}

/** Utilitário para consultas de vigência em SQL cru. */
export const vigenteSql = (table: string, today: string) =>
  sql.raw(`${table}.revoked_at is null and ${table}.valid_from <= '${today}' and (${table}.valid_to is null or ${table}.valid_to >= '${today}')`);
