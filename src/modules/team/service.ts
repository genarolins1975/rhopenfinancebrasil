import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { deskBooking, employee, employeePreference, presenceIntent, resource, spaceBooking } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { localToday } from "@/modules/shared/dates";
import type { Actor } from "@/modules/office/shared";
import { formatSlot } from "@/modules/spaces/rules";

/*
 * Meu time (team.view): a pessoa gestora vê planos presenciais e reservas dos subordinados diretos que autorizaram
 * compartilhar (matriz de permissões, "Equipe do gestor": apenas o que a pessoa autorizou). Sem autorização, a linha
 * existe, mas sem conteúdo. Nada aqui é presença, ponto ou produtividade.
 */

export type TeamDay = { date: string; intent: "onsite" | "remote" | "not_informed"; deskCode: string | null; spaces: Array<{ code: string; slot: string; title: string | null }> };
export type TeamMember = { id: string; name: string; jobTitle: string | null; shared: boolean; days: TeamDay[] };

export async function sharesWithManager(db: DbOrTx, employeeId: string): Promise<boolean> {
  const [p] = await db.select({ v: employeePreference.shareWithManager }).from(employeePreference).where(eq(employeePreference.employeeId, employeeId));
  return p?.v ?? false;
}

/** Preferência da própria pessoa (opt-in). Auditada porque muda quem vê o quê. */
export async function setShareWithManager(db: Db, actor: Actor, value: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await sharesWithManager(tx, actor.employeeId);
    await tx
      .insert(employeePreference)
      .values({ employeeId: actor.employeeId, shareWithManager: value })
      .onConflictDoUpdate({ target: employeePreference.employeeId, set: { shareWithManager: value, updatedAt: new Date() } });
    if (before !== value) {
      await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "preference.share_with_manager", entityType: "employee", entityId: actor.employeeId, before: { shareWithManager: before }, after: { shareWithManager: value }, requestId: actor.requestId });
    }
  });
}

/** Subordinados diretos ativos com o que autorizaram compartilhar, nas datas pedidas. */
export async function teamWeek(db: DbOrTx, managerId: string, dates: string[]): Promise<TeamMember[]> {
  const reports = await db
    .select({ id: employee.id, name: employee.fullName, jobTitle: employee.jobTitle, shared: employeePreference.shareWithManager })
    .from(employee)
    .leftJoin(employeePreference, eq(employeePreference.employeeId, employee.id))
    .where(and(eq(employee.managerEmployeeId, managerId), eq(employee.status, "active")))
    .orderBy(asc(employee.fullName));
  const sharing = reports.filter((r) => r.shared).map((r) => r.id);
  const intents = sharing.length ? await db.select().from(presenceIntent).where(and(inArray(presenceIntent.employeeId, sharing), inArray(presenceIntent.date, dates))) : [];
  const desks = sharing.length
    ? await db
        .select({ employeeId: deskBooking.employeeId, date: deskBooking.bookingDate, code: resource.code })
        .from(deskBooking)
        .innerJoin(resource, eq(resource.id, deskBooking.resourceId))
        .where(and(inArray(deskBooking.employeeId, sharing), inArray(deskBooking.bookingDate, dates), eq(deskBooking.status, "confirmed")))
    : [];
  const spaces = sharing.length
    ? await db
        .select({ employeeId: spaceBooking.employeeId, code: resource.code, title: spaceBooking.title, titleVisibility: spaceBooking.titleVisibility, lower: sql<string>`lower(${spaceBooking.period})`, upper: sql<string>`upper(${spaceBooking.period})`, date: sql<string>`(lower(${spaceBooking.period}) at time zone 'America/Sao_Paulo')::date::text` })
        .from(spaceBooking)
        .innerJoin(resource, eq(resource.id, spaceBooking.resourceId))
        .where(and(inArray(spaceBooking.employeeId, sharing), eq(spaceBooking.status, "confirmed"), inArray(sql`(lower(${spaceBooking.period}) at time zone 'America/Sao_Paulo')::date::text`, dates)))
        .orderBy(asc(sql`lower(${spaceBooking.period})`))
    : [];
  return reports.map((r) => ({
    id: r.id,
    name: r.name,
    jobTitle: r.jobTitle,
    shared: !!r.shared,
    days: dates.map((date) => ({
      date,
      intent: (intents.find((i) => i.employeeId === r.id && i.date === date)?.intent ?? "not_informed") as TeamDay["intent"],
      deskCode: desks.find((d) => d.employeeId === r.id && d.date === date)?.code ?? null,
      spaces: spaces
        .filter((s) => s.employeeId === r.id && s.date === date)
        .map((s) => ({ code: s.code, slot: formatSlot({ start: new Date(s.lower), end: new Date(s.upper) }), title: s.titleVisibility === "manager" || s.titleVisibility === "all" ? s.title : null })),
    })),
  }));
}

export async function hasDirectReports(db: DbOrTx, managerId: string): Promise<boolean> {
  const [r] = await db.select({ id: employee.id }).from(employee).where(and(eq(employee.managerEmployeeId, managerId), eq(employee.status, "active"))).limit(1);
  return !!r;
}

export function todayIso(): string {
  return localToday();
}
