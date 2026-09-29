import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invitation } from "@/db/schema";
import type { OutboxExhaustedHandler, OutboxHandler } from "./outbox";
import { getEmailSender, type EmailMessage } from "./email";

async function sendEmailFromPayload(payload: unknown) {
  const message = (payload as { message?: EmailMessage }).message;
  if (!message?.to || !message.subject || !message.text) throw new Error("payload de email incompleto");
  return getEmailSender().send(message);
}

/** Ao esgotar as tentativas, o convite deixa de parecer "enfileirado". */
export function outboxExhaustedHandlers(): Record<string, OutboxExhaustedHandler> {
  return {
    "email.invitation": async (e) => {
      await db.update(invitation).set({ deliveryStatus: "failed" }).where(eq(invitation.id, e.aggregateId));
    },
  };
}

/** Um handler por tipo de evento. Idempotência vem da chave do evento; reenvio só ocorre em falha. */
export function outboxHandlers(): Record<string, OutboxHandler> {
  return {
    // O convite só é dado como enviado depois do envio real; bloqueio por lista vira status próprio.
    "email.invitation": async (e) => {
      const result = await sendEmailFromPayload(e.payload);
      await db
        .update(invitation)
        .set(result.blocked ? { deliveryStatus: "blocked" } : { deliveryStatus: "sent", sentAt: new Date() })
        .where(eq(invitation.id, e.aggregateId));
      return { blocked: result.blocked };
    },
    "email.password_reset": async (e) => ({ blocked: (await sendEmailFromPayload(e.payload)).blocked }),
    "email.change_confirmation": async (e) => ({ blocked: (await sendEmailFromPayload(e.payload)).blocked }),
    "email.verification": async (e) => ({ blocked: (await sendEmailFromPayload(e.payload)).blocked }),
    "email.booking_changed": async (e) => ({ blocked: (await sendEmailFromPayload(e.payload)).blocked }),
    "email.booking_on_behalf": async (e) => ({ blocked: (await sendEmailFromPayload(e.payload)).blocked }),
    "email.exclusivity": async (e) => ({ blocked: (await sendEmailFromPayload(e.payload)).blocked }),
    "email.waitlist": async (e) => ({ blocked: (await sendEmailFromPayload(e.payload)).blocked }),
    "email.space_booking": async (e) => ({ blocked: (await sendEmailFromPayload(e.payload)).blocked }),
    "identity.revoke_sessions": async (e) => {
      const { authContext } = await import("@/modules/identity/auth");
      const ctx = await authContext();
      const userId = (e.payload as { userId?: string }).userId;
      if (!userId) throw new Error("payload sem userId");
      await ctx.internalAdapter.deleteUserSessions(userId);
    },
  };
}
