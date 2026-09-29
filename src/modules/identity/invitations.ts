import { and, eq, isNull } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { employee, invitation } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { enqueueOutbox } from "@/modules/notifications/outbox";
import { inviteEmail } from "@/modules/notifications/templates";
import { formatLocal } from "@/modules/shared/dates";
import { env } from "@/modules/shared/env";
import { DomainError, ValidationError } from "@/modules/shared/errors";
import { newToken, sha256Hex } from "@/modules/shared/ids";
import { safeErrorInfo } from "@/modules/shared/db-errors";
import { logger } from "@/modules/shared/logger";
import { authContext } from "./auth";
import { checkPasswordPolicy, isPasswordBreached } from "./password";

/** PAR-07: convite vale sete dias. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ActorRef = { employeeId: string | null; userId: string | null; requestId?: string };

/** Revoga convites ativos da pessoa. Usado ao reenviar, ao trocar email de convidado e ao desativar. */
export async function revokeActiveInvitations(tx: DbOrTx, employeeId: string): Promise<number> {
  const rows = await tx
    .update(invitation)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitation.employeeId, employeeId), isNull(invitation.usedAt), isNull(invitation.revokedAt)))
    .returning({ id: invitation.id });
  return rows.length;
}

/**
 * Cria convite individual, expirável e de uso único e enfileira o email na mesma transação.
 * O token só existe em memória e no link; o banco guarda o hash.
 */
export async function createInvitation(tx: DbOrTx, actor: ActorRef, employeeId: string): Promise<{ token: string; expiresAt: Date; url: string }> {
  const [emp] = await tx
    .select({ id: employee.id, status: employee.status, email: employee.corporateEmail, name: employee.fullName, userId: employee.userId })
    .from(employee)
    .where(eq(employee.id, employeeId));
  if (!emp) throw new ValidationError("Pessoa não encontrada.");
  if (emp.status !== "invited" || emp.userId) throw new ValidationError("Só pessoas convidadas sem acesso definido recebem convite.");
  await revokeActiveInvitations(tx, employeeId);
  const token = newToken(32);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const [row] = await tx
    .insert(invitation)
    .values({ employeeId, tokenHash: sha256Hex(token), expiresAt, createdBy: actor.employeeId, sentAt: null, deliveryStatus: "queued" })
    .returning({ id: invitation.id });
  const url = `${env().APP_BASE_URL}/convite/${token}`;
  await enqueueOutbox(tx, {
    eventType: "email.invitation",
    aggregateType: "invitation",
    aggregateId: row.id,
    payload: { message: inviteEmail(emp.email, emp.name, url, formatLocal(expiresAt)) },
    idempotencyKey: `email.invitation:${row.id}`,
  });
  await recordAudit(tx, {
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    action: "invitation.created",
    entityType: "employee",
    entityId: employeeId,
    after: { invitationId: row.id, expiresAt: expiresAt.toISOString() },
    requestId: actor.requestId,
  });
  return { token, expiresAt, url };
}

export type InvitationLookup =
  | { ok: true; invitationId: string; employeeId: string; name: string; emailMasked: string; email: string }
  | { ok: false };

/** Valida o token sem revelar por que ele é inválido (expirado, usado, revogado ou inexistente). */
export async function lookupInvitation(db: DbOrTx, token: string): Promise<InvitationLookup> {
  if (!token || token.length < 20) return { ok: false };
  const [row] = await db
    .select({
      id: invitation.id,
      employeeId: invitation.employeeId,
      expiresAt: invitation.expiresAt,
      usedAt: invitation.usedAt,
      revokedAt: invitation.revokedAt,
      name: employee.fullName,
      email: employee.corporateEmail,
      status: employee.status,
      userId: employee.userId,
    })
    .from(invitation)
    .innerJoin(employee, eq(employee.id, invitation.employeeId))
    .where(eq(invitation.tokenHash, sha256Hex(token)));
  if (!row) return { ok: false };
  if (row.usedAt || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return { ok: false };
  if (row.status !== "invited" || row.userId) return { ok: false };
  const [local, domain] = row.email.split("@");
  const emailMasked = `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
  return { ok: true, invitationId: row.id, employeeId: row.employeeId, name: row.name, emailMasked, email: row.email };
}

/**
 * Aceite do convite: define a senha, cria a identidade e ativa a pessoa.
 * A pessoa entra em seguida pelo login normal, o que garante o segundo fator quando exigido.
 */
export async function acceptInvitation(db: Db, token: string, password: string, meta: { requestId?: string } = {}): Promise<{ employeeId: string }> {
  const found = await lookupInvitation(db, token);
  if (!found.ok) throw new DomainError("invitation.invalid", "Convite inválido. Peça um novo convite ao RH.");
  const policy = checkPasswordPolicy(password, { email: found.email, name: found.name });
  if (!policy.ok) throw new ValidationError(policy.reason);
  if (await isPasswordBreached(password)) {
    throw new ValidationError("Esta senha apareceu em vazamentos conhecidos. Escolha outra.");
  }
  const ctx = await authContext();
  const passwordHash = await ctx.password.hash(password);

  // A identidade nasce fora da transação do portal (adaptador do Better Auth). Se a transação falhar, a identidade é removida.
  const user = await ctx.internalAdapter.createUser({ email: found.email, name: found.name, emailVerified: true }, { method: "invitation" });
  try {
    await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: passwordHash });
    await db.transaction(async (tx) => {
      const [inv] = await tx.select({ id: invitation.id, usedAt: invitation.usedAt, revokedAt: invitation.revokedAt, expiresAt: invitation.expiresAt })
        .from(invitation).where(eq(invitation.id, found.invitationId)).for("update");
      if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt.getTime() <= Date.now()) {
        throw new DomainError("invitation.invalid", "Convite inválido. Peça um novo convite ao RH.");
      }
      const [emp] = await tx.select({ status: employee.status, userId: employee.userId }).from(employee).where(eq(employee.id, found.employeeId)).for("update");
      if (!emp || emp.status !== "invited" || emp.userId) throw new DomainError("invitation.invalid", "Convite inválido. Peça um novo convite ao RH.");
      await tx.update(invitation).set({ usedAt: new Date() }).where(eq(invitation.id, found.invitationId));
      await tx.update(employee).set({ userId: user.id, status: "active", updatedAt: new Date() }).where(eq(employee.id, found.employeeId));
      await recordAudit(tx, {
        actorUserId: user.id,
        actorEmployeeId: found.employeeId,
        action: "invitation.accepted",
        entityType: "employee",
        entityId: found.employeeId,
        after: { status: "active" },
        requestId: meta.requestId,
      });
    });
  } catch (e) {
    try {
      await ctx.internalAdapter.deleteUser(user.id);
    } catch (cleanupError) {
      logger.error({ userId: user.id, err: safeErrorInfo(cleanupError) }, "falha ao remover identidade órfã");
    }
    throw e;
  }
  return { employeeId: found.employeeId };
}
