import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { loginAttempt, outboxEvent } from "@/db/schema";
import { activeUserWithPassword, resetDb, seedEmployee } from "./helpers";

/** Contexto do Next simulado: cabeçalhos e cookies em memória; redirect vira exceção observável. */
let requestHeaders = new Headers();
const jar = new Map<string, string>();
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
    has: (name: string) => jar.has(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe("ações de servidor de identidade", () => {
  beforeEach(async () => {
    await resetDb();
    requestHeaders = new Headers();
    jar.clear();
  });

  it("AUT-11: cinco senhas erradas bloqueiam a conta por dez minutos, com resposta neutra e sem depender do IP", async () => {
    const { signInAction } = await import("@/modules/identity/actions");
    const u = await activeUserWithPassword();
    const attempt = async (password: string, ip: string) => {
      requestHeaders = new Headers({ "x-forwarded-for": ip });
      const fd = new FormData();
      fd.set("email", u.email);
      fd.set("password", password);
      return signInAction({}, fd).catch((e: Error) => ({ redirect: e.message }));
    };
    for (let i = 0; i < 5; i++) {
      const r = (await attempt("senha errada e longa o bastante", `10.0.0.${i}`)) as { error?: string };
      expect(r.error).toMatch(/Não foi possível entrar/);
      expect(r.error).not.toMatch(/bloque|tentativa/i);
    }
    const blocked = (await attempt(u.password, "10.0.0.99")) as { error?: string };
    expect(blocked.error).toMatch(/Não foi possível entrar/);
    expect((await db.select().from(loginAttempt)).filter((a) => !a.success)).toHaveLength(5);
  });

  it("AUT-10-T1: email já cadastrado para outra pessoa, mesmo convidada, não pode ser alvo da troca", async () => {
    const { requestEmailChangeAction } = await import("@/modules/identity/actions");
    const u = await activeUserWithPassword();
    const { headers } = await u.signIn();
    requestHeaders = new Headers({ cookie: headers.get("cookie")! });
    await seedEmployee({ status: "invited", email: "convidada@teste.invalid" });
    const attempt = async (email: string) => {
      const fd = new FormData();
      fd.set("newEmail", email);
      return requestEmailChangeAction({}, fd);
    };
    expect((await attempt("convidada@teste.invalid")).error).toMatch(/Não foi possível iniciar a troca/);
    expect((await attempt(u.email)).error).toMatch(/já é o seu email/);
    expect((await attempt("sem-arroba")).error).toMatch(/email válido/);
    const confirmations = () => db.select().from(outboxEvent).where(eq(outboxEvent.eventType, "email.change_confirmation"));
    expect(await confirmations()).toHaveLength(0);
    expect((await attempt("livre@teste.invalid")).ok).toBe(true);
    expect(await confirmations()).toHaveLength(1);
  });

  it("login correto redireciona para o início e registra sucesso", async () => {
    const { signInAction } = await import("@/modules/identity/actions");
    const u = await activeUserWithPassword();
    const fd = new FormData();
    fd.set("email", u.email);
    fd.set("password", u.password);
    await expect(signInAction({}, fd)).rejects.toThrow("REDIRECT:/inicio");
  });
});
