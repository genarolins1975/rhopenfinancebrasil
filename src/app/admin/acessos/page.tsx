import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { db } from "@/db/client";
import { listPeopleWithGrants } from "@/modules/access/query";
import { requireAdminArea } from "@/modules/identity/session";

export default async function AcessosPage() {
  const current = await requireAdminArea();
  const p = current.access.permissions;
  const people = await listPeopleWithGrants(db);
  return (
    <>
      <PageHeader title="Acessos" lead="Pessoas com perfis ou permissões além do básico. Concessões são feitas na página de cada pessoa, sempre com motivo. Perfis privilegiados só valem com segundo fator ativo." />
      {!p.has("role.assign.standard") && !p.has("role.assign.privileged") ? (
        <Card>
          <p className="text-sm text-text-muted">Você vê esta lista, mas não concede nem revoga acessos.</p>
        </Card>
      ) : null}
      {people.length === 0 ? (
        <EmptyState title="Nenhuma concessão vigente" />
      ) : (
        <Table caption="Pessoas com concessões">
          <thead>
            <tr>
              <th className={th}>Nome</th>
              <th className={th}>Situação</th>
              <th className={th}>Perfis</th>
              <th className={th}>Permissões diretas</th>
            </tr>
          </thead>
          <tbody>
            {people.map((x) => (
              <tr key={x.employeeId}>
                <td className={td}>
                  <Link href={`/admin/colaboradores/${x.employeeId}`} className="underline">
                    {x.name}
                  </Link>
                </td>
                <td className={td}>
                  <StatusBadge status={x.status} />
                </td>
                <td className={td}>{x.roles.join(", ") || "—"}</td>
                <td className={td}>{x.permissions.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
