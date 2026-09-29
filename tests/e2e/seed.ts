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
    'truncate table "checkin","waitlist_offer","waitlist_entry","employee_preference","desk_booking","space_booking","presence_intent","week_plan_request","access_exception","exclusive_assignment","access_group_member","resource_status_period","office_calendar","floor_plan_placement","resource","zone","floor_plan_version","audit_event","outbox_event","login_attempt","import_batch","invitation","employee_permission","employee_role","employee_sensitive","employment_period","employee_org_assignment","employee","area","auth_two_factor","auth_rate_limit","auth_verification","auth_account","auth_session","auth_user" restart identity cascade',
  );
  await pool.query(`insert into office_settings (key, value) values ('booking_open_weekday', '4'), ('booking_open_time', '"10:00"'), ('booking_horizon_weeks', '4'), ('exception_max_days', '30'), ('offer_minutes', '120'), ('business_hours_start', '"09:00"'), ('business_hours_end', '"18:00"'), ('checkin_release_enabled', 'false'), ('checkin_release_time', '"11:00"') on conflict (key) do update set value = excluded.value, updated_by = null`);
  await pool.end();
}

async function person(name: string, email: string, seed: number, roles: string[], permissions: string[], orgCondition: "standard" | "director" = "standard") {
  const [emp] = await db.insert(employee).values({ fullName: name, corporateEmail: email, status: "invited", orgCondition }).returning({ id: employee.id });
  await db.insert(employeeSensitive).values({ employeeId: emp.id, ...protectCpf(syntheticCpf(seed), emp.id) });
  await db.insert(employmentPeriod).values({ employeeId: emp.id, hireDate: localToday() });
  await db.insert(employeeOrgAssignment).values({ employeeId: emp.id, validFrom: localToday(), orgCondition });
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
  const gestor = await person("Gestor Exemplo", "gestor@teste.invalid", 9004, ["manager"], []);
  const adm = await person("Administradora Exemplo", "admin@teste.invalid", 9002, ["admin", "hr", "facilities"], ["role.assign.privileged", "audit.view", "cpf.reveal", "booking.on_behalf.create", "floorplan.publish"]);
  const diretora = await person("Diretora Exemplo", "diretora@teste.invalid", 9005, ["employee"], [], "director");
  const diretor2 = await person("Diretor Segundo", "diretor2@teste.invalid", 9006, ["employee"], [], "director");
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
  // Escritório: rascunho a partir da extração, aprovado e publicado; mesa M001 exclusiva da diretora; diretor2 no grupo.
  const { createDraftFromExtraction, approvePlan, publishPlan } = await import("@/modules/workplace/service");
  const { createAssignment, addGroupMember } = await import("@/modules/exclusivity/service");
  const { accessGroup } = await import("@/db/schema");
  const { readFileSync } = await import("node:fs");
  const admActor = { employeeId: adm.id, userId: adm.userId };
  const file = JSON.parse(readFileSync("docs/fontes/planta-r00-extracao.json", "utf8"));
  const draft = await createDraftFromExtraction(db, admActor, file, "Planta R00 (extração, não validada)");
  await approvePlan(db, admActor, draft.planId, "seed do ponta a ponta");
  await publishPlan(db, admActor, draft.planId);
  const { resource } = await import("@/db/schema");
  const [m001] = await db.select({ id: resource.id }).from(resource).where(eq(resource.code, "M001"));
  await createAssignment(db, admActor, { resourceId: m001.id, mode: "individual", holderEmployeeId: diretora.id, validFrom: localToday(), reason: "seed", responsible: "Diretoria executiva" });
  const [g] = await db.select({ id: accessGroup.id }).from(accessGroup).where(eq(accessGroup.code, "diretoria"));
  await addGroupMember(db, admActor, { groupId: g.id, employeeId: diretor2.id, validFrom: localToday(), reason: "seed" });
  // Meu time: o colaborador responde diretamente ao gestor (o compartilhamento é opt-in e feito pela tela de perfil).
  await db.update(employee).set({ managerEmployeeId: gestor.id }).where(eq(employee.id, comum.id));
  writeFileSync(".e2e-state.json", JSON.stringify({ password: PASSWORD, comum, gestor, adm, diretora, diretor2, totpURI: enabled.totpURI, inviteToken: inv.token }));
  console.log("seed do ponta a ponta concluído");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
