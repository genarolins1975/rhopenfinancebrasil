import Link from "next/link";
import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Alert, Card, PageHeader } from "@/components/ui";
import { canEnterAdminArea } from "@/modules/access/can";
import { requireCurrent } from "@/modules/identity/session";
import { TZ } from "@/modules/shared/dates";

function nextBusinessWeek(now: Date) {
  const local = new TZDate(now, TZ);
  const monday = addDays(startOfWeek(local, { weekStartsOn: 1 }), 7);
  return [0, 1, 2, 3, 4].map((i) => {
    const d = addDays(monday, i);
    return { key: format(d, "yyyy-MM-dd"), weekday: format(d, "EEEE", { locale: ptBR }), date: format(d, "dd/MM") };
  });
}

export default async function InicioPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const current = await requireCurrent();
  const sp = await searchParams;
  const firstName = current.user.name.split(" ")[0];
  const week = nextBusinessWeek(new Date());
  return (
    <>
      <PageHeader title={`Olá, ${firstName}. Como será sua próxima semana?`} lead="Os cinco dias úteis da próxima semana. O planejamento e as reservas chegam na próxima entrega." />
      {sp.aviso === "sem-permissao" ? (
        <div className="mb-4">
          <Alert kind="warning">Esta ação não está disponível para o seu perfil.</Alert>
        </div>
      ) : null}
      {current.access.mfaRequired ? (
        <div className="mb-4">
          <Alert kind="warning" title="Segundo fator obrigatório">
            Seu perfil administrativo só passa a valer depois de ativar o segundo fator.{" "}
            <Link href="/perfil/seguranca" className="underline">
              Ativar agora
            </Link>
            .
          </Alert>
        </div>
      ) : null}
      <Card title="Próxima semana">
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          {week.map((d) => (
            <li key={d.key} className="rounded-md border border-border bg-surface-muted p-3">
              <p className="text-sm font-medium capitalize">{d.weekday}</p>
              <p className="text-xs text-text-muted">{d.date}</p>
              <p className="mt-2 text-sm">
                <span aria-hidden="true">○ </span>Não informado
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-text-muted">Marcar intenção presencial não garante mesa. Ausência de reserva não indica falta ao trabalho.</p>
      </Card>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card title="O que você pode fazer agora">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              <Link href="/perfil" className="underline">
                Conferir seus dados de cadastro
              </Link>
            </li>
            <li>
              <Link href="/perfil/seguranca" className="underline">
                Senha, segundo fator e sessões
              </Link>
            </li>
            {canEnterAdminArea(current.access) ? (
              <li>
                <Link href="/admin" className="underline">
                  Ambiente administrativo
                </Link>
              </li>
            ) : null}
          </ul>
        </Card>
        <Card title="Avisos">
          <p className="text-sm text-text-muted">Nenhum aviso publicado.</p>
        </Card>
      </div>
    </>
  );
}
