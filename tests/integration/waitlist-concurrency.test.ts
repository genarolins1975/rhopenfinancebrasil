import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { deskBooking, waitlistOffer } from "@/db/schema";
import { bookDesk, cancelDesk } from "@/modules/booking/service";
import { deactivateEmployee, suspendEmployee } from "@/modules/employees/service";
import { addDays, localToday } from "@/modules/shared/dates";
import { acceptOffer, declineOffer, expireDueOffers, joinWaitlist, leaveWaitlist, offerFreeDesks } from "@/modules/waitlist/service";
import { ageOpenOffers, ownerQuery, privilegedActor, resetDb, seedDesk, seedEmployee } from "./helpers";

/*
 * R10: concorrência da fila de espera com o pool da aplicação. Cada operação abre a própria transação.
 * Invariantes verificados a cada rodada; contador de deadlocks do banco inalterado; nenhuma nova tentativa registrada.
 */

const today = localToday();
const d = (n: number) => addDays(today, n);
const actorOf = (e: { id: string }) => ({ employeeId: e.id, userId: `u-${e.id}`, requestId: randomUUID() });
const owner = new Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 1 });
afterAll(() => owner.end());

async function deadlocks(): Promise<number> {
  await new Promise((r) => setTimeout(r, 700));
  const r = await owner.query("select deadlocks::int as n from pg_stat_database where datname = current_database()");
  return (r.rows[0] as { n: number }).n;
}

/** Invariantes da fila e das retenções. Cada consulta devolve as linhas que violam. */
async function violations(): Promise<Record<string, number>> {
  const q = async (text: string) => ((await db.execute(sql.raw(text))).rows[0] as { n: number }).n;
  return {
    ofertaAbertaSemRetencaoViva: await q(`select count(*)::int as n from waitlist_offer o join desk_booking b on b.id = o.hold_booking_id where o.status = 'open' and o.expires_at > now() and not (b.status = 'held' and b.hold_expires_at > now())`),
    ofertaAbertaComInscricaoFechada: await q(`select count(*)::int as n from waitlist_offer o join waitlist_entry e on e.id = o.entry_id where o.status = 'open' and e.status <> 'offered'`),
    inscricaoOfertadaSemOfertaAberta: await q(`select count(*)::int as n from waitlist_entry e where e.status = 'offered' and not exists (select 1 from waitlist_offer o where o.entry_id = e.id and o.status = 'open')`),
    retencaoDaFilaSemOferta: await q(`select count(*)::int as n from desk_booking b where b.status = 'held' and b.origin = 'waitlist_offer' and not exists (select 1 from waitlist_offer o where o.hold_booking_id = b.id)`),
    retencaoVivaComOfertaFechada: await q(`select count(*)::int as n from desk_booking b join waitlist_offer o on o.hold_booking_id = b.id where b.status = 'held' and b.hold_expires_at > now() and o.status <> 'open'`),
    reservaInvalida: await q(`select count(*)::int as n from desk_booking b where (b.status = 'confirmed' or (b.status = 'held' and b.hold_expires_at > now())) and not booking_remains_valid(b.employee_id, b.resource_id, b.booking_date)`),
    ofertaDeMesaExclusiva: await q(`select count(*)::int as n from waitlist_offer o join waitlist_entry e on e.id = o.entry_id where o.status = 'open' and not is_eligible(e.employee_id, o.resource_id, e.date)`),
  };
}

const ZERO = { ofertaAbertaSemRetencaoViva: 0, ofertaAbertaComInscricaoFechada: 0, inscricaoOfertadaSemOfertaAberta: 0, retencaoDaFilaSemOferta: 0, retencaoVivaComOfertaFechada: 0, reservaInvalida: 0, ofertaDeMesaExclusiva: 0 };

async function ageOffers() {
  await ageOpenOffers();
}

describe("R10: concorrência da fila de espera", () => {
  beforeEach(resetDb);

  it("cancelamento, inscrição, reserva direta, aceite, recusa, saída, varredura, suspensão e desativação simultâneos: invariantes preservados e zero deadlock", async () => {
    const logFile = process.env.LOG_CAPTURE_FILE!;
    const mark = (() => {
      try {
        return readFileSync(logFile, "utf8").length;
      } catch {
        return 0;
      }
    })();
    const before = await deadlocks();
    const rh = await privilegedActor({ roles: ["hr"] });
    const desks = await Promise.all([seedDesk(), seedDesk(), seedDesk()]);
    for (let i = 0; i < 5; i++) {
      const date = d(1 + i);
      // Escritório cheio na data da rodada: três mesas ocupadas; três pessoas na fila.
      const holders = await Promise.all([seedEmployee(), seedEmployee(), seedEmployee()]);
      const bookings = [];
      for (let k = 0; k < 3; k++) bookings.push(await bookDesk(db, actorOf(holders[k]), { employeeId: holders[k].id, resourceId: desks[k].id, date, idempotencyKey: randomUUID() }));
      const q = await Promise.all([seedEmployee(), seedEmployee(), seedEmployee()]);
      const entries = [];
      for (const p of q) entries.push(await joinWaitlist(db, actorOf(p), { date }));
      const outsider = await seedEmployee();

      // h) cancelamento contra reserva direta de quem não está na fila e contra saída da primeira da fila
      const [h1, h2, h3] = await Promise.allSettled([
        cancelDesk(db, actorOf(holders[0]), bookings[0].bookingId),
        bookDesk(db, actorOf(outsider), { employeeId: outsider.id, resourceId: desks[0].id, date, idempotencyKey: randomUUID() }),
        leaveWaitlist(db, actorOf(q[0]), entries[0].entryId),
      ]);
      expect(h1.status, `rodada ${i} h: cancelamento`).toBe("fulfilled");
      expect(h2.status, `rodada ${i} h: a reserva direta nunca passa à frente da fila`).toBe("rejected");
      void h3;
      expect(await violations(), `rodada ${i} h`).toEqual(ZERO);

      // i) segundo cancelamento contra aceite e recusa concorrentes da oferta aberta
      const open = await db.select().from(waitlistOffer).where(eq(waitlistOffer.status, "open"));
      const offerTarget = open[0];
      const [offerOwner] = offerTarget ? await db.execute(sql`select employee_id from waitlist_entry where id = ${offerTarget.entryId}`).then((r) => r.rows as Array<{ employee_id: string }>) : [];
      const [i1, i2, i3] = await Promise.allSettled([
        cancelDesk(db, actorOf(holders[1]), bookings[1].bookingId),
        offerOwner ? acceptOffer(db, actorOf({ id: offerOwner.employee_id }), offerTarget.id) : Promise.resolve(null),
        offerOwner ? declineOffer(db, actorOf({ id: offerOwner.employee_id }), offerTarget.id) : Promise.resolve(null),
      ]);
      expect(i1.status, `rodada ${i} i: cancelamento`).toBe("fulfilled");
      if (offerOwner) expect([i2.status, i3.status].filter((s) => s === "fulfilled").length, `rodada ${i} i: aceite e recusa são excludentes`).toBeLessThanOrEqual(1);
      expect(await violations(), `rodada ${i} i`).toEqual(ZERO);

      // j) ofertas vencidas: varredura contra aceite atrasado, contra nova inscrição e contra reserva direta
      await ageOffers();
      const late = await db.select().from(waitlistOffer).where(eq(waitlistOffer.status, "open"));
      const lateOwner = late[0] ? ((await db.execute(sql`select employee_id from waitlist_entry where id = ${late[0].entryId}`)).rows[0] as { employee_id: string }) : null;
      const newcomer = await seedEmployee();
      const [j1, j2, j3, j4] = await Promise.allSettled([
        expireDueOffers(db),
        lateOwner ? acceptOffer(db, actorOf({ id: lateOwner.employee_id }), late[0].id) : Promise.resolve(null),
        joinWaitlist(db, actorOf(newcomer), { date }),
        bookDesk(db, actorOf(outsider), { employeeId: outsider.id, resourceId: desks[1].id, date, idempotencyKey: randomUUID() }),
      ]);
      expect(j1.status, `rodada ${i} j: varredura`).toBe("fulfilled");
      if (lateOwner) expect(j2.status, `rodada ${i} j: aceite de oferta vencida`).toBe("rejected");
      void j3;
      void j4;
      await offerFreeDesks(db);
      expect(await violations(), `rodada ${i} j`).toEqual(ZERO);

      // k) terceiro cancelamento contra suspensão e desativação de pessoas da fila
      const [k1, k2, k3] = await Promise.allSettled([
        cancelDesk(db, actorOf(holders[2]), bookings[2].bookingId),
        suspendEmployee(db, rh.actor, q[1].id, "afastamento"),
        deactivateEmployee(db, rh.actor, q[2].id, { reason: "desligamento" }),
      ]);
      expect(k1.status, `rodada ${i} k: cancelamento`).toBe("fulfilled");
      expect(k2.status, `rodada ${i} k: suspensão`).toBe("fulfilled");
      expect(k3.status, `rodada ${i} k: desativação`).toBe("fulfilled");
      expect(await violations(), `rodada ${i} k`).toEqual(ZERO);
      const ofSuspended = await db.execute(sql`select count(*)::int as n from waitlist_entry where employee_id in (${q[1].id}, ${q[2].id}) and status in ('waiting', 'offered')`);
      expect((ofSuspended.rows[0] as { n: number }).n, `rodada ${i} k: pessoa suspensa ou desativada continua na fila`).toBe(0);
    }
    const after = await deadlocks();
    expect(after - before, "deadlocks detectados pelo banco durante o teste").toBe(0);
    const tail = (() => {
      try {
        return readFileSync(logFile, "utf8").slice(mark);
      } catch {
        return "";
      }
    })();
    expect(tail.includes("nova tentativa da transação do escritório"), "transação do escritório precisou de nova tentativa").toBe(false);
    const holds = await db.select().from(deskBooking).where(eq(deskBooking.status, "held"));
    for (const h of holds) expect(h.origin).toBe("waitlist_offer");
  });

  it("R10b: mesa exclusiva sob corrida (titular cancela contra liberação; aceite contra revogação; cancelamento com fila contra nova atribuição): nunca oferta de exclusiva a inelegível", async () => {
    const { createAssignment, createException, previewRevokeException, revokeException } = await import("@/modules/exclusivity/service");
    const before = await deadlocks();
    for (let i = 0; i < 5; i++) {
      await resetDb();
      const rh = await privilegedActor({ roles: ["hr"] });
      const date = d(1 + i);
      const holder = await seedEmployee({ orgCondition: "director" });
      const x = await seedDesk(`X${i}`);
      const assignmentId = await createAssignment(db, rh.actor, { resourceId: x.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "t", responsible: "RH" });
      const s1 = await seedDesk(`S${i}`);
      const filler = await seedEmployee();
      const fb = await bookDesk(db, actorOf(filler), { employeeId: filler.id, resourceId: s1.id, date, idempotencyKey: randomUUID() });
      const c = await seedEmployee();
      await joinWaitlist(db, actorOf(c), { date });
      const hb = await bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: x.id, date, idempotencyKey: randomUUID() });
      // a) titular cancela a própria reserva enquanto o RH libera a mesa ao compartilhado na data
      const [a1, a2] = await Promise.allSettled([
        cancelDesk(db, actorOf(holder), hb.bookingId),
        createException(db, rh.actor, { assignmentId, kind: "release_to_shared", startsOn: date, endsOn: date, reason: "férias" }),
      ]);
      expect(a1.status, `rodada ${i} a: cancelamento`).toBe("fulfilled");
      expect(await violations(), `rodada ${i} a`).toEqual(ZERO);
      await offerFreeDesks(db);
      expect(await violations(), `rodada ${i} a, depois da varredura`).toEqual(ZERO);
      // b) C aceita a oferta da mesa liberada enquanto o RH revoga a liberação, com decisão sobre a retenção vista na prévia
      const exceptionId = a2.status === "fulfilled" ? a2.value : null;
      const [open] = await db.select().from(waitlistOffer).where(eq(waitlistOffer.status, "open"));
      if (exceptionId) {
        const preview = await previewRevokeException(db, rh.actor, exceptionId);
        const decisions = preview.conflicts.map((k) => ({ bookingId: k.bookingId, action: "cancel" as const, reason: "revogada", expectedStatus: k.status }));
        await Promise.allSettled([
          open ? acceptOffer(db, actorOf(c), open.id) : Promise.resolve(null),
          revokeException(db, rh.actor, { exceptionId, reason: "voltou" }, decisions),
        ]);
      }
      expect(await violations(), `rodada ${i} b`).toEqual(ZERO);
      // c) nova mesa compartilhada ocupada, fila em espera; cancelamento contra atribuição exclusiva nova da mesma mesa
      const n = await seedDesk(`N${i}`);
      const f2 = await seedEmployee();
      // Preparação: a mesa nova nasce ocupada (com fila em espera, uma reserva direta dela iria corretamente para a fila).
      const nbRow = await ownerQuery("insert into desk_booking (resource_id, employee_id, booking_date, status, origin, actor_employee_id) values ($1, $2, $3::date, 'confirmed', 'self', $2) returning id", [n.id, f2.id, date]);
      const nb = { bookingId: nbRow.rows[0].id as string };
      const c2 = await seedEmployee();
      await joinWaitlist(db, actorOf(c2), { date }).catch(() => null);
      const holder2 = await seedEmployee({ orgCondition: "director" });
      await Promise.allSettled([
        cancelDesk(db, actorOf(f2), nb.bookingId),
        createAssignment(db, rh.actor, { resourceId: n.id, mode: "individual", holderEmployeeId: holder2.id, validFrom: date, reason: "nova", responsible: "RH" }),
      ]);
      expect(await violations(), `rodada ${i} c`).toEqual(ZERO);
      void fb;
    }
    expect((await deadlocks()) - before, "deadlocks detectados pelo banco").toBe(0);
  });
});
