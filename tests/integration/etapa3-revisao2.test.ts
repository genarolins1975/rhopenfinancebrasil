import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { accessException, accessGroup, accessGroupMember, auditEvent, checkin, deskBooking, employee, exclusiveAssignment, outboxEvent, waitlistEntry, waitlistOffer } from "@/db/schema";
import { bookDesk, cancelDesk } from "@/modules/booking/service";
import { confirmUse } from "@/modules/checkin/service";
import { deactivateEmployee, updateEmployee } from "@/modules/employees/service";
import { parseDecisions } from "@/modules/office/decisions";
import { addDays, localToday } from "@/modules/shared/dates";
import { setShareWithManager, sharesWithManager } from "@/modules/team/service";
import { declineOffer, joinWaitlist, offerFreeDesks, offerManually } from "@/modules/waitlist/service";
import { closeDay, previewCloseDay } from "@/modules/workplace/service";
import { ageOpenOffers, ownerQuery, privilegedActor, resetDb, seedDesk, seedEmployee, seedHold } from "./helpers";

/*
 * Regressão dos achados da segunda rodada da revisão independente da Etapa 3 (docs/testes/aceite.md). Prefixos: RP, lente
 * de regras e privacidade; CB, lente de concorrência e banco. Intercalações fixadas por conexão externa do papel dono.
 */

const today = localToday();
const d = (n: number) => addDays(today, n);
const actorOf = (e: { id: string }) => ({ employeeId: e.id, userId: `u-${e.id}`, requestId: randomUUID() });
const owner = new Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 3 });
afterAll(() => owner.end());

async function deadlocks(): Promise<number> {
  await new Promise((r) => setTimeout(r, 700));
  const r = await owner.query("select deadlocks::int as n from pg_stat_database where datname = current_database()");
  return (r.rows[0] as { n: number }).n;
}

async function waitBlocked(n = 1, timeoutMs = 8000) {
  const start = Date.now();
  for (;;) {
    const r = await owner.query("select count(distinct l.pid)::int as n from pg_locks l join pg_stat_activity a on a.pid = l.pid where not l.granted and a.datname = current_database()");
    if ((r.rows[0] as { n: number }).n >= n) return;
    if (Date.now() - start > timeoutMs) throw new Error("timeout esperando bloqueio");
    await new Promise((res) => setTimeout(res, 20));
  }
}

const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e: e instanceof Error ? e.message : String(e) }));
const openOffers = () => db.select().from(waitlistOffer).where(eq(waitlistOffer.status, "open"));
const entryOf = async (employeeId: string) => (await db.select().from(waitlistEntry).where(eq(waitlistEntry.employeeId, employeeId)))[0];

async function fullWith(date: string, code: string) {
  const taker = await seedEmployee();
  const desk = await seedDesk(code);
  const booking = await bookDesk(db, actorOf(taker), { employeeId: taker.id, resourceId: desk.id, date, idempotencyKey: randomUUID() });
  return { taker, desk, booking };
}

async function dbRule(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "aceito";
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return `${err.message ?? ""} ${err.cause?.message ?? ""}`;
  }
}

describe("segunda revisão independente da Etapa 3: regressão", () => {
  beforeEach(resetDb);

  it("RP-01: integrante de grupo com a mesa do grupo livre não sai da fila; recebe a oferta da compartilhada", async () => {
    const date = d(1);
    const m2 = await seedEmployee({ orgCondition: "director" });
    const [g] = await db.insert(accessGroup).values({ code: `G${randomUUID().slice(0, 6)}`, name: "Grupo teste" }).returning({ id: accessGroup.id });
    await db.insert(accessGroupMember).values({ groupId: g.id, employeeId: m2.id, validFrom: today, reason: "t" });
    const y = await seedDesk("Y001");
    await db.insert(exclusiveAssignment).values({ resourceId: y.id, mode: "group", accessGroupId: g.id, validFrom: today, reason: "t", responsible: "RH" });
    // Y001 ocupada por outra integrante no momento da inscrição; depois liberada sem oferta (DEC-39).
    const m1 = await seedEmployee({ orgCondition: "director" });
    await db.insert(accessGroupMember).values({ groupId: g.id, employeeId: m1.id, validFrom: today, reason: "t" });
    const yb = await bookDesk(db, actorOf(m1), { employeeId: m1.id, resourceId: y.id, date, idempotencyKey: randomUUID() });
    const { taker, booking } = await fullWith(date, "S001");
    const c = await seedEmployee();
    await joinWaitlist(db, actorOf(m2), { date });
    await joinWaitlist(db, actorOf(c), { date });
    await ownerQuery("update desk_booking set status = 'cancelled', cancelled_at = now(), cancel_reason = 'remoção do grupo' where id = $1", [yb.bookingId]);
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [offer] = await openOffers();
    expect(offer.entryId).toBe((await entryOf(m2.id)).id);
    expect((await entryOf(m2.id)).status).toBe("offered");
    expect((await entryOf(c.id)).status).toBe("waiting");
  });

  it("RP-01: titular com a própria mesa liberada ao compartilhado segue na fila e recebe a oferta", async () => {
    const date = d(1);
    const holder = await seedEmployee({ orgCondition: "director" });
    const ex = await seedDesk("X001");
    const [a] = await db.insert(exclusiveAssignment).values({ resourceId: ex.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    await db.insert(accessException).values({ assignmentId: a.id, resourceId: ex.id, kind: "release_to_shared", startsOn: date, endsOn: date, reason: "férias" });
    const other = await seedEmployee();
    const xb = await bookDesk(db, actorOf(other), { employeeId: other.id, resourceId: ex.id, date, idempotencyKey: randomUUID() });
    const { taker, booking } = await fullWith(date, "S001");
    const c = await seedEmployee();
    await joinWaitlist(db, actorOf(holder), { date });
    await joinWaitlist(db, actorOf(c), { date });
    // X001 fica livre sem oferta na mesma transação (janela da DEC-39): qualquer pessoa pode tomá-la.
    await ownerQuery("update desk_booking set status = 'cancelled', cancelled_at = now(), cancel_reason = 'janela sem oferta' where id = $1", [xb.bookingId]);
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    expect((await entryOf(holder.id)).status).toBe("offered");
    expect((await entryOf(c.id)).status).toBe("waiting");
  });

  it("RP-03: oferta retirada pela administração não volta à mesma pessoa na mesma mesa pela varredura", async () => {
    const date = d(1);
    const { taker, desk, booking } = await fullWith(date, "H001");
    const a = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [offer] = await openOffers();
    const fac = await privilegedActor({ roles: ["facilities"] });
    await cancelDesk(db, fac.actor, offer.holdBookingId, { reason: "mesa reservada para visita" });
    expect((await db.select().from(waitlistOffer).where(eq(waitlistOffer.id, offer.id)))[0].status).toBe("withdrawn");
    expect((await entryOf(a.id)).status).toBe("waiting");
    expect(await offerFreeDesks(db)).toBe(0);
    expect(await openOffers()).toHaveLength(0);
    // A mesa segue livre para reserva de outra pessoa; A, que continua na fila, não a bloqueia.
    const visitor = await seedEmployee();
    await expect(bookDesk(db, actorOf(visitor), { employeeId: visitor.id, resourceId: desk.id, date, idempotencyKey: randomUUID() })).resolves.toMatchObject({ created: true });
  });

  it("RP-04: retirar pela administração uma oferta já vencida e não varrida expira a inscrição em vez de devolvê-la à fila", async () => {
    const date = d(1);
    const { taker, booking } = await fullWith(date, "H001");
    const a = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [offer] = await openOffers();
    await ageOpenOffers(offer.id);
    const fac = await privilegedActor({ roles: ["facilities"] });
    await expect(cancelDesk(db, fac.actor, offer.holdBookingId, { reason: "visita" })).rejects.toThrow(/já não está ativa/);
    expect((await db.select().from(waitlistOffer).where(eq(waitlistOffer.id, offer.id)))[0].status).toBe("expired");
    expect((await entryOf(a.id)).status).toBe("expired");
    expect(await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, `waitlist.withdrawn:${offer.holdBookingId}`))).toHaveLength(0);
  });

  it("RP-05: oferta manual a titular com a própria mesa livre recusa com resposta neutra, sem motivo falso, e nada muda", async () => {
    const date = d(1);
    const holder = await seedEmployee({ orgCondition: "director" });
    const ex = await seedDesk("X001");
    const [a] = await db.insert(exclusiveAssignment).values({ resourceId: ex.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    const benef = await seedEmployee();
    const [x] = await db.insert(accessException).values({ assignmentId: a.id, resourceId: ex.id, kind: "release_to_employee", beneficiaryEmployeeId: benef.id, startsOn: date, endsOn: date, reason: "t" }).returning({ id: accessException.id });
    await fullWith(date, "S001");
    await joinWaitlist(db, actorOf(holder), { date });
    await ownerQuery("update access_exception set revoked_at = now() where id = $1", [x.id]);
    const s2 = await seedDesk("S002");
    const fac = await privilegedActor({ roles: ["facilities"] });
    const entry = await entryOf(holder.id);
    const r = await settle(offerManually(db, fac.actor, { entryId: entry.id, resourceId: s2.id }));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.e).toMatch(/Não foi possível oferecer esta mesa à pessoa agora/);
    expect(r.ok ? "" : r.e).not.toMatch(/tempo mínimo|exclusiv/);
    expect((await entryOf(holder.id)).status).toBe("waiting");
    expect(await openOffers()).toHaveLength(0);
  });

  it("RP-06: pelo QR, a segunda leitura durante a reunião não confirma a próxima reserva da sala", async () => {
    const a = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    await ownerQuery("insert into space_booking (resource_id, employee_id, actor_employee_id, period, status) values ($1, $2, $2, tstzrange(now() - interval '20 minutes', now() + interval '40 minutes', '[)'), 'confirmed')", [room.id, a.id]);
    const later = await ownerQuery("insert into space_booking (resource_id, employee_id, actor_employee_id, period, status) values ($1, $2, $2, tstzrange(now() + interval '2 hours', now() + interval '3 hours', '[)'), 'confirmed') returning id", [room.id, a.id]);
    const first = await confirmUse(db, actorOf(a), { resourceCode: "SALA1", method: "qr" });
    const second = await confirmUse(db, actorOf(a), { resourceCode: "SALA1", method: "qr" });
    expect(second.bookingId).toBe(first.bookingId);
    expect(second.already).toBe(true);
    expect(await db.select().from(checkin).where(eq(checkin.spaceBookingId, later.rows[0].id as string))).toHaveLength(0);
  });

  it("RP-06: pelo QR, reserva que começa daqui a mais de 15 minutos não é confirmada", async () => {
    const a = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    await ownerQuery("insert into space_booking (resource_id, employee_id, actor_employee_id, period, status) values ($1, $2, $2, tstzrange(now() + interval '1 hour', now() + interval '2 hours', '[)'), 'confirmed')", [room.id, a.id]);
    await expect(confirmUse(db, actorOf(a), { resourceCode: "SALA1", method: "qr" })).rejects.toThrow(/começando nos próximos 15 minutos/);
  });

  it("RP-07: autorização do Meu time não revive quando o gestor anterior volta; sem gestor, a ativação é recusada", async () => {
    const m1 = await seedEmployee({ roles: ["manager"] });
    const m2 = await seedEmployee({ roles: ["manager"] });
    const p = await seedEmployee();
    const rh = await privilegedActor({ roles: ["hr"] });
    await expect(setShareWithManager(db, actorOf(p), true)).rejects.toThrow(/não tem gestor direto/);
    await updateEmployee(db, rh.actor, p.id, { managerEmployeeId: m1.id, reason: "estrutura" });
    await setShareWithManager(db, actorOf(p), true);
    expect(await sharesWithManager(db, p.id)).toBe(true);
    await updateEmployee(db, rh.actor, p.id, { managerEmployeeId: m2.id, reason: "estrutura" });
    expect(await sharesWithManager(db, p.id)).toBe(false);
    await updateEmployee(db, rh.actor, p.id, { managerEmployeeId: m1.id, reason: "estrutura" });
    expect(await sharesWithManager(db, p.id)).toBe(false);
    // Qualquer caminho de gravação do gestor zera a autorização (trigger), não só a edição do cadastro.
    await setShareWithManager(db, actorOf(p), true);
    await db.update(employee).set({ managerEmployeeId: m2.id }).where(eq(employee.id, p.id));
    await db.update(employee).set({ managerEmployeeId: m1.id }).where(eq(employee.id, p.id));
    expect(await sharesWithManager(db, p.id)).toBe(false);
  });

  it("RP-08: fechar o dia com oferta aberta envia um único aviso à pessoa e registra o ator no encerramento da inscrição", async () => {
    const date = d(1);
    const { taker, booking } = await fullWith(date, "E001");
    const p = await seedEmployee();
    await joinWaitlist(db, actorOf(p), { date });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [o] = await openOffers();
    const fac = await privilegedActor({ roles: ["facilities"] });
    const preview = await previewCloseDay(db, fac.actor, date);
    await closeDay(db, fac.actor, { date, reason: "feriado" }, preview.conflicts.map((c) => ({ bookingId: c.bookingId, action: "cancel" as const, reason: "feriado" })));
    const entry = await entryOf(p.id);
    expect(entry.status).toBe("cancelled");
    expect(entry.closedBy).toBe(fac.actor.employeeId);
    expect(await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, `waitlist.withdrawn:${o.holdBookingId}`))).toHaveLength(0);
    expect(await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, `waitlist.closed:${entry.id}`))).toHaveLength(1);
    const [left] = await db.select().from(auditEvent).where(and(eq(auditEvent.action, "waitlist.left"), eq(auditEvent.entityId, entry.id)));
    expect(left.actorEmployeeId).toBe(fac.actor.employeeId);
  });

  it("CB-01: desativação de quem tem oferta vencida não varrida trava a mesa no passo de recursos: sem deadlock contra a varredura", async () => {
    const date = d(1);
    const p = await seedEmployee();
    const q = await seedEmployee();
    const rH = await seedDesk("H001");
    const { holdBookingId, entryId, offerId } = await seedHold({ resourceId: rH.id, employeeId: p.id, date, expiresAt: new Date(Date.now() - 60_000) });
    await ownerQuery("insert into waitlist_entry (employee_id, date) values ($1, $2::date)", [q.id, date]);
    const rh = await privilegedActor({ roles: ["hr"] });
    const before = await deadlocks();
    const ext = await owner.connect();
    try {
      await ext.query("begin");
      await ext.query("select id from resource where id = $1 for update", [rH.id]);
      const deact = settle(deactivateEmployee(db, rh.actor, p.id, { reason: "desligamento" }));
      await waitBlocked(1);
      // Instruções da varredura, depois da mesa: expira retenção, oferta e inscrição.
      await ext.query("update desk_booking set status = 'expired' where id = $1 and status = 'held'", [holdBookingId]);
      await ext.query("update waitlist_offer set status = 'expired', decided_at = now() where id = $1 and status = 'open'", [offerId]);
      await ext.query("update waitlist_entry set status = 'expired', closed_at = now(), close_reason = 'oferta vencida' where id = $1 and status = 'offered'", [entryId]);
      await ext.query("commit");
      const r = await deact;
      expect(r.ok, r.ok ? "" : r.e).toBe(true);
    } finally {
      await ext.query("rollback").catch(() => null);
      ext.release();
    }
    expect((await deadlocks()) - before).toBe(0);
    // A varredura venceu a corrida e encerrou a oferta de P; a mesa vai a Q no ciclo seguinte.
    expect((await entryOf(q.id)).status).toBe("waiting");
    expect(await offerFreeDesks(db)).toBe(1);
    const [offer] = await openOffers();
    expect(offer.entryId).toBe((await entryOf(q.id)).id);
  });

  it("CB-02: duas desativações simultâneas de pessoas na fila da mesma data, 6 rodadas: sem deadlock", async () => {
    const before = await deadlocks();
    for (let i = 0; i < 6; i++) {
      await resetDb();
      const date = d(1 + (i % 5));
      await fullWith(date, "Z001");
      const a = await seedEmployee();
      const z = await seedEmployee();
      await joinWaitlist(db, actorOf(a), { date });
      await joinWaitlist(db, actorOf(z), { date });
      const rh = await privilegedActor({ roles: ["hr"] });
      const rs = await Promise.allSettled([deactivateEmployee(db, rh.actor, a.id, { reason: "lote" }), deactivateEmployee(db, rh.actor, z.id, { reason: "lote" })]);
      expect(rs.map((r) => r.status), `rodada ${i}`).toEqual(["fulfilled", "fulfilled"]);
    }
    expect((await deadlocks()) - before).toBe(0);
  });

  it("CB-03: pelo papel da aplicação, a retenção da fila não muda de prazo, origem, pessoa ou mesa; reserva encerrada não reabre", async () => {
    const date = d(1);
    const p = await seedEmployee();
    const other = await seedEmployee();
    const r1 = await seedDesk("R001");
    const r2 = await seedDesk("R002");
    const { holdBookingId, offerId } = await seedHold({ resourceId: r1.id, employeeId: p.id, date, expiresAt: new Date(Date.now() + 3_600_000) });
    expect(await dbRule(db.execute(sql`update desk_booking set hold_expires_at = hold_expires_at + interval '1 day' where id = ${holdBookingId}`))).toMatch(/hold_incoherent/);
    expect(await dbRule(db.execute(sql`update desk_booking set origin = 'self', status = 'confirmed', hold_expires_at = null where id = ${holdBookingId}`))).toMatch(/booking_identity_immutable/);
    expect(await dbRule(db.execute(sql`update desk_booking set employee_id = ${other.id} where id = ${holdBookingId}`))).toMatch(/booking_identity_immutable/);
    expect(await dbRule(db.execute(sql`update desk_booking set resource_id = ${r2.id} where id = ${holdBookingId}`))).toMatch(/booking_identity_immutable/);
    // Recusa coerente e tentativa de reabrir a retenção como reserva própria.
    await declineOffer(db, actorOf(p), offerId);
    expect(await dbRule(db.execute(sql`update desk_booking set status = 'confirmed', hold_expires_at = null where id = ${holdBookingId}`))).toMatch(/booking_already_closed/);
    const [row] = await db.select({ status: deskBooking.status, origin: deskBooking.origin }).from(deskBooking).where(eq(deskBooking.id, holdBookingId));
    expect(row).toEqual({ status: "cancelled", origin: "waitlist_offer" });
  });

  it("CB-04: decisão vinda da tela sem a situação vista na prévia é recusada como prévia desatualizada", async () => {
    const fd = new FormData();
    fd.set(`decision:${randomUUID()}`, "cancel");
    expect(() => parseDecisions(fd)).toThrow(/prévia desta operação está desatualizada/);
  });

  it("CB-05: reserva direta que perde a inscrição para uma oferta concorrente recebe a razão real, não o erro de unicidade", async () => {
    const date = d(1);
    await fullWith(date, "K001");
    const p = await seedEmployee();
    const entry = await joinWaitlist(db, actorOf(p), { date });
    const k2 = await seedDesk("K002");
    const k3 = await seedDesk("K003");
    const ext = await owner.connect();
    try {
      // Oferta concorrente: reivindica a inscrição e retém K002 para P, sem confirmar ainda.
      await ext.query("begin");
      await ext.query("update waitlist_entry set status = 'offered' where id = $1 and status = 'waiting'", [entry.entryId]);
      const expires = new Date(Date.now() + 3_600_000);
      const b = await ext.query("insert into desk_booking (resource_id, employee_id, booking_date, status, origin, actor_employee_id, hold_expires_at) values ($1, $2, $3::date, 'held', 'waitlist_offer', $2, $4) returning id", [k2.id, p.id, date, expires]);
      await ext.query("insert into waitlist_offer (entry_id, resource_id, hold_booking_id, expires_at) values ($1, $2, $3, $4)", [entry.entryId, k2.id, b.rows[0].id, expires]);
      const direct = settle(bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: k3.id, date, idempotencyKey: randomUUID() }));
      await waitBlocked(1);
      await ext.query("commit");
      const r = await direct;
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.e).toMatch(/acabou de ser oferecida a você/);
    } finally {
      await ext.query("rollback").catch(() => null);
      ext.release();
    }
  });
});
