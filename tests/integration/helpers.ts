import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { db } from "@/db/client";
import { employee, employeePermission, employeeRole, employeeSensitive, employmentPeriod, employeeOrgAssignment } from "@/db/schema";
import { protectCpf, syntheticCpf } from "@/modules/employees/cpf";
import type { Permission, Role } from "@/modules/access/permissions";
import { localToday } from "@/modules/shared/dates";

const TABLES = [
  "checkin",
  "waitlist_offer",
  "waitlist_entry",
  "employee_preference",
  "desk_booking",
  "space_booking",
  "presence_intent",
  "week_plan_request",
  "access_exception",
  "exclusive_assignment",
  "access_group_member",
  "resource_status_period",
  "office_calendar",
  "floor_plan_placement",
  "resource",
  "zone",
  "floor_plan_version",
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
  // O truncate em cascata de employee apaga office_settings (FK updated_by). No banco de teste a semana seguinte abre na
  // segunda às 00:00 (datas de d+1 a d+13 sempre abertas, independentemente do dia da semana em que a bateria roda);
  // os testes da regra padrão (quinta às 10h) fixam os próprios parâmetros.
  await ownerPool.query(`insert into office_settings (key, value) values ('booking_open_weekday', '1'), ('booking_open_time', '"00:00"'), ('booking_horizon_weeks', '4'), ('exception_max_days', '30'), ('offer_minutes', '120'), ('business_hours_start', '"09:00"'), ('business_hours_end', '"18:00"'), ('checkin_release_enabled', 'false'), ('checkin_release_time', '"11:00"') on conflict (key) do update set value = excluded.value, updated_by = null`);
}

/** Pessoa com perfil privilegiado efetivo: usuário de autenticação e segundo fator ativo (PAR-33). */
export async function privilegedActor(opts: { roles?: Role[]; permissions?: Permission[]; orgCondition?: "standard" | "director" } = {}) {
  const { authUser } = await import("@/db/schema");
  const u = await activeUserWithPassword(opts);
  await db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, u.userId));
  return { ...u, actor: { employeeId: u.id, userId: u.userId, requestId: crypto.randomUUID() } };
}

let deskSeq = 1;

/** Mesa de teste. */
export async function seedDesk(code?: string, type: "desk" | "room" | "booth" = "desk") {
  const { resource } = await import("@/db/schema");
  const n = deskSeq++;
  const [row] = await db
    .insert(resource)
    .values({ code: code ?? `T${String(n).padStart(3, "0")}`, type, capacity: type === "desk" ? null : 6 })
    .returning({ id: resource.id, code: resource.code });
  return row;
}

/** Grupo da diretoria semeado pela migração. */
export async function directorsGroupId(): Promise<string> {
  const { accessGroup } = await import("@/db/schema");
  const [g] = await db.select({ id: accessGroup.id }).from(accessGroup).where(eq(accessGroup.code, "diretoria"));
  return g.id;
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

/** Consulta com o papel dono, para simular passagem de tempo em testes (nunca usada pela aplicação). */
export async function ownerQuery(text: string, params: unknown[] = []) {
  ownerPool ??= new Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 1 });
  return ownerPool.query(text, params);
}
