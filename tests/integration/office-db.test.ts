import { Pool } from "pg";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { accessException, accessGroupMember, deskBooking, exclusiveAssignment, officeCalendar, resourceStatusPeriod } from "@/db/schema";
import { addDays, localToday } from "@/modules/shared/dates";
import { ELIGIBILITY_CASES } from "../unit/availability.test";
import { directorsGroupId, resetDb, seedDesk, seedEmployee } from "./helpers";

/*
 * Verificações no nível do banco: funções compartilhadas, constraints de exclusão, triggers de validação,
 * verificação deferida e lock imposto por trigger (DB-01, DIR-031-T1, DIR-036-T3, DIR-017-T3, DIR-024-T2).
 */

const today = localToday();
const d = (n: number) => addDays(today, n);
const rawPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
afterAll(() => rawPool.end());

/** Mensagem da regra do banco por trás do erro do driver (Drizzle envolve o erro do pg em `cause`). */
const rule = (p: Promise<unknown>) => p.then(() => "ok").catch((e) => String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message));

async function raw<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const r = await rawPool.query(q, params);
  return r.rows as T[];
}

describe("funções do escritório", () => {
  beforeEach(resetDb);

  it("DIR-031-T1: a tabela de casos da elegibilidade produz o mesmo resultado no SQL e no serviço", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const other = await seedEmployee();
    const member = await seedEmployee({ orgCondition: "director" });
    const ids: Record<string, string> = {
      "11111111-1111-4111-8111-111111111111": holder.id,
      "22222222-2222-4222-8222-222222222222": other.id,
      "33333333-3333-4333-8333-333333333333": member.id,
    };
    const group = await directorsGroupId();
    await db.insert(accessGroupMember).values({ groupId: group, employeeId: member.id, validFrom: today, reason: "teste" });
    for (const c of ELIGIBILITY_CASES) {
      const desk = await seedDesk();
      const a = c.policy.assignment;
      if (a) {
        const [row] = await db
          .insert(exclusiveAssignment)
          .values({ resourceId: desk.id, mode: a.mode, holderEmployeeId: a.mode === "individual" ? holder.id : null, accessGroupId: a.mode === "group" ? group : null, validFrom: today, needsReview: a.needsReview, reason: "teste", responsible: "RH" })
          .returning({ id: exclusiveAssignment.id });
        const x = c.policy.exception;
        if (x) {
          await db.insert(accessException).values({ assignmentId: row.id, resourceId: desk.id, kind: x.kind, beneficiaryEmployeeId: x.beneficiaryEmployeeId ? ids[x.beneficiaryEmployeeId] : null, startsOn: today, endsOn: d(3), reason: "teste" });
        }
      }
      const [r] = await raw<{ ok: boolean }>("select is_eligible($1::uuid, $2::uuid, $3::date) as ok", [ids[c.person], desk.id, today]);
      expect(r.ok, c.name).toBe(c.expected);
    }
  });

  it("desk_class e resource_unavailable_reason seguem a mesma ordem do serviço", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const desk = await seedDesk();
    const cls = async () => (await raw<{ c: string }>("select desk_class($1::uuid, $2::date) as c", [desk.id, d(1)]))[0].c;
    expect(await cls()).toBe("shared");
    const [a] = await db.insert(exclusiveAssignment).values({ resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    expect(await cls()).toBe("exclusive");
    await db.insert(accessException).values({ assignmentId: a.id, resourceId: desk.id, kind: "release_to_shared", startsOn: d(1), endsOn: d(1), reason: "t" });
    expect(await cls()).toBe("shared");
    await db.insert(resourceStatusPeriod).values({ resourceId: desk.id, status: "admin_block", startsOn: d(1), endsOn: d(2), reason: "t" });
    expect(await cls()).toBe("blocked");
    await db.insert(resourceStatusPeriod).values({ resourceId: desk.id, status: "maintenance", startsOn: d(1), endsOn: null, reason: "t" });
    expect(await cls()).toBe("maintenance");
    // liberação do período no dia seguinte: a mesa volta pela vigência, sem job (DIR-013 análogo)
    await db.update(resourceStatusPeriod).set({ releasedOn: d(1) }).where(eq(resourceStatusPeriod.status, "maintenance"));
    expect(await cls()).toBe("blocked");
  });

  it("booking_window_open: quinta 10h local abre a semana seguinte; sábado à noite em UTC ainda é sexta local", async () => {
    // parâmetros padrão do produto (PAR-01); o reset do banco de teste usa segunda às 00:00
    await raw("update office_settings set value = case key when 'booking_open_weekday' then '4'::jsonb when 'booking_open_time' then '\"10:00\"'::jsonb else value end");
    // 2026-10-08 é quinta. 09:59 local (12:59Z) fechada; 10:00 local aberta; passado fechado.
    const q = (date: string, now: string) => raw<{ ok: boolean }>("select booking_window_open($1::date, $2::timestamptz) as ok", [date, now]).then((r) => r[0].ok);
    expect(await q("2026-10-12", "2026-10-08T12:59:00Z")).toBe(false);
    expect(await q("2026-10-12", "2026-10-08T13:00:00Z")).toBe(true);
    expect(await q("2026-10-09", "2026-10-08T13:00:00Z")).toBe(true);
    expect(await q("2026-10-07", "2026-10-08T13:00:00Z")).toBe(false);
    // 2026-10-10 02:30Z é sexta 23:30 local: a própria sexta ainda é hoje e está aberta
    expect(await q("2026-10-09", "2026-10-10T02:30:00Z")).toBe(true);
    expect(await q("2026-10-19", "2026-10-09T13:00:00Z")).toBe(false);
  });

  it("local_day_range e local_dates_of cobrem a virada de dia de Brasília (DIR-029)", async () => {
    const [r] = await raw<{ lo: string; hi: string; n: number }>("select lower(local_day_range('2026-10-08'::date))::text as lo, upper(local_day_range('2026-10-08'::date))::text as hi, (select count(*) from local_dates_of(tstzrange('2026-10-08T22:00:00-03', '2026-10-09T01:00:00-03', '[)')))::int as n");
    expect(r.lo).toMatch(/^2026-10-08 00:00:00-03/);
    expect(r.hi).toMatch(/^2026-10-09 00:00:00-03/);
    expect(r.n).toBe(2);
  });
});

describe("constraints e triggers de exclusividade", () => {
  beforeEach(resetDb);

  it("DIR-023: uma reserva ativa por mesa e dia e por pessoa e dia; expirada e cancelada não contam", async () => {
    const a = await seedEmployee();
    const b = await seedEmployee();
    const desk = await seedDesk();
    const desk2 = await seedDesk();
    const ins = (emp: string, res: string, status: "confirmed" | "held" | "cancelled" | "expired" = "confirmed") =>
      db.insert(deskBooking).values({ resourceId: res, employeeId: emp, bookingDate: d(1), status, origin: "self", actorEmployeeId: emp, holdExpiresAt: status === "held" || status === "expired" ? new Date(Date.now() + 60_000) : null });
    await ins(a.id, desk.id);
    await expect(ins(b.id, desk.id)).rejects.toMatchObject({ cause: { code: "23505" } });
    await expect(ins(a.id, desk2.id)).rejects.toMatchObject({ cause: { code: "23505" } });
    await ins(b.id, desk2.id, "cancelled");
    await ins(b.id, desk2.id, "expired");
    await ins(b.id, desk2.id, "confirmed");
  });

  it("exclusão de sobreposição: uma atribuição por mesa e período; anulada fica de fora; exceções e períodos idem", async () => {
    const h1 = await seedEmployee({ orgCondition: "director" });
    const h2 = await seedEmployee({ orgCondition: "director" });
    const desk = await seedDesk();
    const [a1] = await db.insert(exclusiveAssignment).values({ resourceId: desk.id, mode: "individual", holderEmployeeId: h1.id, validFrom: d(1), validTo: d(10), reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    await expect(db.insert(exclusiveAssignment).values({ resourceId: desk.id, mode: "individual", holderEmployeeId: h2.id, validFrom: d(5), reason: "t", responsible: "RH" })).rejects.toMatchObject({ cause: { code: "23P01" } });
    await db.update(exclusiveAssignment).set({ cancelledAt: new Date(), cancelledBy: h1.id, cancelReason: "t" }).where(eq(exclusiveAssignment.id, a1.id));
    const [a2] = await db.insert(exclusiveAssignment).values({ resourceId: desk.id, mode: "individual", holderEmployeeId: h2.id, validFrom: d(5), reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    await db.insert(accessException).values({ assignmentId: a2.id, resourceId: desk.id, kind: "release_to_shared", startsOn: d(6), endsOn: d(8), reason: "t" });
    await expect(db.insert(accessException).values({ assignmentId: a2.id, resourceId: desk.id, kind: "release_to_shared", startsOn: d(8), endsOn: d(9), reason: "t" })).rejects.toMatchObject({ cause: { code: "23P01" } });
    await db.insert(resourceStatusPeriod).values({ resourceId: desk.id, status: "maintenance", startsOn: d(1), endsOn: d(3), reason: "t" });
    await expect(db.insert(resourceStatusPeriod).values({ resourceId: desk.id, status: "maintenance", startsOn: d(3), endsOn: d(4), reason: "t" })).rejects.toMatchObject({ cause: { code: "23P01" } });
    // liberado no próprio dia de início: vigência vazia, não colide
    await db.insert(resourceStatusPeriod).values({ resourceId: desk.id, status: "admin_block", startsOn: d(1), endsOn: null, releasedOn: d(1), reason: "t" });
    await db.insert(resourceStatusPeriod).values({ resourceId: desk.id, status: "admin_block", startsOn: d(1), endsOn: d(2), reason: "t" });
  });

  it("DIR-036-T3: vigência da atribuição: passado, reabrir, mover início, anular iniciada e linha encerrada congelada", async () => {
    const h = await seedEmployee({ orgCondition: "director" });
    const desk = await seedDesk();
    const msg = async (p: Promise<unknown>) => {
      try {
        await p;
        return "ok";
      } catch (e) {
        return String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message);
      }
    };
    expect(await msg(db.insert(exclusiveAssignment).values({ resourceId: desk.id, mode: "individual", holderEmployeeId: h.id, validFrom: d(-1), reason: "t", responsible: "RH" }))).toBe("assignment_starts_in_past");
    const [a] = await db.insert(exclusiveAssignment).values({ resourceId: desk.id, mode: "individual", holderEmployeeId: h.id, validFrom: today, reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    expect(await msg(db.update(exclusiveAssignment).set({ validFrom: d(2) }).where(eq(exclusiveAssignment.id, a.id)))).toBe("assignment_start_immutable");
    expect(await msg(db.update(exclusiveAssignment).set({ cancelledAt: new Date(), cancelledBy: h.id }).where(eq(exclusiveAssignment.id, a.id)))).toBe("assignment_cancel_only_before_start");
    expect(await msg(db.update(exclusiveAssignment).set({ validTo: d(-3), endedBy: h.id, endReason: "ended" }).where(eq(exclusiveAssignment.id, a.id)))).toBe("assignment_end_in_past");
    await db.update(exclusiveAssignment).set({ validTo: today, endedBy: h.id, endReason: "ended" }).where(eq(exclusiveAssignment.id, a.id));
    expect(await msg(db.update(exclusiveAssignment).set({ validTo: null }).where(eq(exclusiveAssignment.id, a.id)))).toBe("assignment_reopen_forbidden");
    // encerrada ontem (via papel dono, simulando a passagem do tempo) fica congelada
    const { Pool: P } = await import("pg");
    const owner = new P({ connectionString: process.env.DATABASE_OWNER_URL, max: 1 });
    await owner.query("alter table exclusive_assignment disable trigger exclusive_assignment_validity");
    await owner.query("update exclusive_assignment set valid_from = $2, valid_to = $2 where id = $1", [a.id, d(-1)]);
    await owner.query("alter table exclusive_assignment enable trigger exclusive_assignment_validity");
    await owner.end();
    expect(await msg(db.update(exclusiveAssignment).set({ validTo: d(5) }).where(eq(exclusiveAssignment.id, a.id)))).toBe("assignment_ended_frozen");
    // agendada pode ser anulada, e depois fica congelada
    const [s] = await db.insert(exclusiveAssignment).values({ resourceId: desk.id, mode: "individual", holderEmployeeId: h.id, validFrom: d(3), reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    expect(await msg(db.update(exclusiveAssignment).set({ validFrom: d(-1) }).where(eq(exclusiveAssignment.id, s.id)))).toBe("assignment_start_in_past");
    await db.update(exclusiveAssignment).set({ cancelledAt: new Date(), cancelledBy: h.id, cancelReason: "t" }).where(eq(exclusiveAssignment.id, s.id));
    expect(await msg(db.update(exclusiveAssignment).set({ validFrom: d(4) }).where(eq(exclusiveAssignment.id, s.id)))).toBe("assignment_cancelled_frozen");
  });

  it("exceção fora da vigência, longa demais ou para o próprio titular é rejeitada; encurtar a atribuição sobre exceção também", async () => {
    const h = await seedEmployee({ orgCondition: "director" });
    const o = await seedEmployee();
    const desk = await seedDesk();
    const [a] = await db.insert(exclusiveAssignment).values({ resourceId: desk.id, mode: "individual", holderEmployeeId: h.id, validFrom: today, validTo: d(20), reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    const cause = async (p: Promise<unknown>) => p.then(() => "ok").catch((e) => String(e.cause?.message ?? e.message));
    expect(await cause(db.insert(accessException).values({ assignmentId: a.id, resourceId: desk.id, kind: "release_to_shared", startsOn: d(15), endsOn: d(25), reason: "t" }))).toBe("exception_outside_assignment");
    expect(await cause(db.insert(accessException).values({ assignmentId: a.id, resourceId: desk.id, kind: "release_to_employee", beneficiaryEmployeeId: h.id, startsOn: d(1), endsOn: d(2), reason: "t" }))).toBe("beneficiary_is_holder");
    const [a2] = await db.insert(exclusiveAssignment).values({ resourceId: (await seedDesk()).id, mode: "individual", holderEmployeeId: h.id, validFrom: today, reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    expect(await cause(db.insert(accessException).values({ assignmentId: a2.id, resourceId: (await seedDesk()).id, kind: "release_to_shared", startsOn: d(1), endsOn: d(2), reason: "t" }))).toBe("exception_resource_mismatch");
    expect(await cause(db.insert(accessException).values({ assignmentId: a2.id, resourceId: desk.id, kind: "release_to_shared", startsOn: d(1), endsOn: d(2), reason: "t" }))).toBe("exception_resource_mismatch");
    const [d2] = await db.select({ r: exclusiveAssignment.resourceId }).from(exclusiveAssignment).where(eq(exclusiveAssignment.id, a2.id));
    expect(await cause(db.insert(accessException).values({ assignmentId: a2.id, resourceId: d2.r, kind: "release_to_shared", startsOn: d(1), endsOn: d(40), reason: "t" }))).toBe("exception_too_long");
    await db.insert(accessException).values({ assignmentId: a.id, resourceId: desk.id, kind: "release_to_employee", beneficiaryEmployeeId: o.id, startsOn: d(10), endsOn: d(12), reason: "t" });
    expect(await cause(db.update(exclusiveAssignment).set({ validTo: d(11), endedBy: h.id, endReason: "ended" }).where(eq(exclusiveAssignment.id, a.id)))).toBe("exception_outside_assignment");
  });

  it("DIR-017-T3: transferência é contígua na mesma mesa, não retroage, e a sucessora só é anulada com decisão", async () => {
    const h1 = await seedEmployee({ orgCondition: "director" });
    const h2 = await seedEmployee({ orgCondition: "director" });
    const desk = await seedDesk();
    const [a] = await db.insert(exclusiveAssignment).values({ resourceId: desk.id, mode: "individual", holderEmployeeId: h1.id, validFrom: today, reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    const call = (from: string, holder = h2.id) => raw<{ id: string }>("select transfer_assignment($1::uuid, $2::uuid, $3::date, 'motivo', 'RH', $2::uuid) as id", [a.id, holder, from]);
    await expect(call(d(-1))).rejects.toThrow(/transfer_in_past/);
    await expect(call(today)).rejects.toThrow(/transfer_before_start/);
    await expect(call(d(2), h1.id)).rejects.toThrow(/transfer_same_holder/);
    const [{ id: succ }] = await call(d(2));
    const rows = await db.select().from(exclusiveAssignment).where(eq(exclusiveAssignment.resourceId, desk.id)).orderBy(exclusiveAssignment.validFrom);
    expect(rows.map((r) => [r.validFrom, r.validTo, r.endReason, r.transferredFromId])).toEqual([
      [today, d(1), "transferred", null],
      [d(2), null, null, a.id],
    ]);
    // encerrar por transferência sem sucessora: rejeitado no commit
    const [b] = await db.insert(exclusiveAssignment).values({ resourceId: (await seedDesk()).id, mode: "individual", holderEmployeeId: h1.id, validFrom: today, reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    expect(await rule(db.update(exclusiveAssignment).set({ validTo: d(1), endedBy: h1.id, endReason: "transferred" }).where(eq(exclusiveAssignment.id, b.id)))).toBe("transfer_without_successor");
    // anular a sucessora sem decidir: rejeitado; com liberação registrada na antecessora: aceito
    expect(await rule(db.update(exclusiveAssignment).set({ cancelledAt: new Date(), cancelledBy: h1.id, cancelReason: "t" }).where(eq(exclusiveAssignment.id, succ)))).toBe("successor_cancel_needs_decision");
    await db.transaction(async (tx) => {
      await tx.update(exclusiveAssignment).set({ endReason: "transfer_cancelled" }).where(eq(exclusiveAssignment.id, a.id));
      await tx.update(exclusiveAssignment).set({ cancelledAt: new Date(), cancelledBy: h1.id, cancelReason: "t" }).where(eq(exclusiveAssignment.id, succ));
    });
    const [pred] = await db.select({ endReason: exclusiveAssignment.endReason, validTo: exclusiveAssignment.validTo }).from(exclusiveAssignment).where(eq(exclusiveAssignment.id, a.id));
    expect(pred).toEqual({ endReason: "transfer_cancelled", validTo: d(1) });
  });

  it("DIR-024-T2: sem nenhum lock da aplicação, o trigger deferido rejeita reserva proibida em cada par de operações", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const other = await seedEmployee();
    const group = await directorsGroupId();
    const insertBooking = (res: string, emp: string, date: string) =>
      db.insert(deskBooking).values({ resourceId: res, employeeId: emp, bookingDate: date, status: "confirmed", origin: "self", actorEmployeeId: emp });

    // reserva e trava: reserva existente do colaborador comum; trava chega depois sem tratar a reserva
    const desk1 = await seedDesk();
    await insertBooking(desk1.id, other.id, d(2));
    expect(await rule(db.insert(exclusiveAssignment).values({ resourceId: desk1.id, mode: "individual", holderEmployeeId: holder.id, validFrom: d(1), reason: "t", responsible: "RH" }))).toBe("booking_conflict");
    // trava primeiro; reserva do colaborador comum é rejeitada no commit
    const desk2 = await seedDesk();
    await db.insert(exclusiveAssignment).values({ resourceId: desk2.id, mode: "individual", holderEmployeeId: holder.id, validFrom: d(1), reason: "t", responsible: "RH" });
    expect(await rule(insertBooking(desk2.id, other.id, d(4)))).toBe("booking_not_allowed");
    await insertBooking(desk2.id, holder.id, d(2));
    // reserva de integrante e remoção do integrante
    const desk3 = await seedDesk();
    const [m] = await db.insert(accessGroupMember).values({ groupId: group, employeeId: holder.id, validFrom: today, reason: "t" }).returning({ id: accessGroupMember.id });
    await db.insert(exclusiveAssignment).values({ resourceId: desk3.id, mode: "group", accessGroupId: group, validFrom: today, reason: "t", responsible: "RH" });
    await insertBooking(desk3.id, holder.id, d(3));
    expect(await rule(db.update(accessGroupMember).set({ validTo: d(1) }).where(eq(accessGroupMember.id, m.id)))).toBe("booking_conflict");
    // reserva e fechamento do dia
    expect(await rule(db.insert(officeCalendar).values({ date: d(3), isOpen: false, reason: "t" }))).toBe("booking_conflict");
    // reserva em nome e desativação da pessoa
    expect(await rule(db.update((await import("@/db/schema")).employee).set({ status: "deactivated" }).where(eq((await import("@/db/schema")).employee.id, holder.id)))).toBe("booking_conflict");
    // suspensão mantém reservas (EMP-02-T1)
    await db.update((await import("@/db/schema")).employee).set({ status: "suspended" }).where(eq((await import("@/db/schema")).employee.id, holder.id));
    // manutenção sobre reserva ativa
    expect(await rule(db.insert(resourceStatusPeriod).values({ resourceId: desk3.id, status: "maintenance", startsOn: d(3), endsOn: d(3), reason: "t" }))).toBe("booking_conflict");
    // desativação do recurso sobre reserva ativa
    const { resource } = await import("@/db/schema");
    expect(await rule(db.update(resource).set({ retiredOn: d(3) }).where(eq(resource.id, desk3.id)))).toBe("booking_conflict");
    // nenhuma reserva proibida coexiste
    const bad = await raw<{ n: number }>("select count(*)::int as n from desk_booking b where b.status = 'confirmed' and not booking_remains_valid(b.employee_id, b.resource_id, b.booking_date)");
    expect(bad[0].n).toBe(0);
  });

  it("lock por trigger: a segunda sessão espera a primeira na linha do recurso e relê com snapshot novo", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const other = await seedEmployee();
    const desk = await seedDesk();
    const c1 = await rawPool.connect();
    const c2 = await rawPool.connect();
    try {
      await c1.query("begin");
      await c1.query("insert into exclusive_assignment (resource_id, mode, holder_employee_id, valid_from, reason, responsible) values ($1, 'individual', $2, $3, 't', 'RH')", [desk.id, holder.id, d(1)]);
      await c2.query("begin");
      await c2.query("set local lock_timeout = '300ms'");
      // a inserção da reserva espera o lock da linha do recurso, tomado pelo trigger da atribuição em c1
      await expect(c2.query("insert into desk_booking (resource_id, employee_id, booking_date, status, origin, actor_employee_id) values ($1, $2, $3, 'confirmed', 'self', $2)", [desk.id, other.id, d(2)])).rejects.toMatchObject({ code: "55P03" });
      await c2.query("rollback");
      await c1.query("commit");
      // depois do commit da trava, a reserva é rejeitada no commit pela verificação deferida
      await c2.query("begin");
      await c2.query("insert into desk_booking (resource_id, employee_id, booking_date, status, origin, actor_employee_id) values ($1, $2, $3, 'confirmed', 'self', $2)", [desk.id, other.id, d(2)]);
      await expect(c2.query("commit")).rejects.toThrow(/booking_not_allowed/);
    } finally {
      c1.release();
      c2.release();
    }
    const rows = await db.select().from(deskBooking).where(and(eq(deskBooking.resourceId, desk.id), isNull(deskBooking.cancelledAt)));
    expect(rows).toHaveLength(0);
    const [{ n }] = await raw<{ n: number }>("select count(*)::int as n from exclusive_assignment where resource_id = $1", [desk.id]);
    expect(n).toBe(1);
    void sql;
  });
});
