import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { deskBooking, exclusiveAssignment } from "@/db/schema";
import { bookDesk } from "@/modules/booking/service";
import { createAssignment } from "@/modules/exclusivity/service";
import { closeDay, openDay } from "@/modules/workplace/service";
import { addDays, localToday } from "@/modules/shared/dates";
import { privilegedActor, resetDb, seedDesk, seedEmployee } from "./helpers";

/*
 * Concorrência real com o pool da aplicação (DIR-023-T1, DIR-024-T1, DIR-033-T3).
 * Cada operação abre a própria transação; o banco serializa por recurso e por dia.
 */

const today = localToday();
const d = (n: number) => addDays(today, n);
const actorOf = (e: { id: string }) => ({ employeeId: e.id, userId: `u-${e.id}`, requestId: randomUUID() });

async function invalidBookings(): Promise<number> {
  const r = await db.execute(sql`select count(*)::int as n from desk_booking b where b.status = 'confirmed' and not booking_remains_valid(b.employee_id, b.resource_id, b.booking_date)`);
  return (r.rows[0] as { n: number }).n;
}

describe("concorrência do escritório", () => {
  beforeEach(resetDb);

  it("DIR-023-T1: dez sessões disputam a última vaga; exatamente uma confirma e as demais recebem conflito correto", async () => {
    const desk = await seedDesk();
    const people = await Promise.all(Array.from({ length: 10 }, () => seedEmployee()));
    const results = await Promise.allSettled(people.map((p) => bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: desk.id, date: d(1), idempotencyKey: randomUUID() })));
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(9);
    for (const f of failed) expect(String(f.reason.message)).toMatch(/reservada|Outra operação|Já existe reserva/);
    expect(await db.select().from(deskBooking).where(eq(deskBooking.status, "confirmed"))).toHaveLength(1);
  });

  it("DIR-024-T1: RH trava enquanto colaborador reserva, 50 repetições: um único resultado coerente, sem reserva proibida coexistente", async () => {
    const rh = await privilegedActor({ roles: ["hr"] });
    const holder = await seedEmployee({ orgCondition: "director" });
    let bookedThenLocked = 0;
    let lockedThenDenied = 0;
    let lockConflict = 0;
    for (let i = 0; i < 50; i++) {
      const p = await seedEmployee();
      const desk = await seedDesk();
      const [b, a] = await Promise.allSettled([
        bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: desk.id, date: d(2), idempotencyKey: randomUUID() }),
        createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: d(1), reason: "corrida", responsible: "RH" }),
      ]);
      const [row] = await db.select({ status: deskBooking.status }).from(deskBooking).where(eq(deskBooking.resourceId, desk.id));
      const [asg] = await db.select({ id: exclusiveAssignment.id }).from(exclusiveAssignment).where(eq(exclusiveAssignment.resourceId, desk.id));
      if (b.status === "fulfilled" && a.status === "rejected") {
        // reserva entrou; a trava reportou conflito explícito (reserva incompatível sem decisão)
        expect(String(a.reason.message)).toMatch(/sem decisão|Outra operação/);
        expect(row?.status).toBe("confirmed");
        expect(asg).toBeUndefined();
        bookedThenLocked++;
      } else if (a.status === "fulfilled" && b.status === "rejected") {
        expect(String(b.reason.message)).toMatch(/uso exclusivo|Outra operação|não é permitida/);
        expect(row).toBeUndefined();
        expect(asg).toBeTruthy();
        lockedThenDenied++;
      } else if (a.status === "rejected" && b.status === "rejected") {
        // ambos perderam por tempo de lock: nada aplicado, estado coerente
        lockConflict++;
      } else {
        throw new Error("reserva proibida e trava coexistem");
      }
    }
    expect(bookedThenLocked + lockedThenDenied + lockConflict).toBe(50);
    expect(await invalidBookings()).toBe(0);
  });

  it("DIR-033-T3: fechar o dia com reserva em voo: ou a reserva entra e o fechamento exige decisão, ou o dia fecha e a reserva é negada", async () => {
    const fac = await privilegedActor({ roles: ["facilities"] });
    for (let i = 0; i < 10; i++) {
      const p = await seedEmployee();
      const desk = await seedDesk();
      // datas da semana corrente, sempre dentro da janela; o dia é reaberto a cada rodada
      const date = d(1 + (i % 3));
      await openDay(db, fac.actor, { date, reason: "" });
      const [b, c] = await Promise.allSettled([
        bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: desk.id, date, idempotencyKey: randomUUID() }),
        closeDay(db, fac.actor, { date, reason: "manutenção geral" }),
      ]);
      if (b.status === "fulfilled") {
        expect(c.status).toBe("rejected");
        expect(String((c as PromiseRejectedResult).reason.message)).toMatch(/sem decisão|Outra operação/);
      } else {
        expect(String(b.reason.message)).toMatch(/escritório fechado|Outra operação|não é permitida/);
      }
    }
    expect(await invalidBookings()).toBe(0);
  });
});
