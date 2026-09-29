import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { invitation, outboxEvent } from "@/db/schema";
import { getEmailSender, memoryMailbox, resetEmailSenderForTests } from "@/modules/notifications/email";
import { outboxHandlers } from "@/modules/notifications/handlers";
import { enqueueOutbox, processOutboxBatch } from "@/modules/notifications/outbox";
import { resetDb } from "./helpers";

describe("outbox de notificações", () => {
  beforeEach(async () => {
    await resetDb();
    resetEmailSenderForTests();
  });

  it("NOT-01: entrega idempotente; falha reagenda com backoff e não perde o evento", async () => {
    const msg = { to: "a@teste.invalid", subject: "Teste", text: "corpo 12345678901" };
    await enqueueOutbox(db, { eventType: "email.password_reset", aggregateType: "t", aggregateId: "1", payload: { message: msg }, idempotencyKey: "k1" });
    await enqueueOutbox(db, { eventType: "email.password_reset", aggregateType: "t", aggregateId: "1", payload: { message: msg }, idempotencyKey: "k1" });
    expect(await db.select().from(outboxEvent)).toHaveLength(1);
    const [stored] = await db.select().from(outboxEvent);
    expect(JSON.stringify(stored.payload)).not.toContain("12345678901");

    const n = await processOutboxBatch(db, outboxHandlers());
    expect(n).toBe(1);
    expect(memoryMailbox).toHaveLength(1);
    const [done] = await db.select().from(outboxEvent);
    expect(done.status).toBe("delivered");
    // carga entregue não fica no banco
    expect(done.payload).toEqual({ redacted: true });
    expect(JSON.stringify(done)).not.toContain("corpo");
    expect(await processOutboxBatch(db, outboxHandlers())).toBe(0);

    await enqueueOutbox(db, { eventType: "sem.handler", aggregateType: "t", aggregateId: "2", payload: {}, idempotencyKey: "k2" });
    await processOutboxBatch(db, outboxHandlers());
    const [failed] = await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, "k2"));
    expect(failed.status).toBe("pending");
    expect(failed.attempts).toBe(1);
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(failed.lastError).toMatch(/sem handler/);
  });

  it("entrega esgotada marca o convite como falho, visível para quem gere o cadastro", async () => {
    const { seedEmployee } = await import("./helpers");
    const { createInvitation } = await import("@/modules/identity/invitations");
    const { outboxExhaustedHandlers } = await import("@/modules/notifications/handlers");
    const pessoa = await seedEmployee({ status: "invited", email: "entrega-falha@teste.invalid" });
    await createInvitation(db, { employeeId: pessoa.id, userId: null }, pessoa.id);
    const quebrado = { "email.invitation": async () => { throw new Error("smtp fora"); } };
    for (let i = 0; i < 10; i++) {
      await db.update(outboxEvent).set({ nextAttemptAt: new Date(Date.now() - 1000) });
      await processOutboxBatch(db, quebrado, 20, outboxExhaustedHandlers());
    }
    const [row] = await db.select({ deliveryStatus: invitation.deliveryStatus, sentAt: invitation.sentAt }).from(invitation).where(eq(invitation.employeeId, pessoa.id));
    expect(row).toEqual({ deliveryStatus: "failed", sentAt: null });
    const [ev] = await db.select().from(outboxEvent);
    expect(ev.status).toBe("failed");
    expect(ev.attempts).toBe(10);
    expect(ev.payload).toEqual({ redacted: true });
  });

  it("lista de destinatários permitidos bloqueia envios fora dela", async () => {
    process.env.EMAIL_ALLOWLIST = "permitido@teste.invalid";
    const { env } = await import("@/modules/shared/env");
    const cached = env();
    const original = cached.EMAIL_ALLOWLIST;
    cached.EMAIL_ALLOWLIST = "permitido@teste.invalid";
    try {
      const sender = getEmailSender();
      const blocked = await sender.send({ to: "outro@teste.invalid", subject: "x", text: "y" });
      expect(blocked.id).toBe("blocked-by-allowlist");
      const ok = await sender.send({ to: "permitido@teste.invalid", subject: "x", text: "y" });
      expect(ok.id).not.toBe("blocked-by-allowlist");
      // convite para destinatário fora da lista: outbox e convite ficam como bloqueados, carga apagada, sem "enviado"
      const { seedEmployee } = await import("./helpers");
      const { createInvitation } = await import("@/modules/identity/invitations");
      const fora = await seedEmployee({ status: "invited", email: "fora-da-lista@teste.invalid" });
      await createInvitation(db, { employeeId: fora.id, userId: null }, fora.id);
      await processOutboxBatch(db, outboxHandlers());
      const [row] = await db.select({ id: invitation.id, deliveryStatus: invitation.deliveryStatus, sentAt: invitation.sentAt }).from(invitation).where(eq(invitation.employeeId, fora.id));
      expect(row.deliveryStatus).toBe("blocked");
      expect(row.sentAt).toBeNull();
      const [ev] = await db.select().from(outboxEvent).where(eq(outboxEvent.aggregateId, row.id));
      expect(ev.status).toBe("blocked");
      expect(ev.payload).toEqual({ redacted: true });
    } finally {
      cached.EMAIL_ALLOWLIST = original;
      delete process.env.EMAIL_ALLOWLIST;
    }
  });
});
