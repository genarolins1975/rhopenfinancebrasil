import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUser } from "./auth";

/* Tipos de coluna que o Drizzle não traz prontos. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => "citext",
});

const ts = () => timestamp({ withTimezone: true, mode: "date" });

/* Enums de domínio. */
export const employeeStatus = pgEnum("employee_status", ["invited", "active", "suspended", "deactivated"]);
export const orgCondition = pgEnum("org_condition", ["standard", "director"]);
export const outboxStatus = pgEnum("outbox_status", ["pending", "delivered", "failed"]);
export const importBatchStatus = pgEnum("import_batch_status", ["previewed", "applied", "discarded"]);

/* Colaboradores. */
export const area = pgTable("area", {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(),
  name: text().notNull(),
  createdAt: ts().notNull().defaultNow(),
});

export const employee = pgTable(
  "employee",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .unique()
      .references(() => authUser.id, { onDelete: "set null" }),
    fullName: text().notNull(),
    corporateEmail: citext().notNull().unique(),
    areaId: uuid().references(() => area.id),
    jobTitle: text(),
    managerEmployeeId: uuid().references((): AnyPgColumn => employee.id),
    orgCondition: orgCondition().notNull().default("standard"),
    status: employeeStatus().notNull().default("invited"),
    deactivatedAt: ts(),
    deactivatedBy: uuid(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index("employee_status_idx").on(t.status), index("employee_area_idx").on(t.areaId)],
);

export const employmentPeriod = pgTable(
  "employment_period",
  {
    id: uuid().primaryKey().defaultRandom(),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id),
    hireDate: date().notNull(),
    exitDate: date(),
    reason: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index("employment_period_employee_idx").on(t.employeeId),
    check("employment_period_dates", sql`${t.exitDate} is null or ${t.exitDate} >= ${t.hireDate}`),
  ],
);

export const employeeOrgAssignment = pgTable(
  "employee_org_assignment",
  {
    id: uuid().primaryKey().defaultRandom(),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id),
    areaId: uuid().references(() => area.id),
    managerEmployeeId: uuid().references(() => employee.id),
    jobTitle: text(),
    orgCondition: orgCondition().notNull().default("standard"),
    validFrom: date().notNull(),
    validTo: date(),
    createdBy: uuid(),
    reason: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index("employee_org_assignment_employee_idx").on(t.employeeId, t.validFrom),
    check("employee_org_assignment_dates", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
  ],
);

/** Tabela separada para o CPF. Nunca entra em listagens. */
export const employeeSensitive = pgTable("employee_sensitive", {
  employeeId: uuid()
    .primaryKey()
    .references(() => employee.id),
  cpfCiphertext: bytea().notNull(),
  cpfKeyVersion: integer().notNull(),
  cpfHmac: bytea().notNull().unique(),
  cpfHmacKeyVersion: integer().notNull(),
  cpfSuffix: char({ length: 2 }).notNull(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
});

export const invitation = pgTable(
  "invitation",
  {
    id: uuid().primaryKey().defaultRandom(),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id),
    tokenHash: text().notNull().unique(),
    expiresAt: ts().notNull(),
    usedAt: ts(),
    revokedAt: ts(),
    createdBy: uuid(),
    sentAt: ts(),
    deliveryStatus: text().notNull().default("queued"),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invitation_active_per_employee")
      .on(t.employeeId)
      .where(sql`${t.usedAt} is null and ${t.revokedAt} is null`),
  ],
);

/* Acesso. */
export const role = pgTable("role", {
  code: text().primaryKey(),
  name: text().notNull(),
  privileged: boolean().notNull().default(false),
});

export const permission = pgTable("permission", {
  code: text().primaryKey(),
  description: text().notNull(),
  sensitive: boolean().notNull().default(false),
});

export const rolePermission = pgTable(
  "role_permission",
  {
    roleCode: text()
      .notNull()
      .references(() => role.code),
    permissionCode: text()
      .notNull()
      .references(() => permission.code),
  },
  (t) => [primaryKey({ columns: [t.roleCode, t.permissionCode] })],
);

export const employeeRole = pgTable(
  "employee_role",
  {
    id: uuid().primaryKey().defaultRandom(),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id),
    roleCode: text()
      .notNull()
      .references(() => role.code),
    validFrom: date().notNull(),
    validTo: date(),
    grantedBy: uuid().references(() => employee.id),
    revokedAt: ts(),
    revokedBy: uuid(),
    reason: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("employee_role_active")
      .on(t.employeeId, t.roleCode)
      .where(sql`${t.revokedAt} is null`),
    check("employee_role_no_self_grant", sql`${t.grantedBy} is null or ${t.grantedBy} <> ${t.employeeId}`),
    check("employee_role_dates", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
  ],
);

export const employeePermission = pgTable(
  "employee_permission",
  {
    id: uuid().primaryKey().defaultRandom(),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id),
    permissionCode: text()
      .notNull()
      .references(() => permission.code),
    validFrom: date().notNull(),
    validTo: date(),
    grantedBy: uuid().references(() => employee.id),
    revokedAt: ts(),
    revokedBy: uuid(),
    reason: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("employee_permission_active")
      .on(t.employeeId, t.permissionCode)
      .where(sql`${t.revokedAt} is null`),
    check("employee_permission_no_self_grant", sql`${t.grantedBy} is null or ${t.grantedBy} <> ${t.employeeId}`),
    check("employee_permission_dates", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
  ],
);

/* Segurança de acesso: contador por conta, independente do IP. */
export const loginAttempt = pgTable(
  "login_attempt",
  {
    id: uuid().primaryKey().defaultRandom(),
    emailHash: text().notNull(),
    attemptedAt: ts().notNull().defaultNow(),
    success: boolean().notNull().default(false),
  },
  (t) => [index("login_attempt_email_idx").on(t.emailHash, t.attemptedAt)],
);

/* Importação CSV: prévia cifrada, de curta duração. */
export const importBatch = pgTable("import_batch", {
  id: uuid().primaryKey().defaultRandom(),
  createdBy: uuid()
    .notNull()
    .references(() => employee.id),
  status: importBatchStatus().notNull().default("previewed"),
  rowsCiphertext: bytea().notNull(),
  rowCount: integer().notNull(),
  summary: jsonb().notNull(),
  expiresAt: ts().notNull(),
  appliedAt: ts(),
  createdAt: ts().notNull().defaultNow(),
});

/* Notificações confiáveis. */
export const outboxEvent = pgTable(
  "outbox_event",
  {
    id: uuid().primaryKey().defaultRandom(),
    eventType: text().notNull(),
    aggregateType: text().notNull(),
    aggregateId: text().notNull(),
    payload: jsonb().notNull(),
    idempotencyKey: text().notNull().unique(),
    status: outboxStatus().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    nextAttemptAt: ts().notNull().defaultNow(),
    lastError: text(),
    deliveredAt: ts(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index("outbox_event_pending_idx").on(t.status, t.nextAttemptAt)],
);

/* Auditoria: somente inserção pelo papel da aplicação (grant em migração). */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid().primaryKey().defaultRandom(),
    actorUserId: text(),
    actorEmployeeId: uuid(),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    requestId: text(),
    ipHash: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index("audit_event_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("audit_event_actor_idx").on(t.actorEmployeeId, t.createdAt),
  ],
);
