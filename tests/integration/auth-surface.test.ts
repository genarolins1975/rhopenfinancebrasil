import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auth, DISABLED_AUTH_PATHS } from "@/modules/identity/auth";
import { acceptInvitation, createInvitation } from "@/modules/identity/invitations";
import { resetDb, seedEmployee } from "./helpers";

const SENHA = "correto cavalo bateria grampo";

async function activeUser() {
  const rh = await seedEmployee({ roles: ["hr"] });
  const a = await seedEmployee({ status: "invited" });
  const inv = await db.transaction((tx) => createInvitation(tx, { employeeId: rh.id, userId: "u" }, a.id));
  await acceptInvitation(db, inv.token, SENHA);
  return a;
}

/** AUT-09: nada além do verificador de email pela rede; caminhos administrativos e de cadastro não existem. */
describe("superfície de autenticação", () => {
  beforeEach(resetDb);

  it("handler HTTP só serve GET de verificação de email e ok", async () => {
    const { GET, POST } = await import("@/app/api/auth/[...all]/route");
    expect((await POST()).status).toBe(404);
    expect((await GET(new Request("http://localhost:3000/api/auth/get-session"))).status).toBe(404);
    expect((await GET(new Request("http://localhost:3000/api/auth/admin/impersonate-user"))).status).toBe(404);
    expect((await GET(new Request("http://localhost:3000/api/auth/ok"))).status).toBe(200);
  });

  it("caminhos desativados e administrativos respondem 404 no próprio Better Auth", async () => {
    for (const p of [...DISABLED_AUTH_PATHS, "/admin/impersonate-user", "/admin/set-user-password", "/admin/create-user"]) {
      const res = await auth.handler(new Request(`http://localhost:3000/api/auth${p}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: "{}" }));
      expect([404, 405], `${p} respondeu ${res.status}`).toContain(res.status);
    }
  });

  it("cadastro por email não existe nem com o caminho habilitado internamente", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "novo@teste.invalid", password: SENHA, name: "Novo" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("login por API interna funciona para pessoa ativa e falha de forma neutra para senha errada", async () => {
    const a = await activeUser();
    const ok = await auth.api.signInEmail({ body: { email: a.email, password: SENHA }, asResponse: true });
    expect(ok.status).toBe(200);
    expect(ok.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(true);
    await expect(auth.api.signInEmail({ body: { email: a.email, password: "senha errada e longa o bastante" } })).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    await expect(auth.api.signInEmail({ body: { email: "ninguem@teste.invalid", password: SENHA } })).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });
});
