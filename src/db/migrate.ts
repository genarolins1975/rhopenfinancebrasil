import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Aplica as migrações SQL como papel dono. Nunca roda com o papel da aplicação. */
async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL ausente");
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle({ client: pool });
  await migrate(db, { migrationsFolder: "src/db/migrations" });
  await pool.end();
  console.log("migrações aplicadas");
}

main().catch((e) => {
  console.error("falha ao migrar:", e instanceof Error ? e.message : e);
  process.exit(1);
});
