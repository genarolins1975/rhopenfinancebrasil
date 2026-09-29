import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, ButtonLink, Card, DefinitionList, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { db } from "@/db/client";
import { listGrants } from "@/modules/access/query";
import { getEmployee } from "@/modules/employees/service";
import { maskCpf } from "@/modules/employees/cpf";
import { requireAnyPermission } from "@/modules/identity/session";
import { formatLocal, formatLocalDate } from "@/modules/shared/dates";
import { EmployeeActions, GrantForms, RevealCpf } from "./actions-panel";

const AVISOS: Record<string, string> = { criado: "Pessoa cadastrada.", editado: "Cadastro atualizado." };

export default async function ColaboradorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aviso?: string }> }) {
  const current = await requireAnyPermission(["employee.read.full", "employee.manage"]);
  const { id } = await params;
  const sp = await searchParams;
  const p = current.access.permissions;
  const emp = await getEmployee(db, id);
  if (!emp) notFound();
  const grants = await listGrants(db, id);
  const canManage = p.has("employee.manage");
  const canAssign = p.has("role.assign.standard") || p.has("role.assign.privileged");
  return (
    <>
      <PageHeader
        title={emp.fullName}
        lead={emp.corporateEmail}
        actions={canManage && emp.status !== "deactivated" ? <ButtonLink href={`/admin/colaboradores/${id}/editar`} variant="secondary">Editar cadastro</ButtonLink> : null}
      />
      {sp.aviso && AVISOS[sp.aviso] ? (
        <div className="mb-4">
          <Alert kind="success">{AVISOS[sp.aviso]}</Alert>
        </div>
      ) : null}
      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card title="Cadastro">
            <DefinitionList
              items={[
                { term: "Situação", value: <StatusBadge status={emp.status} /> },
                { term: "Condição", value: emp.orgCondition === "director" ? "Diretor" : "Colaborador" },
                { term: "Área", value: emp.areaName ?? "Não informada" },
                { term: "Cargo", value: emp.jobTitle ?? "Não informado" },
                { term: "Segundo fator", value: emp.twoFactorEnabled ? "ativo" : "inativo" },
                { term: "Admissão", value: emp.periods[0] ? formatLocalDate(emp.periods[0].hireDate) : "—" },
                { term: "CPF", value: <RevealCpf id={id} masked={emp.cpfSuffix ? maskCpf(emp.cpfSuffix) : "não cadastrado"} canReveal={p.has("cpf.reveal")} /> },
              ]}
            />
          </Card>
          <Card title="Perfis e permissões vigentes">
            {grants.roles.length === 0 && grants.permissions.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhuma concessão além do perfil básico de colaborador.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {grants.roles.map((r) => (
                  <li key={r.id}>
                    Perfil <strong>{r.roleCode}</strong> desde {formatLocalDate(r.validFrom)}
                    {r.validTo ? ` até ${formatLocalDate(r.validTo)}` : ""} · {r.reason}
                  </li>
                ))}
                {grants.permissions.map((g) => (
                  <li key={g.id}>
                    Permissão <strong>{g.permissionCode}</strong> desde {formatLocalDate(g.validFrom)}
                    {g.validTo ? ` até ${formatLocalDate(g.validTo)}` : ""} · {g.reason}
                  </li>
                ))}
              </ul>
            )}
            {canAssign && emp.status !== "deactivated" && current.employee.id !== id ? (
              <div className="mt-4">
                <GrantForms id={id} roles={grants.roles.map((r) => r.roleCode)} permissions={grants.permissions.map((g) => g.permissionCode)} canPrivileged={p.has("role.assign.privileged")} />
              </div>
            ) : null}
            {current.employee.id === id ? <p className="mt-2 text-xs text-text-muted">Ninguém altera os próprios perfis.</p> : null}
          </Card>
          <Card title="Histórico organizacional">
            <Table caption="Vínculos organizacionais">
              <thead>
                <tr>
                  <th className={th}>Vigência</th>
                  <th className={th}>Cargo</th>
                  <th className={th}>Condição</th>
                  <th className={th}>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {emp.orgHistory.map((h) => (
                  <tr key={h.id}>
                    <td className={td}>
                      {formatLocalDate(h.validFrom)} {h.validTo ? `a ${formatLocalDate(h.validTo)}` : "em diante"}
                    </td>
                    <td className={td}>{h.jobTitle ?? "—"}</td>
                    <td className={td}>{h.orgCondition === "director" ? "Diretor" : "Colaborador"}</td>
                    <td className={td}>{h.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card title="Convites">
            {emp.invitations.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhum convite.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {emp.invitations.map((i) => (
                  <li key={i.id}>
                    {i.deliveryStatus === "sent" && i.sentAt ? `Enviado em ${formatLocal(i.sentAt)}` : i.deliveryStatus === "blocked" ? "Bloqueado: destinatário fora da lista permitida deste ambiente" : "Enfileirado, aguardando envio"}
                    , válido até {formatLocal(i.expiresAt)}: {i.usedAt ? "usado" : i.revokedAt ? "revogado" : i.expired ? "expirado" : "válido"}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="min-w-0">
          {canManage ? (
            <Card title="Ações">
              {current.employee.id === id ? (
                <p className="text-sm text-text-muted">Você não altera a própria situação.</p>
              ) : (
                <EmployeeActions id={id} status={emp.status} name={emp.fullName} />
              )}
            </Card>
          ) : null}
          <p className="mt-4 text-sm">
            <Link href={`/admin/auditoria?entityType=employee&entityId=${id}`} className="underline">
              Ver auditoria desta pessoa
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
