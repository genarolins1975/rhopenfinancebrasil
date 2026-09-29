"use client";

import { SimpleForm } from "@/components/office-forms";
import { Field, Input, Select } from "@/components/ui";
import { cancelSpaceAction } from "@/modules/spaces/actions";
import { leaveWaitlistAction, offerManuallyAction } from "@/modules/waitlist/actions";

export function ManualOfferForm({ entryId, desks }: { entryId: string; desks: Array<{ id: string; code: string }> }) {
  if (desks.length === 0) return <p className="text-xs text-text-muted">Nenhuma mesa disponível para a pessoa nesta data.</p>;
  return (
    <SimpleForm action={offerManuallyAction} submitLabel="Oferecer" variant="secondary" pendingText="Oferecendo…">
      <input type="hidden" name="entryId" value={entryId} />
      <Field id={`offer-${entryId}`} label="Mesa disponível para a pessoa">
        <Select id={`offer-${entryId}`} name="resourceId" defaultValue={desks[0].id}>
          {desks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code}
            </option>
          ))}
        </Select>
      </Field>
    </SimpleForm>
  );
}

export function RemoveFromQueueForm({ entryId }: { entryId: string }) {
  return (
    <SimpleForm action={leaveWaitlistAction} submitLabel="Retirar da fila" variant="secondary" pendingText="Retirando…">
      <input type="hidden" name="entryId" value={entryId} />
      <Field id={`rm-${entryId}`} label="Motivo (registrado na auditoria)">
        <Input id={`rm-${entryId}`} name="reason" required minLength={3} />
      </Field>
    </SimpleForm>
  );
}

export function AdminCancelSpaceForm({ bookingId }: { bookingId: string }) {
  return (
    <SimpleForm action={cancelSpaceAction} submitLabel="Cancelar com motivo" variant="secondary" pendingText="Cancelando…">
      <input type="hidden" name="bookingId" value={bookingId} />
      <Field id={`sr-${bookingId}`} label="Motivo (registrado na auditoria)">
        <Input id={`sr-${bookingId}`} name="reason" required minLength={3} />
      </Field>
      <Field id={`sm-${bookingId}`} label="Mensagem à pessoa (opcional)">
        <Input id={`sm-${bookingId}`} name="message" />
      </Field>
    </SimpleForm>
  );
}
