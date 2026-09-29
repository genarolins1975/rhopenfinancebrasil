import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/modules/shared/env";
import * as schema from "./schema";

declare global {
  var __rhPool: Pool | undefined;
}

/** Pool único por processo; em desenvolvimento sobrevive ao hot reload. */
function pool(): Pool {
  if (!globalThis.__rhPool) {
    globalThis.__rhPool = new Pool({
      connectionString: env().DATABASE_URL,
      max: 10,
      // Cada sessão informa o fuso; o papel de banco também o fixa. Defesa em profundidade.
      options: "-c timezone=America/Sao_Paulo",
    });
  }
  return globalThis.__rhPool;
}

export const db = drizzle({ client: pool(), schema, casing: "snake_case" });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
