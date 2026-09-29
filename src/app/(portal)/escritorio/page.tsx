import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Alert, Button, Card, EmptyState, Input, PageHeader, Select, Table, td, th } from "@/components/ui";
import { Legend, OfficeMap, STATE_STYLE } from "@/components/office-map";
import { db } from "@/db/client";
import { stateForPerson } from "@/modules/availability/service";
import { requireCurrent } from "@/modules/identity/session";
import { ISO_DATE } from "@/modules/office/shared";
import { formatLocal, formatLocalDate, localToday } from "@/modules/shared/dates";
import { publishedMap } from "@/modules/workplace/service";
import { BookForm } from "./book-form";

export default async function EscritorioPage({ searchParams }: { searchParams: Promise<{ data?: string; zona?: string; estado?: string; aviso?: string }> }) {
  const current = await requireCurrent();
  const sp = await searchParams;
  const date = sp.data && ISO_DATE.test(sp.data) ? sp.data : localToday();
  const holderView = current.access.permissions.has("exclusive.holder.view");
  let loaded: Awaited<ReturnType<typeof stateForPerson>> | null = null;
  let failed = false;
  try {
    loaded = await stateForPerson(db, current.employee.id, date, { holderView });
  } catch {
    failed = true;
  }
  const map = await publishedMap(db).catch(() => null);
  const items = loaded?.items ?? [];
  const zones = [...new Set(items.map((i) => i.resource.zoneName).filter((z): z is string => !!z))];
  const filtered = items.filter((i) => (!sp.zona || i.resource.zoneName === sp.zona) && (!sp.estado || i.availability.code === sp.estado));
  const states = new Map(items.map((i) => [i.resource.id, i]));
  const key = randomUUID();
  const ctx = loaded?.ctx;
  return (
    <>
      <PageHeader title="Escritório" lead="Mapa e lista com o estado de cada mesa para você na data escolhida. Tudo é calculado no servidor." />
      {sp.aviso === "reservado" ? (
        <div className="mb-4">
          <Alert kind="success">Reserva confirmada.</Alert>
        </div>
      ) : null}
      {failed ? (
        <div className="mb-4">
          <Alert kind="warning" title="Serviço de disponibilidade indisponível">
            Não foi possível calcular os estados agora. Nenhuma mesa é mostrada como disponível por padrão. Tente de novo em instantes.
          </Alert>
        </div>
      ) : null}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filtros">
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="data">
          Data
          <Input id="data" name="data" type="date" defaultValue={date} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="zona">
          Zona
          <Select id="zona" name="zona" defaultValue={sp.zona ?? ""}>
            <option value="">Todas</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="estado">
          Estado
          <Select id="estado" name="estado" defaultValue={sp.estado ?? ""}>
            <option value="">Todos</option>
            {Object.entries(STATE_STYLE)
              .filter(([k]) => ["available", "reserved", "mine", "exclusive", "blocked", "maintenance"].includes(k))
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v.text}
                </option>
              ))}
          </Select>
        </label>
        <Button type="submit" variant="secondary">
          Aplicar
        </Button>
      </form>
      {ctx && !ctx.officeOpen ? (
        <div className="mb-4">
          <Alert kind="info">Escritório fechado em {formatLocalDate(date)}{ctx.closedReason ? `: ${ctx.closedReason}` : ""}.</Alert>
        </div>
      ) : null}
      {ctx && ctx.officeOpen && !ctx.window.open ? (
        <div className="mb-4">
          <Alert kind="info">Reservas para {formatLocalDate(date)} {ctx.window.opensAt ? `abrem em ${formatLocal(ctx.window.opensAt)}` : "ainda não estão abertas"}.</Alert>
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card title="Mapa">
          {map && !failed ? (
            <>
              <Legend />
              <div className="mt-3">
                <OfficeMap map={map} states={states} date={date} hrefFor={(code) => `/escritorio/recursos/${code}?data=${date}`} />
              </div>
            </>
          ) : (
            <EmptyState title="Mapa em preparação">A lista ao lado usa o inventário publicado.</EmptyState>
          )}
        </Card>
        <Card title={`Lista (${filtered.length})`}>
          {filtered.length === 0 ? (
            <EmptyState title={items.length === 0 ? "Nenhuma mesa cadastrada" : "Nenhuma mesa com este filtro"} />
          ) : (
            <Table caption={`Mesas em ${formatLocalDate(date)}`}>
              <thead>
                <tr>
                  <th className={th}>Mesa</th>
                  <th className={th}>Zona</th>
                  <th className={th}>Estado</th>
                  <th className={th}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const a = i.availability;
                  const style = STATE_STYLE[a.code] ?? STATE_STYLE.inactive;
                  return (
                    <tr key={i.resource.id}>
                      <td className={td}>
                        <Link href={`/escritorio/recursos/${i.resource.code}?data=${date}`} className="underline">
                          {i.resource.code}
                        </Link>
                      </td>
                      <td className={td}>{i.resource.zoneName ?? "—"}</td>
                      <td className={td}>
                        <span aria-hidden="true">{style.icon} </span>
                        {a.label}
                        {a.publicReason ? <span className="block text-xs text-text-muted">{a.publicReason}</span> : null}
                        {i.holder ? <span className="block text-xs text-text-muted">Titular: {i.holder.name}</span> : null}
                      </td>
                      <td className={td}>
                        {a.canBook ? <BookForm resourceId={i.resource.id} date={date} idempotencyKey={`${key}:${i.resource.id}`} /> : a.code === "mine" ? <span className="text-xs text-text-muted">Cancelar em Minhas reservas</span> : <span className="text-xs text-text-muted">{a.reason}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
