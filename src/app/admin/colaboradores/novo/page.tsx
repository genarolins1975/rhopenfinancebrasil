import { Card, PageHeader } from "@/components/ui";
import { db } from "@/db/client";
import { createEmployeeAction } from "@/modules/employees/actions";
import { listAreas, listEmployees } from "@/modules/employees/service";
import { requirePermission } from "@/modules/identity/session";
import { EmployeeForm } from "../employee-form";

export default async function NovoColaboradorPage() {
  await requirePermission("employee.manage");
  const areas = await listAreas(db);
  const { items } = await listEmployees(db, { status: "active", pageSize: 100 });
  return (
    <>
      <PageHeader title="Cadastrar pessoa" lead="Cadastro individual. Perfis de sistema são concedidos depois, em Acessos." />
      <Card className="max-w-2xl">
        <EmployeeForm mode="create" action={createEmployeeAction} areas={areas} managers={items.map((i) => ({ id: i.id, name: i.fullName }))} />
      </Card>
    </>
  );
}
