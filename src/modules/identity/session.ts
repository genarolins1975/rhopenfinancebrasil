import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employee } from "@/db/schema";
import { canEnterAdminArea, loadAccess, type Access } from "@/modules/access/can";
import type { Permission } from "@/modules/access/permissions";
import { auth } from "./auth";

export type Current = {
  user: { id: string; email: string; name: string; twoFactorEnabled: boolean };
  session: { id: string; createdAt: Date; expiresAt: Date };
  employee: typeof employee.$inferSelect;
  access: Access;
};

/** PAR-09: sessão de perfil privilegiado vale 12 horas. */
const PRIVILEGED_SESSION_MAX_MS = 12 * 60 * 60 * 1000;

export type CurrentResult = { current: Current; reason?: undefined } | { current: null; reason: "none" | "expired" };

/**
 * Identidade derivada da sessão, sempre conferida no banco. Nunca confia em ids vindos do cliente.
 * A regra das 12 horas para perfis privilegiados (PAR-09) vale aqui, portanto em toda página e toda action.
 */
export async function getCurrentResult(): Promise<CurrentResult> {
  const h = await headers();
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: h });
  } catch {
    return { current: null, reason: "none" };
  }
  if (!session) return { current: null, reason: "none" };
  const [emp] = await db.select().from(employee).where(eq(employee.userId, session.user.id));
  if (!emp || emp.status !== "active") return { current: null, reason: "none" };
  const access = await loadAccess(db, emp.id);
  if (access.hasPrivilegedGrant && Date.now() - session.session.createdAt.getTime() > PRIVILEGED_SESSION_MAX_MS) {
    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteSessions([session.session.token]);
    return { current: null, reason: "expired" };
  }
  const u = session.user as typeof session.user & { twoFactorEnabled?: boolean | null };
  return {
    current: {
      user: { id: u.id, email: u.email, name: u.name, twoFactorEnabled: u.twoFactorEnabled === true },
      session: { id: session.session.id, createdAt: session.session.createdAt, expiresAt: session.session.expiresAt },
      employee: emp,
      access,
    },
  };
}

export async function getCurrent(): Promise<Current | null> {
  return (await getCurrentResult()).current;
}

export async function requireCurrent(): Promise<Current> {
  const r = await getCurrentResult();
  if (!r.current) redirect(r.reason === "expired" ? "/entrar?motivo=sessao" : "/entrar");
  return r.current;
}

/** Ambiente administrativo: alguma permissão administrativa e segundo fator ativo para privilegiados. */
export async function requireAdminArea(): Promise<Current> {
  const current = await requireCurrent();
  if (current.access.mfaRequired) redirect("/perfil/seguranca?mfa=obrigatorio");
  if (!canEnterAdminArea(current.access)) redirect("/inicio?aviso=sem-permissao");
  return current;
}

export async function requirePermission(permission: Permission): Promise<Current> {
  return requireAnyPermission([permission]);
}

/** Exige ao menos uma das permissões. Sem nenhuma, a pessoa nem vê a tela. */
export async function requireAnyPermission(permissions: Permission[]): Promise<Current> {
  const current = await requireCurrent();
  if (current.access.mfaRequired) redirect("/perfil/seguranca?mfa=obrigatorio");
  if (!permissions.some((p) => current.access.permissions.has(p))) redirect("/inicio?aviso=sem-permissao");
  return current;
}

export function actorOf(current: Current, requestId: string = randomUUID()) {
  return { employeeId: current.employee.id, userId: current.user.id, requestId };
}
