import type { OutboxHandler } from "./outbox";
import { getEmailSender, type EmailMessage } from "./email";

async function sendEmailFromPayload(payload: unknown) {
  const message = (payload as { message?: EmailMessage }).message;
  if (!message?.to || !message.subject || !message.text) throw new Error("payload de email incompleto");
  await getEmailSender().send(message);
}

/** Um handler por tipo de evento. Idempotência vem da chave do evento; reenvio só ocorre em falha. */
export function outboxHandlers(): Record<string, OutboxHandler> {
  return {
    "email.invitation": async (e) => sendEmailFromPayload(e.payload),
    "email.password_reset": async (e) => sendEmailFromPayload(e.payload),
    "email.change_confirmation": async (e) => sendEmailFromPayload(e.payload),
    "email.verification": async (e) => sendEmailFromPayload(e.payload),
    "identity.revoke_sessions": async (e) => {
      const { authContext } = await import("@/modules/identity/auth");
      const ctx = await authContext();
      const userId = (e.payload as { userId?: string }).userId;
      if (!userId) throw new Error("payload sem userId");
      await ctx.internalAdapter.deleteUserSessions(userId);
    },
  };
}
