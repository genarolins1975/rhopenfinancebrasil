import { and, count, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { auditEvent, employee, invitation, outboxEvent } from "@/db/schema";

/** Números do painel com numerador e definição explícitos. Sem CPF, sem ranking. */
export async function adminOverview(db: DbOrTx) {
  const byStatus = await db.select({ status: employee.status, n: count() }).from(employee).groupBy(employee.status);
  const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, r.n])) as Record<string, number>;
  const [invitedWithoutActive] = await db
    .select({ n: count() })
    .from(employee)
    .where(
      and(
        eq(employee.status, "invited"),
        sql`not exists (select 1 from ${invitation} i where i.employee_id = ${employee.id} and i.used_at is null and i.revoked_at is null and i.expires_at > now())`,
      ),
    );
  const [expiredInvitations] = await db
    .select({ n: count() })
    .from(invitation)
    .where(and(isNull(invitation.usedAt), isNull(invitation.revokedAt), lte(invitation.expiresAt, sql`now()`)));
  const outbox = await db.select({ status: outboxEvent.status, n: count() }).from(outboxEvent).groupBy(outboxEvent.status);
  const outboxMap = Object.fromEntries(outbox.map((r) => [r.status, r.n])) as Record<string, number>;
  const [auditLast24h] = await db
    .select({ n: count() })
    .from(auditEvent)
    .where(gt(auditEvent.createdAt, sql`now() - interval '24 hours'`));
  return {
    employees: { invited: statusMap.invited ?? 0, active: statusMap.active ?? 0, suspended: statusMap.suspended ?? 0, deactivated: statusMap.deactivated ?? 0 },
    invitedWithoutActiveInvitation: invitedWithoutActive.n,
    expiredInvitations: expiredInvitations.n,
    outbox: { pending: outboxMap.pending ?? 0, failed: outboxMap.failed ?? 0, delivered: outboxMap.delivered ?? 0 },
    auditLast24h: auditLast24h.n,
  };
}
