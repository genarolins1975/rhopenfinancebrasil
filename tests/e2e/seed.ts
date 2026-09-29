import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { db } from "@/db/client";
import { authUser, employee } from "@/db/schema";
import { auth } from "@/modules/identity/auth";
import { acceptInvitation, createInvitation } from "@/modules/identity/invitations";
import { protectCpf, syntheticCpf } from "@/modules/employees/cpf";
import { employeePermission, employeeRole, employeeSensitive, employmentPeriod, employeeOrgAssignment } from "@/db/schema";
import { localToday } from "@/modules/shared/dates";

const PASSWORD = "correto cavalo bateria grampo";

async function reset() {
  const pool = new Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 1 });
  await pool.query(
    'truncate table "audit_event","outbox_event","login_attempt","import_batch","invitation","employee_permission","employee_role","employee_sensitive","employment_period","employee_org_assignment","employee","area","auth_two_factor","auth_rate_limit","auth_verification","auth_account","auth_session","auth_user" restart identity cascade',
  );
  await pool.end();
}

async function person(name: string, email: string, seed: number, roles: string[], permissions: string[]) {
  const [emp] = await db.insert(employee).values({ fullName: name, corporateEmail: email, status: "invited" }).returning({ id: employee.id });
  await db.insert(employeeSensitive).values({ employeeId: emp.id, ...protectCpf(syntheticCpf(seed), emp.id) });
  await db.insert(employmentPeriod).values({ employeeId: emp.id, hireDate: localToday() });
  await db.insert(employeeOrgAssignment).values({ employeeId: emp.id, validFrom: localToday() });
  for (const r of roles) await db.insert(employeeRole).values({ employeeId: emp.id, roleCode: r, validFrom: localToday(), reason: "e2e" });
  for (const p of permissions) await db.insert(employeePermission).values({ employeeId: emp.id, permissionCode: p as never, validFrom: localToday(), reason: "e2e" });
  const inv = await db.transaction((tx) => createInvitation(tx, { employeeId: null, userId: null }, emp.id));
  await acceptInvitation(db, inv.token, PASSWORD);
  const [row] = await db.select({ userId: employee.userId }).from(employee).where(eq(employee.id, emp.id));
  return { id: emp.id, email, userId: row.userId! };
}

async function main() {
  await reset();
  const comum = await person("Colaborador Exemplo", "colaborador@teste.invalid", 9001, ["employee"], []);
  const adm = await person("Administradora Exemplo", "admin@teste.invalid", 9002, ["admin", "hr"], ["role.assign.privileged", "audit.view", "cpf.reveal"]);
  // Segundo fator do admin ativado por API, guardando o URI para o teste gerar códigos.
  const signIn = await auth.api.signInEmail({ body: { email: adm.email, password: PASSWORD }, asResponse: true });
  const cookies = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const headers = new Headers({ cookie: cookies });
  const enabled = (await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers })) as { totpURI: string };
  const { totpFromUri } = await import("../integration/totp");
  await auth.api.verifyTOTP({ body: { code: totpFromUri(enabled.totpURI) }, headers });
  // A verificação emite sessão nova; as sessões do seed são descartadas pelo adaptador interno.
  const ctx = await auth.$context;
  await ctx.internalAdapter.deleteUserSessions(adm.userId);
  const [u] = await db.select({ tf: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.id, adm.userId));
  if (!u.tf) throw new Error("segundo fator não ativado no seed");
  const invitedNoInvite = await db.insert(employee).values({ fullName: "Pessoa Convidada", corporateEmail: "convidada@teste.invalid", status: "invited" }).returning({ id: employee.id });
  await db.insert(employeeSensitive).values({ employeeId: invitedNoInvite[0].id, ...protectCpf(syntheticCpf(9003), invitedNoInvite[0].id) });
  const inv = await db.transaction((tx) => createInvitation(tx, { employeeId: adm.id, userId: adm.userId }, invitedNoInvite[0].id));
  writeFileSync(".e2e-state.json", JSON.stringify({ password: PASSWORD, comum, adm, totpURI: enabled.totpURI, inviteToken: inv.token }));
  console.log("seed do ponta a ponta concluído");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
