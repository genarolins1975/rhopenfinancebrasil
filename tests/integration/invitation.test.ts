import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvent, authAccount, authUser, employee, invitation, outboxEvent } from "@/db/schema";
import { acceptInvitation, createInvitation, lookupInvitation } from "@/modules/identity/invitations";
import { resetDb, seedEmployee } from "./helpers";

const SENHA = "correto cavalo bateria grampo";

describe("convite individual, expirável e de uso único", () => {
  beforeEach(resetDb);

  it("cria convite com hash, enfileira email e aceita uma única vez", async () => {
    const rh = await seedEmployee({ roles: ["hr"] });
    const alvo = await seedEmployee({ status: "invited" });
    const inv = await db.transaction((tx) => createInvitation(tx, { employeeId: rh.id, userId: "u-rh" }, alvo.id));
    expect(inv.url).toContain("/convite/");
    const [row] = await db.select().from(invitation).where(eq(invitation.employeeId, alvo.id));
    expect(row.tokenHash).not.toContain(inv.token);
    const [ev] = await db.select().from(outboxEvent).where(eq(outboxEvent.eventType, "email.invitation"));
    expect(ev).toBeDefined();
    expect(JSON.stringify(ev.payload)).toContain(inv.token);

    const look = await lookupInvitation(db, inv.token);
    expect(look.ok).toBe(true);
    await acceptInvitation(db, inv.token, SENHA);
    const [emp] = await db.select().from(employee).where(eq(employee.id, alvo.id));
    expect(emp.status).toBe("active");
    expect(emp.userId).toBeTruthy();
    const [user] = await db.select().from(authUser).where(eq(authUser.id, emp.userId!));
    expect(user.emailVerified).toBe(true);
    const [acc] = await db.select().from(authAccount).where(eq(authAccount.userId, emp.userId!));
    expect(acc.providerId).toBe("credential");
    expect(acc.password?.startsWith("$argon2id$")).toBe(true);

    // uso único
    await expect(acceptInvitation(db, inv.token, SENHA)).rejects.toThrow(/Convite inválido/);
    expect((await lookupInvitation(db, inv.token)).ok).toBe(false);
    const audits = await db.select().from(auditEvent);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["invitation.created", "invitation.accepted"]));
  });

  it("convite expirado, revogado ou de pessoa já ativa é inválido com a mesma resposta", async () => {
    const rh = await seedEmployee({ roles: ["hr"] });
    const a = await seedEmployee({ status: "invited" });
    const inv = await db.transaction((tx) => createInvitation(tx, { employeeId: rh.id, userId: "u" }, a.id));
    await db.update(invitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitation.employeeId, a.id));
    expect((await lookupInvitation(db, inv.token)).ok).toBe(false);
    await expect(acceptInvitation(db, inv.token, SENHA)).rejects.toThrow(/Convite inválido/);

    const b = await seedEmployee({ status: "invited" });
    const inv2 = await db.transaction((tx) => createInvitation(tx, { employeeId: rh.id, userId: "u" }, b.id));
    await db.update(invitation).set({ revokedAt: new Date() }).where(eq(invitation.employeeId, b.id));
    expect((await lookupInvitation(db, inv2.token)).ok).toBe(false);

    expect((await lookupInvitation(db, "token-inexistente-com-tamanho-suficiente")).ok).toBe(false);
    expect((await lookupInvitation(db, "curto")).ok).toBe(false);
  });

  it("novo convite revoga o anterior; só um ativo por pessoa", async () => {
    const rh = await seedEmployee({ roles: ["hr"] });
    const a = await seedEmployee({ status: "invited" });
    const inv1 = await db.transaction((tx) => createInvitation(tx, { employeeId: rh.id, userId: "u" }, a.id));
    const inv2 = await db.transaction((tx) => createInvitation(tx, { employeeId: rh.id, userId: "u" }, a.id));
    expect((await lookupInvitation(db, inv1.token)).ok).toBe(false);
    expect((await lookupInvitation(db, inv2.token)).ok).toBe(true);
  });

  it("rejeita senha fora da política sem criar identidade", async () => {
    const rh = await seedEmployee({ roles: ["hr"] });
    const a = await seedEmployee({ status: "invited" });
    const inv = await db.transaction((tx) => createInvitation(tx, { employeeId: rh.id, userId: "u" }, a.id));
    await expect(acceptInvitation(db, inv.token, "curta")).rejects.toThrow(/15 caracteres/);
    expect(await db.select().from(authUser)).toHaveLength(0);
    expect((await lookupInvitation(db, inv.token)).ok).toBe(true);
  });

  it("não convida pessoa ativa nem com acesso definido", async () => {
    const rh = await seedEmployee({ roles: ["hr"] });
    const ativa = await seedEmployee({ status: "active" });
    await expect(db.transaction((tx) => createInvitation(tx, { employeeId: rh.id, userId: "u" }, ativa.id))).rejects.toThrow(/Só pessoas convidadas/);
  });
});
