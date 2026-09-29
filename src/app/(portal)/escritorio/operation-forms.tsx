"use client";

import { SimpleForm } from "@/components/office-forms";
import { Field, Input, Select } from "@/components/ui";
import { confirmUseAction } from "@/modules/checkin/actions";
import { bookSpaceAction, cancelSpaceAction } from "@/modules/spaces/actions";
import { shareWithManagerAction } from "@/modules/team/actions";
import { acceptOfferAction, declineOfferAction, joinWaitlistAction, leaveWaitlistAction } from "@/modules/waitlist/actions";

/* Formulários do portal da Etapa 3. Nenhum decide regra: cada um envia a intenção e mostra a resposta do servidor. */

export function JoinQueueForm({ date, zones }: { date: string; zones: Array<{ code: string; name: string }> }) {
  return (
    <SimpleForm action={joinWaitlistAction} submitLabel="Entrar na fila de espera" pendingText="Entrando…">
      <input type="hidden" name="date" value={date} />
      {zones.length ? (
        <Field id={`zone-${date}`} label="Zona preferida (opcional, não garante a zona)">
          <Select id={`zone-${date}`} name="zoneCode" defaultValue="">
            <option value="">Qualquer zona</option>
            {zones.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </SimpleForm>
  );
}

export function LeaveQueueForm({ entryId, label = "Sair da fila" }: { entryId: string; label?: string }) {
  return (
    <SimpleForm action={leaveWaitlistAction} submitLabel={label} variant="secondary" pendingText="Saindo…">
      <input type="hidden" name="entryId" value={entryId} />
    </SimpleForm>
  );
}

export function AcceptOfferForm({ offerId }: { offerId: string }) {
  return (
    <SimpleForm action={acceptOfferAction} submitLabel="Aceitar a mesa" pendingText="Confirmando…">
      <input type="hidden" name="offerId" value={offerId} />
    </SimpleForm>
  );
}

export function DeclineOfferForm({ offerId }: { offerId: string }) {
  return (
    <SimpleForm action={declineOfferAction} submitLabel="Recusar" variant="secondary" pendingText="Recusando…">
      <input type="hidden" name="offerId" value={offerId} />
    </SimpleForm>
  );
}

/** Confirmação de uso: o servidor resolve a reserva da sessão; o id só identifica qual das suas reservas de hoje. */
export function ConfirmUseForm({ bookingId, spaceBookingId, resourceCode, method = "portal" }: { bookingId?: string; spaceBookingId?: string; resourceCode?: string; method?: "portal" | "qr" }) {
  return (
    <SimpleForm action={confirmUseAction} submitLabel="Confirmar uso" variant="secondary" pendingText="Confirmando…">
      <input type="hidden" name="method" value={method} />
      {bookingId ? <input type="hidden" name="bookingId" value={bookingId} /> : null}
      {spaceBookingId ? <input type="hidden" name="spaceBookingId" value={spaceBookingId} /> : null}
      {resourceCode ? <input type="hidden" name="resourceCode" value={resourceCode} /> : null}
    </SimpleForm>
  );
}

export function BookSpaceForm({ resourceId, code, date, start, end, idempotencyKey }: { resourceId: string; code: string; date: string; start: string; end: string; idempotencyKey: string }) {
  return (
    <SimpleForm action={bookSpaceAction} submitLabel={`Reservar ${code}`} pendingText="Reservando…">
      <input type="hidden" name="resourceId" value={resourceId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="end" value={end} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Field id={`title-${resourceId}`} label="Título (opcional)">
        <Input id={`title-${resourceId}`} name="title" maxLength={120} />
      </Field>
      <Field id={`vis-${resourceId}`} label="Quem vê o título">
        <Select id={`vis-${resourceId}`} name="titleVisibility" defaultValue="private">
          <option value="private">Só eu (os demais veem “Reservada”)</option>
          <option value="manager">Eu e meu gestor direto</option>
          <option value="all">Todos</option>
        </Select>
      </Field>
    </SimpleForm>
  );
}

export function CancelSpaceForm({ bookingId }: { bookingId: string }) {
  return (
    <SimpleForm action={cancelSpaceAction} submitLabel="Cancelar" variant="secondary" pendingText="Cancelando…">
      <input type="hidden" name="bookingId" value={bookingId} />
    </SimpleForm>
  );
}

export function ShareWithManagerForm({ current }: { current: boolean }) {
  return (
    <SimpleForm action={shareWithManagerAction} submitLabel="Gravar preferência" variant="secondary">
      <label className="flex min-h-7 items-start gap-2 text-sm">
        <input type="checkbox" name="share" defaultChecked={current} className="mt-0.5 h-5 w-5" />
        <span>Meu gestor direto pode ver minha intenção de presença e minhas reservas de mesa e sala em Meu time.</span>
      </label>
    </SimpleForm>
  );
}
