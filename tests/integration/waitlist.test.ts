import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { accessGroupMember, auditEvent, deskBooking, exclusiveAssignment, officeCalendar, outboxEvent, waitlistEntry, waitlistOffer } from "@/db/schema";
import { stateForPerson } from "@/modules/availability/service";
import { bookDesk, cancelDesk, planWeek } from "@/modules/booking/service";
import { deactivateEmployee, suspendEmployee } from "@/modules/employees/service";
import { ForbiddenError, ValidationError } from "@/modules/shared/errors";
import { addDays, localToday } from "@/modules/shared/dates";
import { acceptOffer, declineOffer, expireDueOffers, joinWaitlist, leaveWaitlist, listQueue, myQueue, offerFreeDesks, offerManually, unmetDemand } from "@/modules/waitlist/service";
import { availableDesksFor, createStatusPeriod, previewStatusPeriod } from "@/modules/workplace/service";
import { ageOpenOffers, directorsGroupId, privilegedActor, resetDb, seedDesk, seedEmployee } from "./helpers";

/*
 * Fila de espera: WL-01 (sem dupla oferta), WL-02 (próxima pessoa elegível automática), WL-03 (inscrição negada com
 * reserva), WL-04 (expiração preguiçosa; reserva direta oferece antes), DIR-025-T1, DIR-007-T1, DIR-034-T2.
 */

const today = localToday();
const d = (n: number) => addDays(today, n);
const actorOf = (e: { id: string }) => ({ employeeId: e.id, userId: `u-${e.id}`, requestId: randomUUID() });

async function entriesOf(employeeId: string) {
  return db.select().from(waitlistEntry).where(eq(waitlistEntry.employeeId, employeeId));
}
async function openOffers() {
  return db.select().from(waitlistOffer).where(eq(waitlistOffer.status, "open"));
}
/** Simula a passagem do prazo: retenção e oferta vencidas no banco (só o papel dono, só em teste). */
async function ageOffer(offerId: string) {
  await ageOpenOffers(offerId);
}
/** Escritório cheio: uma mesa, reservada por `taker`. */
async function fullOffice(date: string) {
  const taker = await seedEmployee();
  const desk = await seedDesk("F001");
  const booking = await bookDesk(db, actorOf(taker), { employeeId: taker.id, resourceId: desk.id, date, idempotencyKey: randomUUID() });
  return { taker, desk, booking };
}

describe("fila de espera", () => {
  beforeEach(resetDb);

  it("WL-03-T1: inscrição negada a quem tem reserva ativa (PAR-30) e a quem tem mesa disponível (DEC-25); repetição devolve a mesma inscrição", async () => {
    const { taker, desk } = await fullOffice(d(1));
    await expect(joinWaitlist(db, actorOf(taker), { date: d(1) })).rejects.toThrow(/já tem reserva/);
    const other = await seedEmployee();
    const free = await seedDesk("F002");
    await expect(joinWaitlist(db, actorOf(other), { date: d(1) })).rejects.toThrow(/1 mesa\(s\) disponível/);
    // ocupa a segunda mesa: agora não há mesa disponível e a inscrição passa
    const third = await seedEmployee();
    await bookDesk(db, actorOf(third), { employeeId: third.id, resourceId: free.id, date: d(1), idempotencyKey: randomUUID() });
    const first = await joinWaitlist(db, actorOf(other), { date: d(1), preferences: { zoneCode: "A" } });
    expect(first.created).toBe(true);
    const again = await joinWaitlist(db, actorOf(other), { date: d(1) });
    expect(again).toEqual({ entryId: first.entryId, created: false });
    expect(await entriesOf(other.id)).toHaveLength(1);
    // data passada, escritório fechado e janela fechada recusam
    await expect(joinWaitlist(db, actorOf(other), { date: d(-1) })).rejects.toBeInstanceOf(ValidationError);
    await db.insert(officeCalendar).values({ date: d(3), isOpen: false, reason: "feriado" });
    await expect(joinWaitlist(db, actorOf(other), { date: d(3) })).rejects.toThrow(/fechado/);
    await expect(joinWaitlist(db, actorOf(other), { date: d(60) })).rejects.toThrow(/ainda não abriram/);
    // pessoa sem permissão de reserva não entra
    const noPerm = await seedEmployee({ status: "suspended" });
    await expect(joinWaitlist(db, actorOf(noPerm), { date: d(1) })).rejects.toBeInstanceOf(ForbiddenError);
    void desk;
  });

  it("WL-01-T1: cancelamento oferece a mesa a exatamente uma pessoa (a primeira da fila), com retenção, oferta e email; a segunda continua em espera", async () => {
    const { taker, desk, booking } = await fullOffice(d(1));
    const a = await seedEmployee({ name: "Primeira" });
    const b = await seedEmployee({ name: "Segunda" });
    await joinWaitlist(db, actorOf(a), { date: d(1) });
    await joinWaitlist(db, actorOf(b), { date: d(1) });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const offers = await openOffers();
    expect(offers).toHaveLength(1);
    const [entryA] = await entriesOf(a.id);
    const [entryB] = await entriesOf(b.id);
    expect(offers[0].entryId).toBe(entryA.id);
    expect(entryA.status).toBe("offered");
    expect(entryB.status).toBe("waiting");
    const [hold] = await db.select().from(deskBooking).where(eq(deskBooking.id, offers[0].holdBookingId));
    expect(hold).toMatchObject({ status: "held", origin: "waitlist_offer", employeeId: a.id, resourceId: desk.id });
    expect(hold.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(hold.holdExpiresAt!.getTime()).toBe(offers[0].expiresAt.getTime());
    const mails = await db.select().from(outboxEvent).where(eq(outboxEvent.eventType, "email.waitlist"));
    expect(mails).toHaveLength(1);
    expect(JSON.stringify(mails[0].payload)).toContain(a.email);
    expect(JSON.stringify(mails[0].payload)).not.toContain(b.email);
    // o mapa: para B a mesa está reservada (retenção viva de terceiro); para A é "sua reserva" (retida)
    expect((await stateForPerson(db, b.id, d(1))).items[0].availability.code).toBe("reserved");
    expect((await stateForPerson(db, a.id, d(1))).items[0].availability.code).toBe("mine");
    // minha fila: A vê a oferta com prazo; B vê espera
    const mine = await myQueue(db, a.id);
    expect(mine[0].offer?.resourceCode).toBe("F001");
    expect((await myQueue(db, b.id))[0].status).toBe("waiting");
    // painel: duas linhas, demanda não atendida conta espera e oferta separadas
    const q = await listQueue(db, { date: d(1) });
    expect(q.map((r) => r.employeeName)).toEqual(["Primeira", "Segunda"]);
    expect(await unmetDemand(db)).toEqual([{ date: d(1), waiting: 1, offered: 1 }]);
  });

  it("WL-01-T2: cancelamentos e inscrições concorrentes, no mesmo lote: nunca dupla retenção, dupla inscrição ou oferta sem retenção", async () => {
    for (let round = 0; round < 5; round++) {
      await resetDb();
      const { taker, booking } = await fullOffice(d(1));
      const people = await Promise.all(Array.from({ length: 6 }, () => seedEmployee()));
      const ops = [
        ...people.flatMap((p) => [() => joinWaitlist(db, actorOf(p), { date: d(1) }), () => joinWaitlist(db, actorOf(p), { date: d(1) })]),
        ...Array.from({ length: 4 }, () => () => cancelDesk(db, actorOf(taker), booking.bookingId)),
      ];
      const results = await Promise.allSettled(ops.map((f) => f()));
      const cancels = results.slice(people.length * 2);
      expect(cancels.filter((c) => c.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
      for (const r of results.slice(0, people.length * 2)) if (r.status === "rejected") expect(String(r.reason.message)).toMatch(/mesa\(s\) disponível|Outra operação/);
      const live = await db.execute(sql`select employee_id, count(*)::int as n from waitlist_entry where status in ('waiting', 'offered') group by employee_id having count(*) > 1`);
      expect(live.rows, `rodada ${round}: inscrição dupla`).toHaveLength(0);
      expect((await openOffers()).length).toBeLessThanOrEqual(1);
      expect((await db.select().from(deskBooking).where(eq(deskBooking.status, "held"))).length).toBeLessThanOrEqual(1);
      // se a mesa ficou livre com gente em espera (inscrição posterior à foto), a varredura oferece
      await offerFreeDesks(db);
      const waitingNow = await db.select().from(waitlistEntry).where(eq(waitlistEntry.status, "waiting"));
      const offersNow = await openOffers();
      if (waitingNow.length + offersNow.length > 0) expect(offersNow).toHaveLength(1);
    }
  });

  it("aceitar converte a retenção em reserva confirmada; oferta alheia é inexistente; aceite após vencimento é recusado", async () => {
    const { taker, booking } = await fullOffice(d(1));
    const a = await seedEmployee();
    const intruder = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date: d(1) });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [offer] = await openOffers();
    await expect(acceptOffer(db, actorOf(intruder), offer.id)).rejects.toThrow(/Oferta não encontrada/);
    await expect(declineOffer(db, actorOf(intruder), offer.id)).rejects.toThrow(/Oferta não encontrada/);
    const r = await acceptOffer(db, actorOf(a), offer.id);
    expect(r.resourceCode).toBe("F001");
    const [b] = await db.select().from(deskBooking).where(eq(deskBooking.id, offer.holdBookingId));
    expect(b.status).toBe("confirmed");
    expect(b.holdExpiresAt).toBeNull();
    expect((await entriesOf(a.id))[0].status).toBe("accepted");
    await expect(acceptOffer(db, actorOf(a), offer.id)).rejects.toThrow(/venceu ou já foi decidida/);
    // vencida: aceite recusado e nada muda
    const c = await seedEmployee();
    const desk2 = await seedDesk("F002");
    const bk = await bookDesk(db, actorOf(taker), { employeeId: taker.id, resourceId: desk2.id, date: d(2), idempotencyKey: randomUUID() });
    // d(2) tem F001 livre para c: a inscrição é recusada por DEC-25; ocupa as mesas livres e c entra na fila
    await expect(joinWaitlist(db, actorOf(c), { date: d(2) })).rejects.toThrow(/mesa\(s\) disponível/);
    const free = await availableDesksFor(db, c.id, d(2));
    expect(free.length).toBeGreaterThan(0);
    for (const f of free) {
      const p = await seedEmployee();
      await bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: f.id, date: d(2), idempotencyKey: randomUUID() });
    }
    await joinWaitlist(db, actorOf(c), { date: d(2) });
    await cancelDesk(db, actorOf(taker), bk.bookingId);
    const [o2] = (await openOffers()).filter((o) => o.resourceId === desk2.id);
    await ageOffer(o2.id);
    await expect(acceptOffer(db, actorOf(c), o2.id)).rejects.toThrow(/venceu/);
  });

  it("WL-02-T1 e REQ-26: oferta vencida passa automaticamente à próxima pessoa elegível pela varredura; a primeira sai da fila e é avisada", async () => {
    const { taker, desk, booking } = await fullOffice(d(1));
    const a = await seedEmployee();
    const b = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date: d(1) });
    await joinWaitlist(db, actorOf(b), { date: d(1) });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [offerA] = await openOffers();
    await ageOffer(offerA.id);
    // leitura ignora a retenção vencida: para B a mesa está disponível
    expect((await stateForPerson(db, b.id, d(1))).items[0].availability.code).toBe("available");
    expect(await myQueue(db, a.id)).toHaveLength(0);
    expect(await expireDueOffers(db)).toBe(1);
    const [entryA] = await entriesOf(a.id);
    const [entryB] = await entriesOf(b.id);
    expect(entryA.status).toBe("expired");
    expect(entryB.status).toBe("offered");
    const [offerB] = await openOffers();
    expect(offerB.entryId).toBe(entryB.id);
    expect(offerB.resourceId).toBe(desk.id);
    const [oldOffer] = await db.select().from(waitlistOffer).where(eq(waitlistOffer.id, offerA.id));
    expect(oldOffer.status).toBe("expired");
    const mails = await db.select().from(outboxEvent).where(eq(outboxEvent.eventType, "email.waitlist"));
    expect(mails.map((m) => m.idempotencyKey).sort()).toEqual([`waitlist.expired:${offerA.id}`, `waitlist.offered:${offerA.id}`, `waitlist.offered:${offerB.id}`].sort());
    expect(await db.select().from(auditEvent).where(eq(auditEvent.action, "waitlist.offer_expired"))).toHaveLength(1);
    // segunda varredura não faz nada
    expect(await expireDueOffers(db)).toBe(0);
  });

  it("WL-04-T2 e PAR-37: reserva direta que expira uma retenção oferece à fila antes de conceder; sem fila, entra (DIR-034-T2)", async () => {
    const { taker, desk, booking } = await fullOffice(d(1));
    const a = await seedEmployee();
    const b = await seedEmployee();
    const c = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date: d(1) });
    await joinWaitlist(db, actorOf(b), { date: d(1) });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [offerA] = await openOffers();
    await ageOffer(offerA.id);
    // C clica primeiro: a retenção vencida é expirada e a mesa vai para B, não para C
    await expect(bookDesk(db, actorOf(c), { employeeId: c.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/oferecida à próxima pessoa da fila/);
    const [offerB] = await openOffers();
    expect((await entriesOf(b.id))[0].id).toBe(offerB.entryId);
    // B recusa: ninguém mais na fila; C entra direto (DIR-034-T2: retenção vencida ou recusada não trava)
    await declineOffer(db, actorOf(b), offerB.id);
    expect(await openOffers()).toHaveLength(0);
    await expect(bookDesk(db, actorOf(c), { employeeId: c.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).resolves.toMatchObject({ created: true });
    const holds = await db.select().from(deskBooking).where(and(eq(deskBooking.resourceId, desk.id), eq(deskBooking.status, "held")));
    expect(holds).toHaveLength(0);
  });

  it("WL-04-T1: inscrição obsoleta (oferta vencida) é expirada de forma preguiçosa pela escrita seguinte; a pessoa entra de novo sem violação de unicidade", async () => {
    const { taker, booking } = await fullOffice(d(1));
    const a = await seedEmployee();
    const c = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date: d(1) });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [offer] = await openOffers();
    await ageOffer(offer.id);
    // ninguém mais em espera: C reserva direto e, no caminho de escrita, expira a retenção e a inscrição obsoleta de A
    await expect(bookDesk(db, actorOf(c), { employeeId: c.id, resourceId: offer.resourceId, date: d(1), idempotencyKey: randomUUID() })).resolves.toMatchObject({ created: true });
    expect((await entriesOf(a.id)).map((e) => e.status)).toEqual(["expired"]);
    expect((await db.select().from(waitlistOffer).where(eq(waitlistOffer.id, offer.id)))[0].status).toBe("expired");
    // A entra de novo: nova inscrição convive com a expirada (unicidade só entre vivas)
    const again = await joinWaitlist(db, actorOf(a), { date: d(1) });
    expect(again.created).toBe(true);
    expect((await entriesOf(a.id)).map((e) => e.status).sort()).toEqual(["expired", "waiting"]);
    // a leitura da pessoa mostra só a inscrição viva
    expect(await myQueue(db, a.id)).toHaveLength(1);
  });

  it("WL-04-T3: semana atômica cede à fila (PAR-37): conflito explícito, oferta persistida, repetição da chave igual; quem está na fila e planeja a semana sai da fila", async () => {
    await fullOffice(d(1));
    const a = await seedEmployee();
    const c = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date: d(1) });
    const f2 = await seedDesk("F002");
    const key = randomUUID();
    const r = await planWeek(db, actorOf(c), { idempotencyKey: key, days: [{ date: d(1), intent: "onsite", resourceId: f2.id }] });
    expect(r.ok).toBe(false);
    expect(r.conflicts[0]).toMatchObject({ date: d(1), resourceCode: "F002" });
    expect(r.conflicts[0].reason).toMatch(/fila de espera/);
    const [offer] = await openOffers();
    expect(offer.resourceId).toBe(f2.id);
    expect(offer.entryId).toBe((await entriesOf(a.id))[0].id);
    expect(await planWeek(db, actorOf(c), { idempotencyKey: key, days: [{ date: d(1), intent: "onsite", resourceId: f2.id }] })).toEqual(r);
    expect(await openOffers()).toHaveLength(1);
    // W em espera (A já tem oferta): W planeja a semana com uma mesa nova e consegue; a inscrição de W é encerrada
    const w = await seedEmployee();
    await joinWaitlist(db, actorOf(w), { date: d(1) });
    const f3 = await seedDesk("F003");
    const rw = await planWeek(db, actorOf(w), { idempotencyKey: randomUUID(), days: [{ date: d(1), intent: "onsite", resourceId: f3.id }] });
    expect(rw.ok).toBe(true);
    const [we] = await entriesOf(w.id);
    expect(we.status).toBe("cancelled");
    expect(we.closeReason).toMatch(/planejamento da semana/);
  });

  it("REQ-26: a oferta pula a candidata inelegível e vai à próxima elegível da fila", async () => {
    const group = await directorsGroupId();
    const m1 = await seedEmployee({ orgCondition: "director" });
    const m2 = await seedEmployee({ orgCondition: "director" });
    await db.insert(accessGroupMember).values({ groupId: group, employeeId: m1.id, validFrom: today, reason: "t" });
    await db.insert(accessGroupMember).values({ groupId: group, employeeId: m2.id, validFrom: today, reason: "t" });
    const g = await seedDesk("G001");
    await db.insert(exclusiveAssignment).values({ resourceId: g.id, mode: "group", accessGroupId: group, validFrom: today, reason: "t", responsible: "RH" });
    const mb = await bookDesk(db, actorOf(m1), { employeeId: m1.id, resourceId: g.id, date: d(1), idempotencyKey: randomUUID() });
    await fullOffice(d(1));
    const common = await seedEmployee();
    await joinWaitlist(db, actorOf(common), { date: d(1) });
    await joinWaitlist(db, actorOf(m2), { date: d(1) });
    await cancelDesk(db, actorOf(m1), mb.bookingId);
    const [offer] = await openOffers();
    expect(offer.entryId).toBe((await entriesOf(m2.id))[0].id);
    expect((await entriesOf(common.id))[0].status).toBe("waiting");
  });

  it("DIR-025-T1 e DIR-006: titular cancela a mesa exclusiva com fila em espera: ninguém recebe oferta, a mesa segue exclusiva e a inscrição em espera", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const common = await seedEmployee();
    const ex = await seedDesk("X001");
    await db.insert(exclusiveAssignment).values({ resourceId: ex.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "t", responsible: "RH" });
    const shared = await seedDesk("S001");
    const filler = await seedEmployee();
    await bookDesk(db, actorOf(filler), { employeeId: filler.id, resourceId: shared.id, date: d(1), idempotencyKey: randomUUID() });
    const hb = await bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: ex.id, date: d(1), idempotencyKey: randomUUID() });
    await joinWaitlist(db, actorOf(common), { date: d(1) });
    await cancelDesk(db, actorOf(holder), hb.bookingId);
    expect(await openOffers()).toHaveLength(0);
    expect((await entriesOf(common.id))[0].status).toBe("waiting");
    expect((await stateForPerson(db, common.id, d(1))).items.find((i) => i.resource.code === "X001")?.availability.label).toBe("Uso exclusivo — Diretoria");
    // DIR-007-T1: nem a varredura de mesas livres oferece a exclusiva; nem a oferta manual
    expect(await offerFreeDesks(db)).toBe(0);
    expect((await availableDesksFor(db, common.id, d(1))).map((x) => x.code)).toEqual([]);
    const fac = await privilegedActor({ roles: ["facilities"] });
    const [entry] = await entriesOf(common.id);
    // Oferta manual de mesa exclusiva: resposta única, que não revela vínculo (achado AUT-04 da revisão).
    await expect(offerManually(db, fac.actor, { entryId: entry.id, resourceId: ex.id })).rejects.toThrow(/Só mesa do conjunto compartilhado/);
    // a compartilhada liberada vai para a fila
    const [fb] = await db.select().from(deskBooking).where(and(eq(deskBooking.employeeId, filler.id), eq(deskBooking.status, "confirmed")));
    await cancelDesk(db, actorOf(filler), fb.id);
    expect((await openOffers())[0].resourceId).toBe(shared.id);
  });

  it("oferta manual pela administração exige waitlist.admin, registra o ator e respeita elegibilidade; retirar alguém exige motivo", async () => {
    const { taker, desk, booking } = await fullOffice(d(1));
    const a = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date: d(1) });
    const rh = await privilegedActor({ roles: ["hr"] });
    const fac = await privilegedActor({ roles: ["facilities"] });
    const [entry] = await entriesOf(a.id);
    await expect(offerManually(db, rh.actor, { entryId: entry.id, resourceId: desk.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(offerManually(db, fac.actor, { entryId: entry.id, resourceId: desk.id })).rejects.toThrow(/reservada/);
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    // o cancelamento já ofereceu automaticamente; a inscrição não está mais em espera
    await expect(offerManually(db, fac.actor, { entryId: entry.id, resourceId: desk.id })).rejects.toThrow(/já não está em espera/);
    const [offer] = await openOffers();
    await declineOffer(db, actorOf(a), offer.id);
    // entra de novo: DEC-25 recusa porque a mesa está livre; então a oferta manual serve para quem ficou esperando outra pessoa
    const b = await seedEmployee();
    const filler = await seedEmployee();
    await bookDesk(db, actorOf(filler), { employeeId: filler.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() });
    await joinWaitlist(db, actorOf(b), { date: d(1) });
    const [entryB] = await entriesOf(b.id);
    await expect(leaveWaitlist(db, fac.actor, entryB.id)).rejects.toThrow(/motivo/);
    await expect(leaveWaitlist(db, rh.actor, entryB.id, { reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    const desk2 = await seedDesk("F002");
    const made = await offerManually(db, fac.actor, { entryId: entryB.id, resourceId: desk2.id });
    expect(made.employeeId).toBe(b.id);
    const [hold] = await db.select().from(deskBooking).where(eq(deskBooking.id, made.holdBookingId));
    expect(hold.actorEmployeeId).toBe(fac.id);
    const audit = await db.select().from(auditEvent).where(eq(auditEvent.action, "waitlist.offered_manually"));
    expect(audit).toHaveLength(1);
    expect(audit[0].actorEmployeeId).toBe(fac.id);
    // retirar pela administração com motivo: oferta recusada, retenção cancelada
    await leaveWaitlist(db, fac.actor, entryB.id, { reason: "pedido por telefone" });
    expect((await entriesOf(b.id))[0].status).toBe("cancelled");
    expect((await db.select().from(deskBooking).where(eq(deskBooking.id, made.holdBookingId)))[0].status).toBe("cancelled");
    expect(await openOffers()).toHaveLength(0);
  });

  it("varredura de mesas livres atende a fila na ordem de inscrição, com preferência de zona quando possível", async () => {
    const { taker, booking } = await fullOffice(d(1));
    const a = await seedEmployee();
    const b = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date: d(1) });
    await joinWaitlist(db, actorOf(b), { date: d(1) });
    // duas mesas novas ficam livres sem passar pelo cancelamento (inventário novo): a varredura oferece a A e a B
    await seedDesk("N001");
    await seedDesk("N002");
    expect(await offerFreeDesks(db)).toBe(2);
    expect(await openOffers()).toHaveLength(2);
    expect((await entriesOf(a.id))[0].status).toBe("offered");
    expect((await entriesOf(b.id))[0].status).toBe("offered");
    expect(await offerFreeDesks(db)).toBe(0);
    void taker;
    void booking;
  });

  it("desativação e suspensão tiram a pessoa da fila; retenção da pessoa desativada é cancelada e a mesa vai à próxima", async () => {
    const { taker, desk, booking } = await fullOffice(d(1));
    const a = await seedEmployee();
    const b = await seedEmployee();
    const c = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date: d(1) });
    await joinWaitlist(db, actorOf(b), { date: d(1) });
    await joinWaitlist(db, actorOf(c), { date: d(1) });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const rh = await privilegedActor({ roles: ["hr"] });
    await suspendEmployee(db, rh.actor, c.id, "afastamento");
    expect((await entriesOf(c.id))[0].status).toBe("cancelled");
    await deactivateEmployee(db, rh.actor, a.id, { reason: "desligamento" });
    expect((await entriesOf(a.id))[0].status).toBe("cancelled");
    const [offA] = await db.select().from(waitlistOffer).where(eq(waitlistOffer.entryId, (await entriesOf(a.id))[0].id));
    expect(offA.status).toBe("declined");
    const [offB] = await openOffers();
    expect((await entriesOf(b.id))[0].id).toBe(offB.entryId);
    expect(offB.resourceId).toBe(desk.id);
  });

  it("oferta aberta atingida por manutenção: a prévia lista a retenção, realocar é recusado, cancelar retira a oferta e devolve a pessoa à fila com aviso", async () => {
    const { taker, desk, booking } = await fullOffice(d(1));
    const a = await seedEmployee();
    await joinWaitlist(db, actorOf(a), { date: d(1) });
    await cancelDesk(db, actorOf(taker), booking.bookingId);
    const [offer] = await openOffers();
    const fac = await privilegedActor({ roles: ["facilities"] });
    const preview = await previewStatusPeriod(db, fac.actor, { resourceId: desk.id, status: "maintenance", startsOn: d(1), endsOn: d(1), reason: "vazamento" });
    expect(preview.conflicts.map((c) => [c.bookingId, c.status])).toEqual([[offer.holdBookingId, "held"]]);
    const other = await seedDesk("F009");
    await expect(createStatusPeriod(db, fac.actor, { resourceId: desk.id, status: "maintenance", startsOn: d(1), endsOn: d(1), reason: "vazamento" }, [{ bookingId: offer.holdBookingId, action: "realloc", reason: "x", targetResourceId: other.id }])).rejects.toThrow(/não é realocada/);
    await createStatusPeriod(db, fac.actor, { resourceId: desk.id, status: "maintenance", startsOn: d(1), endsOn: d(1), reason: "vazamento" }, [{ bookingId: offer.holdBookingId, action: "cancel", reason: "vazamento" }]);
    expect((await db.select().from(waitlistOffer).where(eq(waitlistOffer.id, offer.id)))[0].status).toBe("expired");
    expect((await entriesOf(a.id))[0].status).toBe("waiting");
    expect(await db.select().from(outboxEvent).where(eq(outboxEvent.idempotencyKey, `waitlist.withdrawn:${offer.holdBookingId}`))).toHaveLength(1);
    expect(await db.select().from(auditEvent).where(eq(auditEvent.action, "waitlist.offer_withdrawn"))).toHaveLength(1);
    // a mesa nova (F009) está livre: a varredura oferece a ela, que continua primeira da fila
    expect(await offerFreeDesks(db)).toBe(1);
    expect((await openOffers())[0].resourceId).toBe(other.id);
  });
});
