"use client";

import { Field, Input, Select } from "@/components/ui";
import { PreviewForm, SimpleForm } from "@/components/office-forms";
import { calendarAction, createResourceAction, releasePeriodAction, retireResourceAction, settingAction, statusPeriodAction, updateResourceAction } from "@/modules/exclusivity/actions";

type Zone = { id: string; code: string; name: string };

export function NewResourceForm({ zones }: { zones: Zone[] }) {
  return (
    <SimpleForm action={createResourceAction} submitLabel="Criar recurso">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="code" label="Código (estável e único)">
          <Input id="code" name="code" required placeholder="M085" />
        </Field>
        <Field id="type" label="Tipo">
          <Select id="type" name="type" defaultValue="desk">
            <option value="desk">Mesa</option>
            <option value="room">Sala</option>
            <option value="booth">Cabine ou booth</option>
          </Select>
        </Field>
        <Field id="zoneId" label="Zona">
          <Select id="zoneId" name="zoneId" defaultValue="">
            <option value="">Sem zona</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="capacity" label="Capacidade (salas e cabines)">
          <Input id="capacity" name="capacity" type="number" min={1} />
        </Field>
      </div>
    </SimpleForm>
  );
}

export function AttributesForm({ resourceId, zones, current, zoneId }: { resourceId: string; zones: Zone[]; current: Record<string, unknown>; zoneId: string | null }) {
  const flag = (k: string) => current[k] === true;
  return (
    <SimpleForm action={updateResourceAction} submitLabel="Gravar atributos" variant="secondary">
      <input type="hidden" name="resourceId" value={resourceId} />
      <Field id={`zone-${resourceId}`} label="Zona">
        <Select id={`zone-${resourceId}`} name="zoneId" defaultValue={zoneId ?? ""}>
          <option value="">Sem zona</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="grid gap-1 text-sm">
        <legend className="text-sm font-medium">Atributos</legend>
        {[
          ["monitor", "Monitor"],
          ["docking", "Docking"],
          ["altura_regulavel", "Altura regulável"],
          ["acessivel", "Posição acessível"],
        ].map(([k, label]) => (
          <label key={k} className="flex min-h-7 items-center gap-2">
            <input type="checkbox" name={k} defaultChecked={flag(k)} className="h-5 w-5" />
            {label}
          </label>
        ))}
      </fieldset>
      <Field id={`obs-${resourceId}`} label="Observação">
        <Input id={`obs-${resourceId}`} name="observacao" defaultValue={typeof current.observacao === "string" ? current.observacao : ""} />
      </Field>
      <label className="flex min-h-7 items-center gap-2 text-sm">
        <input type="checkbox" name="verified" className="h-5 w-5" />
        Verificado presencialmente por mim, hoje
      </label>
    </SimpleForm>
  );
}

export function StatusPeriodForm({ resourceId, today }: { resourceId: string; today: string }) {
  return (
    <PreviewForm
      action={statusPeriodAction}
      hidden={{ resourceId }}
      confirmLabel="Confirmar período"
      fields={(input, previewing) => (
        <>
          <Field id={`status-${resourceId}`} label="Tipo">
            <Select id={`status-${resourceId}`} name="status" defaultValue={input.status ?? "maintenance"} disabled={previewing}>
              <option value="maintenance">Manutenção (impede inclusive o titular)</option>
              <option value="admin_block">Bloqueio administrativo</option>
            </Select>
            {previewing ? <input type="hidden" name="status" value={input.status ?? "maintenance"} /> : null}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`starts-${resourceId}`} label="Início">
              <Input id={`starts-${resourceId}`} name="startsOn" type="date" defaultValue={input.startsOn ?? today} required readOnly={previewing} />
            </Field>
            <Field id={`ends-${resourceId}`} label="Término (vazio = sem término)">
              <Input id={`ends-${resourceId}`} name="endsOn" type="date" defaultValue={input.endsOn ?? ""} readOnly={previewing} />
            </Field>
          </div>
          <Field id={`reason-${resourceId}`} label="Motivo (interno)">
            <Input id={`reason-${resourceId}`} name="reason" required defaultValue={input.reason ?? ""} readOnly={previewing} />
          </Field>
          <Field id={`public-${resourceId}`} label="Motivo público (aparece no mapa, opcional)">
            <Input id={`public-${resourceId}`} name="publicReason" defaultValue={input.publicReason ?? ""} readOnly={previewing} />
          </Field>
        </>
      )}
    />
  );
}

export function ReleasePeriodForm({ periodId, today }: { periodId: string; today: string }) {
  return (
    <SimpleForm action={releasePeriodAction} submitLabel="Liberar" variant="secondary">
      <input type="hidden" name="periodId" value={periodId} />
      <Field id={`rel-${periodId}`} label="Volta a partir de">
        <Input id={`rel-${periodId}`} name="releasedOn" type="date" defaultValue={today} required />
      </Field>
      <Field id={`relr-${periodId}`} label="Motivo">
        <Input id={`relr-${periodId}`} name="reason" required />
      </Field>
    </SimpleForm>
  );
}

export function RetireForm({ resourceId, today }: { resourceId: string; today: string }) {
  return (
    <PreviewForm
      action={retireResourceAction}
      hidden={{ resourceId }}
      previewLabel="Desativar: ver impacto"
      confirmLabel="Confirmar desativação"
      fields={(input, previewing) => (
        <>
          <Field id={`ret-${resourceId}`} label="Desativado a partir de">
            <Input id={`ret-${resourceId}`} name="retiredOn" type="date" defaultValue={input.retiredOn ?? today} required readOnly={previewing} />
          </Field>
          <Field id={`retr-${resourceId}`} label="Motivo">
            <Input id={`retr-${resourceId}`} name="reason" required defaultValue={input.reason ?? ""} readOnly={previewing} />
          </Field>
        </>
      )}
    />
  );
}

export function CalendarForm({ today }: { today: string }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section aria-labelledby="fechar-dia">
        <h3 id="fechar-dia" className="font-semibold">
          Fechar um dia
        </h3>
        <PreviewForm
          action={calendarAction}
          allowRealloc={false}
          previewLabel="Ver reservas do dia"
          confirmLabel="Confirmar fechamento"
          fields={(input, previewing) => (
            <>
              <Field id="close-date" label="Data">
                <Input id="close-date" name="date" type="date" defaultValue={input.date ?? today} required readOnly={previewing} />
              </Field>
              <Field id="close-reason" label="Motivo">
                <Input id="close-reason" name="reason" required defaultValue={input.reason ?? ""} readOnly={previewing} />
              </Field>
            </>
          )}
        />
      </section>
      <section aria-labelledby="abrir-dia">
        <h3 id="abrir-dia" className="font-semibold">
          Reabrir um dia
        </h3>
        <SimpleForm action={calendarAction} submitLabel="Reabrir" variant="secondary">
          <input type="hidden" name="open" value="yes" />
          <Field id="open-date" label="Data">
            <Input id="open-date" name="date" type="date" defaultValue={today} required />
          </Field>
          <Field id="open-reason" label="Motivo">
            <Input id="open-reason" name="reason" />
          </Field>
        </SimpleForm>
      </section>
    </div>
  );
}

export function SettingsForm({ settings }: { settings: Record<string, string> }) {
  const items: Array<[string, string, string]> = [
    ["booking_open_weekday", "Dia da semana de abertura (1 = segunda, 7 = domingo)", "number"],
    ["booking_open_time", "Hora de abertura (HH:MM, horário de Brasília)", "text"],
    ["booking_horizon_weeks", "Horizonte máximo em semanas", "number"],
    ["exception_max_days", "Duração máxima de liberação temporária, em dias (PAR-35)", "number"],
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map(([key, label, type]) => (
        <SimpleForm key={key} action={settingAction} submitLabel="Gravar" variant="secondary">
          <input type="hidden" name="key" value={key} />
          <Field id={`set-${key}`} label={label}>
            <Input id={`set-${key}`} name="value" type={type} defaultValue={settings[key] ?? ""} required />
          </Field>
        </SimpleForm>
      ))}
    </div>
  );
}

