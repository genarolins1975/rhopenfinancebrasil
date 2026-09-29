import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { authUser, employee, invitation, outboxEvent } from "@/db/schema";
import { grantPermission, grantRole } from "@/modules/access/grants";
import { loadAccess } from "@/modules/access/can";
import { reactivateEmployee, resendInvitation, revokeInvitation, suspendEmployee, updateEmployee } from "@/modules/employees/service";
import { ForbiddenError } from "@/modules/shared/errors";
import { activeUserWithPassword, resetDb, seedEmployee } from "./helpers";

async function withMfa(opts: Parameters<typeof activeUserWithPassword>[0]) {
  const u = await activeUserWithPassword(opts);
  await db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, u.userId));
  return { ...u, actor: { employeeId: u.id, userId: u.userId } };
}

/** Achado 1 da reapresentação: RH comum não pode tomar a conta de convidada privilegiada nem reativar administrador. */
describe("alvo com concessão privilegiada", () => {
  beforeEach(resetDb);

  it("RH sem role.assign.privileged não troca email, não reenvia nem revoga convite de convidada privilegiada", async () => {
    const adm = await withMfa({ roles: ["hr", "admin"], permissions: ["role.assign.privileged"] });
    const rh = await withMfa({ roles: ["hr"] });
    const convidada = await seedEmployee({ status: "invited", email: "convidada-adm@teste.invalid" });
    await grantRole(db, adm.actor, { targetEmployeeId: convidada.id, role: "admin", reason: "bootstrap de teste" });
    await grantPermission(db, adm.actor, { targetEmployeeId: convidada.id, permission: "role.assign.privileged", reason: "bootstrap de teste" });
    expect((await loadAccess(db, convidada.id)).hasPrivilegedGrant).toBe(true);
    const invitesBefore = (await db.select().from(invitation).where(eq(invitation.employeeId, convidada.id))).length;
    const outboxBefore = (await db.select().from(outboxEvent)).length;

    await expect(updateEmployee(db, rh.actor, convidada.id, { corporateEmail: "rh-controla@teste.invalid" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resendInvitation(db, rh.actor, convidada.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revokeInvitation(db, rh.actor, convidada.id, "teste")).rejects.toBeInstanceOf(ForbiddenError);
    const [emp] = await db.select({ email: employee.corporateEmail }).from(employee).where(eq(employee.id, convidada.id));
    expect(emp.email).toBe("convidada-adm@teste.invalid");
    expect((await db.select().from(invitation).where(eq(invitation.employeeId, convidada.id))).length).toBe(invitesBefore);
    expect((await db.select().from(outboxEvent)).length).toBe(outboxBefore);

    // nome e cargo continuam editáveis pelo RH; quem gere privilégios pode tudo
    await updateEmployee(db, rh.actor, convidada.id, { fullName: "Nome Corrigido Pelo RH", jobTitle: "Diretoria" });
    await updateEmployee(db, adm.actor, convidada.id, { corporateEmail: "endereco-novo@teste.invalid" });
    await resendInvitation(db, adm.actor, convidada.id);
    const [after] = await db.select({ email: employee.corporateEmail, name: employee.fullName }).from(employee).where(eq(employee.id, convidada.id));
    expect(after).toEqual({ email: "endereco-novo@teste.invalid", name: "Nome Corrigido Pelo RH" });
  });

  it("concessão privilegiada com início futuro protege a convidada do mesmo jeito e aparece na página", async () => {
    const adm = await withMfa({ roles: ["hr", "admin"], permissions: ["role.assign.privileged"] });
    const rh = await withMfa({ roles: ["hr"] });
    const convidada = await seedEmployee({ status: "invited", email: "futura-adm@teste.invalid" });
    const amanha = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
    await grantRole(db, adm.actor, { targetEmployeeId: convidada.id, role: "admin", validFrom: amanha, reason: "início agendado" });
    await grantPermission(db, adm.actor, { targetEmployeeId: convidada.id, permission: "role.assign.privileged", validFrom: amanha, reason: "início agendado" });
    expect((await loadAccess(db, convidada.id)).hasPrivilegedGrant).toBe(false);
    await expect(updateEmployee(db, rh.actor, convidada.id, { corporateEmail: "rh-controla-futura@teste.invalid" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resendInvitation(db, rh.actor, convidada.id)).rejects.toBeInstanceOf(ForbiddenError);
    const { listGrants } = await import("@/modules/access/query");
    const grants = await listGrants(db, convidada.id);
    expect(grants.roles.map((r) => [r.roleCode, r.future])).toEqual([["admin", true]]);
    expect(grants.permissions.map((p) => [p.permissionCode, p.future])).toEqual([["role.assign.privileged", true]]);
  });

  it("RH sem role.assign.privileged não reativa administrador suspenso", async () => {
    const adm = await withMfa({ roles: ["hr", "admin"], permissions: ["role.assign.privileged"] });
    const outroAdm = await withMfa({ roles: ["admin"], permissions: ["role.assign.privileged"] });
    const rh = await withMfa({ roles: ["hr"] });
    await suspendEmployee(db, adm.actor, outroAdm.id, "investigação");
    await expect(reactivateEmployee(db, rh.actor, outroAdm.id, "teste")).rejects.toBeInstanceOf(ForbiddenError);
    const [still] = await db.select({ status: employee.status }).from(employee).where(eq(employee.id, outroAdm.id));
    expect(still.status).toBe("suspended");
    await reactivateEmployee(db, adm.actor, outroAdm.id, "concluída");
  });

  it("RH corrige o próprio nome, mas não a própria área, gestor ou condição", async () => {
    const rh = await withMfa({ roles: ["hr"] });
    const [before] = await db.select().from(employee).where(eq(employee.id, rh.id));
    // a action envia todos os campos, mesmo sem mudança: só a diferença real é bloqueada
    await updateEmployee(db, rh.actor, rh.id, { fullName: "Meu Nome Corrigido", areaId: before.areaId, managerEmployeeId: before.managerEmployeeId, orgCondition: before.orgCondition });
    await expect(updateEmployee(db, rh.actor, rh.id, { orgCondition: "director" })).rejects.toThrow(/própria/);
    const [after] = await db.select({ name: employee.fullName, cond: employee.orgCondition }).from(employee).where(eq(employee.id, rh.id));
    expect(after).toEqual({ name: "Meu Nome Corrigido", cond: before.orgCondition });
  });
});
