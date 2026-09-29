/**
 * Tabelas gerenciadas pelo Better Auth 1.7.6, transcritas do gerador oficial em 28/09/2026
 * com nomes prefixados (auth_*) e instantes em timestamptz. Os nomes de modelo são
 * declarados na configuração do Better Auth (modelName) e precisam bater com as chaves
 * do objeto `authSchema`.
 */
import { bigint, boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const ts = () => timestamp({ withTimezone: true, mode: "date" });

export const authUser = pgTable("auth_user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().default(false).notNull(),
  image: text(),
  createdAt: ts().defaultNow().notNull(),
  updatedAt: ts()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  twoFactorEnabled: boolean().default(false),
});

export const authSession = pgTable(
  "auth_session",
  {
    id: text().primaryKey(),
    expiresAt: ts().notNull(),
    token: text().notNull().unique(),
    createdAt: ts().defaultNow().notNull(),
    updatedAt: ts()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: ts(),
    refreshTokenExpiresAt: ts(),
    scope: text(),
    password: text(),
    createdAt: ts().defaultNow().notNull(),
    updatedAt: ts()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("auth_account_user_idx").on(t.userId)],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: ts().notNull(),
    createdAt: ts().defaultNow().notNull(),
    updatedAt: ts()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

export const authTwoFactor = pgTable(
  "auth_two_factor",
  {
    id: text().primaryKey(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: text()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    verified: boolean().default(true),
    failedVerificationCount: integer().default(0),
    lockedUntil: ts(),
  },
  (t) => [index("auth_two_factor_secret_idx").on(t.secret), index("auth_two_factor_user_idx").on(t.userId)],
);

export const authRateLimit = pgTable("auth_rate_limit", {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: "number" }).notNull(),
});

/** Objeto entregue ao adaptador Drizzle do Better Auth: chaves iguais aos modelName. */
export const authSchema = {
  auth_user: authUser,
  auth_session: authSession,
  auth_account: authAccount,
  auth_verification: authVerification,
  auth_two_factor: authTwoFactor,
  auth_rate_limit: authRateLimit,
};
