import "dotenv/config";
import { parseArgs } from "node:util";
import { eq, inArray, isNull, and, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employee, employeePermission, employeeRole, employeeSensitive, employmentPeriod, employeeOrgAssignment } from "@/db/schema";
import { PRIVILEGED_ROLES } from "@/modules/access/permissions";
import { recordAudit } from "@/modules/audit/audit";
import { createInvitation } from "@/modules/identity/invitations";
import { cpfHmac, normalizeCpf, protectCpf } from "@/modules/employees/cpf";
import { localToday } from "@/modules/shared/dates";

/**
 * Procedimento controlado para o primeiro administrador. Sem conta padrão, sem senha fixa:
 * a pessoa define a senha pelo convite e ativa o segundo fator antes de qualquer permissão privilegiada valer.
 * Só roda quando nenhuma pessoa tem perfil privilegiado vigente.
 */
async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" }, cpf: { type: "string" }, force: { type: "boolean", default: false } },
  });
  if (!values.email || !values.name || !values.cpf) {
    console.error("uso: pnpm bootstrap:admin --email <email corporativo> --name <nome completo> --cpf <11 dígitos>");
    process.exit(2);
  }
  const cpf = normalizeCpf(values.cpf);
  if (!cpf) {
    console.error("CPF inválido");
    process.exit(2);
  }
  const appEnv = process.env.APP_ENV ?? "development";
  if (values.force && appEnv !== "development" && appEnv !== "test") {
    console.error("--force só é permitido em desenvolvimento e teste; use o procedimento de acesso emergencial documentado");
    process.exit(1);
  }
  const email = values.email.trim().toLowerCase();
  const url = await db.transaction(async (tx) => {
    // Lock de aplicação: duas execuções simultâneas não criam dois administradores.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bootstrap-admin'))`);
    const existing = await tx
      .select({ id: employeeRole.id })
      .from(employeeRole)
      .where(and(inArray(employeeRole.roleCode, PRIVILEGED_ROLES), isNull(employeeRole.revokedAt)));
    if (existing.length > 0 && !values.force) {
      throw new Error("já existe pessoa com perfil privilegiado; bootstrap recusado");
    }
    const [dupEmail] = await tx.select({ id: employee.id }).from(employee).where(eq(employee.corporateEmail, email));
    const [dupCpf] = await tx.select({ id: employeeSensitive.employeeId }).from(employeeSensitive).where(eq(employeeSensitive.cpfHmac, cpfHmac(cpf)));
    if (dupEmail || dupCpf) throw new Error("já existe cadastro com estes dados");
    const today = localToday();
    const [emp] = await tx.insert(employee).values({ fullName: values.name!.trim(), corporateEmail: email, status: "invited" }).returning({ id: employee.id });
    await tx.insert(employeeSensitive).values({ employeeId: emp.id, ...protectCpf(cpf, emp.id) });
    await tx.insert(employmentPeriod).values({ employeeId: emp.id, hireDate: today });
    await tx.insert(employeeOrgAssignment).values({ employeeId: emp.id, validFrom: today, reason: "bootstrap" });
    // Concessões com granted_by nulo: único caso permitido, registrado como bootstrap.
    await tx.insert(employeeRole).values([
      { employeeId: emp.id, roleCode: "admin", validFrom: today, grantedBy: null, reason: "bootstrap" },
      { employeeId: emp.id, roleCode: "hr", validFrom: today, grantedBy: null, reason: "bootstrap" },
    ]);
    await tx.insert(employeePermission).values([
      { employeeId: emp.id, permissionCode: "role.assign.privileged", validFrom: today, grantedBy: null, reason: "bootstrap" },
      { employeeId: emp.id, permissionCode: "audit.view", validFrom: today, grantedBy: null, reason: "bootstrap" },
    ]);
    await recordAudit(tx, { actorUserId: null, actorEmployeeId: null, action: "access.bootstrap", entityType: "employee", entityId: emp.id, after: { roles: ["admin", "hr"], permissions: ["role.assign.privileged", "audit.view"] }, reason: "bootstrap" });
    const inv = await createInvitation(tx, { employeeId: null, userId: null }, emp.id);
    return inv.url;
  });
  console.log("primeiro administrador cadastrado. O convite foi enfileirado para envio.");
  // O link só aparece em desenvolvimento e teste; em homologação e produção ele chega apenas pelo email.
  if (appEnv === "development" || appEnv === "test") console.log(`link do convite (ambiente ${appEnv}): ${url}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("falha:", e instanceof Error ? e.message : e);
  process.exit(1);
});
