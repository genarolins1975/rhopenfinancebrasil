import { randomUUID } from "node:crypto";
import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/db/client";
import { stateForPerson } from "@/modules/availability/service";
import { habitualDesk, weekOverview } from "@/modules/booking/service";
import { requireCurrent } from "@/modules/identity/session";
import { TZ, formatLocal } from "@/modules/shared/dates";
import { WeekForm, type WeekDayOption } from "./week-form";

/** Semana alvo: a próxima semana útil, ou a corrente se ainda houver dias à frente e o parâmetro pedir. */
function businessWeek(now: Date, which: "atual" | "proxima") {
  const local = new TZDate(now, TZ);
  const monday = addDays(startOfWeek(local, { weekStartsOn: 1 }), which === "proxima" ? 7 : 0);
  return [0, 1, 2, 3, 4].map((i) => {
    const d = addDays(monday, i);
    return { date: format(d, "yyyy-MM-dd"), weekday: format(d, "EEEE", { locale: ptBR }), short: format(d, "dd/MM") };
  });
}

export default async function SemanaPage({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  const current = await requireCurrent();
  const sp = await searchParams;
  const which = sp.semana === "atual" ? "atual" : "proxima";
  const days = businessWeek(new Date(), which);
  const overview = await weekOverview(db, current.employee.id, days.map((d) => d.date));
  const habitual = await habitualDesk(db, current.employee.id);
  const options: WeekDayOption[] = [];
  for (const d of days) {
    const { ctx, items } = await stateForPerson(db, current.employee.id, d.date);
    const ov = overview.find((o) => o.date === d.date)!;
    const desks = items.filter((i) => i.availability.canBook).map((i) => ({ id: i.resource.id, code: i.resource.code, habitual: i.availability.exclusiveMine }));
    desks.sort((a, b) => Number(b.habitual) - Number(a.habitual) || a.code.localeCompare(b.code));
    options.push({
      date: d.date,
      weekday: d.weekday,
      short: d.short,
      intent: ov.intent,
      bookedCode: ov.booking?.code ?? null,
      open: ctx.officeOpen && ctx.window.open,
      note: !ctx.officeOpen ? `Escritório fechado${ctx.closedReason ? `: ${ctx.closedReason}` : ""}` : !ctx.window.open ? `Reservas abrem em ${ctx.window.opensAt ? formatLocal(ctx.window.opensAt) : "data a definir"}` : null,
      desks,
    });
  }
  return (
    <>
      <PageHeader title="Planejar minha semana" lead="Intenção por dia e, se quiser, uma mesa. A confirmação é tudo ou nada; em conflito, nada é gravado e os dias afetados aparecem." />
      <p className="mb-4 text-sm">
        Semana: {which === "proxima" ? "próxima" : "atual"}.{" "}
        <a href={`/semana?semana=${which === "proxima" ? "atual" : "proxima"}`} className="underline">
          Ver a {which === "proxima" ? "semana atual" : "próxima semana"}
        </a>
      </p>
      <Card>
        <WeekForm days={options} idempotencyKey={randomUUID()} habitualCode={habitual?.code ?? null} />
      </Card>
      <p className="mt-3 text-sm text-text-muted">Intenção presencial não garante mesa. Ausência de reserva não indica falta ao trabalho.</p>
    </>
  );
}
