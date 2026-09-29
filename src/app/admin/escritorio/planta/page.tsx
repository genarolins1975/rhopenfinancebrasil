import { Alert, Card, EmptyState, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { db } from "@/db/client";
import { requireAnyPermission } from "@/modules/identity/session";
import { formatLocal } from "@/modules/shared/dates";
import { listPlanVersions, publishedMap } from "@/modules/workplace/service";
import { PlanForms } from "./forms";

export default async function PlantaPage() {
  const current = await requireAnyPermission(["floorplan.edit", "floorplan.publish"]);
  const p = current.access.permissions;
  const versions = await listPlanVersions(db);
  const map = await publishedMap(db);
  return (
    <>
      <PageHeader title="Planta" lead="Versões da planta: rascunho, aprovação e publicação. Publicar não apaga reservas nem troca a identidade de mesa (DIR-030). O PDF original fica em armazenamento privado; aqui entra só o arquivo de trabalho." />
      <Alert kind="info" title="Inventário preliminar">
        A extração da planta R00 (26/01/2026) rotula 84 mesas de 90 posições declaradas. Contagem, códigos, capacidades e atributos dependem de validação de Facilities e RH; até lá o inventário fica marcado como não validado.
      </Alert>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Versões">
          {versions.length === 0 ? (
            <EmptyState title="Nenhuma versão" />
          ) : (
            <Table caption="Versões da planta">
              <thead>
                <tr>
                  <th className={th}>Nome</th>
                  <th className={th}>Estado</th>
                  <th className={th}>Criada</th>
                  <th className={th}>Publicada</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td className={td}>
                      {v.name}
                      {v.sourceSha256 ? <span className="block text-xs text-text-muted">SHA256 {v.sourceSha256.slice(0, 12)}…</span> : null}
                    </td>
                    <td className={td}>
                      <StatusBadge status={v.status} />
                    </td>
                    <td className={td}>{formatLocal(v.createdAt)}</td>
                    <td className={td}>{v.publishedAt ? formatLocal(v.publishedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {map ? <p className="mt-3 text-sm">Mapa publicado: {map.plan.name}, {map.placements.length} recursos posicionados.</p> : <p className="mt-3 text-sm text-text-muted">Sem mapa publicado: o portal mostra Mapa em preparação e a lista.</p>}
        </Card>
        <Card title="Ações">
          <PlanForms versions={versions.map((v) => ({ id: v.id, name: v.name, status: v.status }))} canEdit={p.has("floorplan.edit")} canPublish={p.has("floorplan.publish")} />
        </Card>
      </div>
    </>
  );
}
