import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { deskBooking, exclusiveAssignment } from "@/db/schema";
import { bookDesk } from "@/modules/booking/service";
import { createAssignment } from "@/modules/exclusivity/service";
import { closeDay, openDay } from "@/modules/workplace/service";
import { deactivateEmployee } from "@/modules/employees/service";
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

  it("R9: caminhos de conflito contra desativação e fechamento de dia, sem deadlock: o contador do banco não cresce e não há nova tentativa", async () => {
    const { readFileSync } = await import("node:fs");
    const { Pool } = await import("pg");
    const owner = new Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 1 });
    const deadlocks = async () => {
      await new Promise((r) => setTimeout(r, 700));
      const r = await owner.query("select deadlocks::int as n from pg_stat_database where datname = current_database()");
      return (r.rows[0] as { n: number }).n;
    };
    const logFile = process.env.LOG_CAPTURE_FILE!;
    const logMark = (() => {
      try {
        return readFileSync(logFile, "utf8").length;
      } catch {
        return 0;
      }
    })();
    const before = await deadlocks();
    const { createException, transferAssignment, cancelAssignment, addGroupMember, removeGroupMember, batchAssign } = await import("@/modules/exclusivity/service");
    const { createStatusPeriod } = await import("@/modules/workplace/service");
    const { directorsGroupId } = await import("./helpers");
    for (let i = 0; i < 6; i++) {
      const rh = await privilegedActor({ roles: ["hr"], permissions: ["booking.on_behalf.create", "booking.admin.manage", "resource.status.manage", "resource.manage"] });
      // a) liberação nominal com realocação da reserva do titular contra desativação do titular
      {
        const holder = await seedEmployee({ orgCondition: "director" });
        const guest = await seedEmployee();
        const desk = await seedDesk();
        const target = await seedDesk();
        const id = await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "x", responsible: "RH" });
        const hb = await bookDesk(db, actorOf(holder), { employeeId: holder.id, resourceId: desk.id, date: d(2), idempotencyKey: randomUUID() });
        const [x, dctv] = await Promise.allSettled([
          createException(db, rh.actor, { assignmentId: id, kind: "release_to_employee", beneficiaryEmployeeId: guest.id, startsOn: d(1), endsOn: d(3), reason: "viagem" }, [{ bookingId: hb.bookingId, action: "realloc", reason: "liberação", targetResourceId: target.id }]),
          deactivateEmployee(db, rh.actor, holder.id, { reason: "desligamento" }),
        ]);
        expect(dctv.status, `rodada ${i} a`).toBe("fulfilled");
        void x;
      }
      // b) transferência com realocação contra desativação do titular anterior
      {
        const h1 = await seedEmployee({ orgCondition: "director" });
        const h2 = await seedEmployee({ orgCondition: "director" });
        const desk = await seedDesk();
        const target = await seedDesk();
        const id = await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: h1.id, validFrom: today, reason: "x", responsible: "RH" });
        const hb = await bookDesk(db, actorOf(h1), { employeeId: h1.id, resourceId: desk.id, date: d(3), idempotencyKey: randomUUID() });
        const [t, dctv] = await Promise.allSettled([
          transferAssignment(db, rh.actor, { assignmentId: id, newHolderEmployeeId: h2.id, from: d(2), reason: "troca", responsible: "RH" }, [{ bookingId: hb.bookingId, action: "realloc", reason: "transferência", targetResourceId: target.id }]),
          deactivateEmployee(db, rh.actor, h1.id, { reason: "desligamento" }),
        ]);
        expect(dctv.status, `rodada ${i} b`).toBe("fulfilled");
        void t;
      }
      // c) reabertura da antecessora contra desativação do titular anterior: nunca nasce atribuição para pessoa inativa
      {
        const h1 = await seedEmployee({ orgCondition: "director" });
        const h2 = await seedEmployee({ orgCondition: "director" });
        const desk = await seedDesk();
        const id = await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: h1.id, validFrom: today, reason: "x", responsible: "RH" });
        const succ = await transferAssignment(db, rh.actor, { assignmentId: id, newHolderEmployeeId: h2.id, from: d(2), reason: "troca", responsible: "RH" });
        const [c, dctv] = await Promise.allSettled([cancelAssignment(db, rh.actor, { assignmentId: succ, reason: "desistiu", successorDecision: "reopen" }), deactivateEmployee(db, rh.actor, h1.id, { reason: "desligamento" })]);
        expect(dctv.status, `rodada ${i} c`).toBe("fulfilled");
        const open = await db.select({ holder: exclusiveAssignment.holderEmployeeId, needsReview: exclusiveAssignment.needsReview }).from(exclusiveAssignment).where(eq(exclusiveAssignment.resourceId, desk.id));
        const forH1 = open.filter((o) => o.holder === h1.id && !o.needsReview);
        // ou a reabertura perdeu (recusada por titular inativo), ou venceu e a desativação marcou a revisão
        expect(forH1.every((o) => o.needsReview) || c.status === "rejected" || forH1.length <= 1).toBe(true);
        const rows = await db.execute(sql`select count(*)::int as n from exclusive_assignment a join employee e on e.id = a.holder_employee_id where a.resource_id = ${desk.id} and a.cancelled_at is null and (a.valid_to is null or a.valid_to >= local_today()) and e.status = 'deactivated' and a.needs_review = false`);
        expect((rows.rows[0] as { n: number }).n, `rodada ${i} c: atribuição vigente sem revisão para pessoa desativada`).toBe(0);
      }
      // d) fechamento do dia com cancelamento contra manutenção com cancelamento na mesma data
      {
        const p = await seedEmployee();
        const desk = await seedDesk();
        const date = d(4);
        await openDay(db, rh.actor, { date, reason: "" });
        const b = await bookDesk(db, actorOf(p), { employeeId: p.id, resourceId: desk.id, date, idempotencyKey: randomUUID() });
        const [cd, sp] = await Promise.allSettled([
          closeDay(db, rh.actor, { date, reason: "feriado" }, [{ bookingId: b.bookingId, action: "cancel", reason: "feriado" }]),
          createStatusPeriod(db, rh.actor, { resourceId: desk.id, status: "maintenance", startsOn: date, endsOn: date, reason: "reparo" }, [{ bookingId: b.bookingId, action: "cancel", reason: "reparo" }]),
        ]);
        void cd;
        void sp;
      }
      // e) remoção de integrante com realocação contra trava de grupo em lote
      {
        const group = await directorsGroupId();
        const m = await seedEmployee({ orgCondition: "director" });
        const mid = await addGroupMember(db, rh.actor, { groupId: group, employeeId: m.id, validFrom: today, reason: "x" });
        const g1 = await seedDesk();
        const g2 = await seedDesk();
        await batchAssign(db, rh.actor, [{ resourceId: g1.id, mode: "group", accessGroupId: group, validFrom: today, reason: "x", responsible: "RH" }]);
        const mb = await bookDesk(db, actorOf(m), { employeeId: m.id, resourceId: g1.id, date: d(5), idempotencyKey: randomUUID() });
        const [rm, ba] = await Promise.allSettled([
          removeGroupMember(db, rh.actor, { memberId: mid, validTo: d(1), reason: "saiu" }, [{ bookingId: mb.bookingId, action: "cancel", reason: "saída" }]),
          batchAssign(db, rh.actor, [{ resourceId: g2.id, mode: "group", accessGroupId: group, validFrom: today, reason: "x", responsible: "RH" }]),
        ]);
        void rm;
        void ba;
      }
      expect(await invalidBookings()).toBe(0);
    }
    const after = await deadlocks();
    expect(after - before, "deadlocks detectados pelo banco durante o teste").toBe(0);
    const tail = (() => {
      try {
        return readFileSync(logFile, "utf8").slice(logMark);
      } catch {
        return "";
      }
    })();
    expect(tail.includes("nova tentativa da transação do escritório"), "nenhuma transação precisou de nova tentativa").toBe(false);
    await owner.end();
  });
});
