import "dotenv/config";
import { db } from "@/db/client";
import { outboxExhaustedHandlers, outboxHandlers } from "@/modules/notifications/handlers";
import { processOutboxBatch } from "@/modules/notifications/outbox";
import { logger } from "@/modules/shared/logger";

/** Worker de entrega: consome a outbox a cada 5 segundos. Vários processos podem rodar em paralelo. */
const INTERVAL_MS = Number(process.env.OUTBOX_INTERVAL_MS ?? 5000);
let running = true;

async function loop() {
  const handlers = outboxHandlers();
  const exhausted = outboxExhaustedHandlers();
  logger.info("worker da outbox iniciado");
  while (running) {
    try {
      const n = await processOutboxBatch(db, handlers, 20, exhausted);
      if (n === 0) await new Promise((r) => setTimeout(r, INTERVAL_MS));
    } catch (e) {
      logger.error({ err: e instanceof Error ? e.message : String(e) }, "erro no ciclo da outbox");
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }
  logger.info("worker da outbox encerrado");
}

process.on("SIGINT", () => (running = false));
process.on("SIGTERM", () => (running = false));
loop().then(() => process.exit(0));
