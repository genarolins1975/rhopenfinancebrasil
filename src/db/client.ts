import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/modules/shared/env";
import { logger } from "@/modules/shared/logger";
import * as schema from "./schema";

declare global {
  var __rhPool: Pool | undefined;
}

/** Pool único por processo; em desenvolvimento sobrevive ao hot reload. */
function pool(): Pool {
  if (!globalThis.__rhPool) {
    globalThis.__rhPool = new Pool({
      connectionString: env().DATABASE_URL,
      max: env().DATABASE_POOL_MAX,
      // Cada sessão informa o fuso; o papel e o banco também o fixam. Defesa em profundidade.
      ...(env().DATABASE_TZ_OPTION === "on" ? { options: "-c timezone=America/Sao_Paulo" } : {}),
    });
    // Conexão ociosa encerrada pelo servidor (reinício, suspensão do compute, recriação do banco): o pool descarta o
    // cliente; sem este ouvinte, o evento derrubaria o processo. Só o código do erro vai para o log.
    globalThis.__rhPool.on("error", (e) => logger.warn({ code: (e as { code?: string }).code ?? null }, "conexão ociosa do banco encerrada"));
  }
  return globalThis.__rhPool;
}

export const db = drizzle({ client: pool(), schema, casing: "snake_case" });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
