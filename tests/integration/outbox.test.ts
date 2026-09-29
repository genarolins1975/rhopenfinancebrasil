import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { outboxEvent } from "@/db/schema";
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
    await enqueueOutbox(db, { eventType: "email.invitation", aggregateType: "t", aggregateId: "1", payload: { message: msg }, idempotencyKey: "k1" });
    await enqueueOutbox(db, { eventType: "email.invitation", aggregateType: "t", aggregateId: "1", payload: { message: msg }, idempotencyKey: "k1" });
    expect(await db.select().from(outboxEvent)).toHaveLength(1);
    const [stored] = await db.select().from(outboxEvent);
    expect(JSON.stringify(stored.payload)).not.toContain("12345678901");

    const n = await processOutboxBatch(db, outboxHandlers());
    expect(n).toBe(1);
    expect(memoryMailbox).toHaveLength(1);
    const [done] = await db.select().from(outboxEvent);
    expect(done.status).toBe("delivered");
    expect(await processOutboxBatch(db, outboxHandlers())).toBe(0);

    await enqueueOutbox(db, { eventType: "sem.handler", aggregateType: "t", aggregateId: "2", payload: {}, idempotencyKey: "k2" });
    await processOutboxBatch(db, outboxHandlers());
    const [failed] = await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, "k2"));
    expect(failed.status).toBe("pending");
    expect(failed.attempts).toBe(1);
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(failed.lastError).toMatch(/sem handler/);
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
    } finally {
      cached.EMAIL_ALLOWLIST = original;
      delete process.env.EMAIL_ALLOWLIST;
    }
  });
});
