import { and, asc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accessException, accessGroupMember, deskBooking, employee, exclusiveAssignment, officeCalendar, resource, resourceStatusPeriod, zone } from "@/db/schema";
import { loadAccess } from "@/modules/access/can";
import { readSettings } from "@/modules/office/shared";
import { type Availability, type BookingOnDate, type DayContext, type Person, type Policy, type ResourceOnDate, bookingWindow, deskClass, explain } from "./rules";

export type { Availability, ResourceOnDate, DayContext, Person };

/** Contexto do dia: calendário e janela (passos 2 e 2b). */
export async function loadDayContext(db: DbOrTx, date: string, now = new Date()): Promise<Omit<DayContext, "personBooking">> {
  const [cal] = await db.select().from(officeCalendar).where(eq(officeCalendar.date, date));
  const settings = await readSettings(db);
  return { date, now, officeOpen: cal ? cal.isOpen : true, closedReason: cal && !cal.isOpen ? (cal.reason ?? null) : null, window: bookingWindow(date, now, settings) };
}

export async function loadPerson(db: DbOrTx, employeeId: string): Promise<Person> {
  const [row] = await db.select({ id: employee.id, status: employee.status }).from(employee).where(eq(employee.id, employeeId));
  if (!row) return { id: employeeId, status: "missing", canBookSelf: false };
  const access = await loadAccess(db, employeeId);
  return { id: row.id, status: row.status, canBookSelf: access.permissions.has("booking.self.manage") };
}

export async function personBookingOn(db: DbOrTx, employeeId: string, date: string): Promise<{ resourceId: string; id: string; status: "confirmed" | "held" } | null> {
  const [row] = await db
    .select({ id: deskBooking.id, resourceId: deskBooking.resourceId, status: sql<"confirmed" | "held">`${deskBooking.status}::text` })
    .from(deskBooking)
    .where(and(eq(deskBooking.employeeId, employeeId), eq(deskBooking.bookingDate, date), activeBookingWhere()));
  return row ?? null;
}

function activeBookingWhere() {
  return or(eq(deskBooking.status, "confirmed"), and(eq(deskBooking.status, "held"), gt(deskBooking.holdExpiresAt, sql`now()`)));
}

/**
 * Carrega o estado de recursos numa data: situação operacional, política (atribuição, exceção, integrantes) e reserva.
 * Usado pela leitura (mapa, lista, semana) e pela escrita depois dos locks, com os mesmos dados.
 */
export async function loadResourcesOnDate(db: DbOrTx, date: string, filter: { ids?: string[]; types?: Array<"desk" | "room" | "booth"> } = {}): Promise<ResourceOnDate[]> {
  const conds = [];
  if (filter.ids) conds.push(inArray(resource.id, filter.ids));
  if (filter.types) conds.push(inArray(resource.type, filter.types));
  const rows = await db
    .select({ id: resource.id, code: resource.code, type: resource.type, capacity: resource.capacity, attributes: resource.attributes, retiredOn: resource.retiredOn, zoneCode: zone.code, zoneName: zone.name })
    .from(resource)
    .leftJoin(zone, eq(zone.id, resource.zoneId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(resource.code));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const periods = await db
    .select({ id: resourceStatusPeriod.id, resourceId: resourceStatusPeriod.resourceId, status: resourceStatusPeriod.status, publicReason: resourceStatusPeriod.publicReason })
    .from(resourceStatusPeriod)
    .where(and(inArray(resourceStatusPeriod.resourceId, ids), sql`period_range(${resourceStatusPeriod.startsOn}, ${resourceStatusPeriod.endsOn}, ${resourceStatusPeriod.releasedOn}) @> ${date}::date`));
  const assignments = await db
    .select()
    .from(exclusiveAssignment)
    .where(and(inArray(exclusiveAssignment.resourceId, ids), isNull(exclusiveAssignment.cancelledAt), lte(exclusiveAssignment.validFrom, date), or(isNull(exclusiveAssignment.validTo), gte(exclusiveAssignment.validTo, date))));
  const assignmentIds = assignments.map((a) => a.id);
  const exceptions = assignmentIds.length
    ? await db
        .select()
        .from(accessException)
        .where(and(inArray(accessException.assignmentId, assignmentIds), isNull(accessException.revokedAt), lte(accessException.startsOn, date), gte(accessException.endsOn, date)))
    : [];
  const groupIds = [...new Set(assignments.map((a) => a.accessGroupId).filter((g): g is string => !!g))];
  const members = groupIds.length
    ? await db
        .select({ groupId: accessGroupMember.groupId, employeeId: accessGroupMember.employeeId })
        .from(accessGroupMember)
        .where(and(inArray(accessGroupMember.groupId, groupIds), lte(accessGroupMember.validFrom, date), or(isNull(accessGroupMember.validTo), gte(accessGroupMember.validTo, date))))
    : [];
  const bookings = await db
    .select({ id: deskBooking.id, resourceId: deskBooking.resourceId, employeeId: deskBooking.employeeId, status: deskBooking.status, holdExpiresAt: deskBooking.holdExpiresAt, origin: deskBooking.origin })
    .from(deskBooking)
    .where(and(inArray(deskBooking.resourceId, ids), eq(deskBooking.bookingDate, date), activeBookingWhere()));

  const periodBy = new Map(periods.map((p) => [p.resourceId, p]));
  const maintenanceFirst = new Map<string, (typeof periods)[number]>();
  for (const p of periods) {
    const cur = maintenanceFirst.get(p.resourceId);
    if (!cur || (p.status === "maintenance" && cur.status !== "maintenance")) maintenanceFirst.set(p.resourceId, p);
  }
  const assignmentBy = new Map(assignments.map((a) => [a.resourceId, a]));
  const exceptionBy = new Map(exceptions.map((x) => [x.assignmentId, x]));
  const membersBy = new Map<string, Set<string>>();
  for (const m of members) {
    if (!membersBy.has(m.groupId)) membersBy.set(m.groupId, new Set());
    membersBy.get(m.groupId)!.add(m.employeeId);
  }
  const bookingBy = new Map(bookings.map((b) => [b.resourceId, b]));

  return rows.map((r) => {
    const a = assignmentBy.get(r.id) ?? null;
    const x = a ? (exceptionBy.get(a.id) ?? null) : null;
    const policy: Policy = {
      assignment: a ? { id: a.id, mode: a.mode, holderEmployeeId: a.holderEmployeeId, accessGroupId: a.accessGroupId, needsReview: a.needsReview, validFrom: a.validFrom, validTo: a.validTo } : null,
      exception: x ? { id: x.id, kind: x.kind, beneficiaryEmployeeId: x.beneficiaryEmployeeId, endsOn: x.endsOn } : null,
      members: a?.accessGroupId ? (membersBy.get(a.accessGroupId) ?? new Set()) : new Set(),
    };
    const p = maintenanceFirst.get(r.id) ?? periodBy.get(r.id) ?? null;
    const b = bookingBy.get(r.id);
    const booking: BookingOnDate | null = b ? { id: b.id, employeeId: b.employeeId, status: b.status as "held" | "confirmed", holdExpiresAt: b.holdExpiresAt, origin: b.origin } : null;
    return {
      id: r.id,
      code: r.code,
      type: r.type,
      zoneCode: r.zoneCode,
      zoneName: r.zoneName,
      capacity: r.capacity,
      attributes: (r.attributes ?? {}) as Record<string, unknown>,
      retired: !!r.retiredOn && r.retiredOn <= date,
      period: p ? { id: p.id, status: p.status, publicReason: p.publicReason } : null,
      policy,
      booking,
    };
  });
}

export type ResourceState = {
  resource: Pick<ResourceOnDate, "id" | "code" | "type" | "zoneCode" | "zoneName" | "capacity" | "attributes">;
  availability: Availability;
  /** Classe para indicadores e filtros administrativos. */
  deskClass: ReturnType<typeof deskClass>;
  /** Só com `exclusive.holder.view` (DIR-035). */
  holder: { name: string; mode: "individual" | "group" } | null;
};

/**
 * Estado de todos os recursos para uma pessoa numa data (mapa, lista, busca). A resposta carrega apenas o estado
 * calculado e a marca "é minha"; nomes de titulares só quando o ator tem `exclusive.holder.view`.
 */
export async function stateForPerson(db: DbOrTx, employeeId: string, date: string, opts: { holderView?: boolean; types?: Array<"desk" | "room" | "booth">; now?: Date; ignoreBookingId?: string } = {}): Promise<{ ctx: DayContext; items: ResourceState[] }> {
  const now = opts.now ?? new Date();
  const person = await loadPerson(db, employeeId);
  const day = await loadDayContext(db, date, now);
  // Realocação: a reserva que está sendo movida não conta como limite diário nem como "minha" na mesa de destino.
  const found = await personBookingOn(db, employeeId, date);
  const personBooking = found && found.id === opts.ignoreBookingId ? null : found;
  const ctx: DayContext = { ...day, personBooking };
  const resources = await loadResourcesOnDate(db, date, { types: opts.types ?? ["desk"] });
  const holderNames = opts.holderView ? await holderNamesFor(db, resources) : new Map<string, string>();
  const items = resources.map((r) => {
    const a = r.policy.assignment;
    const holder = opts.holderView && a ? { name: a.mode === "individual" ? (holderNames.get(a.holderEmployeeId!) ?? "titular") : "Grupo diretoria", mode: a.mode } : null;
    return {
      resource: { id: r.id, code: r.code, type: r.type, zoneCode: r.zoneCode, zoneName: r.zoneName, capacity: r.capacity, attributes: r.attributes },
      availability: explain(person, r, ctx),
      deskClass: deskClass(r),
      holder,
    };
  });
  return { ctx, items };
}

async function holderNamesFor(db: DbOrTx, resources: ResourceOnDate[]): Promise<Map<string, string>> {
  const ids = [...new Set(resources.map((r) => r.policy.assignment?.holderEmployeeId).filter((v): v is string => !!v))];
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: employee.id, name: employee.fullName }).from(employee).where(inArray(employee.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Estado de um único recurso para uma pessoa numa data, com a mesma função dos demais canais (DIR-021). */
export async function explainFor(db: DbOrTx, employeeId: string, resourceId: string, date: string, opts: { now?: Date; windowExempt?: boolean } = {}): Promise<{ availability: Availability; resource: ResourceOnDate | null }> {
  const person = await loadPerson(db, employeeId);
  const day = await loadDayContext(db, date, opts.now ?? new Date());
  const personBooking = await personBookingOn(db, employeeId, date);
  const [r] = await loadResourcesOnDate(db, date, { ids: [resourceId] });
  if (!r) return { availability: { code: "retired", label: "Desativada", reason: "recurso inexistente", canBook: false, mine: false, exclusiveMine: false, opensAt: null, publicReason: null, bookingId: null }, resource: null };
  return { availability: explain(person, r, { ...day, personBooking, windowExempt: opts.windowExempt }), resource: r };
}

export type CapacityReport = {
  date: string;
  desks: { total: number; shared: number; exclusive: number; maintenance: number; blocked: number; retired: number };
  sharedConfirmed: number;
  exclusiveConfirmed: number;
  heldExcluded: number;
  /** Explicação obrigatória de cada taxa (DIR-026). */
  notes: string[];
};

/** Capacidade por classe, sem dupla contagem: cada mesa entra em uma única classe pela ordem de desk_class. */
export async function capacityOn(db: DbOrTx, date: string): Promise<CapacityReport> {
  const resources = await loadResourcesOnDate(db, date, { types: ["desk"] });
  const classes = resources.map((r) => ({ r, cls: deskClass(r) }));
  const count = (c: string) => classes.filter((x) => x.cls === c).length;
  const confirmed = (c: string) => classes.filter((x) => x.cls === c && x.r.booking?.status === "confirmed").length;
  const held = classes.filter((x) => x.r.booking?.status === "held").length;
  return {
    date,
    desks: { total: resources.length, shared: count("shared"), exclusive: count("exclusive"), maintenance: count("maintenance"), blocked: count("blocked"), retired: count("retired") },
    sharedConfirmed: confirmed("shared"),
    exclusiveConfirmed: confirmed("exclusive"),
    heldExcluded: held,
    notes: [
      "Capacidade compartilhada: mesas sem atribuição exclusiva vigente (ou liberadas ao conjunto), operacionais na data. Mesa exclusiva em manutenção conta uma única vez, como manutenção.",
      "Ocupação: reservas confirmadas na data. Retenções da fila ficam fora do numerador. Reserva não é presença física.",
      "Mesa exclusiva sem reserva não é vaga compartilhada nem ocupação confirmada. Vínculo administrativo não entra em utilização.",
      "Fonte: tabelas do escritório na data de referência, regras vigentes no dia. Sem dados históricos antes da publicação do inventário.",
    ],
  };
}
