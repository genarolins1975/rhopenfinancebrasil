import { describe, expect, it } from "vitest";
import { dbUrlProblem, maskDbUrl } from "@/modules/operations/db-url";

/* Conferência das URLs de banco no build da demonstração: diagnóstico sem expor senha (DV-20). */

const SENHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const HOST = "ep-cool-name-a1b2c3d4.sa-east-1.aws.neon.tech";
const OK = `postgresql://rh_owner:${SENHA}@${HOST}/rh_demo?sslmode=require`;

describe("conferência das URLs de banco", () => {
  it("URL no formato do roteiro passa", () => {
    expect(dbUrlProblem(OK, "rh_owner")).toBeNull();
  });
  it("aponta o defeito dos erros de montagem mais comuns", () => {
    expect(dbUrlProblem(`psql '${OK}'`)).toMatch(/aspas/);
    expect(dbUrlProblem(`postgresql://rh_owner:${SENHA}@<${HOST}>/rh_demo`)).toMatch(/< >/);
    expect(dbUrlProblem(`${OK} `)).toMatch(/fim/);
    expect(dbUrlProblem(`DATABASE_OWNER_URL=${OK}`)).toMatch(/postgresql:\/\//);
    expect(dbUrlProblem(`postgresql://rh_owner:${SENHA}@postgresql://neondb_owner:npg_AbC123@${HOST}/neondb`)).toMatch(/mais de um/);
    expect(dbUrlProblem(`postgresql://rh_owner:${SENHA}@${HOST}:abc/rh_demo`)).toMatch(/inválido/);
    expect(dbUrlProblem(`postgresql://rh_owner:@${HOST}/rh_demo`)).toMatch(/sem senha/);
    expect(dbUrlProblem(`postgresql://rh_owner:${SENHA}@${HOST}`)).toMatch(/banco/);
    expect(dbUrlProblem(OK.replace("rh_owner", "rh_app"), "rh_owner")).toMatch(/esperado rh_owner/);
  });
  it("máscara esconde toda senha, inclusive a do dono do Neon colada por engano", () => {
    const m = maskDbUrl(`psql 'postgresql://neondb_owner:npg_AbC123xyz@${HOST}/neondb' postgresql://rh_owner:${SENHA}@${HOST}/rh_demo`);
    expect(m).not.toContain(SENHA);
    expect(m).not.toContain("npg_AbC123xyz");
    expect(m).toContain("rh_owner:****@");
    expect(m).toContain(HOST);
  });
});
