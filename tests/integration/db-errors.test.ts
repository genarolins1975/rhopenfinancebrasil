import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { authUser } from "@/db/schema";
import { syntheticCpf } from "@/modules/employees/cpf";
import { createEmployee, deactivateEmployee, updateEmployee } from "@/modules/employees/service";
import { grantRole } from "@/modules/access/grants";
import { ConflictError, ValidationError } from "@/modules/shared/errors";
import { logger } from "@/modules/shared/logger";
import { safeErrorInfo, translateDbError } from "@/modules/shared/db-errors";
import { activeUserWithPassword, resetDb } from "./helpers";

async function rhActor() {
  const rh = await activeUserWithPassword({ roles: ["hr"], permissions: ["role.assign.privileged"] });
  await db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, rh.userId));
  return { employeeId: rh.id, userId: rh.userId };
}

const LOG = process.env.LOG_CAPTURE_FILE!;
const readLog = () => {
  try {
    return readFileSync(LOG, "utf8");
  } catch {
    return "";
  }
};

describe("erros de banco nunca vazam parâmetros", () => {
  beforeEach(resetDb);

  it("CPF-03-T2: corrida de cadastro do mesmo CPF vira conflito genérico e o log não recebe a consulta", async () => {
    const actor = await rhActor();
    const cpf = syntheticCpf(6001);
    const mark = readLog().length;
    const results = await Promise.allSettled([
      createEmployee(db, actor, { fullName: "Corrida Um", corporateEmail: "corrida1@teste.invalid", cpf, orgCondition: "standard", hireDate: "2026-10-01", sendInvitation: false }),
      createEmployee(db, actor, { fullName: "Corrida Dois", corporateEmail: "corrida2@teste.invalid", cpf, orgCondition: "standard", hireDate: "2026-10-01", sendInvitation: false }),
    ]);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictError);
    expect(String(rejected[0].reason.message)).not.toMatch(/Failed query|params/);
    // simula o que uma action faria com o erro: só informação segura vai ao log
    logger.error({ err: safeErrorInfo(rejected[0].reason) }, "teste de redação");
    const tail = readLog().slice(mark);
    expect(tail).not.toContain("Failed query");
    expect(tail).not.toContain("params:");
    expect(tail).not.toContain("corrida1@teste.invalid");
    expect(tail).not.toContain(cpf);
  });

  it("entradas inválidas são recusadas antes do banco, com mensagem de domínio", async () => {
    const actor = await rhActor();
    const base = { fullName: "Pessoa Valida", corporateEmail: "valida@teste.invalid", cpf: syntheticCpf(6002), orgCondition: "standard" as const, hireDate: "2026-10-01" };
    await expect(createEmployee(db, actor, { ...base, areaId: "nao-e-uuid" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createEmployee(db, actor, { ...base, managerEmployeeId: "00000000-0000-0000-0000-000000000000" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createEmployee(db, actor, { ...base, hireDate: "31/12/2026" })).rejects.toBeInstanceOf(ValidationError);
    const r = await createEmployee(db, actor, { ...base, sendInvitation: false });
    await expect(deactivateEmployee(db, actor, r.employeeId, { reason: "teste", exitDate: "31/12/2026" })).rejects.toBeInstanceOf(ValidationError);
    await expect(deactivateEmployee(db, actor, r.employeeId, { reason: "teste", exitDate: "2020-01-01" })).rejects.toThrow(/anterior à admissão/);
    const alvo = await activeUserWithPassword();
    await expect(grantRole(db, actor, { targetEmployeeId: alvo.id, role: "manager", validFrom: "2026-10-10", validTo: "2026-10-01", reason: "x" })).rejects.toThrow(/término/);
    await expect(grantRole(db, actor, { targetEmployeeId: alvo.id, role: "manager", validTo: "amanhã", reason: "x" })).rejects.toThrow(/inválida/);
    await expect(updateEmployee(db, actor, actor.employeeId, { orgCondition: "director" })).rejects.toThrow(/própria/);
  });

  it("tradução de códigos do PostgreSQL", () => {
    const wrap = (code: string) => ({ message: "Failed query: insert ... params: segredo", cause: { code, constraint: "x" } });
    expect(translateDbError(wrap("23505"))).toBeInstanceOf(ConflictError);
    expect(translateDbError(wrap("22P02"))).toBeInstanceOf(ValidationError);
    expect(translateDbError(wrap("23503"))).toBeInstanceOf(ValidationError);
    expect(translateDbError(wrap("40P01"))).toBeInstanceOf(ConflictError);
    expect(translateDbError(new Error("outra"))).toBeNull();
    const info = safeErrorInfo(wrap("23505"));
    expect(JSON.stringify(info)).not.toContain("segredo");
    expect(JSON.stringify(safeErrorInfo(new Error("Failed query: x params: y")))).not.toContain("params");
  });
});
