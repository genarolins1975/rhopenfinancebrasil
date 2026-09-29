import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accessGroup, authUser, employee, employeeOrgAssignment, employeePermission, employeeRole, employeeSensitive, employmentPeriod, resource } from "@/db/schema";
import { addDays, localToday } from "@/modules/shared/dates";

/*
 * Dados de demonstração (DEC-45). Só roda com APP_ENV=demo e banco sem nenhuma pessoa; nunca apaga nada.
 * Tudo é fictício: nomes "Demonstração", emails no domínio de demonstração, CPF sintético com o prefixo reservado 999.
 * As senhas das contas de demonstração vêm de variáveis de ambiente escolhidas por quem opera; este script não as
 * imprime nem as grava fora do hash do Better Auth. Nenhum convite, token ou senha vai para o log.
 */

type Persona = { key: string; name: string; roles: string[]; permissions: string[]; org?: "standard" | "director"; admin?: boolean };

const PERSONAS: Persona[] = [
  { key: "admin", name: "Administração Demonstração", roles: ["admin", "hr", "facilities"], permissions: ["role.assign.privileged", "audit.view", "cpf.reveal", "booking.on_behalf.create", "floorplan.publish", "exclusive.holder.view"], admin: true },
  { key: "colaboradora", name: "Colaboradora Demonstração", roles: ["employee"], permissions: [] },
  { key: "gestor", name: "Gestor Demonstração", roles: ["manager"], permissions: [] },
  { key: "diretora", name: "Diretora Demonstração", roles: ["employee"], permissions: [], org: "director" },
  { key: "diretor", name: "Diretor Demonstração", roles: ["employee"], permissions: [], org: "director" },
];

const FILLERS = 24;

export type DemoSeedResult = { skipped: true; reason: string } | { skipped: false; accounts: string[]; bookings: number };

export async function seedDemo(): Promise<DemoSeedResult> {
  if (process.env.APP_ENV !== "demo") return { skipped: true, reason: "APP_ENV não é demo" };
  // Carga concluída antes: nada a fazer. Pessoas sem a marca de conclusão: carga anterior interrompida, que não é
  // completada em silêncio; o banco de demonstração deve ser recriado (roteiro em docs/operacao/demo-vercel.md).
  const [{ done }] = (await db.execute(sql`select exists (select 1 from audit_event where action = 'demo.seed_completed') as done`)).rows as Array<{ done: boolean }>;
  if (done) return { skipped: true, reason: "dados de demonstração já criados; nada foi alterado" };
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from employee`)).rows as Array<{ n: number }>;
  if (n > 0) throw new Error("o banco tem pessoas mas não tem a marca de conclusão da carga de demonstração: carga anterior interrompida ou banco que não é de demonstração; recrie o banco de demonstração");
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD ?? "";
  const password = process.env.DEMO_PASSWORD ?? "";
  if (adminPassword === password) throw new Error("DEMO_ADMIN_PASSWORD e DEMO_PASSWORD precisam ser diferentes");
  const domain = (process.env.DEMO_EMAIL_DOMAIN ?? "demo.rhopenfinancebrasil.com").toLowerCase();
  // Todas as senhas passam pela política do produto antes de qualquer gravação (sem carga pela metade).
  const { checkPasswordPolicy } = await import("@/modules/identity/password");
  for (const p of PERSONAS) {
    const check = checkPasswordPolicy(p.admin ? adminPassword : password, { email: `${p.key}@${domain}`, name: p.name });
    if (!check.ok) throw new Error(`${p.admin ? "DEMO_ADMIN_PASSWORD" : "DEMO_PASSWORD"} recusada pela política de senha para a conta ${p.key}: ${check.reason}`);
  }

  const { protectCpf, syntheticCpf } = await import("@/modules/employees/cpf");
  const { acceptInvitation, createInvitation } = await import("@/modules/identity/invitations");
  const today = localToday();

  async function person(name: string, email: string, seed: number, roles: string[], permissions: string[], org: "standard" | "director", status: "invited" | "active") {
    const [emp] = await db.insert(employee).values({ fullName: name, corporateEmail: email, status, orgCondition: org }).returning({ id: employee.id });
    await db.insert(employeeSensitive).values({ employeeId: emp.id, ...protectCpf(syntheticCpf(seed), emp.id) });
    await db.insert(employmentPeriod).values({ employeeId: emp.id, hireDate: today });
    await db.insert(employeeOrgAssignment).values({ employeeId: emp.id, validFrom: today, orgCondition: org });
    for (const r of roles) await db.insert(employeeRole).values({ employeeId: emp.id, roleCode: r, validFrom: today, reason: "demonstração" });
    for (const p of permissions) await db.insert(employeePermission).values({ employeeId: emp.id, permissionCode: p as never, validFrom: today, reason: "demonstração" });
    return emp.id;
  }

  // Contas de demonstração: primeiro acesso pelo mesmo fluxo de convite do produto, aceito aqui com a senha escolhida.
  const ids: Record<string, string> = {};
  const accounts: string[] = [];
  let seed = 800_001;
  for (const p of PERSONAS) {
    const email = `${p.key}@${domain}`;
    const id = await person(p.name, email, seed++, p.roles, p.permissions, p.org ?? "standard", "invited");
    const inv = await db.transaction((tx) => createInvitation(tx, { employeeId: null, userId: null }, id));
    await acceptInvitation(db, inv.token, p.admin ? adminPassword : password);
    ids[p.key] = id;
    accounts.push(email);
  }
  await db.update(employee).set({ managerEmployeeId: ids.gestor }).where(eq(employee.id, ids.colaboradora));

  // Pessoas fictícias sem login, só para ocupar o escritório.
  const fillers: string[] = [];
  for (let i = 1; i <= FILLERS; i++) {
    fillers.push(await person(`Pessoa Fictícia ${String(i).padStart(2, "0")}`, `pessoa${String(i).padStart(2, "0")}@${domain}`, seed++, ["employee"], [], "standard", "active"));
  }
  await db.update(employee).set({ managerEmployeeId: ids.gestor }).where(sql`${employee.id} in (${sql.join(fillers.slice(0, 4).map((f) => sql`${f}::uuid`), sql`, `)})`);

  // Escritório: planta da extração (não validada), publicada; M001 exclusiva da diretora; diretor no grupo da diretoria.
  // Permissão privilegiada só vale com segundo fator: durante a semeadura, o indicador fica ligado sem segredo TOTP algum
  // e volta a desligado ao final. No primeiro acesso, a administração cadastra o próprio segundo fator para operar.
  const [adminRow] = await db.select({ userId: employee.userId }).from(employee).where(eq(employee.id, ids.admin));
  const admin = { employeeId: ids.admin, userId: adminRow.userId!, requestId: randomUUID() };
  await db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, admin.userId));
  try {
    const { createDraftFromExtraction, approvePlan, publishPlan } = await import("@/modules/workplace/service");
    const { createAssignment, addGroupMember } = await import("@/modules/exclusivity/service");
    const file = JSON.parse(readFileSync("docs/fontes/planta-r00-extracao.json", "utf8"));
    const draft = await createDraftFromExtraction(db, admin, file, "Planta R00 (extração, não validada)");
    await approvePlan(db, admin, draft.planId, "demonstração");
    await publishPlan(db, admin, draft.planId);
    const [m001] = await db.select({ id: resource.id }).from(resource).where(eq(resource.code, "M001"));
    if (m001) await createAssignment(db, admin, { resourceId: m001.id, mode: "individual", holderEmployeeId: ids.diretora, validFrom: today, reason: "demonstração", responsible: "Diretoria executiva" });
    const [g] = await db.select({ id: accessGroup.id }).from(accessGroup).where(eq(accessGroup.code, "diretoria"));
    if (g) await addGroupMember(db, admin, { groupId: g.id, employeeId: ids.diretor, validFrom: today, reason: "demonstração" });
  } finally {
    await db.update(authUser).set({ twoFactorEnabled: false }).where(eq(authUser.id, admin.userId));
  }

  // Ocupação: cada pessoa fictícia reserva uma mesa compartilhada livre hoje e amanhã, pelo mesmo serviço do produto.
  // Data fora da janela de reservas ou mesa já tomada é pulada: a demonstração não força regra alguma.
  const { bookDesk } = await import("@/modules/booking/service");
  const { stateForPerson } = await import("@/modules/availability/service");
  let bookings = 0;
  for (const date of [today, addDays(today, 1)]) {
    for (const f of fillers) {
      const { items } = await stateForPerson(db, f, date, { types: ["desk"] });
      const free = items.find((i) => i.availability.canBook && i.deskClass === "shared");
      if (!free) continue;
      try {
        await bookDesk(db, { employeeId: f, userId: `demo-${f}`, requestId: randomUUID() }, { employeeId: f, resourceId: free.resource.id, date, idempotencyKey: randomUUID() });
        bookings += 1;
      } catch {
        // janela fechada, dia fechado ou mesa tomada: segue
      }
    }
  }
  const { recordAudit } = await import("@/modules/audit/audit");
  await recordAudit(db, { action: "demo.seed_completed", entityType: "environment", entityId: "demo", after: { accounts: accounts.length, fillers: fillers.length, bookings } });
  return { skipped: false, accounts, bookings };
}

// Execução direta: `APP_ENV=demo pnpm demo:seed` (com as variáveis de banco e as senhas de demonstração no ambiente).
if (process.argv[1]?.endsWith("demo-seed.ts")) {
  (async () => {
    const r = await seedDemo();
    console.log(r.skipped ? `dados de demonstração não criados: ${r.reason}` : `dados de demonstração criados: ${r.accounts.length} contas (${r.accounts.join(", ")}), ${r.bookings} reservas`);
    process.exit(0);
  })().catch((e) => {
    console.error("falha nos dados de demonstração:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
