import Link from "next/link";
import { Button, EmptyState, Input, PageHeader, Table, td, th } from "@/components/ui";
import { db } from "@/db/client";
import { listAudit } from "@/modules/audit/query";
import { requirePermission } from "@/modules/identity/session";
import { formatLocal } from "@/modules/shared/dates";

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<{ action?: string; entityType?: string; entityId?: string; page?: string }> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const page = Number(sp.page ?? "1") || 1;
  const { items, total, pageSize } = await listAudit(db, { action: sp.action, entityType: sp.entityType, entityId: sp.entityId, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      <PageHeader title="Auditoria" lead="Eventos somente de inserção. Antes e depois são redigidos: CPF, senhas e tokens nunca aparecem." />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <div className="flex flex-col gap-1">
          <label htmlFor="action" className="text-sm font-medium">
            Ação (prefixo)
          </label>
          <Input id="action" name="action" defaultValue={sp.action ?? ""} placeholder="employee." />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="entityType" className="text-sm font-medium">
            Entidade
          </label>
          <Input id="entityType" name="entityType" defaultValue={sp.entityType ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="entityId" className="text-sm font-medium">
            Id da entidade
          </label>
          <Input id="entityId" name="entityId" defaultValue={sp.entityId ?? ""} />
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
      </form>
      {items.length === 0 ? (
        <EmptyState title="Nenhum evento com estes filtros" />
      ) : (
        <Table caption="Eventos de auditoria">
          <thead>
            <tr>
              <th className={th}>Quando</th>
              <th className={th}>Ação</th>
              <th className={th}>Ator</th>
              <th className={th}>Entidade</th>
              <th className={th}>Motivo</th>
              <th className={th}>Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td className={td}>{formatLocal(e.createdAt, "dd/MM/yyyy HH:mm:ss")}</td>
                <td className={td}>{e.action}</td>
                <td className={td}>{e.actorName ?? "sistema"}</td>
                <td className={td}>
                  {e.entityType} {e.entityId ? <span className="font-mono text-xs">{e.entityId.slice(0, 8)}</span> : null}
                </td>
                <td className={td}>{e.reason ?? "—"}</td>
                <td className={td}>
                  <details>
                    <summary className="cursor-pointer text-sm underline">ver</summary>
                    <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify({ antes: e.before, depois: e.after }, null, 1)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-3 text-sm text-text-muted">
        {total} evento(s). Página {page} de {pages}.{" "}
        {page < pages ? (
          <Link href={`?action=${sp.action ?? ""}&entityType=${sp.entityType ?? ""}&entityId=${sp.entityId ?? ""}&page=${page + 1}`} className="underline">
            Próxima
          </Link>
        ) : null}
      </p>
    </>
  );
}
