import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { employee } from "./core";

/*
 * Escritório: planta, recursos, situação operacional, calendário, exclusividade e reservas.
 * Três dimensões separadas (DIR-003): política de uso (exclusive_assignment e access_exception),
 * situação operacional (resource_status_period e resource.retired_on) e reserva (desk_booking).
 * Constraints de exclusão, funções e triggers vivem na migração manual 0004.
 */

const ts = () => timestamp({ withTimezone: true, mode: "date" });
export const tstzrange = customType<{ data: string; driverData: string }>({ dataType: () => "tstzrange" });

export const resourceType = pgEnum("resource_type", ["desk", "room", "booth"]);
export const planStatus = pgEnum("plan_status", ["draft", "approved", "published", "retired"]);
export const resourceStatusKind = pgEnum("resource_status_kind", ["maintenance", "admin_block"]);
export const assignmentMode = pgEnum("assignment_mode", ["individual", "group"]);
export const exceptionKind = pgEnum("exception_kind", ["release_to_shared", "release_to_employee"]);
export const deskBookingStatus = pgEnum("desk_booking_status", ["held", "confirmed", "cancelled", "expired"]);
export const bookingOrigin = pgEnum("booking_origin", ["self", "week_plan", "on_behalf", "waitlist_offer", "admin_realloc"]);
export const spaceBookingStatus = pgEnum("space_booking_status", ["confirmed", "cancelled"]);
export const titleVisibility = pgEnum("title_visibility", ["private", "manager", "all"]);
export const presenceIntentKind = pgEnum("presence_intent_kind", ["onsite", "remote", "not_informed"]);

/* Planta. */
export const floorPlanVersion = pgTable("floor_plan_version", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  sourceFileId: text(),
  sourceSha256: text(),
  status: planStatus().notNull().default("draft"),
  approvedBy: uuid().references(() => employee.id),
  approvedAt: ts(),
  publishedAt: ts(),
  notes: text(),
  createdBy: uuid().references(() => employee.id),
  createdAt: ts().notNull().defaultNow(),
});

export const zone = pgTable("zone", {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(),
  name: text().notNull(),
  planVersionId: uuid().references(() => floorPlanVersion.id),
});

export const resource = pgTable(
  "resource",
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull().unique(),
    type: resourceType().notNull(),
    zoneId: uuid().references(() => zone.id),
    capacity: integer(),
    attributes: jsonb().notNull().default(sql`'{}'::jsonb`),
    attributesVerifiedAt: ts(),
    attributesVerifiedBy: uuid().references(() => employee.id),
    retiredOn: date(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [check("resource_capacity_by_type", sql`(${t.type} = 'desk' and ${t.capacity} is null) or (${t.type} <> 'desk')`), index("resource_zone_idx").on(t.zoneId)],
);

export const floorPlanPlacement = pgTable(
  "floor_plan_placement",
  {
    id: uuid().primaryKey().defaultRandom(),
    planVersionId: uuid()
      .notNull()
      .references(() => floorPlanVersion.id),
    resourceId: uuid()
      .notNull()
      .references(() => resource.id),
    x: real().notNull(),
    y: real().notNull(),
    w: real().notNull(),
    h: real().notNull(),
    rotation: real().notNull().default(0),
    shape: text().notNull().default("rect"),
  },
  (t) => [uniqueIndex("floor_plan_placement_unique").on(t.planVersionId, t.resourceId)],
);

/* Situação operacional e calendário. */
export const resourceStatusPeriod = pgTable(
  "resource_status_period",
  {
    id: uuid().primaryKey().defaultRandom(),
    resourceId: uuid()
      .notNull()
      .references(() => resource.id),
    status: resourceStatusKind().notNull(),
    startsOn: date().notNull(),
    endsOn: date(),
    releasedOn: date(),
    releasedAt: ts(),
    reason: text().notNull(),
    publicReason: text(),
    createdBy: uuid().references(() => employee.id),
    releasedBy: uuid().references(() => employee.id),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    check("resource_status_period_dates", sql`(${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}) and (${t.releasedOn} is null or ${t.releasedOn} >= ${t.startsOn})`),
    index("resource_status_period_resource_idx").on(t.resourceId, t.startsOn),
  ],
);

export const officeCalendar = pgTable("office_calendar", {
  date: date().primaryKey(),
  isOpen: boolean().notNull(),
  reason: text(),
  updatedBy: uuid().references(() => employee.id),
  updatedAt: ts().notNull().defaultNow(),
});

export const officeSettings = pgTable("office_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedBy: uuid().references(() => employee.id),
  updatedAt: ts().notNull().defaultNow(),
});

/* Exclusividade. */
export const accessGroup = pgTable("access_group", {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(),
  name: text().notNull(),
});

export const accessGroupMember = pgTable(
  "access_group_member",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => accessGroup.id),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id),
    validFrom: date().notNull(),
    validTo: date(),
    addedBy: uuid().references(() => employee.id),
    removedBy: uuid().references(() => employee.id),
    reason: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [check("access_group_member_dates", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`), index("access_group_member_idx").on(t.groupId, t.validFrom, t.validTo)],
);

export const exclusiveAssignment = pgTable(
  "exclusive_assignment",
  {
    id: uuid().primaryKey().defaultRandom(),
    resourceId: uuid()
      .notNull()
      .references(() => resource.id),
    mode: assignmentMode().notNull(),
    holderEmployeeId: uuid().references(() => employee.id),
    accessGroupId: uuid().references(() => accessGroup.id),
    validFrom: date().notNull(),
    validTo: date(),
    needsReview: boolean().notNull().default(false),
    cancelledAt: ts(),
    cancelledBy: uuid().references(() => employee.id),
    cancelReason: text(),
    reason: text().notNull(),
    responsible: text().notNull(),
    createdBy: uuid().references(() => employee.id),
    endedBy: uuid().references(() => employee.id),
    endReason: text(),
    transferredFromId: uuid().references((): AnyPgColumn => exclusiveAssignment.id),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    check(
      "exclusive_assignment_mode_target",
      sql`(${t.mode} = 'individual' and ${t.holderEmployeeId} is not null and ${t.accessGroupId} is null) or (${t.mode} = 'group' and ${t.accessGroupId} is not null and ${t.holderEmployeeId} is null)`,
    ),
    check("exclusive_assignment_dates", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
    check("exclusive_assignment_review_individual", sql`${t.needsReview} = false or ${t.mode} = 'individual'`),
    check("exclusive_assignment_ended", sql`(${t.endedBy} is null or ${t.validTo} is not null) and ((${t.endedBy} is null) = (${t.endReason} is null))`),
    check("exclusive_assignment_cancelled", sql`(${t.cancelledAt} is null) = (${t.cancelledBy} is null)`),
    index("exclusive_assignment_resource_idx").on(t.resourceId, t.validFrom),
    index("exclusive_assignment_holder_idx").on(t.holderEmployeeId, t.validFrom, t.validTo).where(sql`cancelled_at is null`),
  ],
);

export const accessException = pgTable(
  "access_exception",
  {
    id: uuid().primaryKey().defaultRandom(),
    assignmentId: uuid()
      .notNull()
      .references(() => exclusiveAssignment.id),
    resourceId: uuid()
      .notNull()
      .references(() => resource.id),
    kind: exceptionKind().notNull(),
    beneficiaryEmployeeId: uuid().references(() => employee.id),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    reason: text().notNull(),
    createdBy: uuid().references(() => employee.id),
    revokedAt: ts(),
    revokedBy: uuid().references(() => employee.id),
    revokeReason: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    check("access_exception_dates", sql`${t.endsOn} >= ${t.startsOn}`),
    check("access_exception_beneficiary", sql`(${t.kind} = 'release_to_employee') = (${t.beneficiaryEmployeeId} is not null)`),
    index("access_exception_resource_idx").on(t.resourceId, t.startsOn),
  ],
);

/* Reservas. */
export const weekPlanRequest = pgTable(
  "week_plan_request",
  {
    id: uuid().primaryKey().defaultRandom(),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id),
    idempotencyKey: text().notNull(),
    payload: jsonb().notNull(),
    result: jsonb(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("week_plan_request_unique").on(t.employeeId, t.idempotencyKey)],
);

export const deskBooking = pgTable(
  "desk_booking",
  {
    id: uuid().primaryKey().defaultRandom(),
    resourceId: uuid()
      .notNull()
      .references(() => resource.id),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id),
    bookingDate: date().notNull(),
    status: deskBookingStatus().notNull(),
    origin: bookingOrigin().notNull(),
    actorEmployeeId: uuid()
      .notNull()
      .references(() => employee.id),
    idempotencyKey: text(),
    weekPlanRequestId: uuid().references(() => weekPlanRequest.id),
    accessExceptionId: uuid().references(() => accessException.id),
    holdExpiresAt: ts(),
    cancelledAt: ts(),
    cancelledBy: uuid().references(() => employee.id),
    cancelReason: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("desk_booking_resource_day").on(t.resourceId, t.bookingDate).where(sql`status in ('held', 'confirmed')`),
    uniqueIndex("desk_booking_employee_day").on(t.employeeId, t.bookingDate).where(sql`status in ('held', 'confirmed')`),
    uniqueIndex("desk_booking_idempotency").on(t.actorEmployeeId, t.idempotencyKey).where(sql`idempotency_key is not null`),
    check("desk_booking_hold", sql`${t.status} <> 'held' or ${t.holdExpiresAt} is not null`),
    check("desk_booking_on_behalf", sql`${t.origin} <> 'on_behalf' or ${t.actorEmployeeId} <> ${t.employeeId}`),
    index("desk_booking_employee_idx").on(t.employeeId, t.bookingDate),
    index("desk_booking_resource_idx").on(t.resourceId, t.bookingDate),
    index("desk_booking_hold_idx").on(t.holdExpiresAt).where(sql`status = 'held'`),
  ],
);

export const spaceBooking = pgTable(
  "space_booking",
  {
    id: uuid().primaryKey().defaultRandom(),
    resourceId: uuid()
      .notNull()
      .references(() => resource.id),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id),
    period: tstzrange().notNull(),
    title: text(),
    titleVisibility: titleVisibility().notNull().default("private"),
    status: spaceBookingStatus().notNull().default("confirmed"),
    actorEmployeeId: uuid()
      .notNull()
      .references(() => employee.id),
    idempotencyKey: text(),
    cancelledAt: ts(),
    cancelReason: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("space_booking_idempotency").on(t.actorEmployeeId, t.idempotencyKey).where(sql`idempotency_key is not null`)],
);

export const presenceIntent = pgTable(
  "presence_intent",
  {
    employeeId: uuid()
      .notNull()
      .references(() => employee.id),
    date: date().notNull(),
    intent: presenceIntentKind().notNull(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.date] })],
);

/*
 * Etapa 3: fila de espera, oferta com retenção, confirmação de uso e preferência de compartilhamento.
 * Triggers, grants e parâmetros iniciais na migração manual 0008.
 */
export const waitlistEntryStatus = pgEnum("waitlist_entry_status", ["waiting", "offered", "accepted", "expired", "cancelled"]);
export const waitlistOfferStatus = pgEnum("waitlist_offer_status", ["open", "accepted", "expired", "declined"]);
export const checkinMethod = pgEnum("checkin_method", ["portal", "qr"]);

export const waitlistEntry = pgTable(
  "waitlist_entry",
  {
    id: uuid().primaryKey().defaultRandom(),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id),
    date: date().notNull(),
    preferences: jsonb().notNull().default(sql`'{}'::jsonb`),
    status: waitlistEntryStatus().notNull().default("waiting"),
    createdAt: ts().notNull().defaultNow(),
    closedAt: ts(),
    closedBy: uuid().references(() => employee.id),
    closeReason: text(),
  },
  (t) => [
    uniqueIndex("waitlist_entry_active").on(t.employeeId, t.date).where(sql`status in ('waiting', 'offered')`),
    index("waitlist_entry_date_idx").on(t.date, t.status, t.createdAt),
  ],
);

export const waitlistOffer = pgTable(
  "waitlist_offer",
  {
    id: uuid().primaryKey().defaultRandom(),
    entryId: uuid()
      .notNull()
      .references(() => waitlistEntry.id),
    resourceId: uuid()
      .notNull()
      .references(() => resource.id),
    holdBookingId: uuid()
      .notNull()
      .unique()
      .references(() => deskBooking.id),
    offeredBy: uuid().references(() => employee.id),
    offeredAt: ts().notNull().defaultNow(),
    expiresAt: ts().notNull(),
    status: waitlistOfferStatus().notNull().default("open"),
    decidedAt: ts(),
  },
  (t) => [uniqueIndex("waitlist_offer_open").on(t.entryId).where(sql`status = 'open'`), index("waitlist_offer_expiry_idx").on(t.expiresAt).where(sql`status = 'open'`)],
);

export const checkin = pgTable(
  "checkin",
  {
    id: uuid().primaryKey().defaultRandom(),
    deskBookingId: uuid().references(() => deskBooking.id),
    spaceBookingId: uuid().references(() => spaceBooking.id),
    declaredAt: ts().notNull().defaultNow(),
    method: checkinMethod().notNull(),
    actorEmployeeId: uuid()
      .notNull()
      .references(() => employee.id),
  },
  (t) => [
    check("checkin_one_booking", sql`(${t.deskBookingId} is not null)::int + (${t.spaceBookingId} is not null)::int = 1`),
    uniqueIndex("checkin_desk_unique").on(t.deskBookingId).where(sql`desk_booking_id is not null`),
    uniqueIndex("checkin_space_unique").on(t.spaceBookingId).where(sql`space_booking_id is not null`),
  ],
);

/** Preferências da própria pessoa. Compartilhar com o gestor é opt-in (matriz de permissões, "Equipe do gestor"). */
export const employeePreference = pgTable("employee_preference", {
  employeeId: uuid()
    .primaryKey()
    .references(() => employee.id),
  shareWithManager: boolean().notNull().default(false),
  updatedAt: ts().notNull().defaultNow(),
});
