import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { outboxEvent } from "@/db/schema";
import { auth } from "@/modules/identity/auth";
import { activeUserWithPassword, resetDb } from "./helpers";

describe("recuperação de senha", () => {
  beforeEach(resetDb);

  it("AUT-04: resposta idêntica para email desconhecido; email conhecido recebe link para a página do portal", async () => {
    const u = await activeUserWithPassword();
    const unknown = await auth.api.requestPasswordReset({ body: { email: "ninguem@teste.invalid" } });
    const known = await auth.api.requestPasswordReset({ body: { email: u.email } });
    expect(JSON.stringify(unknown)).toBe(JSON.stringify(known));
    const events = await db.select().from(outboxEvent).where(eq(outboxEvent.eventType, "email.password_reset"));
    expect(events).toHaveLength(1);
    const text = (events[0].payload as { message: { text: string; to: string } }).message.text;
    expect(text).toContain("http://localhost:3000/redefinir-senha/");
    expect(text).not.toContain("/api/auth/");
    const token = text.match(/redefinir-senha\/([A-Za-z0-9_-]+)/)![1];

    const { headers } = await u.signIn();
    expect(await auth.api.getSession({ headers })).toBeTruthy();
    const nova = "outra frase longa e pessoal";
    await auth.api.resetPassword({ body: { token, newPassword: nova } });
    expect(await auth.api.getSession({ headers })).toBeNull();
    await expect(auth.api.signInEmail({ body: { email: u.email, password: u.password } })).rejects.toBeTruthy();
    const ok = await auth.api.signInEmail({ body: { email: u.email, password: nova }, asResponse: true });
    expect(ok.status).toBe(200);
    await expect(auth.api.resetPassword({ body: { token, newPassword: "mais uma frase longa" } })).rejects.toBeTruthy();
  });
});
