import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { authUser, employee } from "@/db/schema";
import { loadAccess } from "@/modules/access/can";
import { auth } from "@/modules/identity/auth";
import { resetDemoAdmin } from "../../scripts/demo-admin-reset";
import { seedDemo } from "../../scripts/demo-seed";
import { activeUserWithPassword, cookieHeader, resetDb, setCookiesFrom } from "./helpers";
import { totpFromUri } from "./totp";

/* DEC-46: segundo fator dispensado na demonstração e redefinição da senha da administração pelo build. */

const KEYS = ["APP_ENV", "DEMO_MFA_OPTIONAL", "DEMO_ADMIN_PASSWORD", "DEMO_PASSWORD", "DEMO_ADMIN_RESET_PASSWORD", "DEMO_EMAIL_DOMAIN"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const restore = () => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
};
const count = async (q: string) => ((await db.execute(sql.raw(q))).rows[0] as { n: number }).n;
const ADMIN = "admin@demo.rhopenfinancebrasil.com";
const OLD = "ensaio gestao portal escritorio 2026";
const NEW = "outra frase longa para a gerencia do portal 2026";

async function signIn(email: string, password: string) {
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const body = res.status === 200 ? ((await res.json()) as { twoFactorRedirect?: boolean }) : null;
  return { status: res.status, body, cookies: setCookiesFrom(res) };
}

describe("segundo fator dispensado na demonstração", () => {
  beforeEach(resetDb);
  afterEach(restore);

  it("perfil privilegiado vale sem segundo fator só com APP_ENV=demo e DEMO_MFA_OPTIONAL=on", async () => {
    const u = await activeUserWithPassword({ roles: ["hr"], permissions: ["cpf.reveal"] });
    process.env.APP_ENV = "demo";
    process.env.DEMO_MFA_OPTIONAL = "on";
    const waived = await loadAccess(db, u.id);
    expect(waived.mfaRequired).toBe(false);
    expect(waived.effectiveRoles).toContain("hr");
    expect(waived.permissions.has("employee.manage")).toBe(true);
    expect(waived.permissions.has("cpf.reveal")).toBe(true);

    process.env.DEMO_MFA_OPTIONAL = "off";
    const required = await loadAccess(db, u.id);
    expect(required.mfaRequired).toBe(true);
    expect(required.permissions.has("employee.manage")).toBe(false);
    expect(required.permissions.has("cpf.reveal")).toBe(false);

    process.env.APP_ENV = "test";
    process.env.DEMO_MFA_OPTIONAL = "on";
    const outside = await loadAccess(db, u.id);
    expect(outside.mfaRequired).toBe(true);
    expect(outside.permissions.has("employee.manage")).toBe(false);
  });

  it("pessoa fora de active continua sem permissão alguma com a dispensa", async () => {
    const u = await activeUserWithPassword({ roles: ["admin"] });
    await db.update(employee).set({ status: "suspended" }).where(eq(employee.id, u.id));
    process.env.APP_ENV = "demo";
    process.env.DEMO_MFA_OPTIONAL = "on";
    const a = await loadAccess(db, u.id);
    expect(a.permissions.size).toBe(0);
    expect(a.mfaRequired).toBe(false);
  });
});

describe("redefinição da senha da administração da demonstração", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.APP_ENV = "demo";
    process.env.DEMO_ADMIN_PASSWORD = OLD;
    process.env.DEMO_PASSWORD = "ensaio pessoas ficticias portal 2026";
    delete process.env.DEMO_EMAIL_DOMAIN;
    delete process.env.DEMO_ADMIN_RESET_PASSWORD;
    await seedDemo();
  });
  afterEach(restore);

  it("troca a senha, apaga o segundo fator, encerra sessões e falhas, audita; a segunda execução não altera nada", async () => {
    // Administração com segundo fator cadastrado e sessão aberta, e uma conta travada por falhas.
    const first = await signIn(ADMIN, OLD);
    const headers = cookieHeader(first.cookies);
    const enrolled = (await auth.api.enableTwoFactor({ body: { password: OLD }, headers })) as { totpURI: string };
    await auth.api.verifyTOTP({ body: { code: totpFromUri(enrolled.totpURI) }, headers });
    for (let i = 0; i < 5; i++) await signIn(ADMIN, "senha errada para travar a conta");
    expect(await count("select count(*)::int as n from auth_two_factor")).toBe(1);

    process.env.DEMO_ADMIN_RESET_PASSWORD = NEW;
    expect(await resetDemoAdmin()).toEqual({ changed: true, email: ADMIN });

    const [admin] = await db.select({ userId: authUser.id, tf: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.email, ADMIN));
    expect(admin.tf).toBe(false);
    expect(await count("select count(*)::int as n from auth_two_factor")).toBe(0);
    expect(await count(`select count(*)::int as n from auth_session where user_id = '${admin.userId}'`)).toBe(0);
    expect(await auth.api.getSession({ headers })).toBeNull();
    expect(await count("select count(*)::int as n from audit_event where action = 'demo.admin_password_reset'")).toBe(1);
    const [ev] = (await db.execute(sql`select after::text as a from audit_event where action = 'demo.admin_password_reset'`)).rows as Array<{ a: string }>;
    expect(ev.a).not.toContain(NEW);

    // Senha antiga recusada; nova entra direto, sem pedir código.
    expect((await signIn(ADMIN, OLD)).status).not.toBe(200);
    const ok = await signIn(ADMIN, NEW);
    expect(ok.status).toBe(200);
    expect(ok.body?.twoFactorRedirect).toBeUndefined();

    const before = await count("select count(*)::int as n from audit_event");
    const sessions = await count(`select count(*)::int as n from auth_session where user_id = '${admin.userId}'`);
    expect(await resetDemoAdmin()).toMatchObject({ changed: false });
    expect(await count("select count(*)::int as n from audit_event")).toBe(before);
    expect(await count(`select count(*)::int as n from auth_session where user_id = '${admin.userId}'`)).toBe(sessions);
  });

  it("sem a variável ou fora da demonstração, nada muda", async () => {
    expect(await resetDemoAdmin()).toMatchObject({ changed: false, reason: expect.stringMatching(/ausente/) });
    process.env.DEMO_ADMIN_RESET_PASSWORD = NEW;
    process.env.APP_ENV = "test";
    expect(await resetDemoAdmin()).toMatchObject({ changed: false, reason: expect.stringMatching(/não é demo/) });
    expect((await signIn(ADMIN, OLD)).status).toBe(200);
  });

  it("senha fora da política ou igual à das demais contas: recusa sem gravar", async () => {
    process.env.DEMO_ADMIN_RESET_PASSWORD = "curta demais";
    await expect(resetDemoAdmin()).rejects.toThrow(/recusada pela política/);
    process.env.DEMO_ADMIN_RESET_PASSWORD = process.env.DEMO_PASSWORD;
    await expect(resetDemoAdmin()).rejects.toThrow(/diferente de DEMO_PASSWORD/);
    expect(await count("select count(*)::int as n from audit_event where action = 'demo.admin_password_reset'")).toBe(0);
    expect((await signIn(ADMIN, OLD)).status).toBe(200);
  });
});
