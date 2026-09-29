import { Pool } from "pg";

/*
 * Conferência do banco antes de publicar (DEC-45), com o papel da aplicação: fuso, extensão das constraints de exclusão,
 * auditoria só de inserção, papel que não é o dono e, quando informada, a URL do dono apontando para o mesmo banco.
 * Devolve os problemas encontrados; a lista vazia significa banco conforme.
 */
export type DbCheck = { role: string; database: string; timezone: string; problems: string[] };

export async function checkDatabase(appUrl: string, ownerUrl?: string): Promise<DbCheck> {
  const pool = new Pool({ connectionString: appUrl, max: 1 });
  try {
    const r = await pool.query<{ tz: string; me: string; db: string; gist: boolean; audit_write: boolean; owner: boolean }>(`
      select current_setting('TimeZone') as tz, current_user as me, current_database() as db,
             exists (select 1 from pg_extension where extname = 'btree_gist') as gist,
             has_table_privilege('audit_event', 'UPDATE') or has_table_privilege('audit_event', 'DELETE') or has_table_privilege('audit_event', 'TRUNCATE') as audit_write,
             coalesce((select pg_has_role(current_user, oid, 'MEMBER') from pg_roles where rolname = 'rh_owner'), false) as owner`);
    const c = r.rows[0];
    const problems = [
      c.tz !== "America/Sao_Paulo" ? `fuso da sessão da aplicação é ${c.tz}, esperado America/Sao_Paulo (ALTER ROLE e ALTER DATABASE de demo-neon.sql)` : null,
      !c.gist ? "extensão btree_gist ausente" : null,
      c.audit_write ? "o papel da aplicação pode alterar ou apagar a auditoria" : null,
      c.owner ? "a aplicação conecta com o papel dono; DATABASE_URL deve usar o papel rh_app" : null,
    ].filter((p): p is string => !!p);
    if (ownerUrl) {
      const o = new Pool({ connectionString: ownerUrl, max: 1 });
      try {
        const od = (await o.query<{ db: string }>("select current_database() as db")).rows[0].db;
        if (od !== c.db) problems.push(`DATABASE_OWNER_URL aponta para o banco ${od} e DATABASE_URL para ${c.db}`);
      } finally {
        await o.end();
      }
    }
    return { role: c.me, database: c.db, timezone: c.tz, problems };
  } finally {
    await pool.end();
  }
}
