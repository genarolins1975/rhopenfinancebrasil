import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/db/client";
import { capacityOn } from "@/modules/availability/service";
import { localToday } from "@/modules/shared/dates";
import { adminOverview } from "@/modules/admin/overview";
import { requireAdminArea } from "@/modules/identity/session";

function Stat({ label, value, help }: { label: string; value: number; help: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-sm text-text-muted">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-text-muted">{help}</p>
    </div>
  );
}

export default async function AdminHome() {
  await requireAdminArea();
  const o = await adminOverview(db);
  const cap = await capacityOn(db, localToday());
  return (
    <>
      <PageHeader title="O que precisa de atenção hoje" lead="Números do cadastro e das notificações. Reservas, fila e atendimentos chegam nas próximas etapas." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pessoas ativas" value={o.employees.active} help="Cadastro com acesso definido e situação ativa." />
        <Stat label="Convidadas sem convite válido" value={o.invitedWithoutActiveInvitation} help="Precisam de reenvio para conseguir entrar." />
        <Stat label="Convites expirados" value={o.expiredInvitations} help="Convites não usados após 7 dias." />
        <Stat label="Suspensas" value={o.employees.suspended} help="Login bloqueado, cadastro mantido." />
        <Stat label="Notificações pendentes" value={o.outbox.pending} help="Aguardando o worker de entrega." />
        <Stat label="Notificações com falha" value={o.outbox.failed} help="Esgotaram as tentativas. Exigem ação." />
        <Stat label="Notificações bloqueadas" value={o.outbox.blocked} help="Destinatário fora da lista permitida deste ambiente." />
        <Stat label="Desativadas" value={o.employees.deactivated} help="Sem acesso; histórico preservado." />
        <Stat label="Eventos de auditoria em 24h" value={o.auditLast24h} help="Alterações administrativas registradas." />
        <Stat label="Capacidade compartilhada hoje" value={cap.desks.shared} help="Mesas sem exclusividade vigente e operacionais. Exclusiva em manutenção conta uma vez." />
        <Stat label="Confirmadas no compartilhado" value={cap.sharedConfirmed} help="Reservas confirmadas hoje. Retenções fora. Não é presença física." />
        <Stat label="Mesas exclusivas hoje" value={cap.desks.exclusive} help="Sem reserva não é vaga compartilhada nem ocupação." />
        <Stat label="Indisponíveis hoje" value={cap.desks.maintenance + cap.desks.blocked + cap.desks.retired} help="Manutenção, bloqueio e desativadas." />
      </div>
      <div className="mt-6">
        <Card title="Atalhos">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              <Link href="/admin/colaboradores/novo" className="underline">
                Cadastrar pessoa
              </Link>
            </li>
            <li>
              <Link href="/admin/colaboradores/importar" className="underline">
                Importar CSV
              </Link>
            </li>
            <li>
              <Link href="/admin/colaboradores?status=invited" className="underline">
                Ver pessoas convidadas
              </Link>
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
