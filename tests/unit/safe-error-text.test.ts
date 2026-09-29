import { describe, expect, it } from "vitest";
import { safeErrorText } from "@/modules/shared/db-errors";

/* Saída de script nunca leva a consulta com parâmetros (hash de senha, token, CPF cifrado): revisão da demonstração. */

describe("texto de erro seguro para scripts", () => {
  it("falha de consulta sem código do banco: consulta redigida, sem parâmetros", () => {
    const e = new Error('Failed query: insert into "auth_account" values ($1)\nparams: $argon2id$v=19$m=47104,t=1,p=1$c2FsdA$aGFzaA,http://localhost/convite/abc');
    const t = safeErrorText(e);
    expect(t).not.toMatch(/argon2id|convite|params/);
  });
  it("erro do banco embrulhado: só código, restrição e tabela", () => {
    const e = Object.assign(new Error('Failed query: select 1\nparams: segredo'), { cause: { code: "23505", constraint: "employee_email_key", table: "employee" } });
    expect(safeErrorText(e)).toBe("erro de banco 23505 (restrição employee_email_key) na tabela employee");
  });
  it("mensagem de validação passa como está", () => {
    expect(safeErrorText(new Error("DEMO_PASSWORD recusada pela política de senha para a conta gestor: A senha não pode conter o seu nome."))).toContain("DEMO_PASSWORD recusada");
  });
});
