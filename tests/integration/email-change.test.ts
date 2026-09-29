import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvent, authSession, authUser, employee, outboxEvent } from "@/db/schema";
import { auth } from "@/modules/identity/auth";
import { activeUserWithPassword, resetDb, setCookiesFrom } from "./helpers";

function linkFrom(eventType: string) {
  return async () => {
    const rows = await db.select().from(outboxEvent).where(eq(outboxEvent.eventType, eventType));
    const text = (rows.at(-1)!.payload as { message: { text: string; to: string } }).message;
    return { url: text.text.match(/https?:\/\/\S+/)![0], to: text.to };
  };
}

/** AUT-10-T1: troca de email com confirmação no endereço antigo, sem sessão pelo link e com cadastro sincronizado. */
describe("troca de email", () => {
  beforeEach(resetDb);

  it("fluxo completo", async () => {
    const u = await activeUserWithPassword();
    const { headers } = await u.signIn();
    const sessionsBefore = (await db.select().from(authSession)).length;
    await auth.api.changeEmail({ body: { newEmail: "novo.endereco@teste.invalid", callbackURL: "/perfil" }, headers });

    // 1. confirmação vai ao endereço antigo
    const link1 = await linkFrom("email.change_confirmation")();
    expect(link1.to).toBe(u.email);
    const r1 = await auth.handler(new Request(link1.url, { method: "GET" }));
    expect([200, 302, 307]).toContain(r1.status);

    // 2. verificação vai ao endereço novo; sem sessão, o link não conclui nem emite sessão
    const link2 = await linkFrom("email.verification")();
    expect(link2.to).toBe("novo.endereco@teste.invalid");
    const r2 = await auth.handler(new Request(link2.url, { method: "GET" }));
    expect(r2.status).toBeGreaterThanOrEqual(300);
    expect(r2.headers.get("location")).toContain("/entrar?aviso=confirmar-email");
    expect(setCookiesFrom(r2).some((c) => c.includes("session_token") && !/session_token=;/.test(c))).toBe(false);
    const [stillOld] = await db.select({ email: authUser.email }).from(authUser).where(eq(authUser.id, u.userId));
    expect(stillOld.email).toBe(u.email);

    // 3. com sessão, conclui: identidade e cadastro sincronizados, nenhuma sessão nova
    const cookie = headers.get("cookie")!;
    const r3 = await auth.handler(new Request(link2.url, { method: "GET", headers: { cookie } }));
    expect([200, 302, 307]).toContain(r3.status);
    const [updated] = await db.select({ email: authUser.email }).from(authUser).where(eq(authUser.id, u.userId));
    expect(updated.email).toBe("novo.endereco@teste.invalid");
    const [emp] = await db.select({ email: employee.corporateEmail }).from(employee).where(eq(employee.id, u.id));
    expect(emp.email).toBe("novo.endereco@teste.invalid");
    expect((await db.select().from(authSession)).length).toBe(sessionsBefore);
    const audits = (await db.select({ a: auditEvent.action }).from(auditEvent)).map((x) => x.a);
    expect(audits).toContain("employee.email_changed");
  });
});
