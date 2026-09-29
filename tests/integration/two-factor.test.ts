import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auth } from "@/modules/identity/auth";
import { loadAccess } from "@/modules/access/can";
import { activeUserWithPassword, cookieHeader, resetDb, setCookiesFrom } from "./helpers";
import { totpFromUri } from "./totp";

async function enroll(u: Awaited<ReturnType<typeof activeUserWithPassword>>) {
  const { headers } = await u.signIn();
  const res = (await auth.api.enableTwoFactor({ body: { password: u.password }, headers })) as { totpURI: string; backupCodes: string[] };
  expect(res.totpURI).toContain("otpauth://totp/");
  await auth.api.verifyTOTP({ body: { code: totpFromUri(res.totpURI) }, headers });
  return res;
}

describe("segundo fator", () => {
  beforeEach(resetDb);

  it("AUT-06: perfil privilegiado só produz efeito com segundo fator; ativação por TOTP", async () => {
    const u = await activeUserWithPassword({ roles: ["hr"] });
    const before = await loadAccess(db, u.id);
    expect(before.mfaRequired).toBe(true);
    expect(before.permissions.has("employee.manage")).toBe(false);
    expect(before.permissions.has("booking.self.manage")).toBe(true);
    await enroll(u);
    const after = await loadAccess(db, u.id);
    expect(after.mfaRequired).toBe(false);
    expect(after.permissions.has("employee.manage")).toBe(true);
  });

  it("login exige o segundo fator; AUT-13: trustDevice é ignorado e não gera cookie de confiança", async () => {
    const u = await activeUserWithPassword({ roles: ["admin"] });
    const enrolled = await enroll(u);
    const res = await auth.api.signInEmail({ body: { email: u.email, password: u.password }, asResponse: true });
    const body = (await res.json()) as { twoFactorRedirect?: boolean };
    expect(body.twoFactorRedirect).toBe(true);
    const cookies = setCookiesFrom(res);
    expect(cookies.some((c) => c.includes("session_token") && !c.includes("session_token=;"))).toBe(false);
    const verify = await auth.api.verifyTOTP({ body: { code: totpFromUri(enrolled.totpURI), trustDevice: true }, headers: cookieHeader(cookies), asResponse: true });
    expect(verify.status).toBe(200);
    const verifyCookies = setCookiesFrom(verify);
    expect(verifyCookies.some((c) => c.includes("session_token"))).toBe(true);
    expect(verifyCookies.some((c) => /trust/i.test(c) && !/trust_device=;/.test(c))).toBe(false);
    const session = await auth.api.getSession({ headers: cookieHeader(verifyCookies) });
    expect(session?.user.email).toBe(u.email);
  });

  it("código de recuperação funciona uma vez", async () => {
    const u = await activeUserWithPassword();
    const enrolled = await enroll(u);
    const res = await auth.api.signInEmail({ body: { email: u.email, password: u.password }, asResponse: true });
    const cookies = setCookiesFrom(res);
    const code = enrolled.backupCodes[0];
    const ok = await auth.api.verifyBackupCode({ body: { code }, headers: cookieHeader(cookies), asResponse: true });
    expect(ok.status).toBe(200);
    const res2 = await auth.api.signInEmail({ body: { email: u.email, password: u.password }, asResponse: true });
    await expect(auth.api.verifyBackupCode({ body: { code }, headers: cookieHeader(setCookiesFrom(res2)) })).rejects.toBeTruthy();
  });

  it("perfil privilegiado não desativa o segundo fator; colaborador comum pode", async () => {
    const priv = await activeUserWithPassword({ roles: ["facilities"] });
    const privEnrolled = await enroll(priv);
    const pending = await auth.api.signInEmail({ body: { email: priv.email, password: priv.password }, asResponse: true });
    const completed = await auth.api.verifyTOTP({ body: { code: totpFromUri(privEnrolled.totpURI) }, headers: cookieHeader(setCookiesFrom(pending)), asResponse: true });
    const privHeaders = cookieHeader(setCookiesFrom(completed));
    expect(await auth.api.getSession({ headers: privHeaders })).toBeTruthy();
    await expect(auth.api.disableTwoFactor({ body: { password: priv.password }, headers: privHeaders })).rejects.toMatchObject({ status: "FORBIDDEN" });
    expect((await loadAccess(db, priv.id)).twoFactorEnabled).toBe(true);

    const comum = await activeUserWithPassword();
    const enrolled = await enroll(comum);
    const res = await auth.api.signInEmail({ body: { email: comum.email, password: comum.password }, asResponse: true });
    const verify = await auth.api.verifyTOTP({ body: { code: totpFromUri(enrolled.totpURI) }, headers: cookieHeader(setCookiesFrom(res)), asResponse: true });
    const full = cookieHeader(setCookiesFrom(verify));
    await auth.api.disableTwoFactor({ body: { password: comum.password }, headers: full });
    const access = await loadAccess(db, comum.id);
    expect(access.twoFactorEnabled).toBe(false);
  });
});
