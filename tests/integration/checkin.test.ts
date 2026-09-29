import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvent, checkin, deskBooking, exclusiveAssignment, outboxEvent, waitlistOffer } from "@/db/schema";
import { stateForPerson } from "@/modules/availability/service";
import { bookDesk } from "@/modules/booking/service";
import { confirmUse, ownBookingTodayOn, releaseUnconfirmed } from "@/modules/checkin/service";
import { ForbiddenError, ValidationError } from "@/modules/shared/errors";
import { addDays, localToday } from "@/modules/shared/dates";
import { bookSpace } from "@/modules/spaces/service";
import { joinWaitlist } from "@/modules/waitlist/service";
import { ownerQuery, resetDb, seedDesk, seedEmployee } from "./helpers";

/* Confirmação de uso: CHK-01 (não libera nem remove exclusividade), CHK-02 (reserva alheia rejeitada), DIR-006-T2, PAR-06. */

const today = localToday();
const d = (n: number) => addDays(today, n);
const actorOf = (e: { id: string }) => ({ employeeId: e.id, userId: `u-${e.id}`, requestId: randomUUID() });

function rule(e: unknown): string {
  const err = e as { cause?: { message?: string }; message?: string };
  return String(err?.cause?.message ?? err?.message ?? "");
}

async function exclusiveFor(deskId: string, holderId: string) {
  await db.insert(exclusiveAssignment).values({ resourceId: deskId, mode: "individual", holderEmployeeId: holderId, validFrom: today, reason: "t", responsible: "RH" });
}

describe("confirmação de uso", () => {
  beforeEach(resetDb);

  it("CHK-01-T1: titular confirma o uso da mesa exclusiva pelo portal e pelo QR; exclusividade intacta; repetição idempotente; auditoria", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const common = await seedEmployee();
    const desk = await seedDesk("X001");
    await exclusiveFor(desk.id, holder.id);
    const b = await bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: desk.id, date: today, idempotencyKey: randomUUID() });
    const first = await confirmUse(db, actorOf(holder), { bookingId: b.bookingId, method: "portal" });
    expect(first).toMatchObject({ kind: "desk", resourceCode: "X001", already: false });
    const again = await confirmUse(db, actorOf(holder), { resourceCode: "x001", method: "qr" });
    expect(again.already).toBe(true);
    expect(await db.select().from(checkin)).toHaveLength(1);
    expect((await db.select().from(auditEvent).where(eq(auditEvent.action, "booking.use_confirmed")))).toHaveLength(1);
    // nada muda em política ou disponibilidade
    const [a] = await db.select().from(exclusiveAssignment).where(eq(exclusiveAssignment.resourceId, desk.id));
    expect(a.validTo).toBeNull();
    expect((await stateForPerson(db, common.id, d(1))).items[0].availability.label).toBe("Uso exclusivo — Diretoria");
    expect((await ownBookingTodayOn(db, holder.id, "X001"))?.confirmedAt).toBeInstanceOf(Date);
  });

  it("CHK-02-T1: id de reserva alheia, reserva de outro dia, cancelada ou QR sem reserva própria são rejeitados sem revelar a reserva de terceiros", async () => {
    const a = await seedEmployee();
    const b = await seedEmployee();
    const desk = await seedDesk("S001");
    const desk2 = await seedDesk("S002");
    const ba = await bookDesk(db, actorOf(a), { employeeId: a.id, resourceId: desk.id, date: today, idempotencyKey: randomUUID() });
    const future = await bookDesk(db, actorOf(b), { employeeId: b.id, resourceId: desk2.id, date: d(1), idempotencyKey: randomUUID() });
    await expect(confirmUse(db, actorOf(b), { bookingId: ba.bookingId, method: "portal" })).rejects.toThrow(/Reserva não encontrada para você hoje/);
    await expect(confirmUse(db, actorOf(b), { resourceCode: "S001", method: "qr" })).rejects.toThrow(/Você não tem reserva confirmada em S001 hoje/);
    await expect(confirmUse(db, actorOf(b), { bookingId: future.bookingId, method: "portal" })).rejects.toBeInstanceOf(ValidationError);
    await expect(confirmUse(db, actorOf(b), { bookingId: "nao-e-uuid", method: "portal" })).rejects.toBeInstanceOf(ValidationError);
    await expect(confirmUse(db, actorOf(b), { method: "portal" })).rejects.toBeInstanceOf(ValidationError);
    expect(await ownBookingTodayOn(db, b.id, "S001")).toBeNull();
    // segunda rede: o banco recusa confirmação de reserva alheia inserida diretamente
    let msg = "";
    try {
      await db.insert(checkin).values({ deskBookingId: ba.bookingId, method: "portal", actorEmployeeId: b.id });
    } catch (e) {
      msg = rule(e);
    }
    expect(msg).toContain("checkin_not_allowed");
    // pessoa suspensa não confirma
    const suspended = await seedEmployee({ status: "suspended" });
    await expect(confirmUse(db, actorOf(suspended), { resourceCode: "S001", method: "qr" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.select().from(checkin)).toHaveLength(0);
  });

  it("confirmação de sala: pelo QR do código da sala resolve a reserva do dia; confirmação é imutável no banco", async () => {
    const a = await seedEmployee();
    const room = await seedDesk("SALA1", "room");
    const now = new Date();
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(now));
    if (h >= 23) return; // sem intervalo futuro no dia; o caso é coberto nas demais horas
    const start = `${String(h + 1).padStart(2, "0")}:00`;
    const end = `${String(h + 1).padStart(2, "0")}:30`;
    await bookSpace(db, actorOf(a), { resourceId: room.id, date: today, start, end, idempotencyKey: randomUUID() });
    const r = await confirmUse(db, actorOf(a), { resourceCode: "SALA1", method: "qr" });
    expect(r.kind).toBe("space");
    let msg = "";
    try {
      await db.update(checkin).set({ method: "portal" }).where(eq(checkin.spaceBookingId, r.bookingId));
    } catch (e) {
      msg = rule(e);
    }
    expect(msg).toContain("checkin_immutable");
  });

  it("DIR-006-T2 e PAR-06: liberação por falta de confirmação desativada por padrão; ativada, libera só mesa compartilhada sem confirmação, avisa e oferece à fila; exclusiva nunca", async () => {
    const holder = await seedEmployee({ orgCondition: "director" });
    const p1 = await seedEmployee();
    const p2 = await seedEmployee();
    const waiting = await seedEmployee();
    const ex = await seedDesk("X001");
    await exclusiveFor(ex.id, holder.id);
    const s1 = await seedDesk("S001");
    const s2 = await seedDesk("S002");
    await bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: ex.id, date: today, idempotencyKey: randomUUID() });
    const b1 = await bookDesk(db, actorOf(p1), { employeeId: p1.id, resourceId: s1.id, date: today, idempotencyKey: randomUUID() });
    const b2 = await bookDesk(db, actorOf(p2), { employeeId: p2.id, resourceId: s2.id, date: today, idempotencyKey: randomUUID() });
    await confirmUse(db, actorOf(p2), { bookingId: b2.bookingId, method: "portal" });
    await joinWaitlist(db, actorOf(waiting), { date: today });
    // padrão: desativada
    expect(await releaseUnconfirmed(db)).toBe(0);
    await ownerQuery(`update office_settings set value = 'true' where key = 'checkin_release_enabled'`);
    await ownerQuery(`update office_settings set value = '"00:00"' where key = 'checkin_release_time'`);
    const released = await releaseUnconfirmed(db);
    expect(released).toBe(1);
    const rows = await db.select({ id: deskBooking.id, status: deskBooking.status, resourceId: deskBooking.resourceId, employeeId: deskBooking.employeeId }).from(deskBooking).where(eq(deskBooking.bookingDate, today));
    expect(rows.find((r) => r.id === b1.bookingId)?.status).toBe("cancelled");
    expect(rows.find((r) => r.id === b2.bookingId)?.status).toBe("confirmed");
    expect(rows.find((r) => r.resourceId === ex.id && r.employeeId === holder.id)?.status).toBe("confirmed");
    // exclusividade intacta; a compartilhada liberada foi oferecida à fila
    const [asg] = await db.select().from(exclusiveAssignment).where(eq(exclusiveAssignment.resourceId, ex.id));
    expect(asg.validTo).toBeNull();
    const [offer] = await db.select().from(waitlistOffer).where(eq(waitlistOffer.status, "open"));
    expect(offer.resourceId).toBe(s1.id);
    expect(await db.select().from(outboxEvent).where(and(eq(outboxEvent.eventType, "email.booking_changed"), eq(outboxEvent.aggregateId, b1.bookingId)))).toHaveLength(1);
    // antes do horário limite nada acontece
    await ownerQuery(`update office_settings set value = '"23:59"' where key = 'checkin_release_time'`);
    const b3 = await bookDesk(db, actorOf(p1), { employeeId: p1.id, resourceId: (await seedDesk("S003")).id, date: today, idempotencyKey: randomUUID() });
    const early = new Date();
    early.setUTCHours(12, 0, 0, 0);
    expect(await releaseUnconfirmed(db, early)).toBe(0);
    expect((await db.select().from(deskBooking).where(eq(deskBooking.id, b3.bookingId)))[0].status).toBe("confirmed");
    void sql;
  });
});
