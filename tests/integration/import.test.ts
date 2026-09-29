import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvent, authUser, employee, importBatch, invitation } from "@/db/schema";
import { syntheticCpf } from "@/modules/employees/cpf";
import { applyImport, previewImport } from "@/modules/employees/import";
import { activeUserWithPassword, resetDb, seedEmployee } from "./helpers";

async function rhActor() {
  const rh = await activeUserWithPassword({ roles: ["hr"] });
  await db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, rh.userId));
  return { employeeId: rh.id, userId: rh.userId };
}

describe("importação CSV", () => {
  beforeEach(resetDb);

  it("IMP-01: prévia valida por linha, mascara dados, ignora colunas de perfil e não funciona como oráculo", async () => {
    const actor = await rhActor();
    const existente = await seedEmployee({ name: "Pessoa Existente", email: "existente@teste.invalid" });
    const csv = [
      "nome;email;cpf;area;cargo;gestor_email;condicao;data_admissao;perfil",
      `Ana Nova;ana@teste.invalid;${syntheticCpf(1001)};Tecnologia;Analista;;colaborador;01/10/2026;admin`,
      `Bruno Erro;bruno@teste.invalid;12345678900;Tecnologia;Analista;;colaborador;01/10/2026;`,
      `Carla Dup;carla@teste.invalid;${existente.cpf};Financeiro;Analista;;diretor;2026-10-01;`,
      `Dani Dup;existente@teste.invalid;${syntheticCpf(1002)};Financeiro;;;colaborador;01/10/2026;`,
      `Ana Nova;ana@teste.invalid;${syntheticCpf(1001)};Tecnologia;Analista;;colaborador;01/10/2026;`,
    ].join("\n");
    const p = await previewImport(db, actor, csv);
    expect(p.summary).toEqual({ total: 5, ok: 1, erro: 1, duplicado: 3 });
    expect(p.warnings[0]).toMatch(/perfil/);
    const blob = JSON.stringify(p);
    expect(blob).not.toContain("Pessoa Existente");
    expect(blob).not.toContain(existente.cpf);
    expect(blob).not.toMatch(/\b\d{11}\b/);
    expect(p.rows[2].messages).toEqual(["conflita com cadastro existente"]);
    expect(p.rows[3].messages).toEqual(["conflita com cadastro existente"]);
    expect(p.rows[4].messages[0]).toMatch(/repetida no arquivo/);
    expect(p.rows[0].display.cpf).toMatch(/^•••\.•••\.•••-\d{2}$/);
    const [batch] = await db.select().from(importBatch).where(eq(importBatch.id, p.batchId));
    expect(batch.rowsCiphertext.toString("utf8")).not.toContain("ana@teste.invalid");
  });

  it("aplicação cria pessoas e convites em uma transação; a prévia só serve uma vez; conflito novo cancela o lote", async () => {
    const actor = await rhActor();
    const csv = [
      "nome,email,cpf,area,cargo,gestor_email,condicao,data_admissao",
      `Gestora Um,gestora@teste.invalid,${syntheticCpf(2001)},Operações,Gerente,,colaborador,01/10/2026`,
      `Pessoa Dois,dois@teste.invalid,${syntheticCpf(2002)},Operações,Analista,gestora@teste.invalid,colaborador,01/10/2026`,
    ].join("\n");
    const p = await previewImport(db, actor, csv);
    expect(p.summary.ok).toBe(2);
    const r = await applyImport(db, actor, p.batchId);
    expect(r.created).toBe(2);
    const rows = await db.select().from(employee).where(eq(employee.corporateEmail, "dois@teste.invalid"));
    expect(rows[0].managerEmployeeId).toBeTruthy();
    expect((await db.select().from(invitation)).filter((i) => i.usedAt === null)).toHaveLength(2);
    await expect(applyImport(db, actor, p.batchId)).rejects.toThrow(/já foi usada/);
    const [batch] = await db.select().from(importBatch).where(eq(importBatch.id, p.batchId));
    expect(batch.rowsCiphertext.length).toBe(0);
    const audits = (await db.select({ a: auditEvent.action }).from(auditEvent)).map((x) => x.a);
    expect(audits).toEqual(expect.arrayContaining(["employee.import.previewed", "employee.import.applied"]));

    const p2 = await previewImport(db, actor, `nome;email;cpf;area;cargo;gestor_email;condicao;data_admissao\nTres;tres@teste.invalid;${syntheticCpf(2003)};;;;;01/10/2026`);
    await seedEmployee({ email: "tres@teste.invalid" });
    await expect(applyImport(db, actor, p2.batchId)).rejects.toThrow(/mudanças no cadastro/);
  });

  it("limite anti oráculo: quinta prévia na hora é recusada; descarte só pelo dono e só de prévia", async () => {
    const actor = await rhActor();
    const outroRh = await rhActor();
    const csv = (n: number) => `nome;email;cpf;area;cargo;gestor_email;condicao;data_admissao\nPessoa ${n};p${n}@teste.invalid;${syntheticCpf(4000 + n)};;;;;01/10/2026`;
    const previews = [];
    for (let i = 0; i < 5; i++) previews.push(await previewImport(db, actor, csv(i)));
    await expect(previewImport(db, actor, csv(9))).rejects.toThrow(/Limite de prévias/);
    await expect(previewImport(db, outroRh, csv(9))).resolves.toBeTruthy();
    const { discardImport } = await import("@/modules/employees/import");
    await expect(discardImport(db, outroRh, previews[0].batchId)).rejects.toThrow(/não encontrada/);
    await discardImport(db, actor, previews[0].batchId);
    await expect(discardImport(db, actor, previews[0].batchId)).rejects.toThrow(/não encontrada/);
    await expect(applyImport(db, actor, previews[0].batchId)).rejects.toThrow(/já foi usada/);
  });

  it("prévia expirada ou de outra pessoa não é aplicada; sem permissão nada acontece", async () => {
    const actor = await rhActor();
    const p = await previewImport(db, actor, `nome;email;cpf;area;cargo;gestor_email;condicao;data_admissao\nQuatro;quatro@teste.invalid;${syntheticCpf(3001)};;;;;01/10/2026`);
    await db.update(importBatch).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(importBatch.id, p.batchId));
    await expect(applyImport(db, actor, p.batchId)).rejects.toThrow(/expirada/);
    const outro = await seedEmployee({ roles: ["employee"] });
    await expect(previewImport(db, { employeeId: outro.id, userId: "x" }, "nome;email")).rejects.toThrow(/perfil/);
  });
});
