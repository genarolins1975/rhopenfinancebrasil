import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { authSession, employee } from "@/db/schema";
import { auth } from "@/modules/identity/auth";
import { isThrottled, registerAttempt, THROTTLE_MAX_FAILURES } from "@/modules/identity/throttle";
import { activeUserWithPassword, cookieHeader, resetDb, setCookiesFrom } from "./helpers";

describe("sessão e situação da pessoa", () => {
  beforeEach(resetDb);

  it("AUT-05: cinco falhas em dez minutos bloqueiam a conta com resposta neutra", async () => {
    const email = "alvo@teste.invalid";
    expect(await isThrottled(db, email)).toBe(false);
    for (let i = 0; i < THROTTLE_MAX_FAILURES; i++) await registerAttempt(db, email, false);
    expect(await isThrottled(db, email)).toBe(true);
    expect(await isThrottled(db, "ALVO@teste.invalid")).toBe(true);
    expect(await isThrottled(db, "outra@teste.invalid")).toBe(false);
  });

  it("pessoa suspensa ou desativada não recebe sessão nova, com a mesma resposta de senha errada", async () => {
    const u = await activeUserWithPassword();
    const sessionsBefore = (await db.select().from(authSession)).length;
    await db.update(employee).set({ status: "suspended" }).where(eq(employee.id, u.id));
    await expect(auth.api.signInEmail({ body: { email: u.email, password: u.password } })).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    await db.update(employee).set({ status: "deactivated" }).where(eq(employee.id, u.id));
    await expect(auth.api.signInEmail({ body: { email: u.email, password: u.password } })).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    expect((await db.select().from(authSession)).length).toBe(sessionsBefore);
    // sem sessão nova mesmo quando a checagem do hook é contornada: o hook de criação de sessão também nega
    const ctx = await auth.$context;
    const created = await ctx.internalAdapter.createSession(u.userId);
    expect(created).toBeNull();
  });

  it("AUT-07: troca de senha encerra as outras sessões", async () => {
    const u = await activeUserWithPassword();
    const s1 = await u.signIn();
    const s2 = await u.signIn();
    const res = await auth.api.changePassword({ headers: s2.headers, body: { currentPassword: u.password, newPassword: "outra frase longa e diferente", revokeOtherSessions: true }, asResponse: true });
    expect(res.status).toBe(200);
    // a sessão que trocou a senha recebe cookie novo; todas as anteriores, inclusive a própria, deixam de valer
    expect(await auth.api.getSession({ headers: s1.headers })).toBeNull();
    expect(await auth.api.getSession({ headers: s2.headers })).toBeNull();
    expect(await auth.api.getSession({ headers: cookieHeader(setCookiesFrom(res)) })).toBeTruthy();
    expect((await db.select().from(authSession)).length).toBe(1);
    await expect(auth.api.signInEmail({ body: { email: u.email, password: u.password } })).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });

  it("AUT-14: sessão emitida antes da desativação deixa de valer na requisição seguinte, mesmo sem revogação", async () => {
    const u = await activeUserWithPassword();
    const { headers } = await u.signIn();
    const before = await auth.api.getSession({ headers });
    expect(before?.user.email).toBe(u.email);
    await db.update(employee).set({ status: "deactivated" }).where(eq(employee.id, u.id));
    await expect(auth.api.getSession({ headers })).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    await expect(auth.api.listSessions({ headers })).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    await expect(auth.api.changePassword({ headers, body: { currentPassword: u.password, newPassword: "outra frase longa e pessoal" } })).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });

  it("AUT-12: revogação das outras sessões vale imediatamente (sem cache em cookie)", async () => {
    const u = await activeUserWithPassword();
    const s1 = await u.signIn();
    const s2 = await u.signIn();
    expect(await auth.api.getSession({ headers: s1.headers })).toBeTruthy();
    await auth.api.revokeOtherSessions({ headers: s2.headers });
    expect(await auth.api.getSession({ headers: s1.headers })).toBeNull();
    expect(await auth.api.getSession({ headers: s2.headers })).toBeTruthy();
  });
});
