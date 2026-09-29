import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env.test", override: true });

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;

/** Ponta a ponta contra build de produção com o banco de teste. Nunca contra produção. */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    // Ambientes com Chromium pré-instalado informam o binário; sem a variável, o Playwright usa o próprio download.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "celular", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `${BASE}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, APP_BASE_URL: BASE, BETTER_AUTH_URL: BASE, PORT: String(PORT) } as Record<string, string>,
  },
});
