import "dotenv/config";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { authAccount, authSession, authTwoFactor, authUser, authVerification, employee, loginAttempt } from "@/db/schema";
import { safeErrorText } from "@/modules/shared/db-errors";

/*
 * Redefinição da senha da administração da demonstração (DEC-46). Só com APP_ENV=demo e DEMO_ADMIN_RESET_PASSWORD
 * preenchida. Troca o hash da senha, apaga o segundo fator cadastrado, encerra as sessões, zera as falhas de login e os
 * links de recuperação pendentes e registra auditoria, tudo numa transação. Se a senha atual já for a informada, nada é
 * alterado: a variável esquecida no ambiente não derruba sessões a cada deploy. Senha e hash nunca vão para o log.
 */

export type DemoAdminResetResult = { changed: false; reason: string } | { changed: true; email: string };

export async function resetDemoAdmin(): Promise<DemoAdminResetResult> {
  if (process.env.APP_ENV !== "demo") return { changed: false, reason: "APP_ENV não é demo" };
  const password = process.env.DEMO_ADMIN_RESET_PASSWORD ?? "";
  if (!password) return { changed: false, reason: "DEMO_ADMIN_RESET_PASSWORD ausente" };
  if (password === process.env.DEMO_PASSWORD) throw new Error("DEMO_ADMIN_RESET_PASSWORD precisa ser diferente de DEMO_PASSWORD");
  const domain = (process.env.DEMO_EMAIL_DOMAIN ?? "demo.rhopenfinancebrasil.com").toLowerCase();
  const email = `admin@${domain}`;

  const [admin] = await db
    .select({ employeeId: employee.id, userId: employee.userId, name: employee.fullName, status: employee.status })
    .from(employee)
    .where(eq(employee.corporateEmail, email));
  if (!admin?.userId) throw new Error(`conta ${email} não encontrada ou sem acesso: confira DEMO_EMAIL_DOMAIN ou recrie o banco de demonstração`);
  if (admin.status !== "active") throw new Error(`conta ${email} não está ativa`);

  const { checkPasswordPolicy, hashPassword, isPasswordBreached, verifyPassword } = await import("@/modules/identity/password");
  const check = checkPasswordPolicy(password, { email, name: admin.name });
  if (!check.ok) throw new Error(`DEMO_ADMIN_RESET_PASSWORD recusada pela política de senha: ${check.reason}`);

  const [account] = await db
    .select({ id: authAccount.id, hash: authAccount.password })
    .from(authAccount)
    .where(and(eq(authAccount.userId, admin.userId), eq(authAccount.providerId, "credential")));
  if (!account) throw new Error(`conta ${email} sem senha cadastrada: recrie o banco de demonstração`);
  if (account.hash && (await verifyPassword({ hash: account.hash, password }))) {
    return { changed: false, reason: "a senha da administração já é a de DEMO_ADMIN_RESET_PASSWORD; nada foi alterado" };
  }
  if (await isPasswordBreached(password)) throw new Error("DEMO_ADMIN_RESET_PASSWORD aparece em vazamentos conhecidos de senhas; escolha outra");

  const hash = await hashPassword(password);
  const userId = admin.userId;
  const { emailKey } = await import("@/modules/identity/throttle");
  const { recordAudit } = await import("@/modules/audit/audit");
  await db.transaction(async (tx) => {
    await tx.update(authAccount).set({ password: hash, updatedAt: new Date() }).where(eq(authAccount.id, account.id));
    const removed = await tx.delete(authTwoFactor).where(eq(authTwoFactor.userId, userId)).returning({ id: authTwoFactor.id });
    await tx.update(authUser).set({ twoFactorEnabled: false }).where(eq(authUser.id, userId));
    await tx.delete(authSession).where(eq(authSession.userId, userId));
    await tx.delete(authVerification).where(and(like(authVerification.identifier, "reset-password:%"), eq(authVerification.value, userId)));
    await tx.delete(loginAttempt).where(eq(loginAttempt.emailHash, emailKey(email)));
    await recordAudit(tx, {
      action: "demo.admin_password_reset",
      entityType: "employee",
      entityId: admin.employeeId,
      after: { secondFactorRemoved: removed.length > 0, sessionsRevoked: true },
      reason: "redefinição pelo build da demonstração (DEC-46)",
    });
  });
  return { changed: true, email };
}

// Execução direta: `APP_ENV=demo pnpm exec tsx scripts/demo-admin-reset.ts` (com as variáveis de banco e a senha no ambiente).
if (process.argv[1]?.endsWith("demo-admin-reset.ts")) {
  (async () => {
    const r = await resetDemoAdmin();
    console.log(r.changed ? `senha da administração redefinida (${r.email}); segundo fator e sessões zerados` : `senha da administração não alterada: ${r.reason}`);
    process.exit(0);
  })().catch((e) => {
    console.error("falha na redefinição da senha da administração:", safeErrorText(e));
    process.exit(1);
  });
}
