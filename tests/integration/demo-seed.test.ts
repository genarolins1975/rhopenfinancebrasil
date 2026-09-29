import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { authUser, employee, employeeSensitive } from "@/db/schema";
import { revealCpf } from "@/modules/employees/cpf";
import { seedDemo } from "../../scripts/demo-seed";
import { resetDb, seedEmployee } from "./helpers";

/* DEC-45: carga de dados da demonstração. Só em APP_ENV=demo, banco vazio, senhas pela política, idempotente. */

const saved = { ...process.env };
const count = async (table: string) => ((await db.execute(sql.raw(`select count(*)::int as n from ${table}`))).rows[0] as { n: number }).n;

describe("dados de demonstração", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.APP_ENV = "demo";
    process.env.DEMO_ADMIN_PASSWORD = "ensaio gestao portal escritorio 2026";
    process.env.DEMO_PASSWORD = "ensaio pessoas ficticias portal 2026";
    delete process.env.DEMO_EMAIL_DOMAIN;
  });
  afterEach(() => {
    for (const k of ["APP_ENV", "DEMO_ADMIN_PASSWORD", "DEMO_PASSWORD", "DEMO_EMAIL_DOMAIN"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("cria as contas, a planta, a mesa exclusiva e a ocupação; administração sem segundo fator até cadastrar o próprio; segunda execução não altera nada", async () => {
    const r = await seedDemo();
    expect(r.skipped).toBe(false);
    if (r.skipped) return;
    expect(r.accounts).toEqual(["admin", "colaboradora", "gestor", "diretora", "diretor"].map((k) => `${k}@demo.rhopenfinancebrasil.com`));
    expect(r.bookings).toBeGreaterThan(0);
    expect(await count("employee")).toBe(29);
    expect(await count("exclusive_assignment")).toBe(1);
    expect(await count("auth_two_factor")).toBe(0);
    const [admin] = await db.select({ tf: authUser.twoFactorEnabled }).from(authUser).innerJoin(employee, eq(employee.userId, authUser.id)).where(eq(employee.corporateEmail, "admin@demo.rhopenfinancebrasil.com"));
    expect(admin.tf).toBe(false);
    // CPF só sintético, com o prefixo reservado 999: nenhum dado real entra na demonstração.
    const rows = await db.select({ id: employeeSensitive.employeeId, c: employeeSensitive.cpfCiphertext }).from(employeeSensitive);
    expect(rows).toHaveLength(29);
    expect(rows.every((x) => revealCpf(Buffer.from(x.c), x.id).startsWith("999"))).toBe(true);
    const before = await count("audit_event");
    const again = await seedDemo();
    expect(again).toMatchObject({ skipped: true });
    expect(await count("audit_event")).toBe(before);
  });

  it("recusa carga pela metade: pessoas sem a marca de conclusão interrompem com orientação", async () => {
    await seedEmployee();
    await expect(seedDemo()).rejects.toThrow(/marca de conclusão/);
  });

  it("senha fora da política ou senhas iguais: recusa antes de gravar qualquer coisa", async () => {
    process.env.DEMO_ADMIN_PASSWORD = "senha da administração demonstração";
    await expect(seedDemo()).rejects.toThrow(/DEMO_ADMIN_PASSWORD recusada/);
    process.env.DEMO_ADMIN_PASSWORD = process.env.DEMO_PASSWORD;
    await expect(seedDemo()).rejects.toThrow(/precisam ser diferentes/);
    expect(await count("employee")).toBe(0);
  });

  it("fora de APP_ENV=demo, não faz nada", async () => {
    process.env.APP_ENV = "test";
    expect(await seedDemo()).toMatchObject({ skipped: true });
    expect(await count("employee")).toBe(0);
  });
});
