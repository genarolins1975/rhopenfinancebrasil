import type { DbOrTx } from "@/db/client";
import { auditEvent } from "@/db/schema";
import { scrub } from "@/modules/shared/logger";

export type AuditInput = {
  actorUserId?: string | null;
  actorEmployeeId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId?: string | null;
  ipHash?: string | null;
};

/** Grava evento de auditoria na mesma transação da operação. Campos sensíveis são redigidos. */
export async function recordAudit(tx: DbOrTx, input: AuditInput): Promise<void> {
  await tx.insert(auditEvent).values({
    actorUserId: input.actorUserId ?? null,
    actorEmployeeId: input.actorEmployeeId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: input.before === undefined ? null : scrub(input.before),
    after: input.after === undefined ? null : scrub(input.after),
    reason: input.reason ?? null,
    requestId: input.requestId ?? null,
    ipHash: input.ipHash ?? null,
  });
}
