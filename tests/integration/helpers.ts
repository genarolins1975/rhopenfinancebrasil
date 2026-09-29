import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { db } from "@/db/client";
import { employee, employeePermission, employeeRole, employeeSensitive, employmentPeriod, employeeOrgAssignment } from "@/db/schema";
import { protectCpf, syntheticCpf } from "@/modules/employees/cpf";
import type { Permission, Role } from "@/modules/access/permissions";
import { localToday } from "@/modules/shared/dates";

const TABLES = [
  "audit_event",
  "outbox_event",
  "login_attempt",
  "import_batch",
  "invitation",
  "employee_permission",
  "employee_role",
  "employee_sensitive",
  "employment_period",
  "employee_org_assignment",
  "employee",
  "area",
  "auth_two_factor",
  "auth_rate_limit",
  "auth_verification",
  "auth_account",
  "auth_session",
  "auth_user",
];

let ownerPool: Pool | undefined;

/** Limpeza usa o papel dono: o papel da aplicação não pode apagar auditoria, e isso é desejado. */
export async function resetDb() {
  ownerPool ??= new Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 1 });
  await ownerPool.query(`truncate table ${TABLES.map((t) => `"${t}"`).join(", ")} restart identity cascade`);
}

let seq = 1;

/** Cria pessoa direto no banco (sem convite) para servir de ator ou alvo em testes. */
export async function seedEmployee(opts: {
  name?: string;
  email?: string;
  status?: "invited" | "active" | "suspended" | "deactivated";
  roles?: Role[];
  permissions?: Permission[];
  userId?: string | null;
  orgCondition?: "standard" | "director";
} = {}) {
  const n = seq++;
  const email = opts.email ?? `pessoa${n}@teste.invalid`;
  const [emp] = await db
    .insert(employee)
    .values({ fullName: opts.name ?? `Pessoa Teste ${n}`, corporateEmail: email, status: opts.status ?? "active", userId: opts.userId ?? null, orgCondition: opts.orgCondition ?? "standard" })
    .returning({ id: employee.id });
  const cpf = syntheticCpf(n);
  await db.insert(employeeSensitive).values({ employeeId: emp.id, ...protectCpf(cpf, emp.id) });
  await db.insert(employmentPeriod).values({ employeeId: emp.id, hireDate: localToday() });
  await db.insert(employeeOrgAssignment).values({ employeeId: emp.id, validFrom: localToday(), orgCondition: opts.orgCondition ?? "standard" });
  for (const r of opts.roles ?? []) await db.insert(employeeRole).values({ employeeId: emp.id, roleCode: r, validFrom: localToday(), grantedBy: null, reason: "teste" });
  for (const p of opts.permissions ?? []) await db.insert(employeePermission).values({ employeeId: emp.id, permissionCode: p, validFrom: localToday(), grantedBy: null, reason: "teste" });
  return { id: emp.id, email, cpf, name: opts.name ?? `Pessoa Teste ${n}` };
}

export function cookieHeader(setCookies: string[]): Headers {
  const h = new Headers();
  h.set("cookie", setCookies.map((c) => c.split(";")[0]).join("; "));
  return h;
}

export function setCookiesFrom(res: Response): string[] {
  const list = res.headers.getSetCookie?.() ?? [];
  return list;
}

/** Pessoa ativa com senha definida pelo convite; devolve cookies de sessão prontos para uso. */
export async function activeUserWithPassword(opts: { roles?: Role[]; permissions?: Permission[]; password?: string; twoFactor?: boolean; orgCondition?: "standard" | "director" } = {}) {
  const { createInvitation, acceptInvitation } = await import("@/modules/identity/invitations");
  const { auth } = await import("@/modules/identity/auth");
  const password = opts.password ?? "correto cavalo bateria grampo";
  const person = await seedEmployee({ status: "invited", roles: opts.roles, permissions: opts.permissions, orgCondition: opts.orgCondition });
  const inv = await db.transaction((tx) => createInvitation(tx, { employeeId: null, userId: null }, person.id));
  await acceptInvitation(db, inv.token, password);
  const [row] = await db.select({ userId: employee.userId }).from(employee).where(eq(employee.id, person.id));
  const signIn = async () => {
    const res = await auth.api.signInEmail({ body: { email: person.email, password }, asResponse: true });
    return { res, cookies: setCookiesFrom(res), headers: cookieHeader(setCookiesFrom(res)) };
  };
  return { ...person, userId: row.userId!, password, signIn };
}
