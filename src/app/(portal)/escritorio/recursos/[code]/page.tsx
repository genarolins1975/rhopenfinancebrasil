import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card, DefinitionList, PageHeader } from "@/components/ui";
import { STATE_STYLE } from "@/components/office-map";
import { db } from "@/db/client";
import { explainFor } from "@/modules/availability/service";
import { requireCurrent } from "@/modules/identity/session";
import { ISO_DATE } from "@/modules/office/shared";
import { formatLocalDate, localToday } from "@/modules/shared/dates";
import { activeEmployeesNamed, getResourceByCode } from "@/modules/workplace/service";
import { BookForm, CancelForm } from "../../book-form";

export default async function RecursoPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ data?: string }> }) {
  const current = await requireCurrent();
  const { code } = await params;
  if (!/^[A-Z0-9-]{2,12}$/i.test(code)) notFound();
  const sp = await searchParams;
  const date = sp.data && ISO_DATE.test(sp.data) ? sp.data : localToday();
  const r = await getResourceByCode(db, code.toUpperCase());
  if (!r) notFound();
  const { availability: a, resource: onDate } = await explainFor(db, current.employee.id, r.id, date);
  const style = STATE_STYLE[a.code] ?? STATE_STYLE.inactive;
  const holderView = current.access.permissions.has("exclusive.holder.view");
  const assignment = onDate?.policy.assignment ?? null;
  const holderName = holderView && assignment?.holderEmployeeId ? (await activeEmployeesNamed(db, [assignment.holderEmployeeId])).get(assignment.holderEmployeeId) : null;
  const attrs = Object.entries(r.attributes as Record<string, unknown>).filter(([k]) => !["bloco", "fileira", "lado", "validado", "rotulo"].includes(k));
  return (
    <>
      <PageHeader title={`Mesa ${r.code}`} lead={`${r.zoneName ?? "Sem zona"}. Estado para você em ${formatLocalDate(date)}.`} actions={<Link href={`/escritorio?data=${date}`} className="underline">Voltar ao escritório</Link>} />
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Estado">
          <p className="text-lg font-semibold">
            <span aria-hidden="true">{style.icon} </span>
            {a.label}
          </p>
          <p className="mt-1 text-sm text-text-muted">Razão: {a.reason}.</p>
          {a.publicReason ? <p className="mt-1 text-sm">{a.publicReason}</p> : null}
          {a.exclusiveMine ? (
            <div className="mt-3">
              <Alert kind="info">Sua mesa de uso exclusivo. Reservar registra os dias de utilização; cancelar não altera a exclusividade.</Alert>
            </div>
          ) : null}
          {assignment && !a.exclusiveMine ? (
            <p className="mt-3 text-sm">
              {a.code === "exclusive" ? "Uso exclusivo — Diretoria" : "Mesa com política exclusiva"}
              {holderName ? ` · Titular: ${holderName}` : assignment.mode === "group" ? " · Grupo diretoria" : ""}
            </p>
          ) : null}
          <div className="mt-4">
            {a.canBook ? <BookForm resourceId={r.id} date={date} idempotencyKey={randomUUID()} back={`/escritorio/recursos/${r.code}?data=${date}`} /> : null}
            {a.code === "mine" && a.bookingId ? <CancelForm bookingId={a.bookingId} /> : null}
          </div>
        </Card>
        <Card title="Atributos verificados">
          {attrs.length === 0 ? (
            <p className="text-sm text-text-muted">Nenhum atributo verificado ainda. Facilities registra monitor, docking e ajuste de altura após conferência.</p>
          ) : (
            <DefinitionList items={attrs.map(([k, v]) => ({ term: k, value: String(v) }))} />
          )}
          <p className="mt-3 text-xs text-text-muted">{r.attributesVerifiedAt ? `Verificado em ${formatLocalDate(r.attributesVerifiedAt.toISOString().slice(0, 10))}.` : "Inventário preliminar da planta, não validado."}</p>
        </Card>
      </div>
    </>
  );
}
