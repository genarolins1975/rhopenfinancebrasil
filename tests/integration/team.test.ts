import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvent, employee } from "@/db/schema";
import { bookDesk, planWeek } from "@/modules/booking/service";
import { addDays, localToday } from "@/modules/shared/dates";
import { bookSpace } from "@/modules/spaces/service";
import { setShareWithManager, sharesWithManager, teamWeek } from "@/modules/team/service";
import { resetDb, seedDesk, seedEmployee } from "./helpers";

/* Meu time: só subordinados diretos ativos; conteúdo só de quem autorizou compartilhar (opt-in auditado). */

const today = localToday();
const d = (n: number) => addDays(today, n);
const actorOf = (e: { id: string }) => ({ employeeId: e.id, userId: `u-${e.id}`, requestId: randomUUID() });

describe("Meu time", () => {
  beforeEach(resetDb);

  it("gestor vê intenção e reservas de quem autorizou; linha sem conteúdo para quem não autorizou; nada de quem não é subordinado direto", async () => {
    const manager = await seedEmployee({ roles: ["manager"] });
    const sharer = await seedEmployee({ name: "Ana Compartilha" });
    const quiet = await seedEmployee({ name: "Beto Reservado" });
    const outsider = await seedEmployee({ name: "Caio de Fora" });
    const gone = await seedEmployee({ name: "Dora Desativada", status: "deactivated" });
    for (const p of [sharer, quiet, gone]) await db.update(employee).set({ managerEmployeeId: manager.id }).where(eq(employee.id, p.id));
    expect(await sharesWithManager(db, sharer.id)).toBe(false);
    await setShareWithManager(db, actorOf(sharer), true);
    await setShareWithManager(db, actorOf(sharer), true);
    expect(await db.select().from(auditEvent).where(eq(auditEvent.action, "preference.share_with_manager"))).toHaveLength(1);
    const desk = await seedDesk("S001");
    const desk2 = await seedDesk("S002");
    const room = await seedDesk("SALA1", "room");
    await planWeek(db, actorOf(sharer), { idempotencyKey: randomUUID(), days: [{ date: d(1), intent: "onsite", resourceId: desk.id }] });
    await bookSpace(db, actorOf(sharer), { resourceId: room.id, date: d(1), start: "10:00", end: "11:00", title: "Privada", idempotencyKey: randomUUID() });
    await bookSpace(db, actorOf(sharer), { resourceId: room.id, date: d(1), start: "11:00", end: "12:00", title: "Para o gestor", titleVisibility: "manager", idempotencyKey: randomUUID() });
    await bookDesk(db, actorOf(quiet), { employeeId: quiet.id, resourceId: desk2.id, date: d(1), idempotencyKey: randomUUID() });
    const team = await teamWeek(db, manager.id, [d(1)]);
    expect(team.map((m) => m.name)).toEqual(["Ana Compartilha", "Beto Reservado"]);
    const ana = team[0];
    expect(ana.shared).toBe(true);
    expect(ana.days[0]).toMatchObject({ intent: "onsite", deskCode: "S001" });
    expect(ana.days[0].spaces.map((s) => s.title)).toEqual([null, "Para o gestor"]);
    const beto = team[1];
    expect(beto.shared).toBe(false);
    expect(beto.days[0]).toMatchObject({ intent: "not_informed", deskCode: null, spaces: [] });
    expect(JSON.stringify(team)).not.toContain("S002");
    expect(JSON.stringify(team)).not.toContain(outsider.id);
    // revogar o compartilhamento esconde de novo
    await setShareWithManager(db, actorOf(sharer), false);
    expect((await teamWeek(db, manager.id, [d(1)]))[0].days[0].deskCode).toBeNull();
    // quem não gerencia ninguém vê lista vazia
    expect(await teamWeek(db, outsider.id, [d(1)])).toEqual([]);
  });
});
