import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { handleCron } from "@/modules/operations/cron-route";
import { checkDatabase } from "@/modules/operations/db-check";

/* DEC-45: conferência do banco antes de publicar e rota agendada de operação. */

describe("operação da demonstração", () => {
  it("banco de teste com o papel da aplicação: conforme", async () => {
    const r = await checkDatabase(process.env.DATABASE_URL!, process.env.DATABASE_OWNER_URL);
    expect(r.problems).toEqual([]);
    expect(r.timezone).toBe("America/Sao_Paulo");
  });
  it("conectando como dono, ou com o dono em outro banco: reprova com o motivo", async () => {
    const asOwner = await checkDatabase(process.env.DATABASE_OWNER_URL!);
    expect(asOwner.problems.join(" ")).toMatch(/papel dono/);
    expect(asOwner.problems.join(" ")).toMatch(/alterar ou apagar a auditoria/);
    const other = process.env.DATABASE_OWNER_URL!.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
    const mismatch = await checkDatabase(process.env.DATABASE_URL!, other);
    expect(mismatch.problems.join(" ")).toMatch(/aponta para o banco postgres/);
  });
  it("rota agendada: 401 sem segredo, com segredo errado ou sem segredo configurado; 200 só com contagens", async () => {
    const secret = "c".repeat(64);
    const req = (h?: string) => new Request("http://localhost/api/cron/operacao", { headers: h ? { authorization: h } : {} });
    expect((await handleCron(db, req(), secret)).status).toBe(401);
    expect((await handleCron(db, req(`Bearer ${"d".repeat(64)}`), secret)).status).toBe(401);
    expect((await handleCron(db, req(`Bearer ${secret}`), undefined)).status).toBe(401);
    const ok = await handleCron(db, req(`Bearer ${secret}`), secret);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["delivered", "ok", "sweep"]);
    expect(Object.keys(body.sweep as object).sort()).toEqual(["expired", "offered", "past", "released"]);
  });
});
