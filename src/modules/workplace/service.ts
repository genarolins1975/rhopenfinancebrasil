import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { deskBooking, employee, floorPlanPlacement, floorPlanVersion, officeCalendar, officeSettings, resource, resourceStatusPeriod, zone } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { addDays, formatLocalDate, localToday } from "@/modules/shared/dates";
import { ConflictError, ValidationError } from "@/modules/shared/errors";
import { type Actor, advisoryExclusiveDay, assertIsoDate, assertPermission, assertUuid, lockDaysAndPeople, lockResources, readSettings, shareLockEmployee, withOfficeTx } from "@/modules/office/shared";
import { applyConflictDecisions, type ConflictDecision, type IncompatibleBooking, listActiveBookingsAll as listActiveBookings } from "@/modules/office/conflicts";

/* Inventário. */

export async function listResources(db: DbOrTx, filter: { type?: "desk" | "room" | "booth"; includeRetired?: boolean } = {}) {
  const conds = [];
  if (filter.type) conds.push(eq(resource.type, filter.type));
  if (!filter.includeRetired) conds.push(isNull(resource.retiredOn));
  return db
    .select({ id: resource.id, code: resource.code, type: resource.type, zoneId: resource.zoneId, zoneCode: zone.code, zoneName: zone.name, capacity: resource.capacity, attributes: resource.attributes, attributesVerifiedAt: resource.attributesVerifiedAt, retiredOn: resource.retiredOn })
    .from(resource)
    .leftJoin(zone, eq(zone.id, resource.zoneId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(resource.code));
}

export async function getResourceByCode(db: DbOrTx, code: string) {
  const [row] = await db
    .select({ id: resource.id, code: resource.code, type: resource.type, zoneCode: zone.code, zoneName: zone.name, capacity: resource.capacity, attributes: resource.attributes, attributesVerifiedAt: resource.attributesVerifiedAt, retiredOn: resource.retiredOn })
    .from(resource)
    .leftJoin(zone, eq(zone.id, resource.zoneId))
    .where(eq(resource.code, code));
  return row ?? null;
}

export async function listZones(db: DbOrTx) {
  return db.select().from(zone).orderBy(asc(zone.code));
}

export async function upsertZone(db: Db, actor: Actor, input: { code: string; name: string }) {
  await assertPermission(db, actor, "resource.manage");
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,20}$/.test(code)) throw new ValidationError("Código de zona inválido.");
  const [row] = await db.insert(zone).values({ code, name: input.name.trim() }).onConflictDoUpdate({ target: zone.code, set: { name: input.name.trim() } }).returning();
  return row;
}

export type ResourceInput = { code: string; type: "desk" | "room" | "booth"; zoneId?: string | null; capacity?: number | null; attributes?: Record<string, unknown> };

export async function createResource(db: Db, actor: Actor, input: ResourceInput) {
  await assertPermission(db, actor, "resource.manage");
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,12}$/.test(code)) throw new ValidationError("Código do recurso inválido: use letras, números e hífen.");
  if (input.type === "desk" && input.capacity) throw new ValidationError("Mesa não tem capacidade.");
  if (input.type !== "desk" && (!input.capacity || input.capacity < 1)) throw new ValidationError("Informe a capacidade de sala ou cabine.");
  return withOfficeTx(db, async (tx) => {
    const [row] = await tx
      .insert(resource)
      .values({ code, type: input.type, zoneId: input.zoneId || null, capacity: input.type === "desk" ? null : input.capacity, attributes: input.attributes ?? {} })
      .returning();
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "resource.created", entityType: "resource", entityId: row.id, after: { code, type: input.type }, requestId: actor.requestId });
    return row;
  });
}

/** Atributos com marcação de verificação (quem, quando). Identidade e posição não mudam aqui (DIR-030). */
export async function updateResourceAttributes(db: Db, actor: Actor, resourceId: string, input: { attributes: Record<string, unknown>; zoneId?: string | null; capacity?: number | null; verified: boolean }) {
  await assertPermission(db, actor, "resource.manage");
  assertUuid(resourceId, "Recurso");
  return withOfficeTx(db, async (tx) => {
    await shareLockEmployee(tx, actor.employeeId);
    const [current] = await tx.select().from(resource).where(eq(resource.id, resourceId)).for("update");
    if (!current) throw new ValidationError("Recurso não encontrado.");
    const set: Partial<typeof resource.$inferInsert> = { attributes: input.attributes, updatedAt: new Date() };
    if (input.zoneId !== undefined) set.zoneId = input.zoneId || null;
    if (input.capacity !== undefined && current.type !== "desk") set.capacity = input.capacity;
    if (input.verified) {
      set.attributesVerifiedAt = new Date();
      set.attributesVerifiedBy = actor.employeeId;
    }
    await tx.update(resource).set(set).where(eq(resource.id, resourceId));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "resource.updated", entityType: "resource", entityId: resourceId, before: { attributes: current.attributes }, after: { attributes: input.attributes, verified: input.verified }, requestId: actor.requestId });
  });
}

/* Situação operacional: manutenção e bloqueio com diálogo de conflito (DIR-033). */

export type PeriodInput = { resourceId: string; status: "maintenance" | "admin_block"; startsOn: string; endsOn?: string | null; reason: string; publicReason?: string | null };

export async function previewStatusPeriod(db: DbOrTx, actor: Actor, input: PeriodInput): Promise<{ conflicts: IncompatibleBooking[] }> {
  await assertPermission(db, actor, "resource.status.manage");
  assertUuid(input.resourceId, "Recurso");
  assertIsoDate(input.startsOn, "Início");
  if (input.endsOn) assertIsoDate(input.endsOn, "Término");
  const bookings = await listActiveBookings(db, { resourceIds: [input.resourceId], from: input.startsOn, to: input.endsOn ?? null });
  return { conflicts: bookings.map((b) => ({ ...b, why: input.status === "maintenance" ? "mesa em manutenção" : "mesa bloqueada administrativamente" })) };
}

export async function createStatusPeriod(db: Db, actor: Actor, input: PeriodInput, decisions: ConflictDecision[] = []) {
  await assertPermission(db, actor, "resource.status.manage");
  assertUuid(input.resourceId, "Recurso");
  assertIsoDate(input.startsOn, "Início");
  if (input.endsOn) assertIsoDate(input.endsOn, "Término");
  if (input.startsOn < localToday()) throw new ValidationError("O período começa hoje ou depois.");
  if (input.endsOn && input.endsOn < input.startsOn) throw new ValidationError("O término não pode ser anterior ao início.");
  if (!input.reason.trim()) throw new ValidationError("Informe o motivo.");
  return withOfficeTx(db, async (tx) => {
    const known = await listActiveBookings(tx, { resourceIds: [input.resourceId], from: input.startsOn, to: input.endsOn ?? null });
    await lockDaysAndPeople(tx, { dates: known.map((k) => k.date), people: [actor.employeeId, ...known.map((k) => k.employeeId)] });
    const targets = decisions.map((d) => d.targetResourceId).filter((v): v is string => !!v);
    await lockResources(tx, [input.resourceId, ...targets]);
    const conflicts = await listActiveBookings(tx, { resourceIds: [input.resourceId], from: input.startsOn, to: input.endsOn ?? null });
    await applyConflictDecisions(tx, actor, conflicts.map((c) => ({ ...c, why: input.status === "maintenance" ? "mesa em manutenção" : "mesa bloqueada administrativamente" })), decisions, {
      excludeResourceIds: [input.resourceId],
      notice: input.status === "maintenance" ? "A mesa entrará em manutenção." : "A mesa foi bloqueada administrativamente.",
    });
    const [row] = await tx
      .insert(resourceStatusPeriod)
      .values({ resourceId: input.resourceId, status: input.status, startsOn: input.startsOn, endsOn: input.endsOn || null, reason: input.reason.trim(), publicReason: input.publicReason?.trim() || null, createdBy: actor.employeeId })
      .returning();
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: `resource.${input.status}.created`, entityType: "resource", entityId: input.resourceId, after: { periodId: row.id, startsOn: input.startsOn, endsOn: input.endsOn ?? null, decisions: decisions.length }, reason: input.reason, requestId: actor.requestId });
    return row;
  });
}

/** Libera o período a partir de um dia local (padrão hoje); a mesa volta pela vigência, sem job. */
export async function releaseStatusPeriod(db: Db, actor: Actor, periodId: string, input: { releasedOn?: string; reason: string }) {
  await assertPermission(db, actor, "resource.status.manage");
  assertUuid(periodId, "Período");
  const releasedOn = input.releasedOn ?? localToday();
  assertIsoDate(releasedOn, "Data de liberação");
  if (!input.reason.trim()) throw new ValidationError("Informe o motivo.");
  return withOfficeTx(db, async (tx) => {
    const [p] = await tx.select().from(resourceStatusPeriod).where(eq(resourceStatusPeriod.id, periodId));
    if (!p) throw new ValidationError("Período não encontrado.");
    if (p.releasedOn) throw new ConflictError("Período já liberado.");
    if (releasedOn < p.startsOn) throw new ValidationError("A liberação não pode ser anterior ao início do período.");
    await shareLockEmployee(tx, actor.employeeId);
    await lockResources(tx, [p.resourceId]);
    await tx.update(resourceStatusPeriod).set({ releasedOn, releasedAt: new Date(), releasedBy: actor.employeeId }).where(eq(resourceStatusPeriod.id, periodId));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: `resource.${p.status}.released`, entityType: "resource", entityId: p.resourceId, before: { periodId, endsOn: p.endsOn }, after: { releasedOn }, reason: input.reason, requestId: actor.requestId });
  });
}

export async function listStatusPeriods(db: DbOrTx, filter: { resourceId?: string; activeFrom?: string } = {}) {
  const conds = [];
  if (filter.resourceId) conds.push(eq(resourceStatusPeriod.resourceId, filter.resourceId));
  if (filter.activeFrom) conds.push(sql`upper(period_range(${resourceStatusPeriod.startsOn}, ${resourceStatusPeriod.endsOn}, ${resourceStatusPeriod.releasedOn})) is null or upper(period_range(${resourceStatusPeriod.startsOn}, ${resourceStatusPeriod.endsOn}, ${resourceStatusPeriod.releasedOn})) > ${filter.activeFrom}::date`);
  return db
    .select({ id: resourceStatusPeriod.id, resourceId: resourceStatusPeriod.resourceId, code: resource.code, status: resourceStatusPeriod.status, startsOn: resourceStatusPeriod.startsOn, endsOn: resourceStatusPeriod.endsOn, releasedOn: resourceStatusPeriod.releasedOn, reason: resourceStatusPeriod.reason, publicReason: resourceStatusPeriod.publicReason })
    .from(resourceStatusPeriod)
    .innerJoin(resource, eq(resource.id, resourceStatusPeriod.resourceId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(resourceStatusPeriod.startsOn));
}

/** Desativar recurso: encerra o que depende dele e trata reservas futuras na mesma transação. */
export async function retireResource(db: Db, actor: Actor, resourceId: string, input: { retiredOn?: string; reason: string }, decisions: ConflictDecision[] = []) {
  await assertPermission(db, actor, "resource.manage");
  assertUuid(resourceId, "Recurso");
  const retiredOn = input.retiredOn ?? localToday();
  assertIsoDate(retiredOn, "Data");
  if (retiredOn < localToday()) throw new ValidationError("A desativação vale de hoje em diante.");
  if (!input.reason.trim()) throw new ValidationError("Informe o motivo.");
  return withOfficeTx(db, async (tx) => {
    const known = await listActiveBookings(tx, { resourceIds: [resourceId], from: retiredOn, to: null });
    await lockDaysAndPeople(tx, { dates: known.map((k) => k.date), people: [actor.employeeId, ...known.map((k) => k.employeeId)] });
    const targets = decisions.map((d) => d.targetResourceId).filter((v): v is string => !!v);
    await lockResources(tx, [resourceId, ...targets]);
    const [current] = await tx.select().from(resource).where(eq(resource.id, resourceId));
    if (!current) throw new ValidationError("Recurso não encontrado.");
    if (current.retiredOn) throw new ConflictError("Recurso já desativado.");
    const { exclusiveAssignment } = await import("@/db/schema");
    const openAssignments = await tx
      .select({ id: exclusiveAssignment.id, validFrom: exclusiveAssignment.validFrom })
      .from(exclusiveAssignment)
      .where(and(eq(exclusiveAssignment.resourceId, resourceId), isNull(exclusiveAssignment.cancelledAt), or(isNull(exclusiveAssignment.validTo), gte(exclusiveAssignment.validTo, retiredOn))));
    if (openAssignments.length) throw new ConflictError("Encerre ou anule as atribuições exclusivas desta mesa antes de desativá-la.");
    const conflicts = await listActiveBookings(tx, { resourceIds: [resourceId], from: retiredOn, to: null });
    await applyConflictDecisions(tx, actor, conflicts.map((c) => ({ ...c, why: "recurso desativado" })), decisions, { excludeResourceIds: [resourceId], notice: "O recurso foi desativado." });
    await tx.update(resource).set({ retiredOn, updatedAt: new Date() }).where(eq(resource.id, resourceId));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "resource.retired", entityType: "resource", entityId: resourceId, after: { retiredOn, decisions: decisions.length }, reason: input.reason, requestId: actor.requestId });
  });
}

/* Calendário do escritório. */

export async function listCalendar(db: DbOrTx, from: string, to: string) {
  return db.select().from(officeCalendar).where(and(gte(officeCalendar.date, from), sql`${officeCalendar.date} <= ${to}::date`)).orderBy(asc(officeCalendar.date));
}

export async function previewCloseDay(db: DbOrTx, actor: Actor, date: string): Promise<{ conflicts: IncompatibleBooking[] }> {
  await assertPermission(db, actor, "resource.status.manage");
  assertIsoDate(date);
  const bookings = await listActiveBookings(db, { from: date, to: date });
  return { conflicts: bookings.map((b) => ({ ...b, why: "escritório fechado" })) };
}

/** Fecha um dia com lock exclusivo da data e tratamento das reservas ativas (DIR-033). */
export async function closeDay(db: Db, actor: Actor, input: { date: string; reason: string }, decisions: ConflictDecision[] = []) {
  await assertPermission(db, actor, "resource.status.manage");
  assertIsoDate(input.date);
  if (input.date < localToday()) throw new ValidationError("Só dias de hoje em diante podem ser fechados.");
  if (!input.reason.trim()) throw new ValidationError("Informe o motivo.");
  if (decisions.some((d) => d.action === "realloc")) throw new ValidationError("Em dia fechado não há realocação: só cancelamento com comunicação.");
  return withOfficeTx(db, async (tx) => {
    await advisoryExclusiveDay(tx, input.date);
    const conflicts = await listActiveBookings(tx, { from: input.date, to: input.date });
    await lockDaysAndPeople(tx, { dates: [], people: [actor.employeeId, ...conflicts.map((c) => c.employeeId)] });
    await lockResources(tx, conflicts.map((c) => c.resourceId));
    await applyConflictDecisions(tx, actor, conflicts.map((c) => ({ ...c, why: "escritório fechado" })), decisions, { excludeResourceIds: [], notice: `O escritório estará fechado em ${formatLocalDate(input.date)}.` });
    await tx
      .insert(officeCalendar)
      .values({ date: input.date, isOpen: false, reason: input.reason.trim(), updatedBy: actor.employeeId })
      .onConflictDoUpdate({ target: officeCalendar.date, set: { isOpen: false, reason: input.reason.trim(), updatedBy: actor.employeeId, updatedAt: new Date() } });
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "calendar.day_closed", entityType: "office_calendar", entityId: input.date, after: { decisions: decisions.length }, reason: input.reason, requestId: actor.requestId });
  });
}

export async function openDay(db: Db, actor: Actor, input: { date: string; reason: string }) {
  await assertPermission(db, actor, "resource.status.manage");
  assertIsoDate(input.date);
  return withOfficeTx(db, async (tx) => {
    await advisoryExclusiveDay(tx, input.date);
    await shareLockEmployee(tx, actor.employeeId);
    await tx
      .insert(officeCalendar)
      .values({ date: input.date, isOpen: true, reason: input.reason.trim() || null, updatedBy: actor.employeeId })
      .onConflictDoUpdate({ target: officeCalendar.date, set: { isOpen: true, reason: input.reason.trim() || null, updatedBy: actor.employeeId, updatedAt: new Date() } });
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "calendar.day_opened", entityType: "office_calendar", entityId: input.date, reason: input.reason, requestId: actor.requestId });
  });
}

/* Configurações (PAR-01, PAR-35). */

const SETTING_KEYS = [
  "booking_open_weekday",
  "booking_open_time",
  "booking_horizon_weeks",
  "exception_max_days",
  "offer_minutes",
  "business_hours_start",
  "business_hours_end",
  "checkin_release_enabled",
  "checkin_release_time",
] as const;
const TIME_KEYS = ["booking_open_time", "business_hours_start", "business_hours_end", "checkin_release_time"];
const INT_RANGES: Record<string, [number, number]> = { booking_open_weekday: [1, 7], booking_horizon_weeks: [1, 52], exception_max_days: [1, 365], offer_minutes: [15, 1440] };

export async function updateSetting(db: Db, actor: Actor, key: string, value: string) {
  await assertPermission(db, actor, "settings.manage");
  if (!(SETTING_KEYS as readonly string[]).includes(key)) throw new ValidationError("Configuração desconhecida.");
  let parsed: unknown;
  if (TIME_KEYS.includes(key)) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new ValidationError("Hora inválida (HH:MM).");
    parsed = value;
  } else if (key === "checkin_release_enabled") {
    if (value !== "true" && value !== "false") throw new ValidationError("Valor inválido: use sim ou não.");
    parsed = value === "true";
  } else {
    const n = Number(value);
    const [min, max] = INT_RANGES[key];
    if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`Valor inválido: inteiro entre ${min} e ${max}.`);
    parsed = n;
  }
  if (key === "business_hours_start" || key === "business_hours_end") {
    const current = await readSettings(db);
    const start = key === "business_hours_start" ? String(parsed) : current.businessHoursStart;
    const end = key === "business_hours_end" ? String(parsed) : current.businessHoursEnd;
    if (end <= start) throw new ValidationError("O fim do expediente precisa ser depois do início.");
  }
  await withOfficeTx(db, async (tx) => {
    await shareLockEmployee(tx, actor.employeeId);
    const [before] = await tx.select().from(officeSettings).where(eq(officeSettings.key, key));
    await tx
      .insert(officeSettings)
      .values({ key, value: parsed as object, updatedBy: actor.employeeId })
      .onConflictDoUpdate({ target: officeSettings.key, set: { value: parsed as object, updatedBy: actor.employeeId, updatedAt: new Date() } });
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "settings.updated", entityType: "office_settings", entityId: key, before: { value: before?.value ?? null }, after: { value: parsed }, requestId: actor.requestId });
  });
}

/* Planta: versões e publicação. Trocar o desenho não troca resource.id (DIR-030). */

export type ExtractionFile = {
  fonte: string;
  sha256_pdf: string;
  validado: boolean;
  mesas: Array<{ id_provisorio: string; bloco: number; fileira: number; lado: string; x: number; y: number }>;
  espacos: Array<{ id_provisorio: string; rotulo_planta: string; tipo: string; x: number; y: number }>;
  cabines: Array<{ id_provisorio: string; rotulo_planta: string; tipo: string; x: number; y: number }>;
  blocos: Array<{ bloco: number; zona: string; fileiras: number; mesas: number }>;
};

/**
 * Cria um rascunho de planta a partir do arquivo de trabalho da extração: zonas por bloco, recursos por id
 * provisório (idempotente por código) e posições normalizadas. Nada é publicado aqui.
 */
export async function createDraftFromExtraction(db: Db, actor: Actor, file: ExtractionFile, name: string) {
  await assertPermission(db, actor, "floorplan.edit");
  return withOfficeTx(db, async (tx) => {
    const [plan] = await tx
      .insert(floorPlanVersion)
      .values({ name, sourceSha256: file.sha256_pdf, status: "draft", notes: `${file.fonte}. Inventário ${file.validado ? "validado" : "NÃO validado"} por Facilities e RH.`, createdBy: actor.employeeId })
      .returning();
    const zoneIds = new Map<string, string>();
    for (const b of file.blocos) {
      const code = `B${b.bloco}`;
      const [z] = await tx
        .insert(zone)
        .values({ code, name: `Bloco ${b.bloco} (${b.zona})`, planVersionId: plan.id })
        .onConflictDoUpdate({ target: zone.code, set: { name: `Bloco ${b.bloco} (${b.zona})` } })
        .returning();
      zoneIds.set(code, z.id);
    }
    const [zc] = await tx.insert(zone).values({ code: "CAB", name: "Cabines acústicas", planVersionId: plan.id }).onConflictDoUpdate({ target: zone.code, set: { name: "Cabines acústicas" } }).returning();
    const [zs] = await tx.insert(zone).values({ code: "SAL", name: "Salas e booths", planVersionId: plan.id }).onConflictDoUpdate({ target: zone.code, set: { name: "Salas e booths" } }).returning();
    let created = 0;
    const place = async (resourceId: string, x: number, y: number, w: number, h: number) => {
      await tx.insert(floorPlanPlacement).values({ planVersionId: plan.id, resourceId, x, y, w, h }).onConflictDoNothing();
    };
    const ensure = async (code: string, type: "desk" | "room" | "booth", zoneId: string | null, capacity: number | null, attributes: Record<string, unknown>) => {
      const [existing] = await tx.select({ id: resource.id }).from(resource).where(eq(resource.code, code));
      if (existing) return existing.id;
      const [row] = await tx.insert(resource).values({ code, type, zoneId, capacity, attributes }).returning({ id: resource.id });
      created += 1;
      return row.id;
    };
    for (const m of file.mesas) {
      const id = await ensure(m.id_provisorio, "desk", zoneIds.get(`B${m.bloco}`) ?? null, null, { bloco: m.bloco, fileira: m.fileira, lado: m.lado, rotulo: "ME01", validado: false });
      await place(id, m.x, m.y, 0.016, 0.02);
    }
    for (const c of file.cabines) {
      const id = await ensure(c.id_provisorio, "booth", zc.id, 1, { rotulo: c.rotulo_planta, validado: false });
      await place(id, c.x, c.y, 0.02, 0.028);
    }
    for (const s of file.espacos) {
      const type = s.tipo === "booth" ? "booth" : "room";
      const cap = /reuni[aã]o 1/i.test(s.rotulo_planta) ? 20 : /reuni[aã]o 2/i.test(s.rotulo_planta) ? 8 : /reuni[aã]o 3/i.test(s.rotulo_planta) ? 6 : /aberta/i.test(s.rotulo_planta) ? 8 : 4;
      const id = await ensure(s.id_provisorio, type, zs.id, cap, { rotulo: s.rotulo_planta, validado: false, capacidade_inferida_pelas_cadeiras: true });
      await place(id, s.x, s.y, 0.04, 0.05);
    }
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "floorplan.draft_created", entityType: "floor_plan_version", entityId: plan.id, after: { name, resourcesCreated: created, sha256: file.sha256_pdf }, requestId: actor.requestId });
    return { planId: plan.id, resourcesCreated: created };
  });
}

export async function listPlanVersions(db: DbOrTx) {
  return db.select().from(floorPlanVersion).orderBy(desc(floorPlanVersion.createdAt));
}

export async function approvePlan(db: Db, actor: Actor, planId: string, notes: string) {
  await assertPermission(db, actor, "floorplan.publish");
  assertUuid(planId, "Versão");
  await withOfficeTx(db, async (tx) => {
    await shareLockEmployee(tx, actor.employeeId);
    const [p] = await tx.select().from(floorPlanVersion).where(eq(floorPlanVersion.id, planId)).for("update");
    if (!p) throw new ValidationError("Versão não encontrada.");
    if (p.status !== "draft") throw new ConflictError("Só rascunho pode ser aprovado.");
    await tx.update(floorPlanVersion).set({ status: "approved", approvedBy: actor.employeeId, approvedAt: new Date(), notes: notes.trim() || p.notes }).where(eq(floorPlanVersion.id, planId));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "floorplan.approved", entityType: "floor_plan_version", entityId: planId, requestId: actor.requestId, reason: notes });
  });
}

/** Publicação: uma única versão publicada; a anterior é aposentada; reservas e atribuições não mudam. */
export async function publishPlan(db: Db, actor: Actor, planId: string) {
  await assertPermission(db, actor, "floorplan.publish");
  assertUuid(planId, "Versão");
  await withOfficeTx(db, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('floor_plan_publish'))`);
    const [p] = await tx.select().from(floorPlanVersion).where(eq(floorPlanVersion.id, planId)).for("update");
    if (!p) throw new ValidationError("Versão não encontrada.");
    if (p.status !== "approved") throw new ConflictError("Só versão aprovada pode ser publicada.");
    await tx.update(floorPlanVersion).set({ status: "retired" }).where(eq(floorPlanVersion.status, "published"));
    await tx.update(floorPlanVersion).set({ status: "published", publishedAt: new Date() }).where(eq(floorPlanVersion.id, planId));
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "floorplan.published", entityType: "floor_plan_version", entityId: planId, requestId: actor.requestId });
  });
}

export type PublishedMap = { plan: { id: string; name: string; publishedAt: Date | null; notes: string | null }; placements: Array<{ resourceId: string; code: string; type: string; x: number; y: number; w: number; h: number }> } | null;

export async function publishedMap(db: DbOrTx): Promise<PublishedMap> {
  const [plan] = await db.select().from(floorPlanVersion).where(eq(floorPlanVersion.status, "published"));
  if (!plan) return null;
  const placements = await db
    .select({ resourceId: floorPlanPlacement.resourceId, code: resource.code, type: resource.type, x: floorPlanPlacement.x, y: floorPlanPlacement.y, w: floorPlanPlacement.w, h: floorPlanPlacement.h })
    .from(floorPlanPlacement)
    .innerJoin(resource, eq(resource.id, floorPlanPlacement.resourceId))
    .where(and(eq(floorPlanPlacement.planVersionId, plan.id), isNull(resource.retiredOn)));
  return { plan: { id: plan.id, name: plan.name, publishedAt: plan.publishedAt, notes: plan.notes }, placements };
}

/** Reposicionar não altera identidade (DIR-030). */
export async function movePlacement(db: Db, actor: Actor, planId: string, resourceId: string, pos: { x: number; y: number }) {
  await assertPermission(db, actor, "floorplan.edit");
  assertUuid(planId, "Versão");
  assertUuid(resourceId, "Recurso");
  if (![pos.x, pos.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw new ValidationError("Posição fora do desenho.");
  await withOfficeTx(db, async (tx) => {
    const [p] = await tx.select().from(floorPlanVersion).where(eq(floorPlanVersion.id, planId));
    if (!p || p.status !== "draft") throw new ConflictError("Só rascunho pode ser editado.");
    await tx
      .insert(floorPlanPlacement)
      .values({ planVersionId: planId, resourceId, x: pos.x, y: pos.y, w: 0.016, h: 0.02 })
      .onConflictDoUpdate({ target: [floorPlanPlacement.planVersionId, floorPlanPlacement.resourceId], set: { x: pos.x, y: pos.y } });
    await recordAudit(tx, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "floorplan.placement_moved", entityType: "resource", entityId: resourceId, after: pos, requestId: actor.requestId });
  });
}

/* Pequenos utilitários usados pelas telas. */

export async function activeEmployeesNamed(db: DbOrTx, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db.select({ id: employee.id, name: employee.fullName }).from(employee).where(inArray(employee.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function bookingsOfResource(db: DbOrTx, resourceId: string, from: string, days = 14) {
  const rows = await db
    .select({ id: deskBooking.id, date: deskBooking.bookingDate, status: deskBooking.status, employeeId: deskBooking.employeeId })
    .from(deskBooking)
    .where(and(eq(deskBooking.resourceId, resourceId), gte(deskBooking.bookingDate, from), sql`${deskBooking.bookingDate} <= ${addDays(from, days)}::date`, inArray(deskBooking.status, ["confirmed", "held"])))
    .orderBy(asc(deskBooking.bookingDate));
  return rows;
}

/** Usado por telas que precisam saber se a pessoa pode reservar uma mesa em outra data (realocação). */
export async function availableDesksFor(db: DbOrTx, employeeId: string, date: string, excludeResourceIds: string[] = [], ignoreBookingId?: string) {
  const { stateForPerson } = await import("@/modules/availability/service");
  const { items } = await stateForPerson(db, employeeId, date, { types: ["desk"], ignoreBookingId });
  return items.filter((i) => i.availability.canBook && !excludeResourceIds.includes(i.resource.id)).map((i) => ({ id: i.resource.id, code: i.resource.code }));
}
