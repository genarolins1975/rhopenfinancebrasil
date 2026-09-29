import { randomUUID } from "node:crypto";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { Card, EmptyState, Input, PageHeader, Table, td, th } from "@/components/ui";
import { db } from "@/db/client";
import { employee } from "@/db/schema";
import { listBookingsAdmin } from "@/modules/booking/service";
import { usageOfDeskBookings } from "@/modules/checkin/service";
import { requireAnyPermission } from "@/modules/identity/session";
import { isValidIsoDate } from "@/modules/office/shared";
import { formatLocal, formatLocalDate, localToday } from "@/modules/shared/dates";
import { listSpaceBookingsAdmin } from "@/modules/spaces/service";
import { listQueue, manualOfferOptions, unmetDemand } from "@/modules/waitlist/service";
import { listResources } from "@/modules/workplace/service";
import { CancelForm } from "@/app/(portal)/escritorio/book-form";
import { OnBehalfForm } from "./on-behalf-form";
import { AdminCancelSpaceForm, ManualOfferForm, RemoveFromQueueForm } from "./queue-forms";

const ORIGIN: Record<string, string> = { self: "própria", week_plan: "semana", on_behalf: "em nome", waitlist_offer: "fila", admin_realloc: "realocação" };
const OFFER: Record<string, string> = { open: "vencida", expired: "vencida", withdrawn: "retirada pela administração", declined: "recusada", accepted: "aceita" };
const ENTRY: Record<string, string> = { waiting: "em espera", offered: "com oferta", accepted: "aceitou", expired: "oferta vencida", cancelled: "saiu ou foi retirada" };

export default async function ReservasAdminPage({ searchParams }: { searchParams: Promise<{ data?: string; aba?: string }> }) {
  const current = await requireAnyPermission(["booking.admin.manage", "booking.on_behalf.create", "waitlist.admin"]);
  const p = current.access.permissions;
  const sp = await searchParams;
  const date = isValidIsoDate(sp.data) ? sp.data : localToday();
  const tabs: Array<[string, string]> = [];
  if (p.has("booking.admin.manage") || p.has("booking.on_behalf.create")) tabs.push(["mesas", "Mesas"]);
  if (p.has("waitlist.admin")) tabs.push(["fila", "Fila de espera"]);
  if (p.has("booking.admin.manage")) tabs.push(["salas", "Salas e cabines"]);
  const aba = tabs.some(([k]) => k === sp.aba) ? sp.aba! : tabs[0][0];
  const tab = (key: string, label: string) => (
    <Link key={key} href={`?aba=${key}&data=${date}`} aria-current={aba === key ? "page" : undefined} className={`rounded-md px-3 py-1.5 text-sm ${aba === key ? "bg-primary text-white" : "underline"}`}>
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader title="Reservas" lead="Mesas, fila de espera e salas por data. Reserva em nome de outra pessoa, oferta manual e cancelamento administrativo com motivo e comunicação." />
      <nav aria-label="Abas" className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([k, l]) => tab(k, l))}
      </nav>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Data">
        <input type="hidden" name="aba" value={aba} />
        <label htmlFor="data" className="flex flex-col gap-1 text-sm font-medium">
          Data
          <Input id="data" name="data" type="date" defaultValue={date} />
        </label>
        <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm underline">
          Aplicar
        </button>
      </form>
      {aba === "mesas" ? await DesksTab({ date, canManage: p.has("booking.admin.manage"), canOnBehalf: p.has("booking.on_behalf.create"), viewerId: current.employee.id }) : null}
      {aba === "fila" ? await QueueTab({ date, holderView: p.has("exclusive.holder.view") || p.has("booking.admin.manage") }) : null}
      {aba === "salas" ? await SpacesTab({ date, viewerId: current.employee.id }) : null}
    </>
  );
}

async function DesksTab({ date, canManage, canOnBehalf, viewerId }: { date: string; canManage: boolean; canOnBehalf: boolean; viewerId: string }) {
  const bookings = await listBookingsAdmin(db, { date });
  const use = await usageOfDeskBookings(db, bookings.map((b) => b.id));
  const people = canOnBehalf ? await db.select({ id: employee.id, name: employee.fullName }).from(employee).where(eq(employee.status, "active")).orderBy(asc(employee.fullName)) : [];
  const desks = canOnBehalf ? await listResources(db, { type: "desk" }) : [];
  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <Card title={`Reservas de mesa em ${formatLocalDate(date)} (${bookings.length})`}>
        {bookings.length === 0 ? (
          <EmptyState title="Nenhuma reserva ativa na data" />
        ) : (
          <Table caption="Reservas de mesa ativas">
            <thead>
              <tr>
                <th className={th}>Mesa</th>
                <th className={th}>Pessoa</th>
                <th className={th}>Origem</th>
                <th className={th}>Situação</th>
                {canManage ? <th className={th}>Ação</th> : null}
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td className={td}>{b.code}</td>
                  <td className={td}>{b.employeeName}</td>
                  <td className={td}>{ORIGIN[b.origin] ?? b.origin}</td>
                  <td className={td}>
                    {b.status === "held" ? `retida para oferta da fila${b.holdExpiresAt ? ` até ${formatLocal(b.holdExpiresAt, "dd/MM HH:mm")}` : ""}` : "confirmada"}
                    {use.get(b.id) ? <span className="block text-xs text-text-muted">uso declarado {use.get(b.id)!.method === "qr" ? "pelo QR" : "pelo portal"}</span> : null}
                  </td>
                  {canManage ? (
                    <td className={td}>
                      {b.status === "held" && b.employeeId === viewerId ? (
                        // A própria oferta de quem opera não é "retirada": aceitar ou recusar é em Minhas reservas.
                        <Link href="/escritorio/minhas-reservas" className="text-sm underline">
                          Sua oferta: aceitar ou recusar em Minhas reservas
                        </Link>
                      ) : (
                        <CancelForm bookingId={b.id} status={b.status === "held" ? "held" : "confirmed"} admin label={b.status === "held" ? "Retirar oferta (a pessoa continua na fila)" : "Cancelar com motivo"} />
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-xs text-text-muted">Uso declarado é declaração da pessoa, não presença física nem ponto.</p>
      </Card>
      <Card title="Reservar em nome de alguém">
        {canOnBehalf ? (
          <OnBehalfForm people={people} desks={desks.map((d) => ({ id: d.id, code: d.code }))} date={date} idempotencyKey={randomUUID()} />
        ) : (
          <p className="text-sm text-text-muted">Exige a permissão própria de reserva em nome (DIR-011).</p>
        )}
      </Card>
    </div>
  );
}

async function QueueTab({ date, holderView }: { date: string; holderView: boolean }) {
  const queue = await listQueue(db, { date });
  const demand = await unmetDemand(db);
  const live = queue.filter((q) => q.status === "waiting" || (q.status === "offered" && q.offer?.live));
  const options = new Map<string, Array<{ id: string; code: string }>>();
  for (const q of live.filter((x) => x.status === "waiting")) options.set(q.entryId, await manualOfferOptions(db, q.employeeId, date, q.entryId));
  // Data passada não tem fila viva: a varredura encerra essas inscrições.
  const liveOf = (q: (typeof queue)[number]) => date >= localToday() && (q.status === "waiting" || (q.status === "offered" && !!q.offer?.live));
  const positions = new Map(queue.filter(liveOf).map((q, i) => [q.entryId, i + 1]));
  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <Card title={`Fila de ${formatLocalDate(date)} (${live.length} viva(s))`}>
        {queue.length === 0 ? (
          <EmptyState title="Ninguém entrou na fila nesta data" />
        ) : (
          <Table caption="Inscrições na fila, por ordem de entrada">
            <thead>
              <tr>
                <th className={th}>Posição</th>
                <th className={th}>Pessoa</th>
                <th className={th}>Situação</th>
                <th className={th}>Oferta</th>
                <th className={th}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((q) => {
                const isLive = liveOf(q);
                return (
                  <tr key={q.entryId}>
                    <td className={td}>{positions.get(q.entryId) ?? "—"}</td>
                    <td className={td}>
                      {q.employeeName}
                      <span className="block text-xs text-text-muted">desde {formatLocal(q.createdAt, "dd/MM HH:mm")}</span>
                      {q.preferences.zoneCode ? <span className="block text-xs text-text-muted">prefere zona {q.preferences.zoneCode}</span> : null}
                    </td>
                    <td className={td}>{q.status === "offered" && !q.offer?.live ? "oferta vencida (expira na próxima escrita)" : (ENTRY[q.status] ?? q.status)}</td>
                    <td className={td}>
                      {q.offer && q.offer.live ? `${!holderView ? "oferta aberta" : q.offer.resourceCode} até ${formatLocal(q.offer.expiresAt, "dd/MM HH:mm")}` : q.offer ? <span className="text-text-muted">última oferta {OFFER[q.offer.status] ?? q.offer.status}</span> : "—"}
                    </td>
                    <td className={td}>
                      {isLive ? (
                        <div className="flex min-w-[200px] flex-col gap-3">
                          {q.status === "waiting" ? <ManualOfferForm entryId={q.entryId} desks={options.get(q.entryId) ?? []} /> : null}
                          <RemoveFromQueueForm entryId={q.entryId} />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-xs text-text-muted">A oferta automática segue a ordem de entrada e a mesma regra de disponibilidade da reserva direta. Mesa de uso exclusivo só é oferecida pela fila a quem pode usá-la (titular, integrante do grupo ou beneficiário de liberação vigente).</p>
      </Card>
      <Card title="Demanda não atendida (próximos 14 dias)">
        {demand.length === 0 ? (
          <p className="text-sm text-text-muted">Nenhuma inscrição viva na fila.</p>
        ) : (
          <Table caption="Inscrições vivas por data">
            <thead>
              <tr>
                <th className={th}>Data</th>
                <th className={th}>Em espera</th>
                <th className={th}>Com oferta</th>
              </tr>
            </thead>
            <tbody>
              {demand.map((d) => (
                <tr key={d.date}>
                  <td className={td}>
                    <Link href={`?aba=fila&data=${d.date}`} className="underline">
                      {formatLocalDate(d.date)}
                    </Link>
                  </td>
                  <td className={td}>{d.waiting}</td>
                  <td className={td}>{d.offered}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-xs text-text-muted">Numerador: inscrições em espera ou com oferta, por data, a partir de hoje. Não há denominador: a fila mede pedidos sem mesa, não pessoas que desistiram de pedir. Fonte: tabela da fila na consulta.</p>
      </Card>
    </div>
  );
}

async function SpacesTab({ date, viewerId }: { date: string; viewerId: string }) {
  const rows = await listSpaceBookingsAdmin(db, viewerId, { date });
  return (
    <Card title={`Salas e cabines em ${formatLocalDate(date)} (${rows.length})`}>
      {rows.length === 0 ? (
        <EmptyState title="Nenhuma reserva de sala ou cabine na data" />
      ) : (
        <Table caption="Reservas de sala e cabine">
          <thead>
            <tr>
              <th className={th}>Recurso</th>
              <th className={th}>Horário</th>
              <th className={th}>Pessoa</th>
              <th className={th}>Título</th>
              <th className={th}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={td}>{r.code}</td>
                <td className={td}>{r.slot}</td>
                <td className={td}>{r.employeeName}</td>
                <td className={td}>{r.title ?? <span className="text-text-muted">privado</span>}</td>
                <td className={td}>{r.ended ? <span className="text-xs text-text-muted">encerrada</span> : <AdminCancelSpaceForm bookingId={r.id} />}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-3 text-xs text-text-muted">Título privado continua oculto também para a administração. Manutenção, bloqueio e fechamento de dia tratam as reservas de sala no diálogo de conflito, só com cancelamento.</p>
    </Card>
  );
}
