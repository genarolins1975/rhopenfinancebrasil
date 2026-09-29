"use client";

import { Field, Input, Select } from "@/components/ui";
import { SimpleForm } from "@/components/office-forms";
import { bookOnBehalfAction } from "@/modules/booking/actions";

export function OnBehalfForm({ people, desks, date, idempotencyKey }: { people: Array<{ id: string; name: string }>; desks: Array<{ id: string; code: string }>; date: string; idempotencyKey: string }) {
  return (
    <SimpleForm action={bookOnBehalfAction} submitLabel="Reservar em nome" pendingText="Reservando…">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Field id="ob-employee" label="Pessoa beneficiária">
        <Select id="ob-employee" name="employeeId" defaultValue="" required>
          <option value="">Escolha</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="ob-desk" label="Mesa">
        <Select id="ob-desk" name="resourceId" defaultValue="" required>
          <option value="">Escolha</option>
          {desks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="ob-date" label="Data">
        <Input id="ob-date" name="date" type="date" defaultValue={date} required />
      </Field>
      <label className="flex min-h-7 items-center gap-2 text-sm">
        <input type="checkbox" name="confirm" value="sim" required className="h-5 w-5" />
        Confirmo que a pessoa está ciente. Ela será notificada e a reserva registra quem a fez.
      </label>
    </SimpleForm>
  );
}
