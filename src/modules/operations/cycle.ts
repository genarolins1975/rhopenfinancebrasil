import type { Db } from "@/db/client";
import { outboxExhaustedHandlers, outboxHandlers } from "@/modules/notifications/handlers";
import { processOutboxBatch } from "@/modules/notifications/outbox";
import { logger } from "@/modules/shared/logger";

/*
 * Ciclo de operação: entrega da outbox e varreduras do escritório (DEC-27). Usado pelo processo de fundo
 * (`pnpm worker:outbox`) e pela rota agendada (`/api/cron/operacao`, DEC-45). A correção das reservas não depende dele
 * (DIR-034): ele só entrega avisos e adianta o que a próxima escrita faria.
 */

export type SweepResult = { expired: number; offered: number; past: number; released: number };

/** Varreduras do escritório: ofertas vencidas, mesas livres com fila, inscrições de datas passadas, liberação por falta de confirmação. */
export async function runOfficeSweep(db: Db): Promise<SweepResult> {
  const { runWaitlistSweep } = await import("@/modules/waitlist/service");
  const { releaseUnconfirmed } = await import("@/modules/checkin/service");
  const queue = await runWaitlistSweep(db);
  const released = await releaseUnconfirmed(db);
  if (queue.expired || queue.offered || queue.past || released) logger.info({ ...queue, released }, "varredura do escritório");
  return { ...queue, released };
}

/** Entrega até `maxBatches` lotes da outbox; para quando não há mais pendência. Devolve quantos eventos foram tratados. */
export async function drainOutbox(db: Db, maxBatches = 5, batchSize = 20): Promise<number> {
  const handlers = outboxHandlers();
  const exhausted = outboxExhaustedHandlers();
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const n = await processOutboxBatch(db, handlers, batchSize, exhausted);
    total += n;
    if (n === 0) break;
  }
  return total;
}
