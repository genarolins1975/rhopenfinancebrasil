import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { accessException, auditEvent, deskBooking, employee, exclusiveAssignment, outboxEvent, resource, waitlistEntry, waitlistOffer, zone } from "@/db/schema";
import { capacityOn, loadResourcesOnDate } from "@/modules/availability/service";
import { deskClass } from "@/modules/availability/rules";
import { bookDesk, cancelDesk } from "@/modules/booking/service";
import { deactivateEmployee, readmitEmployee } from "@/modules/employees/service";
import { addDays, localToday } from "@/modules/shared/dates";
import { setShareWithManager, sharesWithManager } from "@/modules/team/service";
import { acceptOffer, joinWaitlist, manualOfferOptions, offerManually, unmetDemand } from "@/modules/waitlist/service";
import { closeDay, previewCloseDay, updateResourceAttributes } from "@/modules/workplace/service";
import { ageOpenOffers, ownerQuery, privilegedActor, resetDb, seedDesk, seedEmployee } from "./helpers";

/*
 * Regressão dos achados da terceira rodada da revisão independente da Etapa 3 (docs/testes/aceite.md, prefixo TR).
 * Intercalações determinísticas usam uma conexão externa do papel dono que segura linhas ou grava por outra transação.
 */

const today = localToday();
const d = (n: number) => addDays(today, n);
const actorOf = (e: { id: string }) => ({ employeeId: e.id, userId: `u-${e.id}`, requestId: randomUUID() });
const owner = new Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 3 });
afterAll(() => owner.end());

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

/** Uma pessoa na fila de d+1 com oferta aberta de H001 (liberada pelo cancelamento de quem a ocupava). */
async function offerScenario() {
  const date = d(1);
  const { taker, desk, booking } = await fullWith(date, "H001");
  const p = await seedEmployee();
  await joinWaitlist(db, actorOf(p), { date });
  await cancelDesk(db, actorOf(taker), booking.bookingId);
  const [offer] = await openOffers();
  return { date, desk, p, offer };
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

describe("terceira revisão independente da Etapa 3: regressão", () => {
  beforeEach(resetDb);

  it("TR-01: retirada de oferta com aceite gravado enquanto espera o lock da mesa: nada é cancelado, a pessoa fica com a reserva", async () => {
    const { desk, p, offer } = await offerScenario();
    const fac = await privilegedActor({ roles: ["facilities"] });
    const ext = await owner.connect();
    try {
      await ext.query("begin");
      await ext.query("select id from resource where id = $1 for update", [desk.id]);
      const withdraw = settle(cancelDesk(db, fac.actor, offer.holdBookingId, { reason: "visita", expectedStatus: "held" }));
      await waitBlocked(1);
      // O aceite, gravado por outra transação enquanto a retirada espera: retenção confirmada, oferta e inscrição aceitas.
      await ext.query("update desk_booking set status = 'confirmed', hold_expires_at = null where id = $1", [offer.holdBookingId]);
      await ext.query("update waitlist_offer set status = 'accepted', decided_at = now() where id = $1", [offer.id]);
      await ext.query("update waitlist_entry set status = 'accepted', closed_at = now() where id = $1", [offer.entryId]);
      await ext.query("commit");
      const r = await withdraw;
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.e).toMatch(/oferta foi aceita/);
    } finally {
      await ext.query("rollback").catch(() => null);
      ext.release();
    }
    expect((await db.select().from(deskBooking).where(eq(deskBooking.id, offer.holdBookingId)))[0].status).toBe("confirmed");
    expect((await entryOf(p.id)).status).toBe("accepted");
    expect(await db.select().from(auditEvent).where(and(eq(auditEvent.action, "booking.cancelled_by_admin"), eq(auditEvent.entityId, offer.holdBookingId)))).toHaveLength(0);
    expect(await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, `booking.cancelled:${offer.holdBookingId}`))).toHaveLength(0);
  });

  it("TR-01: tela desatualizada (aceite antes do clique em Retirar oferta): recusa sem cancelar; com a situação atual, o cancelamento é de reserva comum", async () => {
    const { p, offer } = await offerScenario();
    await acceptOffer(db, actorOf(p), offer.id);
    const fac = await privilegedActor({ roles: ["facilities"] });
    await expect(cancelDesk(db, fac.actor, offer.holdBookingId, { reason: "visita", expectedStatus: "held" })).rejects.toThrow(/oferta foi aceita/);
    expect((await db.select().from(deskBooking).where(eq(deskBooking.id, offer.holdBookingId)))[0].status).toBe("confirmed");
    // Com a tela atualizada, a decisão é explícita sobre uma reserva confirmada: aviso e auditoria de reserva, não de oferta.
    const r = await cancelDesk(db, fac.actor, offer.holdBookingId, { reason: "visita", expectedStatus: "confirmed" });
    expect(r.kind).toBe("cancelled");
    const [audit] = await db.select().from(auditEvent).where(and(eq(auditEvent.action, "booking.cancelled_by_admin"), eq(auditEvent.entityId, offer.holdBookingId)));
    expect((audit.before as { status: string }).status).toBe("confirmed");
    const [mail] = await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, `booking.cancelled:${offer.holdBookingId}`));
    expect(mail.eventType).toBe("email.booking_changed");
  });

  it("TR-08: cancelamento que encontra a reserva cancelada por outra transação responde 'já foi cancelada', não 'a oferta venceu'", async () => {
    const p = await seedEmployee();
    const desk = await seedDesk("C001");
    const b = await bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() });
    const fac = await privilegedActor({ roles: ["facilities"] });
    const ext = await owner.connect();
    try {
      await ext.query("begin");
      await ext.query("select id from resource where id = $1 for update", [desk.id]);
      const admin = settle(cancelDesk(db, fac.actor, b.bookingId, { reason: "x", expectedStatus: "confirmed" }));
      await waitBlocked(1);
      // A própria pessoa cancela por outra transação enquanto o cancelamento administrativo espera a mesa.
      await ext.query("update desk_booking set status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'cancelada pela própria pessoa' where id = $1", [b.bookingId, p.id]);
      await ext.query("commit");
      const r = await admin;
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.e).toMatch(/já foi cancelada/);
    } finally {
      await ext.query("rollback").catch(() => null);
      ext.release();
    }
  });

  it("TR-08 e pista da revisão: retirar oferta vencida e não varrida expira a inscrição e oferece a mesa à próxima pessoa na mesma transação", async () => {
    const { date, desk, p, offer } = await offerScenario();
    const q = await seedEmployee();
    await ownerQuery("insert into waitlist_entry (employee_id, date) values ($1, $2::date)", [q.id, date]);
    await ageOpenOffers(offer.id);
    const fac = await privilegedActor({ roles: ["facilities"] });
    await expect(cancelDesk(db, fac.actor, offer.holdBookingId, { reason: "visita", expectedStatus: "held" })).rejects.toThrow(/já tinha vencido/);
    expect((await entryOf(p.id)).status).toBe("expired");
    const [next] = await openOffers();
    expect(next.resourceId).toBe(desk.id);
    expect(next.entryId).toBe((await entryOf(q.id)).id);
  });

  it("TR-02: mesa em revisão com liberação ao compartilhado vigente conta como exclusiva no serviço e no banco (DIR-018, DIR-026)", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const ex = await seedDesk("R001");
    await seedDesk("R002");
    const [a] = await db.insert(exclusiveAssignment).values({ resourceId: ex.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    await db.insert(accessException).values({ assignmentId: a.id, resourceId: ex.id, kind: "release_to_shared", startsOn: d(1), endsOn: d(1), reason: "férias" });
    await ownerQuery("update exclusive_assignment set needs_review = true where id = $1", [a.id]);
    const rs = await loadResourcesOnDate(db, d(1), { types: ["desk"] });
    const sqlClasses = await db.execute(sql`select code, desk_class(id, ${d(1)}::date) as c from resource where type = 'desk' order by code`);
    expect(rs.map((r) => [r.code, deskClass(r)]).sort()).toEqual((sqlClasses.rows as Array<{ code: string; c: string }>).map((r) => [r.code, r.c]).sort());
    expect(deskClass(rs.find((r) => r.code === "R001")!)).toBe("exclusive");
    const cap = await capacityOn(db, d(1));
    expect(cap.desks).toMatchObject({ total: 2, shared: 1, exclusive: 1 });
  });

  it("TR-03: autorização do Meu time dada a um gestor não revive quando ele é desativado e readmitido", async () => {
    const m1 = await seedEmployee({ roles: ["manager"] });
    const p = await seedEmployee();
    await db.update(employee).set({ managerEmployeeId: m1.id }).where(eq(employee.id, p.id));
    await setShareWithManager(db, actorOf(p), true);
    expect(await sharesWithManager(db, p.id)).toBe(true);
    const rh = await privilegedActor({ roles: ["hr"] });
    await deactivateEmployee(db, rh.actor, m1.id, { reason: "desligamento" });
    expect(await sharesWithManager(db, p.id)).toBe(false);
    await readmitEmployee(db, rh.actor, m1.id, { hireDate: today, reason: "retorno" });
    await db.update(employee).set({ status: "active" }).where(eq(employee.id, m1.id));
    expect(await sharesWithManager(db, p.id)).toBe(false);
  });

  it("TR-05: fechar o dia com oferta vencida e não varrida encerra a inscrição com o aviso de fechamento e o ator, sem aviso de vencimento", async () => {
    const { date, p, offer } = await offerScenario();
    await ageOpenOffers(offer.id);
    const fac = await privilegedActor({ roles: ["facilities"] });
    const preview = await previewCloseDay(db, fac.actor, date);
    await closeDay(db, fac.actor, { date, reason: "feriado" }, preview.conflicts.map((c) => ({ bookingId: c.bookingId, action: "cancel" as const, reason: "feriado" })));
    const entry = await entryOf(p.id);
    expect(entry.status).toBe("cancelled");
    expect(entry.closedBy).toBe(fac.actor.employeeId);
    expect(entry.closeReason).toContain("escritório fechado");
    expect((await db.select().from(deskBooking).where(eq(deskBooking.id, offer.holdBookingId)))[0].status).toBe("expired");
    expect(await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, `waitlist.closed:${entry.id}`))).toHaveLength(1);
    expect(await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, `waitlist.expired:${offer.id}`))).toHaveLength(0);
  });

  it("TR-06: mesa com oferta retirada da inscrição não aparece nas opções da oferta manual e, se pedida, é recusada com o motivo", async () => {
    const { date, desk, p, offer } = await offerScenario();
    const fac = await privilegedActor({ roles: ["facilities"] });
    await cancelDesk(db, fac.actor, offer.holdBookingId, { reason: "visita", expectedStatus: "held" });
    const entry = await entryOf(p.id);
    expect(entry.status).toBe("waiting");
    const options = await manualOfferOptions(db, p.id, date, entry.id);
    expect(options.map((o) => o.id)).not.toContain(desk.id);
    await expect(offerManually(db, fac.actor, { entryId: entry.id, resourceId: desk.id })).rejects.toThrow(/retirada desta pessoa pela administração/);
  });

  it("TR-09: pelo papel da aplicação, a oferta aberta não tem o prazo estendido nem nasce além do fim do dia; encerramento da reserva congelado", async () => {
    const { date, desk, p, offer } = await offerScenario();
    // estender só a oferta
    expect(await dbRule(db.execute(sql`update waitlist_offer set expires_at = expires_at + interval '1 hour' where id = ${offer.id}`))).toMatch(/offer_deadline_immutable/);
    // estender retenção e oferta juntas, na mesma transação
    expect(
      await dbRule(
        db.transaction(async (tx) => {
          await tx.execute(sql`update desk_booking set hold_expires_at = hold_expires_at + interval '365 days' where id = ${offer.holdBookingId}`);
          await tx.execute(sql`update waitlist_offer set expires_at = expires_at + interval '365 days' where id = ${offer.id}`);
        }),
      ),
    ).toMatch(/offer_deadline_immutable/);
    // oferta nova com prazo além do fim do dia da data
    const q = await seedEmployee();
    const k2 = await seedDesk("K002");
    expect(
      await dbRule(
        db.transaction(async (tx) => {
          const [e] = await tx.insert(waitlistEntry).values({ employeeId: q.id, date }).returning({ id: waitlistEntry.id });
          await tx.update(waitlistEntry).set({ status: "offered" }).where(eq(waitlistEntry.id, e.id));
          const far = new Date(Date.now() + 5 * 86_400_000);
          const [h] = await tx.insert(deskBooking).values({ resourceId: k2.id, employeeId: q.id, bookingDate: date, status: "held", origin: "waitlist_offer", actorEmployeeId: q.id, holdExpiresAt: far }).returning({ id: deskBooking.id });
          await tx.insert(waitlistOffer).values({ entryId: e.id, resourceId: k2.id, holdBookingId: h.id, expiresAt: far });
        }),
      ),
    ).toMatch(/offer_beyond_day/);
    // encerramento de reserva cancelada não é reescrito
    await acceptOffer(db, actorOf(p), offer.id);
    await cancelDesk(db, actorOf(p), offer.holdBookingId, { expectedStatus: "confirmed" });
    expect(await dbRule(db.execute(sql`update desk_booking set cancel_reason = 'outro motivo' where id = ${offer.holdBookingId}`))).toMatch(/booking_already_closed/);
    void desk;
  });

  it("TR-12: reserva em nome que perde a inscrição da pessoa para oferta concorrente responde ao operador sobre a pessoa, não sobre ele", async () => {
    const date = d(1);
    await fullWith(date, "K001");
    const p = await seedEmployee();
    const entry = await joinWaitlist(db, actorOf(p), { date });
    const k2 = await seedDesk("K002");
    const k3 = await seedDesk("K003");
    const operator = await privilegedActor({ roles: ["hr"], permissions: ["booking.on_behalf.create"] });
    const ext = await owner.connect();
    try {
      await ext.query("begin");
      await ext.query("update waitlist_entry set status = 'offered' where id = $1 and status = 'waiting'", [entry.entryId]);
      const expires = new Date(Date.now() + 3_600_000);
      const b = await ext.query("insert into desk_booking (resource_id, employee_id, booking_date, status, origin, actor_employee_id, hold_expires_at) values ($1, $2, $3::date, 'held', 'waitlist_offer', $2, $4) returning id", [k2.id, p.id, date, expires]);
      await ext.query("insert into waitlist_offer (entry_id, resource_id, hold_booking_id, expires_at) values ($1, $2, $3, $4)", [entry.entryId, k2.id, b.rows[0].id, expires]);
      const direct = settle(bookDesk(db, operator.actor, { employeeId: p.id, resourceId: k3.id, date, idempotencyKey: randomUUID() }));
      await waitBlocked(1);
      await ext.query("commit");
      const r = await direct;
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.e).toMatch(/oferecida a esta pessoa/);
    } finally {
      await ext.query("rollback").catch(() => null);
      ext.release();
    }
  });

  it("TR-13: aviso de encerramento por mesa própria livre traz a data e o código da mesa", async () => {
    const date = d(1);
    const holder = await seedEmployee({ orgCondition: "director" });
    const ex = await seedDesk("X001");
    const [a] = await db.insert(exclusiveAssignment).values({ resourceId: ex.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "t", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
    const benef = await seedEmployee();
    const [x] = await db.insert(accessException).values({ assignmentId: a.id, resourceId: ex.id, kind: "release_to_employee", beneficiaryEmployeeId: benef.id, startsOn: date, endsOn: date, reason: "t" }).returning({ id: accessException.id });
    const { taker, booking } = await fullWith(date, "S001");
    await joinWaitlist(db, actorOf(holder), { date });
    await ownerQuery("update access_exception set revoked_at = now() where id = $1", [x.id]);
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const entry = await entryOf(holder.id);
    expect(entry.status).toBe("cancelled");
    const [mail] = await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, `waitlist.closed:${entry.id}`));
    const text = (mail.payload as { message: { text: string; subject: string } }).message.text;
    expect(text).toContain("X001");
    expect(text).toContain(date.split("-").reverse().join("/"));
  });

  it("TR-15 (achado 32 da primeira rodada): demanda não atendida conta oferta vencida como espera e cobre exatamente 14 datas", async () => {
    const { date, offer } = await offerScenario();
    expect((await unmetDemand(db)).find((x) => x.date === date)).toMatchObject({ waiting: 0, offered: 1 });
    await ageOpenOffers(offer.id);
    expect((await unmetDemand(db)).find((x) => x.date === date)).toMatchObject({ waiting: 1, offered: 0 });
    // janela: hoje até hoje + 13 (14 datas); a 15ª data fica de fora
    const late = await seedEmployee();
    await ownerQuery("insert into waitlist_entry (employee_id, date) values ($1, $2::date)", [late.id, d(14)]);
    const edge = await seedEmployee();
    await ownerQuery("insert into waitlist_entry (employee_id, date) values ($1, $2::date)", [edge.id, d(13)]);
    const dates = (await unmetDemand(db)).map((x) => x.date);
    expect(dates).toContain(d(13));
    expect(dates).not.toContain(d(14));
  });

  it("TR-15: alteração de capacidade e zona de sala entra na auditoria com antes e depois", async () => {
    const fac = await privilegedActor({ roles: ["facilities"] });
    const room = await seedDesk("SALA1", "room");
    const [z] = await db.insert(zone).values({ code: `Z${randomUUID().slice(0, 5)}`, name: "Zona teste" }).returning({ id: zone.id });
    const [before] = await db.select({ capacity: resource.capacity, zoneId: resource.zoneId }).from(resource).where(eq(resource.id, room.id));
    await updateResourceAttributes(db, fac.actor, room.id, { attributes: { tela: true }, zoneId: z.id, capacity: 12, verified: true });
    const [ev] = await db.select().from(auditEvent).where(and(eq(auditEvent.action, "resource.updated"), eq(auditEvent.entityId, room.id)));
    expect(ev.before).toMatchObject({ capacity: before.capacity, zoneId: before.zoneId });
    expect(ev.after).toMatchObject({ capacity: 12, zoneId: z.id });
  });
});
