import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvent, checkin, deskBooking, officeSettings, waitlistEntry, waitlistOffer } from "@/db/schema";
import { bookDesk, cancelDesk } from "@/modules/booking/service";
import { addDays, localToday } from "@/modules/shared/dates";
import { joinWaitlist } from "@/modules/waitlist/service";
import { updateSetting } from "@/modules/workplace/service";
import { privilegedActor, resetDb, seedDesk, seedEmployee, seedHold } from "./helpers";

/*
 * DB-01 da Etapa 3: a rede do banco para fila, oferta e confirmação de uso (migrações 0008, 0009 e 0012), exercida com o
 * pool da aplicação (papel rh_app), sem passar pelos serviços. Parâmetros novos de office_settings com validação e auditoria.
 */

const today = localToday();
const d = (n: number) => addDays(today, n);
const actorOf = (e: { id: string }) => ({ employeeId: e.id, userId: `u-${e.id}`, requestId: randomUUID() });

/** Mensagem ou código do erro do banco, atravessando o invólucro do Drizzle. */
async function dbError(f: () => Promise<unknown>): Promise<string> {
  try {
    await f();
  } catch (e) {
    const err = e as { cause?: { message?: string; code?: string }; message?: string; code?: string };
    return `${err.cause?.code ?? err.code ?? ""} ${err.cause?.message ?? err.message ?? ""}`;
  }
  return "sem erro";
}

async function offerScenario() {
  const taker = await seedEmployee();
  const desk = await seedDesk("W001");
  const b = await bookDesk(db, actorOf(taker), { employeeId: taker.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() });
  const p = await seedEmployee();
  await joinWaitlist(db, actorOf(p), { date: d(1) });
  await cancelDesk(db, actorOf(taker), b.bookingId);
  const [offer] = await db.select().from(waitlistOffer).where(eq(waitlistOffer.status, "open"));
  const [entry] = await db.select().from(waitlistEntry).where(eq(waitlistEntry.employeeId, p.id));
  return { desk, p, offer, entry };
}

describe("DB-01 da Etapa 3: rede do banco com o papel da aplicação", () => {
  beforeEach(resetDb);

  it("DELETE negado em inscrição, oferta e confirmação de uso", async () => {
    for (const t of ["waitlist_entry", "waitlist_offer", "checkin"]) {
      expect(await dbError(() => db.execute(sql.raw(`delete from ${t}`)))).toMatch(/42501|permission denied/);
    }
  });

  it("inscrição nasce em espera, não muda de pessoa, data nem ordem de entrada, e encerrada não reabre nem muda o encerramento", async () => {
    const p = await seedEmployee();
    expect(await dbError(() => db.insert(waitlistEntry).values({ employeeId: p.id, date: d(1), status: "offered" }))).toContain("entry_must_start_waiting");
    const [e] = await db.insert(waitlistEntry).values({ employeeId: p.id, date: d(1) }).returning();
    expect(await dbError(() => db.update(waitlistEntry).set({ createdAt: new Date(0) }).where(eq(waitlistEntry.id, e.id)))).toContain("entry_identity_immutable");
    expect(await dbError(() => db.update(waitlistEntry).set({ date: d(2) }).where(eq(waitlistEntry.id, e.id)))).toContain("entry_identity_immutable");
    expect(await dbError(() => db.update(waitlistEntry).set({ status: "accepted" }).where(eq(waitlistEntry.id, e.id)))).toContain("entry_incoherent");
    await db.update(waitlistEntry).set({ status: "cancelled", closeReason: "saiu" }).where(eq(waitlistEntry.id, e.id));
    expect(await dbError(() => db.update(waitlistEntry).set({ status: "waiting" }).where(eq(waitlistEntry.id, e.id)))).toContain("entry_already_closed");
    expect(await dbError(() => db.update(waitlistEntry).set({ closeReason: "outro motivo" }).where(eq(waitlistEntry.id, e.id)))).toContain("entry_already_closed");
  });

  it("oferta só nasce coerente: retenção da mesma pessoa, mesa, data e prazo, inscrição reivindicada e prazo futuro", async () => {
    const { desk, p, offer, entry } = await offerScenario();
    const other = await seedEmployee();
    const [otherEntry] = await db.insert(waitlistEntry).values({ employeeId: other.id, date: d(1) }).returning();
    // retenção de outra pessoa
    expect(await dbError(() => db.insert(waitlistOffer).values({ entryId: otherEntry.id, resourceId: desk.id, holdBookingId: offer.holdBookingId, expiresAt: offer.expiresAt }))).toContain("offer_inconsistent");
    // inscrição em espera, não reivindicada
    const desk2 = await seedDesk("W002");
    const msg = await dbError(() =>
      db.transaction(async (tx) => {
        const [h] = await tx.insert(deskBooking).values({ resourceId: desk2.id, employeeId: other.id, bookingDate: d(1), status: "held", origin: "waitlist_offer", actorEmployeeId: other.id, holdExpiresAt: new Date(Date.now() + 3_600_000) }).returning();
        await tx.insert(waitlistOffer).values({ entryId: otherEntry.id, resourceId: desk2.id, holdBookingId: h.id, expiresAt: h.holdExpiresAt! });
      }),
    );
    expect(msg).toMatch(/offer_entry_not_waiting|hold_incoherent/);
    // prazo já vencido
    const msg2 = await dbError(() =>
      db.transaction(async (tx) => {
        await tx.update(waitlistEntry).set({ status: "offered" }).where(eq(waitlistEntry.id, otherEntry.id));
        const past = new Date(Date.now() - 60_000);
        const [h] = await tx.insert(deskBooking).values({ resourceId: desk2.id, employeeId: other.id, bookingDate: d(1), status: "held", origin: "waitlist_offer", actorEmployeeId: other.id, holdExpiresAt: past }).returning();
        await tx.insert(waitlistOffer).values({ entryId: otherEntry.id, resourceId: desk2.id, holdBookingId: h.id, expiresAt: past });
      }),
    );
    expect(msg2).toContain("offer_already_expired");
    void p;
    void entry;
  });

  it("oferta não muda de inscrição, mesa, retenção, autoria nem data de oferta; decidida fica congelada; prazo desalinhado da retenção é recusado no commit", async () => {
    const { offer } = await offerScenario();
    expect(await dbError(() => db.update(waitlistOffer).set({ offeredAt: new Date(0) }).where(eq(waitlistOffer.id, offer.id)))).toContain("offer_identity_immutable");
    // Encurtar só a oferta desalinha da retenção: recusado no commit. Estender é recusado na hora (0016).
    expect(await dbError(() => db.update(waitlistOffer).set({ expiresAt: new Date(Date.now() + 60_000) }).where(eq(waitlistOffer.id, offer.id)))).toContain("offer_incoherent");
    expect(await dbError(() => db.update(waitlistOffer).set({ expiresAt: new Date(offer.expiresAt.getTime() + 60_000) }).where(eq(waitlistOffer.id, offer.id)))).toContain("offer_deadline_immutable");
    // decidir de forma coerente (retenção cancelada, oferta recusada, inscrição encerrada) e tentar mudar depois
    await db.transaction(async (tx) => {
      await tx.update(deskBooking).set({ status: "cancelled" }).where(eq(deskBooking.id, offer.holdBookingId));
      await tx.update(waitlistOffer).set({ status: "declined", decidedAt: new Date() }).where(eq(waitlistOffer.id, offer.id));
      await tx.update(waitlistEntry).set({ status: "cancelled" }).where(eq(waitlistEntry.id, offer.entryId));
    });
    expect(await dbError(() => db.update(waitlistOffer).set({ status: "accepted" }).where(eq(waitlistOffer.id, offer.id)))).toContain("offer_already_decided");
    expect(await dbError(() => db.update(waitlistOffer).set({ decidedAt: new Date(0) }).where(eq(waitlistOffer.id, offer.id)))).toContain("offer_already_decided");
  });

  it("retenção da fila só vira reserva com a oferta aceita; oferta aberta exige retenção viva e inscrição ofertada", async () => {
    const { offer } = await offerScenario();
    expect(await dbError(() => db.update(deskBooking).set({ status: "confirmed", holdExpiresAt: null }).where(eq(deskBooking.id, offer.holdBookingId)))).toContain("hold_incoherent");
    expect(await dbError(() => db.update(waitlistEntry).set({ status: "cancelled" }).where(eq(waitlistEntry.id, offer.entryId)))).toContain("entry_incoherent");
    // o caminho coerente passa
    await db.transaction(async (tx) => {
      await tx.update(deskBooking).set({ status: "confirmed", holdExpiresAt: null }).where(eq(deskBooking.id, offer.holdBookingId));
      await tx.update(waitlistOffer).set({ status: "accepted", decidedAt: new Date() }).where(eq(waitlistOffer.id, offer.id));
      await tx.update(waitlistEntry).set({ status: "accepted" }).where(eq(waitlistEntry.id, offer.entryId));
    });
    expect((await db.select().from(deskBooking).where(eq(deskBooking.id, offer.holdBookingId)))[0].status).toBe("confirmed");
  });

  it("confirmação de uso datada pelo relógio do banco; o trigger de lock da oferta só age na inserção", async () => {
    const p = await seedEmployee();
    const desk = await seedDesk("W009");
    const b = await bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: desk.id, date: today, idempotencyKey: randomUUID() });
    const [c] = await db.insert(checkin).values({ deskBookingId: b.bookingId, method: "portal", actorEmployeeId: p.id, declaredAt: new Date(0) }).returning();
    expect(Math.abs(c.declaredAt.getTime() - Date.now())).toBeLessThan(60_000);
    const t = await db.execute(sql`select (tgtype & 4) <> 0 as on_insert, (tgtype & 16) <> 0 as on_update from pg_trigger where tgname = 'waitlist_offer_lock'`);
    expect(t.rows[0]).toEqual({ on_insert: true, on_update: false });
    const held = await seedHold({ resourceId: (await seedDesk("W010")).id, employeeId: (await seedEmployee()).id, date: d(1), expiresAt: new Date(Date.now() + 60_000) });
    expect(held.offerId).toBeTruthy();
  });
});

describe("parâmetros da Etapa 3 em office_settings", () => {
  beforeEach(resetDb);

  it("faixas, expediente coerente, booleano e auditoria antes e depois", async () => {
    const adm = await privilegedActor({ roles: ["admin"] });
    await expect(updateSetting(db, adm.actor, "offer_minutes", "10")).rejects.toThrow(/entre 15 e 1440/);
    await expect(updateSetting(db, adm.actor, "offer_minutes", "2000")).rejects.toThrow(/entre 15 e 1440/);
    await updateSetting(db, adm.actor, "offer_minutes", "90");
    await expect(updateSetting(db, adm.actor, "business_hours_end", "08:00")).rejects.toThrow(/fim do expediente/);
    await expect(updateSetting(db, adm.actor, "business_hours_start", "25:00")).rejects.toThrow(/HH:MM/);
    await updateSetting(db, adm.actor, "business_hours_end", "19:00");
    await expect(updateSetting(db, adm.actor, "checkin_release_enabled", "sim")).rejects.toThrow(/sim ou não/);
    await updateSetting(db, adm.actor, "checkin_release_enabled", "true");
    const rows = Object.fromEntries((await db.select().from(officeSettings)).map((r) => [r.key, r.value]));
    expect(rows).toMatchObject({ offer_minutes: 90, business_hours_end: "19:00", checkin_release_enabled: true });
    const audit = await db.select().from(auditEvent).where(eq(auditEvent.action, "settings.updated"));
    const offer = audit.find((a) => a.entityId === "offer_minutes")!;
    expect(offer.before).toEqual({ value: 120 });
    expect(offer.after).toEqual({ value: 90 });
    const rh = await privilegedActor({ roles: ["hr"] });
    await expect(updateSetting(db, rh.actor, "offer_minutes", "60")).rejects.toThrow(/não está disponível/);
  });
});
