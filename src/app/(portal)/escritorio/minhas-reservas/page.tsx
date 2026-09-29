import Link from "next/link";
import { Alert, Card, EmptyState, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { db } from "@/db/client";
import { habitualDesk, listMyBookings } from "@/modules/booking/service";
import { pendingUseConfirmation, usageOfDeskBookings, usageOfSpaceBookings } from "@/modules/checkin/service";
import { requireCurrent } from "@/modules/identity/session";
import { formatLocal, formatLocalDate, localToday } from "@/modules/shared/dates";
import { mySpaceBookings } from "@/modules/spaces/service";
import { myQueue } from "@/modules/waitlist/service";
import { CancelForm } from "../book-form";
import { AcceptOfferForm, CancelSpaceForm, ConfirmUseForm, DeclineOfferForm, LeaveQueueForm } from "../operation-forms";

const ORIGIN: Record<string, string> = { self: "você", week_plan: "planejamento da semana", on_behalf: "em seu nome", waitlist_offer: "oferta da fila", admin_realloc: "realocação administrativa" };
const METHOD: Record<string, string> = { portal: "pelo portal", qr: "pelo QR" };

export default async function MinhasReservasPage() {
  const current = await requireCurrent();
  const today = localToday();
  const { upcoming, past } = await listMyBookings(db, current.employee.id);
  const habitual = await habitualDesk(db, current.employee.id);
  const queue = await myQueue(db, current.employee.id);
  const offers = queue.filter((q) => q.offer);
  const waiting = queue.filter((q) => !q.offer);
  const spaces = await mySpaceBookings(db, current.employee.id);
  const deskUse = await usageOfDeskBookings(db, upcoming.filter((b) => b.date === today).map((b) => b.id));
  const spaceUse = await usageOfSpaceBookings(db, spaces.upcoming.filter((s) => s.date === today).map((s) => s.id));
  const confirmedDesks = upcoming.filter((b) => b.status === "confirmed");
  const deadline = await pendingUseConfirmation(db, current.employee.id);
  return (
    <>
      <PageHeader title="Minhas reservas" lead="Mesas, salas, ofertas e fila de espera. Cancelar reflete no mapa na hora." actions={<Link href="/escritorio" className="underline">Ir ao escritório</Link>} />
      {habitual ? <p className="mb-4 text-sm text-text-muted">Sua mesa habitual: {habitual.code}. Cancelar uma reserva nela não altera a exclusividade.</p> : null}
      {deadline ? (
        <div className="mb-4">
          <Alert kind="warning">Confirme o uso da sua reserva de mesa de hoje até {deadline}. Sem confirmação até esse horário, a mesa é liberada para outra pessoa.</Alert>
        </div>
      ) : null}
      {offers.length ? (
        <div className="mb-6">
          <Card title="Oferta da fila de espera">
            <ul className="grid gap-4">
              {offers.map((o) => (
                <li key={o.entryId} className="rounded-md border border-border p-3">
                  <Alert kind="info" title={`Mesa ${o.offer!.resourceCode} disponível para você em ${formatLocalDate(o.date)}`}>
                    Retida para você até {formatLocal(o.offer!.expiresAt)}. Sem resposta até lá, a mesa passa à próxima pessoa da fila.
                  </Alert>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <AcceptOfferForm offerId={o.offer!.id} />
                    <DeclineOfferForm offerId={o.offer!.id} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Mesas: próximas">
          {confirmedDesks.length === 0 ? (
            <EmptyState title="Nenhuma reserva de mesa futura">
              <Link href="/semana" className="underline">
                Planejar minha semana
              </Link>
            </EmptyState>
          ) : (
            <Table caption="Reservas de mesa futuras">
              <thead>
                <tr>
                  <th className={th}>Data</th>
                  <th className={th}>Mesa</th>
                  <th className={th}>Origem</th>
                  <th className={th}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {confirmedDesks.map((b) => {
                  const use = deskUse.get(b.id);
                  return (
                    <tr key={b.id}>
                      <td className={td}>{formatLocalDate(b.date)}</td>
                      <td className={td}>{b.code}</td>
                      <td className={td}>{ORIGIN[b.origin] ?? b.origin}</td>
                      <td className={td}>
                        <div className="flex flex-col gap-2">
                          {b.date === today ? use ? <span className="text-sm">Uso confirmado às {formatLocal(use.declaredAt, "HH:mm")} {METHOD[use.method]}.</span> : <ConfirmUseForm bookingId={b.id} /> : null}
                          <CancelForm bookingId={b.id} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Salas e cabines: próximas">
          {spaces.upcoming.length === 0 ? (
            <EmptyState title="Nenhuma reserva de sala futura">
              <Link href="/escritorio/salas" className="underline">
                Buscar sala ou cabine
              </Link>
            </EmptyState>
          ) : (
            <Table caption="Reservas de sala futuras">
              <thead>
                <tr>
                  <th className={th}>Data</th>
                  <th className={th}>Recurso</th>
                  <th className={th}>Horário</th>
                  <th className={th}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {spaces.upcoming.map((s) => {
                  const use = spaceUse.get(s.id);
                  return (
                    <tr key={s.id}>
                      <td className={td}>{formatLocalDate(s.date)}</td>
                      <td className={td}>
                        {s.code}
                        {s.title ? <span className="block text-xs text-text-muted">{s.title}</span> : null}
                      </td>
                      <td className={td}>{s.slot}</td>
                      <td className={td}>
                        <div className="flex flex-col gap-2">
                          {s.date === today ? use ? <span className="text-sm">Uso confirmado às {formatLocal(use.declaredAt, "HH:mm")}.</span> : <ConfirmUseForm spaceBookingId={s.id} /> : null}
                          <CancelSpaceForm bookingId={s.id} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Fila de espera">
          {waiting.length === 0 ? (
            <p className="text-sm text-text-muted">Você não está em nenhuma fila. Quando não houver mesa disponível numa data, o mapa oferece a entrada na fila.</p>
          ) : (
            <ul className="grid gap-3 text-sm">
              {waiting.map((w) => (
                <li key={w.entryId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                  <span>
                    {formatLocalDate(w.date)}: aguardando mesa desde {formatLocal(w.createdAt, "dd/MM HH:mm")}
                  </span>
                  <LeaveQueueForm entryId={w.entryId} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Passadas">
          {past.length === 0 && spaces.past.length === 0 ? (
            <EmptyState title="Nenhuma reserva passada" />
          ) : (
            <Table caption="Reservas passadas">
              <thead>
                <tr>
                  <th className={th}>Data</th>
                  <th className={th}>Recurso</th>
                  <th className={th}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {past.map((b) => (
                  <tr key={b.id}>
                    <td className={td}>{formatLocalDate(b.date)}</td>
                    <td className={td}>Mesa {b.code}</td>
                    <td className={td}>
                      <StatusBadge status={b.status} />
                    </td>
                  </tr>
                ))}
                {spaces.past.map((s) => (
                  <tr key={s.id}>
                    <td className={td}>{formatLocalDate(s.date)}</td>
                    <td className={td}>
                      {s.code} {s.slot}
                    </td>
                    <td className={td}>
                      <StatusBadge status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-3 text-xs text-text-muted">Reserva e confirmação de uso não são presença física, ponto nem produtividade.</p>
        </Card>
      </div>
    </>
  );
}
