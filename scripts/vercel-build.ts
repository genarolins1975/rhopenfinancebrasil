import "dotenv/config";
import { runMigrations } from "@/db/migrate";
import { checkDatabase } from "@/modules/operations/db-check";
import { dbUrlProblem, maskDbUrl } from "@/modules/operations/db-url";
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
  // Variável Secret não pode ser lida de volta: URL fora do formato é apontada aqui, com toda senha mascarada.
  for (const [name, user] of [["DATABASE_URL", "rh_app"], ["DATABASE_OWNER_URL", "rh_owner"]] as const) {
    const value = process.env[name];
    const problem = value === undefined ? null : dbUrlProblem(value, appEnv === "demo" ? user : undefined);
    if (problem) throw new Error(`${name} fora do formato (${problem}). Valor com senhas mascaradas: ${maskDbUrl(value!)}`);
  }
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
    const { resetDemoAdmin } = await import("./demo-admin-reset");
    const reset = await resetDemoAdmin();
    console.log(reset.changed ? `administração ${reset.email}: ${reset.passwordChanged ? "senha redefinida" : "senha mantida"}; segundo fator e sessões zerados` : `senha da administração não alterada: ${reset.reason}`);
    const { mfaWaived } = await import("@/modules/shared/env");
    console.log(mfaWaived() ? "segundo fator dispensado para perfis privilegiados (DEMO_MFA_OPTIONAL=on, DEC-46)" : "segundo fator obrigatório para perfis privilegiados (PAR-33)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("falha na preparação do deploy:", safeErrorText(e));
    process.exit(1);
  });
