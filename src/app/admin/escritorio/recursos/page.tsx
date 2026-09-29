import Link from "next/link";
import { Alert, Card, EmptyState, Input, PageHeader, Table, td, th } from "@/components/ui";
import { db } from "@/db/client";
import { capacityOn, stateForPerson } from "@/modules/availability/service";
import { requireAnyPermission } from "@/modules/identity/session";
import { ISO_DATE, readSettings } from "@/modules/office/shared";
import { addDays, formatLocalDate, localToday } from "@/modules/shared/dates";
import { getResourceByCode, listCalendar, listResources, listStatusPeriods, listZones } from "@/modules/workplace/service";
import { AttributesForm, CalendarForm, NewResourceForm, ReleasePeriodForm, RetireForm, SettingsForm, StatusPeriodForm } from "./forms";

const CLASS_LABEL: Record<string, string> = { shared: "Compartilhada", exclusive: "Exclusiva", maintenance: "Em manutenção", blocked: "Bloqueada", retired: "Desativada" };

export default async function RecursosPage({ searchParams }: { searchParams: Promise<{ data?: string; mesa?: string; aba?: string }> }) {
  const current = await requireAnyPermission(["resource.manage", "resource.status.manage", "floorplan.edit", "settings.manage"]);
  const p = current.access.permissions;
  const sp = await searchParams;
  const today = localToday();
  const date = sp.data && ISO_DATE.test(sp.data) ? sp.data : today;
  const aba = ["recursos", "calendario", "configuracoes"].includes(sp.aba ?? "") ? sp.aba! : "recursos";
  const holderView = p.has("exclusive.holder.view");
  const { items } = await stateForPerson(db, current.employee.id, date, { holderView, types: ["desk", "room", "booth"] });
  const all = await listResources(db, { includeRetired: true });
  const zones = await listZones(db);
  const capacity = await capacityOn(db, date);
  const selected = sp.mesa ? await getResourceByCode(db, sp.mesa) : null;
  const periods = selected ? await listStatusPeriods(db, { resourceId: selected.id }) : [];
  const calendar = await listCalendar(db, today, addDays(today, 60));
  const settingsRaw = await readSettings(db);
  const settings = { booking_open_weekday: String(settingsRaw.bookingOpenWeekday), booking_open_time: settingsRaw.bookingOpenTime, booking_horizon_weeks: String(settingsRaw.bookingHorizonWeeks), exception_max_days: String(settingsRaw.exceptionMaxDays) };
  const tab = (key: string, label: string) => (
    <Link href={`?aba=${key}&data=${date}`} aria-current={aba === key ? "page" : undefined} className={`rounded-md px-3 py-1.5 text-sm ${aba === key ? "bg-primary text-white" : "underline"}`}>
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader title="Recursos e situação operacional" lead="Inventário, atributos verificados, manutenção e bloqueio, calendário do escritório e parâmetros. Política de acesso fica na tela de exclusividade." />
      <nav aria-label="Abas" className="mb-4 flex flex-wrap gap-2">
        {tab("recursos", "Recursos")}
        {tab("calendario", "Calendário")}
        {tab("configuracoes", "Configurações")}
      </nav>
      {aba === "recursos" ? (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ["Mesas", capacity.desks.total],
                ["Compartilhadas", capacity.desks.shared],
                ["Exclusivas", capacity.desks.exclusive],
                ["Manutenção", capacity.desks.maintenance],
                ["Bloqueadas", capacity.desks.blocked],
                ["Confirmadas no compartilhado", capacity.sharedConfirmed],
              ] as Array<[string, number]>
            ).map(([label, n]) => (
              <div key={label} className="rounded-md border border-border bg-surface p-3">
                <p className="text-xs text-text-muted">{label}</p>
                <p className="text-xl font-semibold">{n}</p>
              </div>
            ))}
          </div>
          <details className="mb-4 text-sm">
            <summary className="cursor-pointer underline">Como ler estes números</summary>
            <ul className="mt-2 list-disc pl-5">
              {capacity.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Data de referência">
            <input type="hidden" name="aba" value="recursos" />
            <label htmlFor="data" className="flex flex-col gap-1 text-sm font-medium">
              Data de referência
              <Input id="data" name="data" type="date" defaultValue={date} />
            </label>
            <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm underline">
              Aplicar
            </button>
          </form>
          <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
            <Card title={`Inventário (${all.length})`}>
              {all.length === 0 ? (
                <EmptyState title="Nenhum recurso cadastrado">
                  <Link href="/admin/escritorio/planta" className="underline">
                    Criar rascunho da planta a partir da extração
                  </Link>
                </EmptyState>
              ) : (
                <Table caption={`Recursos e situação em ${formatLocalDate(date)}`}>
                  <thead>
                    <tr>
                      <th className={th}>Código</th>
                      <th className={th}>Tipo</th>
                      <th className={th}>Zona</th>
                      <th className={th}>Situação na data</th>
                      <th className={th}>Atributos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {all.map((r) => {
                      const st = items.find((i) => i.resource.id === r.id);
                      return (
                        <tr key={r.id}>
                          <td className={td}>
                            <Link href={`?aba=recursos&data=${date}&mesa=${r.code}`} className="underline">
                              {r.code}
                            </Link>
                          </td>
                          <td className={td}>{r.type === "desk" ? "mesa" : r.type === "room" ? "sala" : "cabine"}</td>
                          <td className={td}>{r.zoneName ?? "—"}</td>
                          <td className={td}>{r.retiredOn && r.retiredOn <= date ? "Desativada" : st ? (CLASS_LABEL[st.deskClass] ?? st.deskClass) : "—"}</td>
                          <td className={td}>{r.attributesVerifiedAt ? "verificados" : "não verificados"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
              {p.has("resource.manage") ? (
                <details className="mt-4">
                  <summary className="cursor-pointer font-medium">Novo recurso</summary>
                  <div className="mt-3">
                    <NewResourceForm zones={zones} />
                  </div>
                </details>
              ) : null}
            </Card>
            <Card title={selected ? `Recurso ${selected.code}` : "Painel do recurso"}>
              {!selected ? (
                <p className="text-sm text-text-muted">Selecione um recurso na tabela.</p>
              ) : (
                <div className="grid gap-6">
                  <section>
                    <h3 className="font-semibold">Períodos de manutenção e bloqueio</h3>
                    {periods.length === 0 ? (
                      <p className="text-sm text-text-muted">Nenhum período registrado.</p>
                    ) : (
                      <ul className="mt-2 grid gap-2 text-sm">
                        {periods.map((pe) => (
                          <li key={pe.id} className="rounded-md border border-border p-2">
                            {pe.status === "maintenance" ? "Manutenção" : "Bloqueio"}: {formatLocalDate(pe.startsOn)} {pe.endsOn ? `até ${formatLocalDate(pe.endsOn)}` : "sem término"}
                            {pe.releasedOn ? ` (liberado a partir de ${formatLocalDate(pe.releasedOn)})` : ""}: {pe.reason}
                            {!pe.releasedOn && p.has("resource.status.manage") ? (
                              <div className="mt-2">
                                <ReleasePeriodForm periodId={pe.id} today={today} />
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    {p.has("resource.status.manage") && !selected.retiredOn ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer font-medium">Novo período (prévia com reservas afetadas)</summary>
                        <div className="mt-3">
                          <StatusPeriodForm resourceId={selected.id} today={today} />
                        </div>
                      </details>
                    ) : null}
                  </section>
                  {p.has("resource.manage") ? (
                    <section>
                      <h3 className="font-semibold">Atributos (verificado por, em)</h3>
                      <div className="mt-2">
                        <AttributesForm resourceId={selected.id} zones={zones} current={selected.attributes as Record<string, unknown>} zoneId={all.find((r) => r.id === selected.id)?.zoneId ?? null} />
                      </div>
                    </section>
                  ) : null}
                  {p.has("resource.manage") && !selected.retiredOn ? (
                    <section>
                      <h3 className="font-semibold">Desativar</h3>
                      <p className="mb-2 text-sm text-text-muted">Exige encerrar antes as atribuições exclusivas; reservas futuras entram no diálogo de conflito.</p>
                      <RetireForm resourceId={selected.id} today={today} />
                    </section>
                  ) : null}
                </div>
              )}
            </Card>
          </div>
        </>
      ) : null}
      {aba === "calendario" ? (
        <Card title="Calendário do escritório">
          <p className="mb-3 text-sm text-text-muted">Fechar um dia trava a data e trata as reservas ativas (só cancelamento com comunicação). Dias sem registro estão abertos.</p>
          {calendar.filter((c) => !c.isOpen).length === 0 ? (
            <p className="mb-4 text-sm">Nenhum fechamento nos próximos 60 dias.</p>
          ) : (
            <ul className="mb-4 list-disc pl-5 text-sm">
              {calendar
                .filter((c) => !c.isOpen)
                .map((c) => (
                  <li key={c.date}>
                    {formatLocalDate(c.date)}: fechado{c.reason ? ` (${c.reason})` : ""}
                  </li>
                ))}
            </ul>
          )}
          {p.has("resource.status.manage") ? <CalendarForm today={today} /> : <Alert kind="info">Seu perfil só consulta o calendário.</Alert>}
        </Card>
      ) : null}
      {aba === "configuracoes" ? (
        <Card title="Parâmetros do escritório">
          <p className="mb-3 text-sm text-text-muted">Janela de abertura (PAR-01), horizonte e duração máxima de liberação (PAR-35). Toda alteração é auditada.</p>
          {p.has("settings.manage") ? <SettingsForm settings={settings} /> : <Alert kind="info">Alterar parâmetros exige `settings.manage`.</Alert>}
        </Card>
      ) : null}
    </>
  );
}
