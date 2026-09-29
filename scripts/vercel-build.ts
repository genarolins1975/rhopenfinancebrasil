import "dotenv/config";
import { Pool } from "pg";
import { runMigrations } from "@/db/migrate";

/*
 * Etapa anterior ao `next build` na Vercel (DEC-45). Só no deploy de produção: aplica as migrações como papel dono,
 * confere o banco com o papel da aplicação e, em APP_ENV=demo, cria os dados de demonstração se o banco estiver vazio.
 * Prévias de branch não tocam o banco (o vercel.json nem as constrói). Nada de senha, token ou convite no log.
 */
async function checkDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const r = await pool.query<{ tz: string; me: string; gist: boolean; audit_delete: boolean; owner: boolean }>(`
      select current_setting('TimeZone') as tz, current_user as me,
             exists (select 1 from pg_extension where extname = 'btree_gist') as gist,
             has_table_privilege('audit_event', 'DELETE') as audit_delete,
             coalesce((select pg_has_role(current_user, oid, 'MEMBER') from pg_roles where rolname = 'rh_owner'), false) as owner`);
    const c = r.rows[0];
    const problems = [
      c.tz !== "America/Sao_Paulo" ? `fuso da sessão da aplicação é ${c.tz}, esperado America/Sao_Paulo` : null,
      !c.gist ? "extensão btree_gist ausente" : null,
      c.audit_delete ? "papel da aplicação pode apagar auditoria" : null,
      c.owner ? "a aplicação conecta com o papel dono; use o papel rh_app" : null,
    ].filter(Boolean);
    if (problems.length) throw new Error(`banco fora do esperado: ${problems.join("; ")}`);
    console.log(`banco conferido: papel ${c.me}, fuso ${c.tz}, btree_gist presente, auditoria só de inserção`);
  } finally {
    await pool.end();
  }
}

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log("build fora de produção: sem migração nem dados");
    return;
  }
  await runMigrations();
  console.log("migrações aplicadas");
  await checkDatabase();
  if (process.env.APP_ENV === "demo") {
    const { seedDemo } = await import("./demo-seed");
    const r = await seedDemo();
    console.log(r.skipped ? `dados de demonstração não criados: ${r.reason}` : `dados de demonstração criados: ${r.accounts.length} contas, ${r.bookings} reservas`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("falha na preparação do deploy:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
