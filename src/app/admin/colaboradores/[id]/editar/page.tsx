import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/db/client";
import { updateEmployeeAction } from "@/modules/employees/actions";
import { getEmployee, listAreas, listEmployees } from "@/modules/employees/service";
import { requirePermission } from "@/modules/identity/session";
import { EmployeeForm } from "../../employee-form";

export default async function EditarColaboradorPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("employee.manage");
  const { id } = await params;
  const emp = await getEmployee(db, id);
  if (!emp || emp.status === "deactivated") notFound();
  const areas = await listAreas(db);
  const { items } = await listEmployees(db, { status: "active", pageSize: 100 });
  return (
    <>
      <PageHeader title={`Editar ${emp.fullName}`} lead="Mudanças de área, cargo, gestor e condição abrem um novo vínculo no histórico." />
      <Card className="max-w-2xl">
        <EmployeeForm
          mode="edit"
          action={updateEmployeeAction}
          areas={areas}
          managers={items.map((i) => ({ id: i.id, name: i.fullName }))}
          initial={{ id: emp.id, fullName: emp.fullName, corporateEmail: emp.corporateEmail, areaId: emp.areaId, jobTitle: emp.jobTitle, managerEmployeeId: emp.managerEmployeeId, orgCondition: emp.orgCondition, status: emp.status }}
        />
      </Card>
    </>
  );
}
