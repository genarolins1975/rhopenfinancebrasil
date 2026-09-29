import { and, eq, isNull, gte, lte, or } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { employee, employeePermission, employeeRole } from "@/db/schema";
import { localToday } from "@/modules/shared/dates";

/** Concessões vigentes ou com início futuro de uma pessoa, para exibição e revogação. Nada agendado fica invisível. */
export async function listGrants(db: DbOrTx, employeeId: string) {
  const today = localToday();
  const roles = await db
    .select()
    .from(employeeRole)
    .where(and(eq(employeeRole.employeeId, employeeId), isNull(employeeRole.revokedAt), or(isNull(employeeRole.validTo), gte(employeeRole.validTo, today))));
  const permissions = await db
    .select()
    .from(employeePermission)
    .where(and(eq(employeePermission.employeeId, employeeId), isNull(employeePermission.revokedAt), or(isNull(employeePermission.validTo), gte(employeePermission.validTo, today))));
  return { roles: roles.map((r) => ({ ...r, future: r.validFrom > today })), permissions: permissions.map((p) => ({ ...p, future: p.validFrom > today })), today };
}

/** Pessoas com qualquer concessão vigente, para a tela de acessos. */
export async function listPeopleWithGrants(db: DbOrTx) {
  const today = localToday();
  const roleRows = await db
    .select({ employeeId: employeeRole.employeeId, code: employeeRole.roleCode, name: employee.fullName, email: employee.corporateEmail, status: employee.status })
    .from(employeeRole)
    .innerJoin(employee, eq(employee.id, employeeRole.employeeId))
    .where(and(isNull(employeeRole.revokedAt), lte(employeeRole.validFrom, today), or(isNull(employeeRole.validTo), gte(employeeRole.validTo, today))));
  const permRows = await db
    .select({ employeeId: employeePermission.employeeId, code: employeePermission.permissionCode, name: employee.fullName, email: employee.corporateEmail, status: employee.status })
    .from(employeePermission)
    .innerJoin(employee, eq(employee.id, employeePermission.employeeId))
    .where(and(isNull(employeePermission.revokedAt), lte(employeePermission.validFrom, today), or(isNull(employeePermission.validTo), gte(employeePermission.validTo, today))));
  const map = new Map<string, { employeeId: string; name: string; email: string; status: string; roles: string[]; permissions: string[] }>();
  for (const r of roleRows) {
    const e = map.get(r.employeeId) ?? { employeeId: r.employeeId, name: r.name, email: r.email, status: r.status, roles: [], permissions: [] };
    e.roles.push(r.code);
    map.set(r.employeeId, e);
  }
  for (const p of permRows) {
    const e = map.get(p.employeeId) ?? { employeeId: p.employeeId, name: p.name, email: p.email, status: p.status, roles: [], permissions: [] };
    e.permissions.push(p.code);
    map.set(p.employeeId, e);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
