import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Consulta de senhas vazadas ligada (PASSWORD_BREACH_CHECK=on), como na demonstração e na produção. O complemento do
 * Better Auth exige contexto de requisição ao cifrar senha; o aceite do convite e a carga de demonstração rodam fora
 * dele (ação de servidor e script de build) e não podem depender disso (DV-21). A consulta externa é simulada.
 */
vi.hoisted(() => {
  process.env.PASSWORD_BREACH_CHECK = "on";
});

import { db } from "@/db/client";
import { auth } from "@/modules/identity/auth";
import { acceptInvitation, createInvitation } from "@/modules/identity/invitations";
import { seedDemo } from "../../scripts/demo-seed";
import { resetDb, seedEmployee } from "./helpers";

const SENHA = "ensaio consulta ligada portal escritorio";
const saved = { ...process.env };

describe("consulta de senhas vazadas ligada", () => {
  beforeEach(async () => {
    await resetDb();
    // Faixa de resumos sem a senha usada: nenhuma senha do teste aparece como vazada.
    vi.stubGlobal("fetch", async () => new Response("0000000000000000000000000000000000A:3\r\n", { status: 200 }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["APP_ENV", "DEMO_ADMIN_PASSWORD", "DEMO_PASSWORD"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("o complemento do Better Auth está ativo neste arquivo", () => {
    expect(auth.options.plugins?.some((p) => p.id === "have-i-been-pwned")).toBe(true);
  });

  it("aceite do convite cria a identidade fora de requisição do Better Auth", async () => {
    const rh = await seedEmployee({ roles: ["hr"] });
    const alvo = await seedEmployee({ status: "invited", email: "consulta.ligada@exemplo.org" });
    const inv = await db.transaction((tx) => createInvitation(tx, { employeeId: rh.id, userId: "u-rh" }, alvo.id));
    await expect(acceptInvitation(db, inv.token, SENHA)).resolves.toEqual({ employeeId: alvo.id });
  });

  it("carga de demonstração conclui com a consulta ligada", async () => {
    process.env.APP_ENV = "demo";
    process.env.DEMO_ADMIN_PASSWORD = "ensaio gestao portal escritorio 2026";
    process.env.DEMO_PASSWORD = "ensaio pessoas ficticias portal 2026";
    const r = await seedDemo();
    expect(r.skipped).toBe(false);
  });
});
