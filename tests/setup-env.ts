import { config } from "dotenv";
// TEST_ENV_FILE permite bancos de teste isolados para execuções paralelas (revisão independente); padrão .env.test.
config({ path: process.env.TEST_ENV_FILE ?? ".env.test", override: true });
