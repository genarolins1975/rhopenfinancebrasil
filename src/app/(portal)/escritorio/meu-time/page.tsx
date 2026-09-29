import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import Link from "next/link";
import { Card, EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { db } from "@/db/client";
import { requirePermission } from "@/modules/identity/session";
import { TZ } from "@/modules/shared/dates";
import { teamWeek } from "@/modules/team/service";

function week(which: "atual" | "proxima") {
  const local = new TZDate(new Date(), TZ);
  const monday = addDays(startOfWeek(local, { weekStartsOn: 1 }), which === "proxima" ? 7 : 0);
  return [0, 1, 2, 3, 4].map((i) => {
    const d = addDays(monday, i);
    return { date: format(d, "yyyy-MM-dd"), label: format(d, "EEE dd/MM", { locale: ptBR }) };
  });
}

const INTENT: Record<string, { icon: string; text: string }> = {
  onsite: { icon: "●", text: "Presencial" },
  remote: { icon: "◐", text: "Remoto" },
  not_informed: { icon: "○", text: "Não informado" },
};

export default async function MeuTimePage({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  const current = await requirePermission("team.view");
  const sp = await searchParams;
  const which = sp.semana === "proxima" ? "proxima" : "atual";
  const days = week(which);
  const team = await teamWeek(db, current.employee.id, days.map((d) => d.date));
  const tab = (key: "atual" | "proxima", label: string) => (
    <Link href={`?semana=${key}`} aria-current={which === key ? "page" : undefined} className={`rounded-md px-3 py-1.5 text-sm ${which === key ? "bg-primary text-white" : "underline"}`}>
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader title="Meu time" lead="Intenção de presença e reservas das pessoas que respondem diretamente a você e autorizaram compartilhar. Nada aqui é presença, ponto ou produtividade." />
      <nav aria-label="Semana" className="mb-4 flex gap-2">
        {tab("atual", "Esta semana")}
        {tab("proxima", "Próxima semana")}
      </nav>
      <Card>
        {team.length === 0 ? (
          <EmptyState title="Nenhuma pessoa responde diretamente a você no cadastro">O vínculo de gestão é mantido pelo RH.</EmptyState>
        ) : (
          <Table caption="Planos da equipe">
            <thead>
              <tr>
                <th className={th}>Pessoa</th>
                {days.map((d) => (
                  <th key={d.date} className={`${th} capitalize`}>
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id}>
                  <td className={td}>
                    <span className="font-medium">{m.name}</span>
                    {m.jobTitle ? <span className="block text-xs text-text-muted">{m.jobTitle}</span> : null}
                  </td>
                  {m.shared ? (
                    m.days.map((d) => (
                      <td key={d.date} className={td}>
                        <span aria-hidden="true">{INTENT[d.intent].icon} </span>
                        {INTENT[d.intent].text}
                        {d.deskCode ? <span className="block text-xs">Mesa {d.deskCode}</span> : null}
                        {d.spaces.map((s) => (
                          <span key={`${s.code}${s.slot}`} className="block text-xs">
                            {s.code} {s.slot}
                            {s.title ? ` · ${s.title}` : ""}
                          </span>
                        ))}
                      </td>
                    ))
                  ) : (
                    <td className={td} colSpan={days.length}>
                      <span className="text-text-muted">A pessoa não autorizou compartilhar os planos.</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-xs text-text-muted">Cada pessoa decide, no próprio perfil, se compartilha. Intenção presencial não garante mesa; ausência de reserva não indica falta.</p>
      </Card>
    </>
  );
}
