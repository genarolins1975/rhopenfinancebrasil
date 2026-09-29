import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { db } from "@/db/client";
import { habitualDesk, listMyBookings } from "@/modules/booking/service";
import { requireCurrent } from "@/modules/identity/session";
import { formatLocalDate } from "@/modules/shared/dates";
import { CancelForm } from "../book-form";

const ORIGIN: Record<string, string> = { self: "você", week_plan: "planejamento da semana", on_behalf: "em seu nome", waitlist_offer: "oferta da fila", admin_realloc: "realocação administrativa" };

export default async function MinhasReservasPage() {
  const current = await requireCurrent();
  const { upcoming, past } = await listMyBookings(db, current.employee.id);
  const habitual = await habitualDesk(db, current.employee.id);
  return (
    <>
      <PageHeader title="Minhas reservas" lead="Reservas futuras e passadas. Cancelar reflete no mapa na hora." actions={<Link href="/escritorio" className="underline">Ir ao escritório</Link>} />
      {habitual ? (
        <p className="mb-4 text-sm text-text-muted">Sua mesa habitual: {habitual.code}. Cancelar uma reserva nela não altera a exclusividade.</p>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Próximas">
          {upcoming.length === 0 ? (
            <EmptyState title="Nenhuma reserva futura">
              <Link href="/semana" className="underline">
                Planejar minha semana
              </Link>
            </EmptyState>
          ) : (
            <Table caption="Reservas futuras">
              <thead>
                <tr>
                  <th className={th}>Data</th>
                  <th className={th}>Mesa</th>
                  <th className={th}>Origem</th>
                  <th className={th}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((b) => (
                  <tr key={b.id}>
                    <td className={td}>{formatLocalDate(b.date)}</td>
                    <td className={td}>{b.code}</td>
                    <td className={td}>{ORIGIN[b.origin] ?? b.origin}</td>
                    <td className={td}>
                      <CancelForm bookingId={b.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Passadas">
          {past.length === 0 ? (
            <EmptyState title="Nenhuma reserva passada" />
          ) : (
            <Table caption="Reservas passadas">
              <thead>
                <tr>
                  <th className={th}>Data</th>
                  <th className={th}>Mesa</th>
                  <th className={th}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {past.map((b) => (
                  <tr key={b.id}>
                    <td className={td}>{formatLocalDate(b.date)}</td>
                    <td className={td}>{b.code}</td>
                    <td className={td}>
                      <StatusBadge status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-3 text-xs text-text-muted">Reserva não é presença física, ponto nem produtividade.</p>
        </Card>
      </div>
    </>
  );
}
