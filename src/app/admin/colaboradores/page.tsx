import Link from "next/link";
import { Button, ButtonLink, EmptyState, Input, PageHeader, Select, StatusBadge, Table, td, th } from "@/components/ui";
import { db } from "@/db/client";
import { listEmployees } from "@/modules/employees/service";
import { requireAnyPermission } from "@/modules/identity/session";

export default async function ColaboradoresPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const current = await requireAnyPermission(["employee.read.full", "employee.manage"]);
  const sp = await searchParams;
  const page = Number(sp.page ?? "1") || 1;
  const { items, total } = await listEmployees(db, { q: sp.q, status: sp.status, page });
  const canManage = current.access.permissions.has("employee.manage");
  const pages = Math.max(1, Math.ceil(total / 25));
  return (
    <>
      <PageHeader
        title="Colaboradores"
        lead="Cadastro, convites e situação. CPF nunca aparece nesta lista."
        actions={
          canManage ? (
            <>
              <ButtonLink href="/admin/colaboradores/importar" variant="secondary">
                Importar CSV
              </ButtonLink>
              <ButtonLink href="/admin/colaboradores/novo">Cadastrar pessoa</ButtonLink>
            </>
          ) : null
        }
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Nome ou email
          </label>
          <Input id="q" name="q" defaultValue={sp.q ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-sm font-medium">
            Situação
          </label>
          <Select id="status" name="status" defaultValue={sp.status ?? ""}>
            <option value="">Todas</option>
            <option value="invited">Convidadas</option>
            <option value="active">Ativas</option>
            <option value="suspended">Suspensas</option>
            <option value="deactivated">Desativadas</option>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
      </form>
      {items.length === 0 ? (
        <EmptyState title="Nenhuma pessoa encontrada">Ajuste os filtros ou cadastre uma pessoa.</EmptyState>
      ) : (
        <Table caption="Lista de colaboradores">
          <thead>
            <tr>
              <th className={th}>Nome</th>
              <th className={th}>Email</th>
              <th className={th}>Área</th>
              <th className={th}>Condição</th>
              <th className={th}>Situação</th>
              <th className={th}>Convite</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td className={td}>
                  <Link href={`/admin/colaboradores/${e.id}`} className="underline">
                    {e.fullName}
                  </Link>
                </td>
                <td className={td}>{e.corporateEmail}</td>
                <td className={td}>{e.areaName ?? "—"}</td>
                <td className={td}>{e.orgCondition === "director" ? "Diretor" : "Colaborador"}</td>
                <td className={td}>
                  <StatusBadge status={e.status} />
                </td>
                <td className={td}>{e.status === "invited" ? (e.hasActiveInvitation ? "válido" : "sem convite válido") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-3 text-sm text-text-muted">
        {total} pessoa(s). Página {page} de {pages}.{" "}
        {page > 1 ? (
          <Link href={`?q=${sp.q ?? ""}&status=${sp.status ?? ""}&page=${page - 1}`} className="underline">
            Anterior
          </Link>
        ) : null}{" "}
        {page < pages ? (
          <Link href={`?q=${sp.q ?? ""}&status=${sp.status ?? ""}&page=${page + 1}`} className="underline">
            Próxima
          </Link>
        ) : null}
      </p>
    </>
  );
}
