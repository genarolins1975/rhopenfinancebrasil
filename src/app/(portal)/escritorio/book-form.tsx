"use client";

import { useActionState } from "react";
import { ActionMessages, SubmitButton } from "@/components/forms";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { bookDeskAction, cancelDeskAction } from "@/modules/booking/actions";
import type { ActionState } from "@/modules/shared/action-state";

/** Reservar: a chave de idempotência nasce no servidor a cada renderização; reenvio da mesma chave não duplica. */
export function BookForm({ resourceId, date, idempotencyKey, label = "Reservar", back }: { resourceId: string; date: string; idempotencyKey: string; label?: string; back?: string }) {
  const [state, formAction] = useActionState(bookDeskAction, {} as ActionState);
  if (state.ok) {
    return (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <ActionMessages state={state} />
      <input type="hidden" name="resourceId" value={resourceId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <SubmitButton pendingText="Reservando…">{label}</SubmitButton>
    </form>
  );
}

export function CancelForm({ bookingId, status = "confirmed", admin = false, label = "Cancelar reserva" }: { bookingId: string; status?: "held" | "confirmed"; admin?: boolean; label?: string }) {
  const [state, formAction] = useActionState(cancelDeskAction, {} as ActionState);
  if (state.ok) {
    return (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <ActionMessages state={state} />
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="status" value={status} />
      {admin ? (
        <>
          <Field id={`reason-${bookingId}`} label="Motivo (registrado na auditoria)">
            <Input id={`reason-${bookingId}`} name="reason" required minLength={3} />
          </Field>
          <Field id={`message-${bookingId}`} label="Mensagem à pessoa (opcional)">
            <Textarea id={`message-${bookingId}`} name="message" rows={2} />
          </Field>
        </>
      ) : null}
      <Button type="submit" variant="secondary">
        {label}
      </Button>
    </form>
  );
}
