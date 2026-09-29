import { and, desc, eq, ilike, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { auditEvent, employee } from "@/db/schema";

export async function listAudit(db: DbOrTx, filters: { action?: string; entityType?: string; entityId?: string; page?: number } = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 50;
  const conds = [];
  if (filters.action) conds.push(ilike(auditEvent.action, `${filters.action}%`));
  if (filters.entityType) conds.push(eq(auditEvent.entityType, filters.entityType));
  if (filters.entityId) conds.push(eq(auditEvent.entityId, filters.entityId));
  const where = conds.length ? and(...conds) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(auditEvent).where(where);
  const items = await db
    .select({
      id: auditEvent.id,
      action: auditEvent.action,
      entityType: auditEvent.entityType,
      entityId: auditEvent.entityId,
      reason: auditEvent.reason,
      createdAt: auditEvent.createdAt,
      actorName: employee.fullName,
      before: auditEvent.before,
      after: auditEvent.after,
    })
    .from(auditEvent)
    .leftJoin(employee, eq(employee.id, auditEvent.actorEmployeeId))
    .where(where)
    .orderBy(desc(auditEvent.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items, total, page, pageSize };
}
