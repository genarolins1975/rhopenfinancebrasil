import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvent, authUser, employee } from "@/db/schema";
import { loadAccess } from "@/modules/access/can";
import { grantPermission, grantRole, revokeRole } from "@/modules/access/grants";
import { activeUserWithPassword, resetDb, seedEmployee } from "./helpers";

async function withMfa(u: { userId: string }) {
  await db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, u.userId));
}

describe("acesso e separação de atribuições", () => {
  beforeEach(resetDb);

  it("negação por padrão: pessoa inativa não tem permissão; colaborador tem só o básico", async () => {
    const inativa = await seedEmployee({ status: "deactivated", roles: ["hr"] });
    expect((await loadAccess(db, inativa.id)).permissions.size).toBe(0);
    const comum = await seedEmployee({ roles: ["employee"] });
    const a = await loadAccess(db, comum.id);
    expect([...a.permissions].sort()).toEqual(["booking.self.manage", "employee.read.basic", "ticket.self"]);
  });

  it("ACC-01: ninguém concede a si mesmo; RH não concede perfil privilegiado sem permissão própria", async () => {
    const rh = await activeUserWithPassword({ roles: ["hr"] });
    await withMfa(rh);
    const alvo = await seedEmployee();
    const actor = { employeeId: rh.id, userId: rh.userId };
    await expect(grantRole(db, actor, { targetEmployeeId: rh.id, role: "admin", reason: "quero" })).rejects.toThrow(/próprios perfis/);
    await expect(grantRole(db, actor, { targetEmployeeId: alvo.id, role: "admin", reason: "promoção" })).rejects.toThrow(/permissão específica/);
    await expect(grantPermission(db, actor, { targetEmployeeId: alvo.id, permission: "cpf.reveal", reason: "x" })).rejects.toThrow(/permissão específica/);
    await grantRole(db, actor, { targetEmployeeId: alvo.id, role: "manager", reason: "coordena a equipe" });
    expect((await loadAccess(db, alvo.id)).grantedRoles).toEqual(["manager"]);
  });

  it("com role.assign.privileged concede e revoga perfil privilegiado com auditoria; duplicidade ativa é rejeitada", async () => {
    const adm = await activeUserWithPassword({ roles: ["admin"], permissions: ["role.assign.privileged"] });
    await withMfa(adm);
    const alvo = await activeUserWithPassword();
    const actor = { employeeId: adm.id, userId: adm.userId };
    await grantRole(db, actor, { targetEmployeeId: alvo.id, role: "hr", reason: "assume o RH" });
    await expect(grantRole(db, actor, { targetEmployeeId: alvo.id, role: "hr", reason: "de novo" })).rejects.toThrow();
    let a = await loadAccess(db, alvo.id);
    expect(a.hasPrivilegedGrant).toBe(true);
    expect(a.mfaRequired).toBe(true);
    expect(a.permissions.has("employee.manage")).toBe(false);
    await withMfa(alvo);
    a = await loadAccess(db, alvo.id);
    expect(a.permissions.has("employee.manage")).toBe(true);
    await revokeRole(db, actor, { targetEmployeeId: alvo.id, role: "hr", reason: "mudou de área" });
    a = await loadAccess(db, alvo.id);
    expect(a.grantedRoles).toEqual([]);
    const actions = (await db.select({ a: auditEvent.action }).from(auditEvent)).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(["access.role.granted", "access.role.revoked"]));
  });

  it("concessão com vigência futura ou vencida não vale hoje", async () => {
    const adm = await activeUserWithPassword({ roles: ["admin"], permissions: ["role.assign.privileged"] });
    await withMfa(adm);
    const alvo = await seedEmployee();
    const actor = { employeeId: adm.id, userId: adm.userId };
    await grantRole(db, actor, { targetEmployeeId: alvo.id, role: "manager", validFrom: "2099-01-01", reason: "futuro" });
    expect((await loadAccess(db, alvo.id)).grantedRoles).toEqual([]);
    await grantPermission(db, actor, { targetEmployeeId: alvo.id, permission: "report.view", validFrom: "2020-01-01", validTo: "2020-12-31", reason: "passado" });
    expect((await loadAccess(db, alvo.id)).permissions.has("report.view")).toBe(false);
    const [e] = await db.select({ status: employee.status }).from(employee).where(eq(employee.id, alvo.id));
    expect(e.status).toBe("active");
  });
});
