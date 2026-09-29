import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { resetDb } from "./helpers";

/** DB-01: extensões, funções de dia local, fuso por sessão e proteção da auditoria. */
describe("banco: fundação", () => {
  beforeAll(resetDb);

  it("tem citext e btree_gist", async () => {
    const r = await db.execute(sql`select extname from pg_extension where extname in ('citext','btree_gist') order by 1`);
    expect(r.rows.map((x) => x.extname)).toEqual(["btree_gist", "citext"]);
  });

  it("sessão em America/Sao_Paulo e local_today coerente", async () => {
    const tz = await db.execute(sql`show timezone`);
    expect((tz.rows[0] as { TimeZone: string }).TimeZone).toBe("America/Sao_Paulo");
    const r = await db.execute(sql`select local_today() as d, (now() at time zone 'America/Sao_Paulo')::date as e`);
    expect(String((r.rows[0] as { d: string }).d)).toBe(String((r.rows[0] as { e: string }).e));
  });

  it("local_day_range cobre o dia local inteiro, mesmo em sessão UTC", async () => {
    await db.execute(sql`set local timezone to 'UTC'`);
    const r = await db.execute(sql`select lower(local_day_range('2026-09-30'::date)) as a, upper(local_day_range('2026-09-30'::date)) as b`);
    const row = r.rows[0] as { a: Date; b: Date };
    expect(new Date(row.a).toISOString()).toBe("2026-09-30T03:00:00.000Z");
    expect(new Date(row.b).toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });

  it("papel da aplicação não altera nem apaga auditoria", async () => {
    await db.execute(sql`insert into audit_event (action, entity_type) values ('teste', 'x')`);
    const denied = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === "42501";
    await expect(db.execute(sql`update audit_event set action = 'y'`)).rejects.toSatisfy(denied);
    await expect(db.execute(sql`delete from audit_event`)).rejects.toSatisfy(denied);
  });

  it("perfis e permissões semeados batem com o catálogo", async () => {
    const { PERMISSIONS, ROLE_PERMISSIONS } = await import("@/modules/access/permissions");
    const p = await db.execute(sql`select count(*)::int as n from permission`);
    expect((p.rows[0] as { n: number }).n).toBe(Object.keys(PERMISSIONS).length);
    const rp = await db.execute(sql`select count(*)::int as n from role_permission`);
    expect((rp.rows[0] as { n: number }).n).toBe(Object.values(ROLE_PERMISSIONS).reduce((a, b) => a + b.length, 0));
  });
});
