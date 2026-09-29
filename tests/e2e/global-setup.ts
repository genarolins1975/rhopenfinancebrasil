import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

/**
 * Prepara o banco de teste com pessoas de exemplo (sintéticas) e grava os dados de acesso em arquivo local.
 * Roda como processo separado para não carregar o app no runner do Playwright.
 */
export default async function globalSetup() {
  config({ path: ".env.test", override: true });
  const r = spawnSync("pnpm", ["exec", "tsx", "tests/e2e/seed.ts"], { stdio: "inherit", env: { ...process.env, APP_BASE_URL: "http://localhost:3100" } });
  if (r.status !== 0) throw new Error("seed do ponta a ponta falhou");
  writeFileSync(".e2e-ready", String(Date.now()));
}
