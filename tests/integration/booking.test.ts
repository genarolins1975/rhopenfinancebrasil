import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { accessException, accessGroupMember, auditEvent, deskBooking, exclusiveAssignment, officeCalendar, outboxEvent, resourceStatusPeriod } from "@/db/schema";
import { stateForPerson } from "@/modules/availability/service";
import { bookDesk, cancelDesk, habitualDesk, listMyBookings, planWeek } from "@/modules/booking/service";
import { ConflictError, ForbiddenError } from "@/modules/shared/errors";
import { addDays, localToday } from "@/modules/shared/dates";
import { directorsGroupId, privilegedActor, resetDb, seedDesk, seedEmployee } from "./helpers";

const today = localToday();
const d = (n: number) => addDays(today, n);
const actorOf = (e: { id: string }) => ({ employeeId: e.id, userId: `u-${e.id}`, requestId: randomUUID() });

async function exclusiveFor(deskId: string, holderId: string, from = today, to: string | null = null) {
  const [a] = await db.insert(exclusiveAssignment).values({ resourceId: deskId, mode: "individual", holderEmployeeId: holderId, validFrom: from, validTo: to, reason: "teste", responsible: "RH" }).returning({ id: exclusiveAssignment.id });
  return a.id;
}

describe("reservas de mesa", () => {
  beforeEach(resetDb);

  it("DIR-008-T1 e DIR-002-T1: colaborador e outro diretor não reservam mesa individual da diretoria; o titular reserva (DIR-009-T1)", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const otherDirector = await seedEmployee({ orgCondition: "director" });
    const common = await seedEmployee();
    const desk = await seedDesk("M001");
    await exclusiveFor(desk.id, holder.id);
    for (const p of [common, otherDirector]) {
      await expect(bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/uso exclusivo da diretoria/);
    }
    const r = await bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: desk.id, date: d(1), idempotencyKey: "k1" });
    expect(r.created).toBe(true);
    // repetir a chave devolve a mesma reserva
    const again = await bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: desk.id, date: d(1), idempotencyKey: "k1" });
    expect(again).toEqual({ ...r, created: false });
    expect((await habitualDesk(db, holder.id))?.code).toBe("M001");
    // o mapa reflete o mesmo para todos os canais (DIR-004-T1): sem nome de titular para quem não pode ver
    const map = await stateForPerson(db, common.id, d(1));
    expect(map.items[0].availability.label).toBe("Uso exclusivo — Diretoria");
    expect(map.items[0].holder).toBeNull();
    expect(JSON.stringify(map)).not.toContain(holder.id);
    const rh = await stateForPerson(db, common.id, d(1), { holderView: true });
    expect(rh.items[0].holder?.name).toBe(holder.name);
  });

  it("DIR-010: integrante ativo reserva mesa de grupo; integrante com vigência encerrada e não integrante são negados", async () => {
    const member = await seedEmployee({ orgCondition: "director" });
    const former = await seedEmployee({ orgCondition: "director" });
    const common = await seedEmployee();
    const group = await directorsGroupId();
    await db.insert(accessGroupMember).values({ groupId: group, employeeId: member.id, validFrom: today, reason: "t" });
    await db.insert(accessGroupMember).values({ groupId: group, employeeId: former.id, validFrom: d(-10), validTo: d(-1), reason: "t" });
    const desk = await seedDesk();
    await db.insert(exclusiveAssignment).values({ resourceId: desk.id, mode: "group", accessGroupId: group, validFrom: today, reason: "t", responsible: "RH" });
    await expect(bookDesk(db, actorOf(former), { employeeId: former.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/uso exclusivo/);
    await expect(bookDesk(db, actorOf(common), { employeeId: common.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/uso exclusivo/);
    await expect(bookDesk(db, actorOf(member), { employeeId: member.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).resolves.toMatchObject({ created: true });
  });

  it("DIR-012-T1: uma reserva efetiva por dia, inclusive para o diretor; reserva em outra mesa não libera a exclusiva", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const common = await seedEmployee();
    const own = await seedDesk("M010");
    const shared = await seedDesk("M011");
    await exclusiveFor(own.id, holder.id);
    await bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: shared.id, date: d(1), idempotencyKey: randomUUID() });
    await expect(bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: own.id, date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/já tem reserva neste dia/);
    await expect(bookDesk(db, actorOf(common), { employeeId: common.id, resourceId: own.id, date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/uso exclusivo/);
  });

  it("DIR-006-T1: cancelar a reserva do titular não altera a exclusividade; BKG-01: cancelamento reflete de imediato", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const common = await seedEmployee();
    const desk = await seedDesk();
    const shared = await seedDesk();
    await exclusiveFor(desk.id, holder.id);
    const r = await bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: desk.id, date: d(2), idempotencyKey: randomUUID() });
    await cancelDesk(db, actorOf(holder), r.bookingId);
    await expect(bookDesk(db, actorOf(common), { employeeId: common.id, resourceId: desk.id, date: d(2), idempotencyKey: randomUUID() })).rejects.toThrow(/uso exclusivo/);
    const s = await bookDesk(db, actorOf(common), { employeeId: common.id, resourceId: shared.id, date: d(2), idempotencyKey: randomUUID() });
    expect((await stateForPerson(db, holder.id, d(2))).items.find((i) => i.resource.code === shared.code)?.availability.code).toBe("reserved");
    await cancelDesk(db, actorOf(common), s.bookingId);
    expect((await stateForPerson(db, holder.id, d(2))).items.find((i) => i.resource.code === shared.code)?.availability.code).toBe("available");
    // cancelar reserva alheia exige permissão administrativa e motivo
    const t = await bookDesk(db, actorOf(common), { employeeId: common.id, resourceId: shared.id, date: d(3), idempotencyKey: randomUUID() });
    await expect(cancelDesk(db, actorOf(holder), t.bookingId, { reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    const fac = await privilegedActor({ roles: ["facilities"] });
    await expect(cancelDesk(db, actorOf(fac), t.bookingId)).rejects.toThrow(/motivo/);
    await cancelDesk(db, actorOf(fac), t.bookingId, { reason: "manutenção urgente" });
    const mails = await db.select().from(outboxEvent).where(eq(outboxEvent.eventType, "email.booking_changed"));
    expect(mails).toHaveLength(1);
    expect(JSON.stringify(mails[0].payload)).toContain(common.email);
  });

  it("DIR-020: manutenção impede inclusive o titular; DIR-014: liberação não anula manutenção nem ultrapassa a janela", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const guest = await seedEmployee();
    const desk = await seedDesk();
    const a = await exclusiveFor(desk.id, holder.id);
    await db.insert(resourceStatusPeriod).values({ resourceId: desk.id, status: "maintenance", startsOn: d(1), endsOn: d(1), reason: "t", publicReason: "troca de cadeira" });
    await expect(bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/em manutenção/);
    await db.insert(accessException).values({ assignmentId: a, resourceId: desk.id, kind: "release_to_employee", beneficiaryEmployeeId: guest.id, startsOn: d(1), endsOn: d(2), reason: "t" });
    await expect(bookDesk(db, actorOf(guest), { employeeId: guest.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/em manutenção/);
    await expect(bookDesk(db, actorOf(guest), { employeeId: guest.id, resourceId: desk.id, date: d(2), idempotencyKey: randomUUID() })).resolves.toMatchObject({ created: true });
    await expect(bookDesk(db, actorOf(guest), { employeeId: guest.id, resourceId: desk.id, date: d(3), idempotencyKey: randomUUID() })).rejects.toThrow(/uso exclusivo/);
    // DIR-031-T2: titular não reserva na data liberada a outra pessoa (PAR-26); o texto explica a liberação
    await expect(bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: desk.id, date: d(2), idempotencyKey: randomUUID() })).rejects.toThrow(/liberada a outra pessoa/);
    expect((await stateForPerson(db, holder.id, d(2))).items.find((i) => i.resource.id === desk.id)?.availability.label).toMatch(/^Liberada a outra pessoa até \d{2}\/\d{2}$/);
    await expect(bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: desk.id, date: d(3), idempotencyKey: randomUUID() })).resolves.toMatchObject({ created: true });
  });

  it("DIR-013-T1: liberação expira pela vigência, sem job: dia seguinte ao fim volta a ser exclusivo", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const desk = await seedDesk();
    const a = await exclusiveFor(desk.id, holder.id);
    await db.insert(accessException).values({ assignmentId: a, resourceId: desk.id, kind: "release_to_shared", startsOn: today, endsOn: d(1), reason: "t" });
    const common = await seedEmployee();
    const on = async (date: string) => (await stateForPerson(db, common.id, date)).items[0].availability.code;
    expect(await on(today)).toBe("available");
    expect(await on(d(1))).toBe("available");
    expect(await on(d(2))).toBe("exclusive");
  });

  it("DIR-011: reserva em nome exige permissão própria, registra o ator, notifica e passa o beneficiário pelas mesmas regras", async () => {
    const rh = await privilegedActor({ roles: ["hr"], permissions: ["booking.on_behalf.create"] });
    const noPerm = await privilegedActor({ roles: ["hr"] });
    const holder = await seedEmployee({ orgCondition: "director" });
    const common = await seedEmployee();
    const suspended = await seedEmployee({ status: "suspended" });
    const desk = await seedDesk();
    await exclusiveFor(desk.id, holder.id);
    await expect(bookDesk(db, actorOf(noPerm), { employeeId: holder.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(bookDesk(db, actorOf(rh), { employeeId: common.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/uso exclusivo/);
    await expect(bookDesk(db, actorOf(rh), { employeeId: suspended.id, resourceId: (await seedDesk()).id, date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/conta inativa/);
    const r = await bookDesk(db, actorOf(rh), { employeeId: holder.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() });
    const [b] = await db.select().from(deskBooking).where(eq(deskBooking.id, r.bookingId));
    expect(b.origin).toBe("on_behalf");
    expect(b.actorEmployeeId).toBe(rh.id);
    expect(b.employeeId).toBe(holder.id);
    const mails = await db.select().from(outboxEvent).where(eq(outboxEvent.eventType, "email.booking_on_behalf"));
    expect(mails).toHaveLength(1);
    expect(JSON.stringify(mails[0].payload)).toContain(holder.email);
    const audit = await db.select({ a: auditEvent.action }).from(auditEvent).where(eq(auditEvent.entityId, r.bookingId));
    expect(audit.map((x) => x.a)).toContain("booking.created_on_behalf");
  });

  it("DIR-022-T1: identificadores enviados pelo cliente não dão acesso: reserva para outra pessoa sem permissão, cancelar reserva alheia, mesa inexistente", async () => {
    const a = await seedEmployee();
    const b = await seedEmployee();
    const desk = await seedDesk();
    await expect(bookDesk(db, actorOf(a), { employeeId: b.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(ForbiddenError);
    const r = await bookDesk(db, actorOf(b), { employeeId: b.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() });
    await expect(cancelDesk(db, actorOf(a), r.bookingId, { reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(bookDesk(db, actorOf(a), { employeeId: a.id, resourceId: randomUUID(), date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/não encontrada/);
    await expect(bookDesk(db, actorOf(a), { employeeId: a.id, resourceId: "nao-e-uuid", date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/inválido/);
  });

  it("calendário fechado e janela: escritório fechado nega; data além da abertura nega com o instante; realocação administrativa é isenta", async () => {
    const p = await seedEmployee();
    const desk = await seedDesk();
    await db.insert(officeCalendar).values({ date: d(1), isOpen: false, reason: "feriado" });
    await expect(bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).rejects.toThrow(/escritório fechado/);
    await expect(bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: desk.id, date: d(21), idempotencyKey: randomUUID() })).rejects.toThrow(/abrem em/);
    await expect(bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: desk.id, date: d(-1), idempotencyKey: randomUUID() })).rejects.toThrow(/abrem em|não definida/);
  });

  it("DIR-034-T1: retenção vencida não trava mesa nem pessoa; reserva direta entra sem job", async () => {
    const a = await seedEmployee();
    const b = await seedEmployee();
    const desk = await seedDesk();
    await db.insert(deskBooking).values({ resourceId: desk.id, employeeId: a.id, bookingDate: d(1), status: "held", origin: "waitlist_offer", actorEmployeeId: a.id, holdExpiresAt: new Date(Date.now() - 1000) });
    expect((await stateForPerson(db, b.id, d(1))).items[0].availability.code).toBe("available");
    await expect(bookDesk(db, actorOf(b), { employeeId: b.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })).resolves.toMatchObject({ created: true });
    const [old] = await db.select({ status: deskBooking.status }).from(deskBooking).where(and(eq(deskBooking.employeeId, a.id), eq(deskBooking.bookingDate, d(1))));
    expect(old.status).toBe("expired");
    // retenção viva bloqueia
    const desk2 = await seedDesk();
    await db.insert(deskBooking).values({ resourceId: desk2.id, employeeId: a.id, bookingDate: d(2), status: "held", origin: "waitlist_offer", actorEmployeeId: a.id, holdExpiresAt: new Date(Date.now() + 60_000) });
    await expect(bookDesk(db, actorOf(b), { employeeId: b.id, resourceId: desk2.id, date: d(2), idempotencyKey: randomUUID() })).rejects.toThrow(/reservada/);
  });

  it("BKG-02: semana atômica e idempotente; conflito em um dia não grava nada; intenção sem mesa não gera reserva (REQ-25)", async () => {
    const p = await seedEmployee();
    const holder = await seedEmployee({ orgCondition: "director" });
    const shared = await seedDesk("S001");
    const shared2 = await seedDesk("S002");
    const exclusive = await seedDesk("X001");
    await exclusiveFor(exclusive.id, holder.id);
    const actor = actorOf(p);
    const bad = await planWeek(db, actor, { idempotencyKey: "semana-1", days: [{ date: d(1), intent: "onsite", resourceId: shared.id }, { date: d(2), intent: "onsite", resourceId: exclusive.id }, { date: d(3), intent: "remote" }] });
    expect(bad.ok).toBe(false);
    expect(bad.conflicts).toEqual([{ date: d(2), resourceCode: "X001", reason: "uso exclusivo da diretoria" }]);
    expect(await db.select().from(deskBooking)).toHaveLength(0);
    const { presenceIntent } = await import("@/db/schema");
    expect(await db.select().from(presenceIntent)).toHaveLength(0);
    // mesma chave devolve o mesmo resultado sem reprocessar
    expect(await planWeek(db, actor, { idempotencyKey: "semana-1", days: [{ date: d(1), intent: "onsite", resourceId: shared.id }] })).toEqual(bad);
    // seleção menor com nova chave
    const ok = await planWeek(db, actor, { idempotencyKey: "semana-2", days: [{ date: d(1), intent: "onsite", resourceId: shared.id }, { date: d(2), intent: "onsite", resourceId: shared2.id }, { date: d(3), intent: "remote" }, { date: d(4), intent: "onsite" }] });
    expect(ok.ok).toBe(true);
    expect(ok.applied.map((a) => a.resourceCode)).toEqual(["S001", "S002", null, null]);
    expect(await db.select().from(deskBooking)).toHaveLength(2);
    expect((await db.select().from(presenceIntent)).map((i) => i.intent)).toEqual(["onsite", "onsite", "remote", "onsite"]);
    // repetir a chave da semana boa não duplica (BKG-02-T4: cinco dias com uma chave)
    expect(await planWeek(db, actor, { idempotencyKey: "semana-2", days: [{ date: d(1), intent: "onsite", resourceId: shared.id }] })).toEqual(ok);
    expect(await db.select().from(deskBooking)).toHaveLength(2);
    const mine = await listMyBookings(db, p.id);
    expect(mine.upcoming.map((b) => b.code)).toEqual(["S001", "S002"]);
  });

  it("DIR-035-T1: resposta do mapa carrega estado e marca 'é minha', nunca ids nem nomes de titulares sem permissão", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const me = await seedEmployee();
    const desk = await seedDesk("M100");
    const shared = await seedDesk("M101");
    await exclusiveFor(desk.id, holder.id);
    await bookDesk(db, actorOf(me), { employeeId: me.id, resourceId: shared.id, date: d(1), idempotencyKey: randomUUID() });
    const { items } = await stateForPerson(db, me.id, d(1));
    const text = JSON.stringify(items);
    expect(text).not.toContain(holder.id);
    expect(text).not.toContain(holder.name);
    expect(items.find((i) => i.resource.code === "M101")?.availability.mine).toBe(true);
    expect(items.find((i) => i.resource.code === "M100")?.availability.mine).toBe(false);
  });
});

describe("DIR-025-T0: o serviço nunca lista mesa exclusiva como ofertável a quem não é elegível", () => {
  beforeEach(resetDb);
  it("filtrar por canBook devolve só mesas compartilhadas para o colaborador comum", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const common = await seedEmployee();
    const ex = await seedDesk("E1");
    await seedDesk("C1");
    await exclusiveFor(ex.id, holder.id);
    const { items } = await stateForPerson(db, common.id, d(1));
    expect(items.filter((i) => i.availability.canBook).map((i) => i.resource.code)).toEqual(["C1"]);
    expect(new ConflictError("x")).toBeInstanceOf(Error);
  });
});
