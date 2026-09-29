import { Alert, Card, DefinitionList, PageHeader, StatusBadge } from "@/components/ui";
import { db } from "@/db/client";
import { getEmployee } from "@/modules/employees/service";
import { requireCurrent } from "@/modules/identity/session";
import { formatLocalDate } from "@/modules/shared/dates";
import { EmailChangeForm } from "./email-change-form";

export default async function PerfilPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const current = await requireCurrent();
  const sp = await searchParams;
  const emp = await getEmployee(db, current.employee.id);
  const period = emp?.periods[0];
  return (
    <>
      <PageHeader title="Meu perfil" lead="Dados mantidos pelo RH. Para corrigir algo, abra uma solicitação." />
      {sp.aviso === "email-confirmado" ? (
        <div className="mb-4">
          <Alert kind="success">Email confirmado.</Alert>
        </div>
      ) : null}
      <Card title="Cadastro">
        <DefinitionList
          items={[
            { term: "Nome", value: current.employee.fullName },
            { term: "Email corporativo", value: current.employee.corporateEmail },
            { term: "Área", value: emp?.areaName ?? "Não informada" },
            { term: "Cargo", value: current.employee.jobTitle ?? "Não informado" },
            { term: "Situação", value: <StatusBadge status={current.employee.status} /> },
            { term: "Admissão", value: period ? formatLocalDate(period.hireDate) : "Não informada" },
            { term: "Perfis", value: current.access.grantedRoles.length ? current.access.grantedRoles.join(", ") : "Colaborador" },
          ]}
        />
      </Card>
      <div className="mt-6">
        <Card title="Trocar email de acesso">
          <p className="mb-3 text-sm text-text-muted">A confirmação vai primeiro para o email atual. Só depois o novo endereço recebe a verificação.</p>
          <EmailChangeForm />
        </Card>
      </div>
    </>
  );
}
