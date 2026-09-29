"use client";

import { useActionState } from "react";
import { ActionMessages, SubmitButton } from "@/components/forms";
import { Select } from "@/components/ui";
import { planWeekAction } from "@/modules/booking/actions";
import type { ActionState } from "@/modules/shared/action-state";

export type WeekDayOption = {
  date: string;
  weekday: string;
  short: string;
  intent: "onsite" | "remote" | "not_informed";
  bookedCode: string | null;
  offeredCode: string | null;
  open: boolean;
  note: string | null;
  desks: Array<{ id: string; code: string; habitual: boolean }>;
};

export function WeekForm({ days, idempotencyKey, habitualCode }: { days: WeekDayOption[]; idempotencyKey: string; habitualCode: string | null }) {
  const [state, formAction] = useActionState(planWeekAction, {} as ActionState);
  const conflicts = (state.data?.conflicts as Array<{ date: string; resourceCode: string | null; reason: string }> | undefined) ?? [];
  const key = (state.data?.idempotencyKey as string | undefined) ?? idempotencyKey;
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <ActionMessages state={state} />
      <input type="hidden" name="idempotencyKey" value={key} />
      {conflicts.length ? (
        <ul className="rounded-md border border-warning bg-warning-soft p-3 text-sm" aria-label="Dias com impedimento">
          {conflicts.map((c) => (
            <li key={c.date}>
              {c.date.split("-").reverse().join("/")}
              {c.resourceCode ? `, mesa ${c.resourceCode}` : ""}: {c.reason}
            </li>
          ))}
        </ul>
      ) : null}
      <ol className="grid gap-3 md:grid-cols-5">
        {days.map((d) => (
          <li key={d.date} className="rounded-md border border-border bg-surface-muted p-3">
            <input type="hidden" name="dates" value={d.date} />
            <p className="text-sm font-medium capitalize">{d.weekday}</p>
            <p className="text-xs text-text-muted">{d.short}</p>
            <fieldset className="mt-2">
              <legend className="text-xs font-medium">Intenção</legend>
              {(["onsite", "remote", "not_informed"] as const).map((v) => (
                <label key={v} className="flex min-h-7 items-center gap-2 py-0.5 text-sm">
                  <input type="radio" name={`intent:${d.date}`} value={v} defaultChecked={d.intent === v} className="h-5 w-5" />
                  {v === "onsite" ? "Presencial" : v === "remote" ? "Remoto" : "Não informado"}
                </label>
              ))}
            </fieldset>
            <label className="mt-2 flex flex-col gap-1 text-xs font-medium" htmlFor={`desk:${d.date}`}>
              Mesa (opcional)
              {d.bookedCode ? (
                <span className="text-sm font-normal">Reservada: {d.bookedCode}</span>
              ) : d.offeredCode ? (
                <span className="text-sm font-normal">
                  Mesa {d.offeredCode} oferecida a você pela fila.{" "}
                  <a href="/escritorio/minhas-reservas" className="underline">
                    Aceitar ou recusar
                  </a>
                </span>
              ) : d.open ? (
                <Select id={`desk:${d.date}`} name={`desk:${d.date}`} defaultValue="">
                  <option value="">Sem mesa</option>
                  {d.desks.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.code}
                      {k.habitual ? " (sua mesa habitual)" : ""}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="text-sm font-normal text-text-muted">{d.note}</span>
              )}
            </label>
          </li>
        ))}
      </ol>
      {habitualCode ? <p className="text-xs text-text-muted">Sua mesa habitual {habitualCode} aparece primeiro nos dias em que está disponível.</p> : null}
      <div>
        <SubmitButton pendingText="Confirmando…">Confirmar a semana</SubmitButton>
      </div>
    </form>
  );
}
