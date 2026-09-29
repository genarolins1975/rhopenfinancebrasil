import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { Card, EmptyState, Input, PageHeader, Table, td, th } from "@/components/ui";
import { db } from "@/db/client";
import { employee } from "@/db/schema";
import { listBookingsAdmin } from "@/modules/booking/service";
import { requireAnyPermission } from "@/modules/identity/session";
import { ISO_DATE } from "@/modules/office/shared";
import { formatLocalDate, localToday } from "@/modules/shared/dates";
import { listResources } from "@/modules/workplace/service";
import { CancelForm } from "@/app/(portal)/escritorio/book-form";
import { OnBehalfForm } from "./on-behalf-form";

export default async function ReservasAdminPage({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  const current = await requireAnyPermission(["booking.admin.manage", "booking.on_behalf.create"]);
  const p = current.access.permissions;
  const sp = await searchParams;
  const date = sp.data && ISO_DATE.test(sp.data) ? sp.data : localToday();
  const bookings = await listBookingsAdmin(db, { date });
  const people = p.has("booking.on_behalf.create") ? await db.select({ id: employee.id, name: employee.fullName }).from(employee).where(eq(employee.status, "active")).orderBy(asc(employee.fullName)) : [];
  const desks = p.has("booking.on_behalf.create") ? await listResources(db, { type: "desk" }) : [];
  return (
    <>
      <PageHeader title="Reservas" lead="Reservas por data, reserva em nome de outra pessoa e cancelamento administrativo com motivo e comunicação." />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Data">
        <label htmlFor="data" className="flex flex-col gap-1 text-sm font-medium">
          Data
          <Input id="data" name="data" type="date" defaultValue={date} />
        </label>
        <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm underline">
          Aplicar
        </button>
      </form>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card title={`Reservas em ${formatLocalDate(date)} (${bookings.length})`}>
          {bookings.length === 0 ? (
            <EmptyState title="Nenhuma reserva ativa na data" />
          ) : (
            <Table caption="Reservas ativas">
              <thead>
                <tr>
                  <th className={th}>Mesa</th>
                  <th className={th}>Pessoa</th>
                  <th className={th}>Origem</th>
                  <th className={th}>Situação</th>
                  {p.has("booking.admin.manage") ? <th className={th}>Ação</th> : null}
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id}>
                    <td className={td}>{b.code}</td>
                    <td className={td}>{b.employeeName}</td>
                    <td className={td}>{b.origin}</td>
                    <td className={td}>{b.status === "held" ? "retida (oferta da fila)" : "confirmada"}</td>
                    {p.has("booking.admin.manage") ? (
                      <td className={td}>
                        <CancelForm bookingId={b.id} admin label="Cancelar com motivo" />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Reservar em nome de alguém">
          {p.has("booking.on_behalf.create") ? (
            <OnBehalfForm people={people} desks={desks.map((d) => ({ id: d.id, code: d.code }))} date={date} idempotencyKey={randomUUID()} />
          ) : (
            <p className="text-sm text-text-muted">Exige a permissão própria de reserva em nome (DIR-011).</p>
          )}
        </Card>
      </div>
    </>
  );
}
