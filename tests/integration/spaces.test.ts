import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvent, employee, outboxEvent, resource, spaceBooking } from "@/db/schema";
import { createStatusPeriod, closeDay, previewCloseDay, previewStatusPeriod } from "@/modules/workplace/service";
import { ForbiddenError, ValidationError } from "@/modules/shared/errors";
import { addDays, localToday } from "@/modules/shared/dates";
import { bookSpace, cancelSpace, listSpaceBookingsAdmin, mySpaceBookings, searchSpaces } from "@/modules/spaces/service";
import { deactivateEmployee } from "@/modules/employees/service";
import { privilegedActor, resetDb, seedDesk, seedEmployee } from "./helpers";

/* Salas e cabines por intervalo: BKG-03 (sem sobreposição, adjacência permitida), PAR-18, visibilidade do título. */

const today = localToday();
const d = (n: number) => addDays(today, n);
const actorOf = (e: { id: string }) => ({ employeeId: e.id, userId: `u-${e.id}`, requestId: randomUUID() });
const book = (who: { id: string }, resourceId: string, date: string, start: string, end: string, extra: Partial<Parameters<typeof bookSpace>[2]> = {}) => bookSpace(db, actorOf(who), { resourceId, date, start, end, idempotencyKey: randomUUID(), ...extra });

describe("salas e cabines", () => {
  beforeEach(resetDb);

  it("BKG-03-T1: sobreposição recusada com o horário ocupado; adjacência permitida; idempotência pela chave", async () => {
    const a = await seedEmployee();
    const b = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    const key = randomUUID();
    const r1 = await bookSpace(db, actorOf(a), { resourceId: room.id, date: d(1), start: "10:00", end: "11:00", idempotencyKey: key });
    expect(r1.created).toBe(true);
    expect(await bookSpace(db, actorOf(a), { resourceId: room.id, date: d(1), start: "10:00", end: "11:00", idempotencyKey: key })).toMatchObject({ bookingId: r1.bookingId, created: false });
    await expect(book(b, room.id, d(1), "10:30", "11:30")).rejects.toThrow(/já está reservada das 10:00 às 11:00/);
    await expect(book(b, room.id, d(1), "09:00", "12:00")).rejects.toThrow(/já está reservada/);
    await expect(book(b, room.id, d(1), "10:15", "10:45")).rejects.toThrow(/já está reservada/);
    await expect(book(b, room.id, d(1), "11:00", "12:00")).resolves.toMatchObject({ created: true });
    await expect(book(b, room.id, d(1), "09:00", "10:00")).resolves.toMatchObject({ created: true });
    // segunda rede: a constraint de exclusão recusa sobreposição inserida diretamente
    await expect(
      db.insert(spaceBooking).values({ resourceId: room.id, employeeId: b.id, actorEmployeeId: b.id, period: `[${new Date(`${d(1)}T13:30:00Z`).toISOString()},${new Date(`${d(1)}T14:30:00Z`).toISOString()})` }),
    ).rejects.toSatisfy((e: unknown) => String((e as { cause?: { code?: string } }).cause?.code) === "23P01");
    // cancelada libera o intervalo
    await cancelSpace(db, actorOf(a), r1.bookingId);
    await expect(book(b, room.id, d(1), "10:30", "11:00")).resolves.toMatchObject({ created: true });
  });

  it("BKG-03-T2: dez sessões disputam o mesmo intervalo: exatamente uma confirma", async () => {
    const room = await seedDesk("SALA1", "room");
    const people = await Promise.all(Array.from({ length: 10 }, () => seedEmployee()));
    const results = await Promise.allSettled(people.map((p) => book(p, room.id, d(1), "14:00", "15:00")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === "rejected")) expect(String(r.reason.message)).toMatch(/já está reservada|Já existe um registro vigente|Outra operação/);
    expect(await db.select().from(spaceBooking)).toHaveLength(1);
  });

  it("intervalo inválido: fim antes do início, fora da grade de 15 minutos, passado, além do horizonte, acima do limite do recurso (PAR-18)", async () => {
    const a = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    await expect(book(a, room.id, d(1), "11:00", "10:00")).rejects.toThrow(/término precisa ser depois/);
    await expect(book(a, room.id, d(1), "10:05", "11:00")).rejects.toThrow(/múltiplos de 15/);
    await expect(book(a, room.id, d(-1), "10:00", "11:00")).rejects.toThrow(/data passada|encerrado|passado/);
    await expect(book(a, room.id, d(60), "10:00", "11:00")).rejects.toThrow(/horizonte/);
    await expect(book(a, room.id, d(1), "25:00", "26:00")).rejects.toBeInstanceOf(ValidationError);
    await db.update(resource).set({ attributes: { max_duration_minutes: 60 } }).where(eq(resource.id, room.id));
    await expect(book(a, room.id, d(1), "10:00", "11:15")).rejects.toThrow(/duração máxima deste recurso: 60 minutos/);
    await expect(book(a, room.id, d(1), "10:00", "11:00")).resolves.toMatchObject({ created: true });
    // mesa não é reservada por intervalo
    const desk = await seedDesk("M001");
    await expect(book(a, desk.id, d(1), "10:00", "11:00")).rejects.toThrow(/Sala ou cabine não encontrada/);
  });

  it("título privado por padrão: terceiros e administração veem “Reservada”; gestor direto vê só com visibilidade gestor; todos com visibilidade todos", async () => {
    const manager = await seedEmployee();
    const a = await seedEmployee();
    await db.update(employee).set({ managerEmployeeId: manager.id }).where(eq(employee.id, a.id));
    const other = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    await book(a, room.id, d(1), "09:00", "10:00", { title: "Conversa de desempenho" });
    await book(a, room.id, d(1), "10:00", "11:00", { title: "Planejamento do time", titleVisibility: "manager" });
    await book(a, room.id, d(1), "11:00", "12:00", { title: "Apresentação aberta", titleVisibility: "all" });
    const input = { date: d(1), start: "13:00", end: "14:00" };
    const seen = async (viewer: { id: string }) => (await searchSpaces(db, viewer.id, input)).items[0].agenda.map((x) => x.title);
    expect(await seen(a)).toEqual(["Conversa de desempenho", "Planejamento do time", "Apresentação aberta"]);
    expect(await seen(manager)).toEqual([null, "Planejamento do time", "Apresentação aberta"]);
    expect(await seen(other)).toEqual([null, null, "Apresentação aberta"]);
    const fac = await privilegedActor({ roles: ["facilities"] });
    const admin = await listSpaceBookingsAdmin(db, fac.id, { date: d(1) });
    expect(admin.map((r) => r.title)).toEqual([null, null, "Apresentação aberta"]);
    expect(JSON.stringify(await searchSpaces(db, other.id, input))).not.toContain("Conversa de desempenho");
    // a busca explica o impedimento do intervalo pedido
    const busy = await searchSpaces(db, other.id, { date: d(1), start: "09:30", end: "10:30" });
    expect(busy.items[0].problem).toMatch(/ocupada das 09:00 às 10:00/);
  });

  it("busca filtra por capacidade e por atributo verificado; atributo não verificado não conta", async () => {
    const a = await seedEmployee();
    const small = await seedDesk("CAB1", "booth");
    const big = await seedDesk("SALA1", "room");
    await db.update(resource).set({ capacity: 1, attributes: { videoconferencia: true } }).where(eq(resource.id, small.id));
    await db.update(resource).set({ capacity: 10, attributes: { videoconferencia: true }, attributesVerifiedAt: new Date() }).where(eq(resource.id, big.id));
    const byCap = await searchSpaces(db, a.id, { date: d(1), start: "10:00", end: "11:00", capacity: 4 });
    expect(byCap.items.map((i) => i.resource.code)).toEqual(["SALA1"]);
    const byAttr = await searchSpaces(db, a.id, { date: d(1), start: "10:00", end: "11:00", attributes: ["videoconferencia"] });
    expect(byAttr.items.map((i) => i.resource.code)).toEqual(["SALA1"]);
  });

  it("cancelamento: próprio sem motivo; alheio só com booking.admin.manage, motivo, comunicação e auditoria; reserva encerrada não é cancelada", async () => {
    const a = await seedEmployee();
    const b = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    const r = await book(a, room.id, d(1), "10:00", "11:00");
    await expect(cancelSpace(db, actorOf(b), r.bookingId, { reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    const fac = await privilegedActor({ roles: ["facilities"] });
    await expect(cancelSpace(db, fac.actor, r.bookingId)).rejects.toThrow(/motivo/);
    await cancelSpace(db, fac.actor, r.bookingId, { reason: "evento da diretoria", message: "Use a SALA2." });
    const mails = await db.select().from(outboxEvent).where(eq(outboxEvent.eventType, "email.space_booking"));
    expect(mails).toHaveLength(1);
    expect(JSON.stringify(mails[0].payload)).toContain("Use a SALA2.");
    expect(await db.select().from(auditEvent).where(eq(auditEvent.action, "space_booking.cancelled_by_admin"))).toHaveLength(1);
    await expect(cancelSpace(db, fac.actor, r.bookingId, { reason: "de novo" })).rejects.toThrow(/já não está ativa/);
    expect((await mySpaceBookings(db, a.id)).upcoming).toHaveLength(0);
  });

  it("DIR-033 em salas: manutenção e fechamento de dia listam reservas de sala na prévia; confirmar exige decisão e só aceita cancelamento", async () => {
    const a = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    const r = await book(a, room.id, d(2), "10:00", "11:00");
    const fac = await privilegedActor({ roles: ["facilities"] });
    const preview = await previewStatusPeriod(db, fac.actor, { resourceId: room.id, status: "maintenance", startsOn: d(2), endsOn: d(2), reason: "pintura" });
    expect(preview.conflicts).toHaveLength(1);
    expect(preview.conflicts[0]).toMatchObject({ kind: "space", bookingId: r.bookingId, slot: "10:00 às 11:00" });
    await expect(createStatusPeriod(db, fac.actor, { resourceId: room.id, status: "maintenance", startsOn: d(2), endsOn: d(2), reason: "pintura" })).rejects.toThrow(/sem decisão/);
    await expect(createStatusPeriod(db, fac.actor, { resourceId: room.id, status: "maintenance", startsOn: d(2), endsOn: d(2), reason: "pintura" }, [{ bookingId: r.bookingId, action: "realloc", reason: "x", targetResourceId: room.id }])).rejects.toThrow(/só cancelamento/);
    await createStatusPeriod(db, fac.actor, { resourceId: room.id, status: "maintenance", startsOn: d(2), endsOn: d(2), reason: "pintura" }, [{ bookingId: r.bookingId, action: "cancel", reason: "pintura" }]);
    expect((await db.select().from(spaceBooking).where(eq(spaceBooking.id, r.bookingId)))[0].status).toBe("cancelled");
    await expect(book(a, room.id, d(2), "10:00", "11:00")).rejects.toThrow(/manutenção/);
    // fechamento de dia
    const r2 = await book(a, room.id, d(3), "15:00", "16:00");
    expect((await previewCloseDay(db, fac.actor, d(3))).conflicts.map((c) => c.bookingId)).toEqual([r2.bookingId]);
    await expect(closeDay(db, fac.actor, { date: d(3), reason: "feriado" })).rejects.toThrow(/sem decisão/);
    await closeDay(db, fac.actor, { date: d(3), reason: "feriado" }, [{ bookingId: r2.bookingId, action: "cancel", reason: "feriado" }]);
    expect(await db.select().from(auditEvent).where(eq(auditEvent.action, "space_booking.cancelled_by_conflict"))).toHaveLength(2);
    await expect(book(a, room.id, d(3), "15:00", "16:00")).rejects.toThrow(/fechado/);
  });

  it("desativação cancela as reservas de sala futuras da pessoa com comunicação", async () => {
    const a = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    const r = await book(a, room.id, d(1), "10:00", "11:00");
    const rh = await privilegedActor({ roles: ["hr"] });
    await deactivateEmployee(db, rh.actor, a.id, { reason: "desligamento" });
    expect((await db.select().from(spaceBooking).where(eq(spaceBooking.id, r.bookingId)))[0].status).toBe("cancelled");
  });
});
