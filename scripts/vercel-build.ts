import "dotenv/config";
import { runMigrations } from "@/db/migrate";
import { checkDatabase } from "@/modules/operations/db-check";
import { safeErrorText } from "@/modules/shared/db-errors";

/*
 * Etapa anterior ao `next build` na Vercel (DEC-45). Só no deploy de produção: aplica as migrações como papel dono
 * (quando DATABASE_OWNER_URL estiver cadastrada), confere o banco com o papel da aplicação e, em APP_ENV=demo, cria os
 * dados de demonstração se o banco estiver vazio. Prévias não tocam o banco. Nada de senha, token, convite ou consulta
 * com parâmetros no log.
 */
async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log("build fora de produção: sem migração nem dados");
    return;
  }
  const appEnv = process.env.APP_ENV;
  if ((appEnv === "demo" || appEnv === "production") && (process.env.CRON_SECRET ?? "").length < 32) {
    throw new Error("CRON_SECRET ausente ou com menos de 32 caracteres: sem ele a rota agendada responde 401 e a outbox não anda (gere com openssl rand -hex 32)");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL ausente");
  const owner = process.env.DATABASE_OWNER_URL;
  if (owner) {
    await runMigrations(owner);
    console.log("migrações aplicadas");
  } else {
    console.log("DATABASE_OWNER_URL ausente: migrações não aplicadas neste deploy (o esquema precisa já estar na versão do código)");
  }
  const check = await checkDatabase(process.env.DATABASE_URL, owner);
  if (check.problems.length) throw new Error(`banco fora do esperado: ${check.problems.join("; ")}`);
  console.log(`banco conferido: papel ${check.role}, banco ${check.database}, fuso ${check.timezone}, btree_gist presente, auditoria só de inserção`);
  if (appEnv === "demo") {
    const { seedDemo } = await import("./demo-seed");
    const r = await seedDemo();
    console.log(r.skipped ? `dados de demonstração não criados: ${r.reason}` : `dados de demonstração criados: ${r.accounts.length} contas, ${r.bookings} reservas`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("falha na preparação do deploy:", safeErrorText(e));
    process.exit(1);
  });
