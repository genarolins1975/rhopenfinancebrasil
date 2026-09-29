import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { safeErrorText } from "@/modules/shared/db-errors";

/** Aplica as migrações SQL como papel dono. Nunca roda com o papel da aplicação. */
export async function runMigrations(url = process.env.DATABASE_OWNER_URL): Promise<void> {
  if (!url) throw new Error("DATABASE_OWNER_URL ausente");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: "src/db/migrations" });
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations()
    .then(() => {
      console.log("migrações aplicadas");
      process.exit(0);
    })
    .catch((e) => {
      console.error("falha ao migrar:", safeErrorText(e));
      process.exit(1);
    });
}
