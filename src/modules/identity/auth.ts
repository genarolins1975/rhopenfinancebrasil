import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { twoFactor } from "better-auth/plugins/two-factor";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { authSchema, employee } from "@/db/schema";
import { loadAccess } from "@/modules/access/can";
import { enqueueOutbox } from "@/modules/notifications/outbox";
import { emailChangeConfirmation, emailVerification, maskEmail, passwordResetEmail } from "@/modules/notifications/templates";
import { env, isProduction } from "@/modules/shared/env";
import { logger } from "@/modules/shared/logger";
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from "./password";

/** Caminhos que não têm sessão para conferir ou que autenticam por token próprio. */
const PATHS_WITHOUT_STATUS_CHECK = new Set([
  "/sign-in/email",
  "/sign-out",
  "/ok",
  "/error",
  "/request-password-reset",
  "/reset-password",
  "/verify-email",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

/** Caminhos que nunca são servidos, mesmo que um plugin os registre. */
export const DISABLED_AUTH_PATHS = [
  "/sign-up/email",
  "/sign-in/social",
  "/update-user",
  "/delete-user",
  "/delete-user/callback",
  "/link-social",
  "/unlink-account",
  "/list-accounts",
  "/account-info",
  "/get-access-token",
  "/refresh-token",
  "/update-session",
  "/verify-password",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
];

const TWO_FACTOR_VERIFY_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

async function employeeStatusForUser(userId: string) {
  const [row] = await db.select({ id: employee.id, status: employee.status }).from(employee).where(eq(employee.userId, userId));
  return row ?? null;
}

const authIssuer = "Portal do Colaborador AOF";
const trustedIpHeader = env().TRUSTED_IP_HEADER;
const trustedIpHeaders: string[] = trustedIpHeader ? [trustedIpHeader] : [];

export const auth = betterAuth({
  appName: authIssuer,
  baseURL: env().APP_BASE_URL,
  secret: env().BETTER_AUTH_SECRET,
  trustedOrigins: [env().APP_BASE_URL],
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  user: {
    modelName: "auth_user",
    changeEmail: {
      enabled: true,
      // Confirmação vai ao endereço antigo; só depois o token vai ao novo endereço.
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        await enqueueOutbox(db, {
          eventType: "email.change_confirmation",
          aggregateType: "auth_user",
          aggregateId: user.id,
          payload: { message: emailChangeConfirmation(user.email, maskEmail(newEmail), url) },
          idempotencyKey: `email.change_confirmation:${user.id}:${Date.now()}`,
        });
      },
    },
  },
  session: {
    modelName: "auth_session",
    expiresIn: 7 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
    // Sem cache em cookie: revogação e desativação valem na requisição seguinte.
    cookieCache: { enabled: false },
  },
  account: { modelName: "auth_account" },
  verification: { modelName: "auth_verification" },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    requireEmailVerification: true,
    minPasswordLength: PASSWORD_MIN,
    maxPasswordLength: PASSWORD_MAX,
    autoSignIn: false,
    password: { hash: hashPassword, verify: verifyPassword },
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    // O link aponta para a página do portal; a rota GET do Better Auth não é servida pela rede.
    sendResetPassword: async ({ user, token }) => {
      const url = `${env().APP_BASE_URL}/redefinir-senha/${token}`;
      await enqueueOutbox(db, {
        eventType: "email.password_reset",
        aggregateType: "auth_user",
        aggregateId: user.id,
        payload: { message: passwordResetEmail(user.email, url) },
        idempotencyKey: `email.password_reset:${user.id}:${Date.now()}`,
      });
    },
  },
  emailVerification: {
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => {
      await enqueueOutbox(db, {
        eventType: "email.verification",
        aggregateType: "auth_user",
        aggregateId: user.id,
        payload: { message: emailVerification(user.email, url) },
        idempotencyKey: `email.verification:${user.id}:${Date.now()}`,
      });
    },
  },
  rateLimit: {
    enabled: env().APP_ENV !== "test",
    window: 60,
    max: 100,
    storage: "database",
    modelName: "auth_rate_limit",
    customRules: {
      "/sign-in/email": { window: 600, max: 20 },
      "/request-password-reset": { window: 600, max: 5 },
      "/two-factor/verify-totp": { window: 600, max: 10 },
      "/two-factor/verify-backup-code": { window: 600, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: isProduction(),
    ipAddress: {
      ipAddressHeaders: trustedIpHeaders,
    },
  },
  disabledPaths: DISABLED_AUTH_PATHS,
  databaseHooks: {
    session: {
      create: {
        // Só pessoa ativa recebe sessão nova.
        before: async (session) => {
          const emp = await employeeStatusForUser(session.userId);
          if (!emp || emp.status !== "active") {
            logger.warn({ userId: session.userId }, "sessão negada: pessoa inexistente ou inativa");
            return false;
          }
          return { data: session };
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Dispositivo confiável desativado para todos (PAR-38): o cookie de 30 dias pularia o segundo fator.
      if (TWO_FACTOR_VERIFY_PATHS.has(ctx.path)) {
        return { context: { ...ctx, body: { ...(ctx.body ?? {}), trustDevice: false } } };
      }
      if (PATHS_WITHOUT_STATUS_CHECK.has(ctx.path)) return;
      const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
      if (!session) return;
      const emp = await employeeStatusForUser(session.user.id);
      if (!emp || emp.status !== "active") {
        throw new APIError("UNAUTHORIZED", { message: "Conta indisponível." });
      }
      if (ctx.path === "/two-factor/disable") {
        const access = await loadAccess(db, emp.id);
        if (access.hasPrivilegedGrant) {
          throw new APIError("FORBIDDEN", { message: "Perfis administrativos não podem desativar o segundo fator." });
        }
      }
    }),
  },
  plugins: [
    twoFactor({ issuer: authIssuer, twoFactorTable: "auth_two_factor" }),
    ...(env().PASSWORD_BREACH_CHECK === "on" ? [haveIBeenPwned()] : []),
    nextCookies(),
  ],
});

export type Auth = typeof auth;

/** Contexto interno do Better Auth: adaptador interno e hash de senha, para fluxos próprios do portal. */
export async function authContext() {
  return auth.$context;
}
