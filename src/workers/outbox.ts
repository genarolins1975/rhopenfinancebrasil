import "dotenv/config";
import { db } from "@/db/client";
import { drainOutbox, runOfficeSweep } from "@/modules/operations/cycle";
import { logger } from "@/modules/shared/logger";

/** Worker de entrega: consome a outbox a cada 5 segundos e roda as varreduras do escritório a cada minuto. Vários processos podem rodar em paralelo. */
const INTERVAL_MS = Number(process.env.OUTBOX_INTERVAL_MS ?? 5000);
/** Varreduras do escritório (DEC-27): conveniência; a correção não depende delas (DIR-034). */
const SWEEP_MS = Number(process.env.OFFICE_SWEEP_INTERVAL_MS ?? 60_000);
let running = true;
let lastSweep = 0;

async function loop() {
  logger.info("worker da outbox iniciado");
  while (running) {
    try {
      if (Date.now() - lastSweep >= SWEEP_MS) {
        lastSweep = Date.now();
        await runOfficeSweep(db).catch((e) => logger.error({ err: e instanceof Error ? e.message : String(e) }, "erro na varredura do escritório"));
      }
      const n = await drainOutbox(db, 1);
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
