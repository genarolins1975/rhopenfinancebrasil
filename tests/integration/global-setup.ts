import { spawnSync } from "node:child_process";
import { config } from "dotenv";

/** Aplica as migrações no banco de teste antes da bateria de integração. */
export default function globalSetup() {
  config({ path: ".env.test", override: true });
  const r = spawnSync("pnpm", ["exec", "tsx", "src/db/migrate.ts"], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error("migração do banco de teste falhou");
}
