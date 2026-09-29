import "server-only";
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

/** Identidade derivada da sessão, sempre conferida no banco. Nunca confia em ids vindos do cliente. */
export async function getCurrent(): Promise<Current | null> {
  const h = await headers();
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: h });
  } catch {
    return null;
  }
  if (!session) return null;
  const [emp] = await db.select().from(employee).where(eq(employee.userId, session.user.id));
  if (!emp || emp.status !== "active") return null;
  const access = await loadAccess(db, emp.id);
  const u = session.user as typeof session.user & { twoFactorEnabled?: boolean | null };
  return {
    user: { id: u.id, email: u.email, name: u.name, twoFactorEnabled: u.twoFactorEnabled === true },
    session: { id: session.session.id, createdAt: session.session.createdAt, expiresAt: session.session.expiresAt },
    employee: emp,
    access,
  };
}

export async function requireCurrent(): Promise<Current> {
  const current = await getCurrent();
  if (!current) redirect("/entrar");
  return current;
}

async function enforcePrivilegedSessionAge(current: Current) {
  if (!current.access.hasPrivilegedGrant) return;
  if (Date.now() - current.session.createdAt.getTime() > PRIVILEGED_SESSION_MAX_MS) {
    try {
      await auth.api.signOut({ headers: await headers() });
    } catch {
      /* sessão já inválida */
    }
    redirect("/entrar?motivo=sessao");
  }
}

/** Ambiente administrativo: alguma permissão administrativa, segundo fator ativo para privilegiados e sessão recente. */
export async function requireAdminArea(): Promise<Current> {
  const current = await requireCurrent();
  await enforcePrivilegedSessionAge(current);
  if (current.access.mfaRequired) redirect("/perfil/seguranca?mfa=obrigatorio");
  if (!canEnterAdminArea(current.access)) redirect("/inicio?aviso=sem-permissao");
  return current;
}

export async function requirePermission(permission: Permission): Promise<Current> {
  const current = await requireCurrent();
  await enforcePrivilegedSessionAge(current);
  if (current.access.mfaRequired) redirect("/perfil/seguranca?mfa=obrigatorio");
  if (!current.access.permissions.has(permission)) redirect("/inicio?aviso=sem-permissao");
  return current;
}

export function actorOf(current: Current, requestId?: string) {
  return { employeeId: current.employee.id, userId: current.user.id, requestId };
}
