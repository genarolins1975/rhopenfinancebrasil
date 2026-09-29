import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvent, authUser, employee, employeeOrgAssignment, employeeSensitive, invitation, outboxEvent } from "@/db/schema";
import { loadAccess } from "@/modules/access/can";
import { syntheticCpf } from "@/modules/employees/cpf";
import { createEmployee, deactivateEmployee, getEmployee, listEmployees, readmitEmployee, revealCpf, suspendEmployee, updateEmployee } from "@/modules/employees/service";
import { auth } from "@/modules/identity/auth";
import { activeUserWithPassword, resetDb, seedEmployee } from "./helpers";

async function rhActor() {
  const rh = await activeUserWithPassword({ roles: ["hr"] });
  await db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, rh.userId));
  return { rh, actor: { employeeId: rh.id, userId: rh.userId } };
}

const CPF_RE = /\b\d{11}\b/;

describe("colaboradores e CPF", () => {
  beforeEach(resetDb);

  it("cadastro exige permissão; cria pessoa convidada com CPF cifrado e convite enfileirado", async () => {
    const { actor } = await rhActor();
    const semPermissao = await seedEmployee();
    const cpf = syntheticCpf(500);
    await expect(createEmployee(db, { employeeId: semPermissao.id, userId: "x" }, { fullName: "Nova Pessoa", corporateEmail: "nova@teste.invalid", cpf, orgCondition: "standard", hireDate: "2026-10-01" })).rejects.toThrow(/perfil/);
    const r = await createEmployee(db, actor, { fullName: "Nova Pessoa", corporateEmail: "Nova@Teste.invalid", cpf, orgCondition: "director", hireDate: "2026-10-01" });
    expect(r.invitationUrl).toContain("/convite/");
    const [sens] = await db.select().from(employeeSensitive).where(eq(employeeSensitive.employeeId, r.employeeId));
    expect(sens.cpfSuffix).toBe(cpf.slice(9));
    expect(sens.cpfCiphertext.toString("utf8")).not.toContain(cpf);
    expect(sens.cpfCiphertext[0]).toBe(1);
    const [emp] = await db.select().from(employee).where(eq(employee.id, r.employeeId));
    expect(emp.corporateEmail).toBe("nova@teste.invalid");
    expect(emp.status).toBe("invited");
    expect(emp.orgCondition).toBe("director");
    expect((await loadAccess(db, r.employeeId)).permissions.size).toBe(0);
  });

  it("CPF-02: duplicidade por HMAC e por email com a mesma resposta genérica; zeros à esquerda preservados", async () => {
    const { actor } = await rhActor();
    const cpf = "01234567890";
    await createEmployee(db, actor, { fullName: "Primeira Pessoa", corporateEmail: "p1@teste.invalid", cpf: "012.345.678-90", orgCondition: "standard", hireDate: "2026-10-01", sendInvitation: false });
    await expect(createEmployee(db, actor, { fullName: "Outra Pessoa", corporateEmail: "p2@teste.invalid", cpf, orgCondition: "standard", hireDate: "2026-10-01" })).rejects.toThrow(/Já existe cadastro com estes dados/);
    await expect(createEmployee(db, actor, { fullName: "Outra Pessoa", corporateEmail: "P1@teste.invalid", cpf: syntheticCpf(9), orgCondition: "standard", hireDate: "2026-10-01" })).rejects.toThrow(/Já existe cadastro com estes dados/);
    const { items } = await listEmployees(db, { q: "Primeira" });
    const [sens] = await db.select().from(employeeSensitive).where(eq(employeeSensitive.employeeId, items[0].id));
    expect(sens.cpfSuffix).toBe("90");
  });

  it("CPF-01: CPF não aparece em listagem, detalhe, auditoria nem outbox; revelação exige permissão, motivo e é auditada", async () => {
    const { rh, actor } = await rhActor();
    const cpf = syntheticCpf(77);
    const r = await createEmployee(db, actor, { fullName: "Pessoa Protegida", corporateEmail: "prot@teste.invalid", cpf, orgCondition: "standard", hireDate: "2026-10-01" });
    const list = JSON.stringify(await listEmployees(db));
    const detail = JSON.stringify(await getEmployee(db, r.employeeId));
    const audits = JSON.stringify(await db.select().from(auditEvent));
    const outbox = JSON.stringify(await db.select().from(outboxEvent));
    for (const blob of [list, detail, audits, outbox]) {
      expect(blob).not.toContain(cpf);
      expect(blob).not.toMatch(CPF_RE);
    }
    expect(detail).toContain(`"cpfSuffix":"${cpf.slice(9)}"`);
    await expect(revealCpf(db, actor, r.employeeId, "conferência de cadastro")).rejects.toThrow(/perfil/);
    const { grantPermission } = await import("@/modules/access/grants");
    const adm = await activeUserWithPassword({ roles: ["admin"], permissions: ["role.assign.privileged"] });
    await db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, adm.userId));
    await grantPermission(db, { employeeId: adm.id, userId: adm.userId }, { targetEmployeeId: rh.id, permission: "cpf.reveal", reason: "atende auditoria interna" });
    await expect(revealCpf(db, actor, r.employeeId, "x")).rejects.toThrow(/motivo/);
    const shown = await revealCpf(db, actor, r.employeeId, "conferência de cadastro");
    expect(shown.replace(/\D/g, "")).toBe(cpf);
    const [ev] = await db.select().from(auditEvent).where(eq(auditEvent.action, "cpf.revealed"));
    expect(ev.reason).toBe("conferência de cadastro");
    expect(ev.actorEmployeeId).toBe(rh.id);
    expect(JSON.stringify(ev)).not.toContain(cpf);
  });

  it("edição: email de pessoa ativa não muda pelo RH; de convidada muda e revoga convites; mudança organizacional abre histórico", async () => {
    const { actor } = await rhActor();
    const ativa = await activeUserWithPassword();
    await expect(updateEmployee(db, actor, ativa.id, { corporateEmail: "novo@teste.invalid" })).rejects.toThrow(/fluxo de troca/);
    const r = await createEmployee(db, actor, { fullName: "Convidada Pessoa", corporateEmail: "conv@teste.invalid", cpf: syntheticCpf(31), orgCondition: "standard", hireDate: "2026-10-01" });
    await updateEmployee(db, actor, r.employeeId, { corporateEmail: "conv2@teste.invalid" });
    const invs = await db.select().from(invitation).where(eq(invitation.employeeId, r.employeeId));
    expect(invs.every((i) => i.revokedAt !== null)).toBe(true);
    await updateEmployee(db, actor, ativa.id, { jobTitle: "Analista", orgCondition: "director", reason: "promoção" });
    const hist = await db.select().from(employeeOrgAssignment).where(eq(employeeOrgAssignment.employeeId, ativa.id));
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist.some((h) => h.orgCondition === "director" && h.validTo === null)).toBe(true);
  });

  it("suspensão e desativação revogam sessões; desativação encerra concessões e convites; readmissão zera credenciais", async () => {
    const { actor } = await rhActor();
    const alvo = await activeUserWithPassword({ roles: ["manager"] });
    const { headers } = await alvo.signIn();
    expect(await auth.api.getSession({ headers })).toBeTruthy();
    await expect(suspendEmployee(db, actor, alvo.id, "")).rejects.toThrow(/motivo/);
    await suspendEmployee(db, actor, alvo.id, "afastamento");
    // sessões revogadas: sem sessão (null) ou recusada pelo hook de situação
    const afterSuspend = await auth.api.getSession({ headers }).catch(() => "recusada");
    expect(afterSuspend === null || afterSuspend === "recusada").toBe(true);
    expect((await loadAccess(db, alvo.id)).grantedRoles).toEqual(["manager"]);
    await deactivateEmployee(db, actor, alvo.id, { reason: "desligamento", exitDate: "2026-10-15" });
    const access = await loadAccess(db, alvo.id);
    expect(access.grantedRoles).toEqual([]);
    expect(access.permissions.size).toBe(0);
    const d = await getEmployee(db, alvo.id);
    expect(d?.status).toBe("deactivated");
    expect(d?.periods[0].exitDate).toBe("2026-10-15");
    await readmitEmployee(db, actor, alvo.id, { hireDate: "2027-01-05", reason: "recontratação" });
    const r = await getEmployee(db, alvo.id);
    expect(r?.status).toBe("invited");
    expect(r?.userId).toBeNull();
    expect(r?.periods).toHaveLength(2);
    expect(r?.invitations.some((i) => !i.usedAt && !i.revokedAt)).toBe(true);
    expect(await db.select().from(authUser).where(eq(authUser.id, alvo.userId))).toHaveLength(0);
  });
});
