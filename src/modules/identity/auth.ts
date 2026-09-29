import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { twoFactor } from "better-auth/plugins/two-factor";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { authSchema, authVerification, authUser, employee } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { loadAccess } from "@/modules/access/can";
import { enqueueOutbox } from "@/modules/notifications/outbox";
import { emailChangeConfirmation, emailVerification, maskEmail, passwordResetEmail } from "@/modules/notifications/templates";
import { env } from "@/modules/shared/env";
import { logger, scrub } from "@/modules/shared/logger";
import { safeErrorInfo } from "@/modules/shared/db-errors";
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

async function employeeStatusForEmail(email: string) {
  const [row] = await db.select({ id: employee.id, status: employee.status }).from(employee).where(eq(employee.corporateEmail, email.trim().toLowerCase()));
  return row ?? null;
}

/** Dono de um token de recuperação, pela tabela de verificação do Better Auth (identificador `reset-password:<token>`). */
async function userIdForResetToken(token: string): Promise<string | null> {
  const [row] = await db.select({ value: authVerification.value }).from(authVerification).where(eq(authVerification.identifier, `reset-password:${token}`));
  return row?.value ?? null;
}

/** Tipo de pedido embutido no token de verificação de email, sem confiar nele para nada além de rotear. */
/** Carga do token de verificação de email (JWT do Better Auth), lida sem validar: a validação é do próprio handler. */
function verificationPayload(token: string | undefined): { requestType?: string; updateTo?: string; email?: string } {
  if (!token) return {};
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { requestType?: string; updateTo?: string; email?: string };
  } catch {
    return {};
  }
}

const UNAUTHORIZED = () => new APIError("UNAUTHORIZED", { message: "Conta indisponível." });

const authIssuer = "Portal do Colaborador AOF";
const trustedIpHeader = env().TRUSTED_IP_HEADER;
const trustedIpHeaders: string[] = trustedIpHeader ? [trustedIpHeader] : [];

export const auth = betterAuth({
  appName: authIssuer,
  // O logger do Better Auth imprimiria erros de driver com a consulta e os parâmetros; tudo passa pelo pino com redação.
  logger: {
    level: "warn",
    log: (level, message, ...args) => {
      const fn = level === "error" ? logger.error : level === "warn" ? logger.warn : level === "debug" ? logger.debug : logger.info;
      fn.call(logger, { origin: "better-auth", args: scrub(args.map((a) => (a instanceof Error ? safeErrorInfo(a) : a))) }, scrub(message) as string);
    },
  },
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
    // Pessoa suspensa ou desativada não recebe o email; a resposta ao pedido continua neutra.
    sendResetPassword: async ({ user, token }) => {
      const emp = await employeeStatusForUser(user.id);
      if (!emp || emp.status !== "active") {
        logger.info({ userId: user.id }, "recuperação ignorada: pessoa inativa");
        return;
      }
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
    // Seguro sempre que o domínio canônico for https, inclusive em homologação.
    useSecureCookies: env().APP_BASE_URL.startsWith("https://"),
    ipAddress: {
      ipAddressHeaders: trustedIpHeaders,
    },
  },
  disabledPaths: DISABLED_AUTH_PATHS,
  databaseHooks: {
    session: {
      create: {
        // Só pessoa ativa recebe sessão nova; o link de verificação de email nunca emite sessão.
        before: async (session, ctx) => {
          if (ctx?.path === "/verify-email") {
            logger.warn({ userId: session.userId }, "sessão negada: verificação de email não emite sessão");
            return false;
          }
          const emp = await employeeStatusForUser(session.userId);
          if (!emp || emp.status !== "active") {
            logger.warn({ userId: session.userId }, "sessão negada: pessoa inexistente ou inativa");
            return false;
          }
          return { data: session };
        },
      },
    },
    user: {
      update: {
        // Email de autenticação e email do cadastro andam juntos; a troca só chega aqui após confirmação nos dois endereços.
        after: async (user) => {
          const [emp] = await db.select({ id: employee.id, email: employee.corporateEmail }).from(employee).where(eq(employee.userId, user.id));
          if (!emp || emp.email.toLowerCase() === user.email.toLowerCase()) return;
          const next = user.email.toLowerCase();
          try {
            await db.transaction(async (tx) => {
              await tx.update(employee).set({ corporateEmail: next, updatedAt: new Date() }).where(eq(employee.id, emp.id));
              await recordAudit(tx, { actorUserId: user.id, actorEmployeeId: emp.id, action: "employee.email_changed", entityType: "employee", entityId: emp.id, before: { corporateEmail: emp.email }, after: { corporateEmail: next }, reason: "troca confirmada pela própria pessoa" });
            });
          } catch (e) {
            // Cadastro e identidade nunca divergem: se o cadastro não aceita o email novo, a identidade volta ao anterior.
            await db.update(authUser).set({ email: emp.email }).where(eq(authUser.id, user.id));
            logger.warn({ userId: user.id, err: safeErrorInfo(e) }, "troca de email desfeita: cadastro recusou o novo endereço");
            throw new APIError("CONFLICT", { message: "Este email não está mais disponível. Peça a troca de novo com outro endereço." });
          }
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
      // Login e redefinição de senha de pessoa inativa falham antes de qualquer verificação de segredo.
      if (ctx.path === "/sign-in/email") {
        const body = ctx.body as { email?: string; password?: string } | undefined;
        if (body?.email) {
          const emp = await employeeStatusForEmail(body.email);
          if (emp && emp.status !== "active") {
            // Mesmo custo de tempo do caminho de senha errada, para não revelar a situação da conta.
            await ctx.context.password.hash(body.password ?? "");
            throw UNAUTHORIZED();
          }
        }
        return;
      }
      if (ctx.path === "/reset-password") {
        const token = (ctx.body as { token?: string } | undefined)?.token;
        const userId = token ? await userIdForResetToken(token) : null;
        if (userId) {
          const emp = await employeeStatusForUser(userId);
          if (!emp || emp.status !== "active") throw UNAUTHORIZED();
        }
        return;
      }
      if (ctx.path === "/verify-email") {
        // Confirmar a troca de email exige sessão ativa; sem ela, a pessoa entra primeiro e reabre o link.
        const payload = verificationPayload((ctx.query as { token?: string } | undefined)?.token);
        if (payload.requestType === "change-email-verification") {
          const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
          if (!session) throw ctx.redirect(`${env().APP_BASE_URL}/entrar?aviso=confirmar-email`);
          const emp = await employeeStatusForUser(session.user.id);
          if (!emp || emp.status !== "active") throw UNAUTHORIZED();
          // O endereço pode ter sido cadastrado para outra pessoa entre os dois links: recusa antes de tocar a identidade.
          const taken = payload.updateTo ? await employeeStatusForEmail(payload.updateTo) : null;
          if (taken && taken.id !== emp.id) throw ctx.redirect(`${env().APP_BASE_URL}/perfil?aviso=email-indisponivel`);
        }
        return;
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
