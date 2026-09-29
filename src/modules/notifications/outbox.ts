import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { outboxEvent } from "@/db/schema";
import { logger, scrub, scrubCpf } from "@/modules/shared/logger";

export type OutboxInput = {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

export type OutboxEvent = typeof outboxEvent.$inferSelect;
export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

const MAX_ATTEMPTS = 10;

/** Enfileira na mesma transação da operação de negócio. Chave repetida não duplica. */
export async function enqueueOutbox(tx: DbOrTx, input: OutboxInput): Promise<void> {
  await tx
    .insert(outboxEvent)
    .values({
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: scrubCpf(input.payload) as Record<string, unknown>,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: outboxEvent.idempotencyKey });
}

function backoffSeconds(attempt: number): number {
  return Math.min(3600, 15 * 2 ** Math.max(0, attempt - 1));
}

/**
 * Processa um lote de eventos pendentes com `for update skip locked`, o que permite
 * vários workers sem entrega duplicada. Falha registra erro e reagenda; após o limite, marca failed.
 */
export async function processOutboxBatch(db: Db, handlers: Record<string, OutboxHandler>, limit = 20): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outboxEvent)
      .where(and(eq(outboxEvent.status, "pending"), lte(outboxEvent.nextAttemptAt, sql`now()`)))
      .orderBy(asc(outboxEvent.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const row of rows) {
      const handler = handlers[row.eventType];
      try {
        if (!handler) throw new Error(`sem handler para ${row.eventType}`);
        await handler(row);
        await tx
          .update(outboxEvent)
          .set({ status: "delivered", deliveredAt: new Date(), attempts: row.attempts + 1, lastError: null })
          .where(eq(outboxEvent.id, row.id));
      } catch (e) {
        const attempts = row.attempts + 1;
        const message = scrub(e instanceof Error ? e.message : String(e)) as string;
        logger.warn({ eventId: row.id, eventType: row.eventType, attempts, err: message }, "falha na entrega da outbox");
        await tx
          .update(outboxEvent)
          .set({
            attempts,
            lastError: message.slice(0, 500),
            status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
            nextAttemptAt: new Date(Date.now() + backoffSeconds(attempts) * 1000),
          })
          .where(eq(outboxEvent.id, row.id));
      }
    }
    return rows.length;
  });
}
