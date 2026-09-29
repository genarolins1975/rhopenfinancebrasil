import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Alert, Button, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { db } from "@/db/client";
import { requireCurrent } from "@/modules/identity/session";
import { ISO_DATE } from "@/modules/office/shared";
import { formatLocalDate, localToday } from "@/modules/shared/dates";
import { searchSpaces } from "@/modules/spaces/service";
import { BookSpaceForm } from "../operation-forms";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ATTRS: Array<[string, string]> = [
  ["videoconferencia", "Videoconferência"],
  ["tela", "Tela ou TV"],
  ["quadro", "Quadro"],
  ["acessivel", "Acessível"],
];

function nextSlot(): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const start = Math.min(h + 1, 22);
  return { start: `${String(start).padStart(2, "0")}:00`, end: `${String(start + 1).padStart(2, "0")}:00` };
}

export default async function SalasPage({ searchParams }: { searchParams: Promise<{ data?: string; inicio?: string; fim?: string; capacidade?: string; atributo?: string | string[] }> }) {
  const current = await requireCurrent();
  const sp = await searchParams;
  const def = nextSlot();
  const date = sp.data && ISO_DATE.test(sp.data) ? sp.data : localToday();
  const start = sp.inicio && HHMM.test(sp.inicio) ? sp.inicio : def.start;
  const end = sp.fim && HHMM.test(sp.fim) ? sp.fim : def.end;
  const capacity = Number(sp.capacidade) > 0 ? Math.min(99, Math.floor(Number(sp.capacidade))) : null;
  const wanted = (Array.isArray(sp.atributo) ? sp.atributo : sp.atributo ? [sp.atributo] : []).filter((a) => ATTRS.some(([k]) => k === a));
  let result: Awaited<ReturnType<typeof searchSpaces>> | null = null;
  let error: string | null = null;
  try {
    result = await searchSpaces(db, current.employee.id, { date, start, end, capacity, attributes: wanted });
  } catch (e) {
    error = e instanceof Error ? e.message : "Busca indisponível.";
  }
  const key = randomUUID();
  return (
    <>
      <PageHeader title="Salas e cabines" lead="Reserva por intervalo. Horários em múltiplos de 15 minutos, início incluído e fim excluído: uma reserva pode começar no minuto em que a outra termina." actions={<Link href="/escritorio" className="underline">Mesas</Link>} />
      <form method="get" className="mb-4 grid gap-3 rounded-md border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Busca de salas e cabines">
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="data">
          Data
          <Input id="data" name="data" type="date" defaultValue={date} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="inicio">
          Início
          <Input id="inicio" name="inicio" type="time" step={900} defaultValue={start} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="fim">
          Fim
          <Input id="fim" name="fim" type="time" step={900} defaultValue={end} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="capacidade">
          Pessoas
          <Input id="capacidade" name="capacidade" type="number" min={1} max={99} defaultValue={capacity ?? ""} />
        </label>
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="font-medium">Recursos verificados</legend>
          {ATTRS.map(([k, label]) => (
            <label key={k} className="flex min-h-7 items-center gap-2">
              <input type="checkbox" name="atributo" value={k} defaultChecked={wanted.includes(k)} className="h-5 w-5" />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="sm:col-span-2 lg:col-span-5">
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </div>
      </form>
      {error ? (
        <div className="mb-4">
          <Alert kind="warning">{error}</Alert>
        </div>
      ) : null}
      {result?.dayProblem ? (
        <div className="mb-4">
          <Alert kind="info">
            {formatLocalDate(date)}: {result.dayProblem}.
          </Alert>
        </div>
      ) : null}
      {result && result.items.length === 0 ? (
        <EmptyState title="Nenhuma sala ou cabine com estes critérios">Atributos só contam quando verificados por Facilities.</EmptyState>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {result?.items.map((i) => (
          <Card key={i.resource.id} title={`${i.resource.code} · ${i.resource.type === "room" ? "sala" : "cabine"}`}>
            <p className="text-sm text-text-muted">
              {i.resource.zoneName ?? "Sem zona"} · capacidade {i.resource.capacity ?? "não informada"}
              {i.resource.maxMinutes ? ` · até ${i.resource.maxMinutes} min por reserva` : ""}
              {i.resource.verified ? "" : " · atributos não verificados"}
            </p>
            <h3 className="mt-3 text-sm font-semibold">Agenda de {formatLocalDate(date)}</h3>
            {i.agenda.length === 0 ? (
              <p className="text-sm text-text-muted">Livre o dia todo.</p>
            ) : (
              <ul className="mt-1 grid gap-1 text-sm">
                {i.agenda.map((a) => (
                  <li key={a.id}>
                    <span className="font-medium">{a.slot}</span>: {a.mine ? "sua reserva" : "Reservada"}
                    {a.title ? ` · ${a.title}` : ""}
                    {!a.mine && a.employeeName ? ` · ${a.employeeName}` : ""}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              {i.problem ? (
                <p className="text-sm">
                  <span aria-hidden="true">✕ </span>
                  Indisponível das {start} às {end}: {i.problem}.
                </p>
              ) : (
                <BookSpaceForm resourceId={i.resource.id} code={i.resource.code} date={date} start={start} end={end} idempotencyKey={`${key}:${i.resource.id}`} />
              )}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
