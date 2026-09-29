import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { accessException, accessGroupMember, auditEvent, checkin, deskBooking, employee, exclusiveAssignment, outboxEvent, spaceBooking, waitlistEntry, waitlistOffer } from "@/db/schema";
import { bookDesk, cancelDesk } from "@/modules/booking/service";
import { confirmUse, releaseUnconfirmed } from "@/modules/checkin/service";
import { deactivateEmployee, readmitEmployee, suspendEmployee } from "@/modules/employees/service";
import { addDays, localToday } from "@/modules/shared/dates";
import { bookSpace, searchSpaces } from "@/modules/spaces/service";
import { setShareWithManager, sharesWithManager, teamWeek } from "@/modules/team/service";
import { acceptOffer, joinWaitlist, leaveWaitlist, manualOfferOptions, offerFreeDesks, offerManually } from "@/modules/waitlist/service";
import { closeDay, createStatusPeriod, previewCloseDay, previewStatusPeriod } from "@/modules/workplace/service";
import { parseDecisions } from "@/modules/office/decisions";
import { ageOpenOffers, directorsGroupId, ownerQuery, privilegedActor, resetDb, seedDesk, seedEmployee } from "./helpers";

/*
 * Regressão dos achados confirmados na revisão independente da Etapa 3 (docs/testes/aceite.md).
 * Cada caso nomeia o achado. Intercalações determinísticas usam uma conexão externa do papel dono que só segura linhas.
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

async function openOffers() {
  return db.select().from(waitlistOffer).where(eq(waitlistOffer.status, "open"));
}
async function entryOf(employeeId: string) {
  return (await db.select().from(waitlistEntry).where(eq(waitlistEntry.employeeId, employeeId)))[0];
}
async function fullWith(date: string, code: string) {
  const taker = await seedEmployee();
  const desk = await seedDesk(code);
  const booking = await bookDesk(db, actorOf(taker), { employeeId: taker.id, resourceId: desk.id, date, idempotencyKey: randomUUID() });
  return { taker, desk, booking };
}
async function invariants() {
  const q = async (text: string) => ((await db.execute(sql.raw(text))).rows[0] as { n: number }).n;
  return {
    duasAtivasNoDia: await q(`select count(*)::int as n from (select employee_id, booking_date from desk_booking where status = 'confirmed' or (status = 'held' and hold_expires_at > now()) group by 1, 2 having count(*) > 1) x`),
    reservaComInscricaoEmEspera: await q(`select count(*)::int as n from waitlist_entry e join desk_booking b on b.employee_id = e.employee_id and b.booking_date = e.date where e.status = 'waiting' and b.status = 'confirmed'`),
    ofertaAbertaSemRetencaoViva: await q(`select count(*)::int as n from waitlist_offer o join desk_booking b on b.id = o.hold_booking_id where o.status = 'open' and o.expires_at > now() and not (b.status = 'held' and b.hold_expires_at > now())`),
    confirmacaoDeReservaCancelada: await q(`select count(*)::int as n from checkin c join desk_booking b on b.id = c.desk_booking_id where b.status <> 'confirmed'`),
  };
}
const CLEAN = { duasAtivasNoDia: 0, reservaComInscricaoEmEspera: 0, ofertaAbertaSemRetencaoViva: 0, confirmacaoDeReservaCancelada: 0 };

describe("revisão independente da Etapa 3: regressão", () => {
  beforeEach(resetDb);

  it("CONC-03: reivindicação da fila contra reserva direta da mesma pessoa, com intercalação fixada: sem deadlock", async () => {
    const date = d(1);
    await fullWith(date, "A001");
    const x = await seedEmployee();
    const entry = await joinWaitlist(db, actorOf(x), { date });
    await seedDesk("A002");
    const r3 = await seedDesk("A003");
    const before = await deadlocks();
    const ext = await owner.connect();
    try {
      await ext.query("begin");
      await ext.query("select 1 from waitlist_entry where id = $1 for update", [entry.entryId]);
      const sweep = settle(offerFreeDesks(db));
      await waitBlocked(1);
      const direct = settle(bookDesk(db, actorOf(x), { employeeId: x.id, resourceId: r3.id, date, idempotencyKey: randomUUID() }));
      await new Promise((r) => setTimeout(r, 300));
      await ext.query("rollback");
      await Promise.all([sweep, direct]);
    } finally {
      await ext.query("rollback").catch(() => null);
      ext.release();
    }
    expect((await deadlocks()) - before).toBe(0);
    expect(await invariants()).toEqual(CLEAN);
  });

  it("CONC-02: inscrição e reserva simultâneas da mesma pessoa, 20 rodadas: nunca reserva confirmada com inscrição em espera", async () => {
    const before = await deadlocks();
    for (let i = 0; i < 20; i++) {
      await resetDb();
      const date = d(1 + (i % 10));
      await fullWith(date, "B001");
      const r = await seedDesk("B002");
      const x = await seedEmployee();
      await Promise.allSettled([joinWaitlist(db, actorOf(x), { date }), bookDesk(db, actorOf(x), { employeeId: x.id, resourceId: r.id, date, idempotencyKey: randomUUID() })]);
      expect(await invariants(), `rodada ${i}`).toEqual(CLEAN);
    }
    expect((await deadlocks()) - before).toBe(0);
  });

  it("CONC-04: suspensão de quem tem oferta vencida não varrida contra reserva direta da mesma mesa: sem deadlock", async () => {
    const before = await deadlocks();
    for (let i = 0; i < 15; i++) {
      await resetDb();
      const date = d(1 + (i % 10));
      const { taker, desk, booking } = await fullWith(date, "C001");
      const p = await seedEmployee();
      await joinWaitlist(db, actorOf(p), { date });
      await cancelDesk(db, actorOf(taker), booking.bookingId);
      const [o] = await openOffers();
      await ageOpenOffers(o.id);
      const q = await seedEmployee();
      const rh = await privilegedActor({ roles: ["hr"] });
      const [s, b] = await Promise.allSettled([suspendEmployee(db, rh.actor, p.id, "afastamento"), bookDesk(db, actorOf(q), { employeeId: q.id, resourceId: desk.id, date, idempotencyKey: randomUUID() })]);
      expect(s.status, `rodada ${i}: suspensão`).toBe("fulfilled");
      expect(b.status, `rodada ${i}: reserva direta`).toBe("fulfilled");
    }
    expect((await deadlocks()) - before).toBe(0);
  });

  it("CONC-01: confirmação de uso concorrente com a liberação por falta de confirmação: nunca confirmação gravada em reserva cancelada", async () => {
    await ownerQuery(`update office_settings set value = 'true' where key = 'checkin_release_enabled'`);
    await ownerQuery(`update office_settings set value = '"00:00"' where key = 'checkin_release_time'`);
    const p = await seedEmployee();
    const desk = await seedDesk("Q001");
    const b = await bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: desk.id, date: today, idempotencyKey: randomUUID() });
    await ownerQuery("update desk_booking set created_at = now() - interval '1 day' where id = $1", [b.bookingId]);
    const ext = await owner.connect();
    try {
      await ext.query("begin");
      await ext.query("select 1 from desk_booking where id = $1 for no key update", [b.bookingId]);
      const rel = settle(releaseUnconfirmed(db, new Date()));
      await waitBlocked(1);
      const conf = settle(confirmUse(db, actorOf(p), { bookingId: b.bookingId, method: "qr" }));
      await waitBlocked(2);
      await ext.query("rollback");
      const [r, c] = await Promise.all([rel, conf]);
      const [row] = await db.select({ status: deskBooking.status }).from(deskBooking).where(eq(deskBooking.id, b.bookingId));
      const confirmations = await db.select().from(checkin).where(eq(checkin.deskBookingId, b.bookingId));
      // Um vence: ou a liberação cancela e a confirmação é recusada, ou a confirmação entra e a reserva segue confirmada.
      if (row.status === "cancelled") {
        expect(confirmations).toHaveLength(0);
        expect(c.ok).toBe(false);
      } else {
        expect(confirmations).toHaveLength(1);
      }
      void r;
    } finally {
      await ext.query("rollback").catch(() => null);
      ext.release();
    }
    expect(await invariants()).toEqual(CLEAN);
  });

  it("CONC-06: reserva de sala e de mesa repetidas em paralelo com a mesma chave devolvem o resultado original", async () => {
    const a = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    const desk = await seedDesk("D001");
    const k1 = randomUUID();
    const k2 = randomUUID();
    const rooms = await Promise.allSettled([0, 1, 2].map(() => bookSpace(db, actorOf(a), { resourceId: room.id, date: d(1), start: "10:00", end: "11:00", idempotencyKey: k1 })));
    const desks = await Promise.allSettled([0, 1, 2].map(() => bookDesk(db, actorOf(a), { employeeId: a.id, resourceId: desk.id, date: d(1), idempotencyKey: k2 })));
    expect(rooms.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(desks.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(new Set(rooms.map((r) => (r as PromiseFulfilledResult<{ bookingId: string }>).value.bookingId)).size).toBe(1);
    expect(new Set(desks.map((r) => (r as PromiseFulfilledResult<{ bookingId: string }>).value.bookingId)).size).toBe(1);
    expect(await db.select().from(spaceBooking)).toHaveLength(1);
  });

  it("CONC-05 e EXC-08: fechamento de dia com retenção já cancelada por suspensão não grava decisão falsa; inscrições da data são encerradas com aviso", async () => {
    const date = d(1);
    const { taker, booking } = await fullWith(date, "E001");
    const p = await seedEmployee();
    const w = await seedEmployee();
    await joinWaitlist(db, actorOf(p), { date });
    await joinWaitlist(db, actorOf(w), { date });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [o] = await openOffers();
    const fac = await privilegedActor({ roles: ["facilities"] });
    const rh = await privilegedActor({ roles: ["hr"] });
    const preview = await previewCloseDay(db, fac.actor, date);
    const decisions = preview.conflicts.map((c) => ({ bookingId: c.bookingId, action: "cancel" as const, reason: "feriado" }));
    await suspendEmployee(db, rh.actor, p.id, "afastamento");
    await closeDay(db, fac.actor, { date, reason: "feriado" }, decisions);
    expect(await db.select().from(auditEvent).where(and(eq(auditEvent.action, "booking.cancelled_by_conflict"), eq(auditEvent.entityId, o.holdBookingId)))).toHaveLength(0);
    expect(await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, `waitlist.withdrawn:${o.holdBookingId}`))).toHaveLength(0);
    const wEntry = await entryOf(w.id);
    expect(wEntry.status).toBe("cancelled");
    expect(wEntry.closeReason).toContain("escritório fechado");
    expect(await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, `waitlist.closed:${wEntry.id}`))).toHaveLength(1);
  });

  it("EXC-01: desativar titular cuja mesa está liberada ao compartilhado, com reserva própria e fila: conclui, a mesa entra em revisão e não é oferecida", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const ex = await seedDesk("X001");
    const [a] = await db.insert(exclusiveAssignment).values({ resourceId: ex.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    await db.insert(accessException).values({ assignmentId: a.id, resourceId: ex.id, kind: "release_to_shared", startsOn: d(1), endsOn: d(3), reason: "férias" });
    await bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: ex.id, date: d(1), idempotencyKey: randomUUID() });
    await fullWith(d(1), "S001");
    const q = await seedEmployee();
    await joinWaitlist(db, actorOf(q), { date: d(1) });
    const rh = await privilegedActor({ roles: ["hr"] });
    await deactivateEmployee(db, rh.actor, holder.id, { reason: "desligamento" });
    expect((await db.select().from(exclusiveAssignment).where(eq(exclusiveAssignment.id, a.id)))[0].needsReview).toBe(true);
    expect(await openOffers()).toHaveLength(0);
    expect((await entryOf(q.id)).status).toBe("waiting");
  });

  it("EXC-02: a primeira da fila reserva direto a mesa livre sem perder para a segunda; a segunda não passa à frente da primeira", async () => {
    const date = d(1);
    await fullWith(date, "F001");
    const a = await seedEmployee();
    const b = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date });
    await joinWaitlist(db, actorOf(b), { date });
    // mesa nova livre: A, primeira da fila, reserva direto e fica com ela; a inscrição de A é encerrada; B segue em espera
    const f2 = await seedDesk("F002");
    await expect(bookDesk(db, actorOf(a), { employeeId: a.id, resourceId: f2.id, date, idempotencyKey: randomUUID() })).resolves.toMatchObject({ created: true });
    expect((await entryOf(a.id)).status).toBe("cancelled");
    expect((await entryOf(b.id)).status).toBe("waiting");
    expect(await openOffers()).toHaveLength(0);
    // nova pessoa C entra depois de B; mesa nova livre: C tenta reservar direto, a mesa vai para B, que entrou antes
    const c = await seedEmployee();
    await joinWaitlist(db, actorOf(c), { date });
    const f4 = await seedDesk("F004");
    await expect(bookDesk(db, actorOf(c), { employeeId: c.id, resourceId: f4.id, date, idempotencyKey: randomUUID() })).rejects.toThrow(/oferecida à próxima pessoa da fila/);
    const [offer] = await openOffers();
    expect(offer.entryId).toBe((await entryOf(b.id)).id);
    expect(offer.resourceId).toBe(f4.id);
    expect((await entryOf(c.id)).status).toBe("waiting");
  });

  it("EXC-03: titular na fila cuja mesa exclusiva voltou a ficar livre não consome a compartilhada; a pessoa comum recebe a oferta", async () => {
    const date = d(1);
    const holder = await seedEmployee({ orgCondition: "director" });
    const benef = await seedEmployee();
    const ex = await seedDesk("X001");
    const [a] = await db.insert(exclusiveAssignment).values({ resourceId: ex.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    const [x] = await db.insert(accessException).values({ assignmentId: a.id, resourceId: ex.id, kind: "release_to_employee", beneficiaryEmployeeId: benef.id, startsOn: date, endsOn: date, reason: "t" }).returning({ id: accessException.id });
    const { taker, booking } = await fullWith(date, "S001");
    const common = await seedEmployee();
    await joinWaitlist(db, actorOf(holder), { date });
    await joinWaitlist(db, actorOf(common), { date });
    await ownerQuery("update access_exception set revoked_at = now() where id = $1", [x.id]);
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [offer] = await openOffers();
    expect(offer.entryId).toBe((await entryOf(common.id)).id);
    const h = await entryOf(holder.id);
    expect(h.status).toBe("cancelled");
    expect(h.closeReason).toBe("mesa de uso exclusivo disponível");
  });

  it("EXC-04: decisão tomada sobre oferta aberta não vale para a reserva que a pessoa aceitou entre a prévia e a confirmação", async () => {
    const date = d(1);
    const { taker, desk, booking } = await fullWith(date, "G001");
    const a = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [offer] = await openOffers();
    const fac = await privilegedActor({ roles: ["facilities"] });
    const preview = await previewStatusPeriod(db, fac.actor, { resourceId: desk.id, status: "maintenance", startsOn: date, endsOn: date, reason: "vazamento" });
    const fd = new FormData();
    for (const c of preview.conflicts) {
      fd.set(`decision:${c.bookingId}`, "cancel");
      fd.set(`reason:${c.bookingId}`, "vazamento");
      fd.set(`status:${c.bookingId}`, c.status);
    }
    await acceptOffer(db, actorOf(a), offer.id);
    await expect(createStatusPeriod(db, fac.actor, { resourceId: desk.id, status: "maintenance", startsOn: date, endsOn: date, reason: "vazamento" }, parseDecisions(fd))).rejects.toThrow(/mudou desde a prévia/);
    expect((await db.select().from(deskBooking).where(eq(deskBooking.id, offer.holdBookingId)))[0].status).toBe("confirmed");
  });

  it("EXC-05: retirar a oferta pela aba Mesas mantém a pessoa na fila, avisa e passa a mesa à próxima", async () => {
    const date = d(1);
    const { taker, booking } = await fullWith(date, "H001");
    const a = await seedEmployee();
    const b = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date });
    await joinWaitlist(db, actorOf(b), { date });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [offer] = await openOffers();
    const fac = await privilegedActor({ roles: ["facilities"] });
    await cancelDesk(db, fac.actor, offer.holdBookingId, { reason: "mesa reservada para visita" });
    expect((await entryOf(a.id)).status).toBe("waiting");
    const [next] = await openOffers();
    expect(next.entryId).toBe((await entryOf(b.id)).id);
    const mail = await db.select().from(outboxEvent).where(and(eq(outboxEvent.eventType, "email.waitlist"), eq(outboxEvent.aggregateId, offer.holdBookingId)));
    expect(JSON.stringify(mail[0].payload)).toContain("Você continua na fila de espera");
  });

  it("EXC-06: pedido forjado de pessoa comum em mesa de grupo livre responde uso exclusivo e não aciona a fila", async () => {
    const date = d(1);
    const group = await directorsGroupId();
    const m1 = await seedEmployee({ orgCondition: "director" });
    const m2 = await seedEmployee({ orgCondition: "director" });
    await db.insert(accessGroupMember).values({ groupId: group, employeeId: m1.id, validFrom: today, reason: "t" });
    await db.insert(accessGroupMember).values({ groupId: group, employeeId: m2.id, validFrom: today, reason: "t" });
    const y = await seedDesk("Y001");
    await db.insert(exclusiveAssignment).values({ resourceId: y.id, mode: "group", accessGroupId: group, validFrom: today, reason: "t", responsible: "RH" });
    const mb = await bookDesk(db, actorOf(m1), { employeeId: m1.id, resourceId: y.id, date, idempotencyKey: randomUUID() });
    await fullWith(date, "S001");
    await joinWaitlist(db, actorOf(m2), { date });
    await ownerQuery("update desk_booking set status = 'cancelled' where id = $1", [mb.bookingId]);
    const c = await seedEmployee();
    await expect(bookDesk(db, actorOf(c), { employeeId: c.id, resourceId: y.id, date, idempotencyKey: randomUUID() })).rejects.toThrow(/uso exclusivo da diretoria/);
    expect(await openOffers()).toHaveLength(0);
  });

  it("privacidade: nome de quem reservou a sala só para a própria pessoa e a administração; título 'todos' não revela o nome", async () => {
    const a = await seedEmployee({ name: "Ana Organizadora" });
    const other = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    await bookSpace(db, actorOf(a), { resourceId: room.id, date: d(1), start: "10:00", end: "11:00", title: "Aberta", titleVisibility: "all", idempotencyKey: randomUUID() });
    const seen = (await searchSpaces(db, other.id, { date: d(1), start: "12:00", end: "13:00" })).items[0].agenda[0];
    expect(seen.title).toBe("Aberta");
    expect(seen.employeeName).toBeNull();
    const fac = await privilegedActor({ roles: ["facilities"] });
    expect((await searchSpaces(db, fac.id, { date: d(1), start: "12:00", end: "13:00" })).items[0].agenda[0].employeeName).toBe("Ana Organizadora");
  });

  it("privacidade: consentimento do Meu time vale só para o gestor da época; troca de gestor, desativação e readmissão exigem nova autorização", async () => {
    const m1 = await seedEmployee({ roles: ["manager"] });
    const m2 = await seedEmployee({ roles: ["manager"] });
    const p = await seedEmployee();
    await db.update(employee).set({ managerEmployeeId: m1.id }).where(eq(employee.id, p.id));
    await setShareWithManager(db, actorOf(p), true);
    expect((await teamWeek(db, m1.id, [d(1)]))[0].shared).toBe(true);
    await db.update(employee).set({ managerEmployeeId: m2.id }).where(eq(employee.id, p.id));
    expect(await sharesWithManager(db, p.id)).toBe(false);
    expect((await teamWeek(db, m2.id, [d(1)]))[0].shared).toBe(false);
    await setShareWithManager(db, actorOf(p), true);
    expect((await teamWeek(db, m2.id, [d(1)]))[0].shared).toBe(true);
    const rh = await privilegedActor({ roles: ["hr"] });
    await deactivateEmployee(db, rh.actor, p.id, { reason: "desligamento" });
    await readmitEmployee(db, rh.actor, p.id, { hireDate: today, reason: "retorno" });
    await db.update(employee).set({ status: "active" }).where(eq(employee.id, p.id));
    expect((await teamWeek(db, m2.id, [d(1)]))[0].shared).toBe(false);
  });

  it("privacidade: oferta manual não serve de oráculo de titularidade; opções só de mesas compartilhadas", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const ex = await seedDesk("X001");
    const [a] = await db.insert(exclusiveAssignment).values({ resourceId: ex.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    const benef = await seedEmployee();
    const [x] = await db.insert(accessException).values({ assignmentId: a.id, resourceId: ex.id, kind: "release_to_employee", beneficiaryEmployeeId: benef.id, startsOn: d(1), endsOn: d(1), reason: "t" }).returning({ id: accessException.id });
    await fullWith(d(1), "S001");
    const other = await seedEmployee();
    await joinWaitlist(db, actorOf(holder), { date: d(1) });
    await joinWaitlist(db, actorOf(other), { date: d(1) });
    await ownerQuery("update access_exception set revoked_at = now() where id = $1", [x.id]);
    const operator = await seedEmployee({ permissions: ["waitlist.admin"] });
    const msgs: string[] = [];
    for (const who of [holder, other]) {
      const e = await entryOf(who.id);
      msgs.push(await offerManually(db, actorOf(operator), { entryId: e.id, resourceId: ex.id }).then(() => "oferecida", (err: Error) => err.message));
      expect((await manualOfferOptions(db, who.id, d(1))).map((o) => o.code)).not.toContain("X001");
    }
    expect(msgs[0]).toBe(msgs[1]);
  });

  it("privacidade: retirada da fila pela administração avisa a pessoa com o motivo", async () => {
    const { taker, booking } = await fullWith(d(1), "I001");
    const a = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date: d(1) });
    const e = await entryOf(a.id);
    const fac = await privilegedActor({ roles: ["facilities"] });
    await leaveWaitlist(db, fac.actor, e.id, { reason: "pedido por telefone" });
    const mail = await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, `waitlist.removed:${e.id}`));
    expect(JSON.stringify(mail[0].payload)).toContain("pedido por telefone");
    void taker;
    void booking;
  });

  it("T-01: salas seguem o horizonte configurado das mesas, sem a abertura semanal: semanas +2 a +4 aceitas, +5 recusada", async () => {
    const a = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    const monday = (n: number) => {
      const [y, m, dd] = today.split("-").map(Number);
      const wd = (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7;
      return addDays(today, 7 * n - wd + 2);
    };
    for (const w of [2, 3, 4]) await expect(bookSpace(db, actorOf(a), { resourceId: room.id, date: monday(w), start: "10:00", end: "11:00", idempotencyKey: randomUUID() })).resolves.toMatchObject({ created: true });
    await expect(bookSpace(db, actorOf(a), { resourceId: room.id, date: monday(5), start: "10:00", end: "11:00", idempotencyKey: randomUUID() })).rejects.toThrow(/além do horizonte de 4 semana/);
  });

  it("T-02: fechar o dia de hoje não esbarra em reserva de sala já encerrada", async () => {
    const a = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    await ownerQuery("insert into space_booking (resource_id, employee_id, actor_employee_id, period, status) values ($1, $2, $2, tstzrange(now() - interval '3 hours', now() - interval '2 hours', '[)'), 'confirmed')", [room.id, a.id]);
    const fac = await privilegedActor({ roles: ["facilities"] });
    const now = new Date();
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(now));
    if (h < 3) return; // a reserva encerrada precisa cair no dia de hoje; antes das 03:00 ela seria de ontem
    expect((await previewCloseDay(db, fac.actor, today)).conflicts).toHaveLength(0);
    await expect(closeDay(db, fac.actor, { date: today, reason: "queda de energia" })).resolves.toBeUndefined();
  });

  it("T-03 e T-04: com PAR-06 ativo, reserva feita depois do limite e reserva realocada de quem já confirmou não são liberadas", async () => {
    await ownerQuery(`update office_settings set value = 'true' where key = 'checkin_release_enabled'`);
    await ownerQuery(`update office_settings set value = '"00:00"' where key = 'checkin_release_time'`);
    const late = await seedEmployee();
    const moved = await seedEmployee();
    const d1 = await seedDesk("L001");
    const d2 = await seedDesk("L002");
    const d3 = await seedDesk("L003");
    // reserva feita agora, depois do limite (00:00): nunca liberada hoje
    const lateB = await bookDesk(db, actorOf(late), { employeeId: late.id, resourceId: d1.id, date: today, idempotencyKey: randomUUID() });
    // quem confirmou e foi realocado: a reserva nova, sem confirmação própria, também não é liberada
    const mb = await bookDesk(db, actorOf(moved), { employeeId: moved.id, resourceId: d2.id, date: today, idempotencyKey: randomUUID() });
    await ownerQuery("update desk_booking set created_at = now() - interval '1 day' where id = $1", [mb.bookingId]);
    await confirmUse(db, actorOf(moved), { bookingId: mb.bookingId, method: "portal" });
    const fac = await privilegedActor({ roles: ["facilities"] });
    await createStatusPeriod(db, fac.actor, { resourceId: d2.id, status: "maintenance", startsOn: today, endsOn: today, reason: "reparo" }, [{ bookingId: mb.bookingId, action: "realloc", reason: "reparo", targetResourceId: d3.id }]);
    await ownerQuery("update desk_booking set created_at = now() - interval '1 day' where resource_id = $1 and booking_date = $2", [d3.id, today]);
    expect(await releaseUnconfirmed(db)).toBe(0);
    expect((await db.select().from(deskBooking).where(eq(deskBooking.id, lateB.bookingId)))[0].status).toBe("confirmed");
    expect((await db.select().from(deskBooking).where(and(eq(deskBooking.resourceId, d3.id), eq(deskBooking.bookingDate, today))))[0].status).toBe("confirmed");
  });

  it("T-05: QR de sala confirma a reserva em andamento ou a que começa em até 15 minutos, nunca a já encerrada", async () => {
    const a = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    // Períodos relativos ao relógio do banco: independem da hora em que a bateria roda (exceto o último minuto do dia).
    await ownerQuery("insert into space_booking (resource_id, employee_id, actor_employee_id, period, status) values ($1, $2, $2, tstzrange(now() - interval '2 minutes', now() - interval '1 minute', '[)'), 'confirmed')", [room.id, a.id]);
    const next = await ownerQuery("insert into space_booking (resource_id, employee_id, actor_employee_id, period, status) values ($1, $2, $2, tstzrange(now() + interval '1 minute', now() + interval '20 minutes', '[)'), 'confirmed') returning id", [room.id, a.id]);
    const r = await confirmUse(db, actorOf(a), { resourceCode: "SALA1", method: "qr" });
    expect(r.bookingId).toBe(next.rows[0].id);
  });

  it("T-06: data inexistente é recusada como validação, nunca como erro de banco", async () => {
    const a = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    await expect(bookSpace(db, actorOf(a), { resourceId: room.id, date: "2026-02-30", start: "10:00", end: "11:00", idempotencyKey: randomUUID() })).rejects.toThrow(/Data inválida/);
    await expect(joinWaitlist(db, actorOf(a), { date: "2026-02-30" })).rejects.toThrow(/Data inválida/);
    await expect(searchSpaces(db, a.id, { date: "2026-11-31", start: "10:00", end: "11:00" })).rejects.toThrow(/Data inválida/);
  });

  it("T-07: reserva de sala pode terminar às 24:00", async () => {
    const a = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    const r = await bookSpace(db, actorOf(a), { resourceId: room.id, date: d(1), start: "23:00", end: "24:00", idempotencyKey: randomUUID() });
    expect(r.slot).toBe("23:00 às 24:00");
  });

  it("T-09: inscrição em espera de data passada é encerrada pela varredura", async () => {
    const a = await seedEmployee();
    await ownerQuery("insert into waitlist_entry (employee_id, date, status) values ($1, $2::date, 'waiting')", [a.id, d(-1)]);
    const { closePastEntries } = await import("@/modules/waitlist/service");
    expect(await closePastEntries(db)).toBe(1);
    expect((await entryOf(a.id)).status).toBe("expired");
  });
});
