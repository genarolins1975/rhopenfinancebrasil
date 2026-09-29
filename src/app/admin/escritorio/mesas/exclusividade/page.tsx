import Link from "next/link";
import { Alert, Card, EmptyState, Input, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { db } from "@/db/client";
import { employee } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { stateForPerson } from "@/modules/availability/service";
import { directors, history, listAssignments, listGroups, needsReviewList } from "@/modules/exclusivity/service";
import { requireAnyPermission } from "@/modules/identity/session";
import { pendingConflicts } from "@/modules/office/conflicts";
import { formatLocal, formatLocalDate, localToday } from "@/modules/shared/dates";
import { AssignPanel, BatchPanel, ExclusivePanel, GroupPanel } from "./panel";

const POLICY_LABEL: Record<string, string> = { shared: "Compartilhada", exclusive: "Exclusiva", maintenance: "Manutenção", blocked: "Bloqueada", retired: "Desativada" };
const FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "Todas" },
  { key: "compartilhadas", label: "Compartilhadas" },
  { key: "individuais", label: "Exclusivas individuais" },
  { key: "grupo", label: "Exclusivas de grupo" },
  { key: "bloqueadas", label: "Bloqueadas" },
  { key: "manutencao", label: "Manutenção" },
  { key: "revisar", label: "Vínculo a revisar" },
];

export default async function ExclusividadePage({ searchParams }: { searchParams: Promise<{ aba?: string; filtro?: string; q?: string; mesa?: string; lote?: string | string[] }> }) {
  const current = await requireAnyPermission(["exclusive.view", "manage_executive_seat_assignments"]);
  const canManage = current.access.permissions.has("manage_executive_seat_assignments");
  const holderView = current.access.permissions.has("exclusive.holder.view");
  const sp = await searchParams;
  const today = localToday();
  const aba = ["mesas", "grupo", "conflitos", "historico"].includes(sp.aba ?? "") ? sp.aba! : "mesas";
  const { items } = await stateForPerson(db, current.employee.id, today, { holderView });
  const assignments = await listAssignments(db, {});
  const review = await needsReviewList(db);
  const reviewIds = new Set(review.map((r) => r.id));
  const byResource = new Map<string, (typeof assignments)[number][]>();
  for (const a of assignments) byResource.set(a.resourceId, [...(byResource.get(a.resourceId) ?? []), a]);
  const rows = items
    .map((i) => {
      const list = byResource.get(i.resource.id) ?? [];
      const active = list.find((a) => a.state === "active") ?? null;
      const scheduled = list.filter((a) => a.state === "scheduled");
      return { i, active, scheduled, toReview: list.some((a) => reviewIds.has(a.id)) };
    })
    .filter(({ i, active, scheduled, toReview }) => {
      const f = sp.filtro ?? "";
      if (sp.q && !i.resource.code.toLowerCase().includes(sp.q.toLowerCase())) return false;
      if (f === "compartilhadas") return !active && scheduled.length === 0 && i.deskClass !== "retired";
      if (f === "individuais") return !!active && active.mode === "individual";
      if (f === "grupo") return !!active && active.mode === "group";
      if (f === "bloqueadas") return i.deskClass === "blocked";
      if (f === "manutencao") return i.deskClass === "maintenance";
      if (f === "revisar") return toReview;
      return true;
    });
  const selected = sp.mesa ? rows.find((r) => r.i.resource.code === sp.mesa) ?? items.map((i) => ({ i, active: null, scheduled: [], toReview: false })).find((r) => r.i.resource.code === sp.mesa) ?? null : null;
  const selectedAssignments = selected ? (byResource.get(selected.i.resource.id) ?? []) : [];
  const dirs = await directors(db);
  const groups = await listGroups(db);
  const group = groups.find((g) => g.code === "diretoria") ?? groups[0];
  const employees = canManage ? await db.select({ id: employee.id, name: employee.fullName }).from(employee).where(eq(employee.status, "active")).orderBy(asc(employee.fullName)) : [];
  const lote = (Array.isArray(sp.lote) ? sp.lote : sp.lote ? [sp.lote] : []).filter((c) => items.some((i) => i.resource.code === c));
  const conflicts = aba === "conflitos" ? await pendingConflicts(db, today) : [];
  const hist = aba === "historico" && selected ? await history(db, selected.i.resource.id) : null;
  const tab = (key: string, label: string) => (
    <Link href={`?aba=${key}${sp.mesa ? `&mesa=${sp.mesa}` : ""}`} aria-current={aba === key ? "page" : undefined} className={`rounded-md px-3 py-1.5 text-sm ${aba === key ? "bg-primary text-white" : "underline"}`}>
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader title="Exclusividade da diretoria" lead="Travar, agendar, transferir, encerrar, liberar temporariamente, grupo, conflitos e histórico. Nada é aplicado sem prévia e confirmação; nenhuma reserva é cancelada em silêncio." />
      {!canManage ? (
        <div className="mb-4">
          <Alert kind="info">Modo leitura: seu perfil vê a política das mesas, sem alterar.</Alert>
        </div>
      ) : null}
      <nav aria-label="Abas" className="mb-4 flex flex-wrap gap-2">
        {tab("mesas", "Mesas")}
        {tab("grupo", "Grupo diretoria")}
        {tab("conflitos", "Conflitos pendentes")}
        {tab("historico", "Histórico")}
      </nav>
      {aba === "mesas" ? (
        <>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-2" aria-label="Filtros">
            <input type="hidden" name="aba" value="mesas" />
            {FILTERS.map((f) => (
              <Link key={f.key} href={`?aba=mesas&filtro=${f.key}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} aria-current={(sp.filtro ?? "") === f.key ? "page" : undefined} className={`rounded-md border border-border px-2 py-1 text-xs ${(sp.filtro ?? "") === f.key ? "bg-primary-soft font-semibold" : ""}`}>
                {f.label}
              </Link>
            ))}
            <label htmlFor="q" className="ml-auto flex items-center gap-2 text-sm">
              Busca
              <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="código" />
            </label>
            {sp.filtro ? <input type="hidden" name="filtro" value={sp.filtro} /> : null}
          </form>
          <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
            <Card title={`Mesas (${rows.length})`}>
              {rows.length === 0 ? (
                <EmptyState title={items.length === 0 ? "Nenhuma mesa cadastrada" : "Nenhuma mesa com este filtro"}>
                  {items.length === 0 ? (
                    <Link href="/admin/escritorio/planta" className="underline">
                      Criar o inventário a partir da planta
                    </Link>
                  ) : null}
                </EmptyState>
              ) : (
                <form method="get">
                  <input type="hidden" name="aba" value="mesas" />
                  <Table caption="Mesas e política de uso na data de hoje">
                    <thead>
                      <tr>
                        {canManage ? <th className={th}>Lote</th> : null}
                        <th className={th}>Mesa</th>
                        <th className={th}>Zona</th>
                        <th className={th}>Política</th>
                        <th className={th}>Beneficiário</th>
                        <th className={th}>Vigência</th>
                        <th className={th}>Situação</th>
                        <th className={th}>Pendências</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ i, active, scheduled, toReview }) => (
                        <tr key={i.resource.id}>
                          {canManage ? (
                            <td className={td}>
                              <input type="checkbox" name="lote" value={i.resource.code} aria-label={`Selecionar ${i.resource.code}`} defaultChecked={lote.includes(i.resource.code)} className="h-6 w-6" />
                            </td>
                          ) : null}
                          <td className={td}>
                            <Link href={`?aba=mesas&mesa=${i.resource.code}${sp.filtro ? `&filtro=${sp.filtro}` : ""}`} className="underline" aria-current={sp.mesa === i.resource.code ? "true" : undefined}>
                              {i.resource.code}
                            </Link>
                          </td>
                          <td className={td}>{i.resource.zoneName ?? "—"}</td>
                          <td className={td}>{active ? (active.mode === "individual" ? "Exclusiva individual" : "Exclusiva de grupo") : scheduled.length ? `Compartilhada (agendada ${formatLocalDate(scheduled[0].validFrom)})` : "Compartilhada"}</td>
                          <td className={td}>{active ? (active.mode === "individual" ? (holderView ? active.holderName : "titular") : active.groupName) : "—"}</td>
                          <td className={td}>{active ? `${formatLocalDate(active.validFrom)} ${active.validTo ? `até ${formatLocalDate(active.validTo)}` : "até sem término"}` : "—"}</td>
                          <td className={td}>{POLICY_LABEL[i.deskClass] === "Exclusiva" ? "operacional" : (POLICY_LABEL[i.deskClass] ?? i.deskClass).toLowerCase()}</td>
                          <td className={td}>{toReview ? <StatusBadge status="revisar" /> : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {canManage ? (
                    <div className="mt-3">
                      <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm underline">
                        Selecionar para lote
                      </button>
                    </div>
                  ) : null}
                </form>
              )}
            </Card>
            <Card title={selected ? `Mesa ${selected.i.resource.code}` : "Painel da mesa"}>
              {!selected ? (
                <p className="text-sm text-text-muted">Selecione uma mesa na tabela.</p>
              ) : (
                <>
                  <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="font-medium">Zona</dt>
                    <dd>{selected.i.resource.zoneName ?? "—"}</dd>
                    <dt className="font-medium">Política hoje</dt>
                    <dd>{selected.active ? (selected.active.mode === "individual" ? "Exclusiva individual" : "Exclusiva de grupo") : "Compartilhada"}</dd>
                    {selected.active ? (
                      <>
                        <dt className="font-medium">Beneficiário</dt>
                        <dd>{selected.active.mode === "individual" ? (holderView ? selected.active.holderName : "titular (nome restrito)") : selected.active.groupName}</dd>
                        <dt className="font-medium">Vigência</dt>
                        <dd>
                          {formatLocalDate(selected.active.validFrom)} {selected.active.validTo ? `até ${formatLocalDate(selected.active.validTo)}` : "até sem término definido"}
                        </dd>
                      </>
                    ) : null}
                    <dt className="font-medium">Situação</dt>
                    <dd>{selected.i.deskClass === "exclusive" || selected.i.deskClass === "shared" ? "operacional" : (POLICY_LABEL[selected.i.deskClass] ?? "").toLowerCase()}</dd>
                    <dt className="font-medium">Pendências</dt>
                    <dd>{selected.toReview ? "vínculo a revisar" : "nenhuma"}</dd>
                  </dl>
                  {selectedAssignments.filter((a) => a.state === "scheduled").length ? (
                    <p className="mb-3 text-sm">Agendadas: {selectedAssignments.filter((a) => a.state === "scheduled").map((a) => `${a.mode === "individual" ? (holderView ? a.holderName : "titular") : a.groupName} a partir de ${formatLocalDate(a.validFrom)}`).join("; ")}</p>
                  ) : null}
                  {canManage && group ? (
                    <div className="grid min-w-0 gap-6">
                      {selectedAssignments.map((a) => (
                        <details key={a.id} open={a.state === "active"} className="min-w-0 rounded-md border border-border p-3">
                          <summary className="cursor-pointer font-medium">
                            Atribuição {a.state === "active" ? "vigente" : a.state === "scheduled" ? "agendada" : a.state}: {a.mode === "individual" ? a.holderName : a.groupName}
                          </summary>
                          <div className="mt-3">
                            <ExclusivePanel assignment={a} directors={dirs} employees={employees} today={today} />
                          </div>
                        </details>
                      ))}
                      {selectedAssignments.length === 0 ? <AssignPanel desk={{ id: selected.i.resource.id, code: selected.i.resource.code, zone: selected.i.resource.zoneName, deskClass: selected.i.deskClass, stateLabel: selected.i.availability.label, holder: null }} directors={dirs} groupId={group.id} today={today} /> : null}
                      <Link href={`?aba=historico&mesa=${selected.i.resource.code}`} className="text-sm underline">
                        Histórico desta mesa
                      </Link>
                    </div>
                  ) : null}
                </>
              )}
            </Card>
          </div>
          {canManage && group && lote.length ? (
            <div className="mt-6">
              <BatchPanel resourceIds={lote.map((c) => items.find((i) => i.resource.code === c)!.resource.id)} codes={lote} groupId={group.id} today={today} directors={dirs} />
            </div>
          ) : null}
        </>
      ) : null}
      {aba === "grupo" ? (
        <Card title={group ? `Grupo ${group.name}` : "Grupo"}>
          {!group ? (
            <EmptyState title="Grupo não cadastrado" />
          ) : (
            <>
              <Table caption="Integrantes do grupo com vigência">
                <thead>
                  <tr>
                    <th className={th}>Pessoa</th>
                    <th className={th}>Vigência</th>
                    <th className={th}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {group.members.map((m) => (
                    <tr key={m.id}>
                      <td className={td}>{holderView ? m.name : "integrante (nome restrito)"}</td>
                      <td className={td}>
                        {formatLocalDate(m.validFrom)} {m.validTo ? `até ${formatLocalDate(m.validTo)}` : "em diante"}
                      </td>
                      <td className={td}>{m.state}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {canManage ? (
                <div className="mt-6">
                  <GroupPanel groupId={group.id} directors={dirs.filter((d) => !group.members.some((m) => m.employeeId === d.id && m.state !== "encerrado"))} members={group.members.map((m) => ({ id: m.id, name: holderView ? m.name : "integrante", validFrom: m.validFrom, validTo: m.validTo, state: m.state }))} today={today} />
                </div>
              ) : null}
            </>
          )}
        </Card>
      ) : null}
      {aba === "conflitos" ? (
        <Card title="Conflitos pendentes">
          <p className="mb-3 text-sm text-text-muted">Consulta dinâmica sobre reservas ativas futuras que deixaram de ser válidas. Com os triggers deferidos do banco, o normal é vazio: qualquer linha indica escrita fora do protocolo e vira incidente.</p>
          {conflicts.length === 0 ? (
            <EmptyState title="Nenhum conflito pendente" />
          ) : (
            <Table caption="Reservas ativas incompatíveis">
              <thead>
                <tr>
                  <th className={th}>Data</th>
                  <th className={th}>Mesa</th>
                  <th className={th}>Pessoa</th>
                  <th className={th}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => (
                  <tr key={c.bookingId}>
                    <td className={td}>{formatLocalDate(c.date)}</td>
                    <td className={td}>{c.resourceCode}</td>
                    <td className={td}>{holderView ? c.employeeName : "pessoa (nome restrito)"}</td>
                    <td className={td}>{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {review.length ? (
            <div className="mt-6">
              <h3 className="font-semibold">Vínculos a revisar</h3>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {review.map((r) => (
                  <li key={r.id}>
                    <Link href={`?aba=mesas&mesa=${r.code}`} className="underline">
                      {r.code}
                    </Link>
                    : {r.why}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}
      {aba === "historico" ? (
        <Card title={selected ? `Histórico da mesa ${selected.i.resource.code}` : "Histórico"}>
          {!selected || !hist ? (
            <p className="text-sm text-text-muted">Escolha uma mesa na aba Mesas para ver o histórico.</p>
          ) : (
            <>
              <h3 className="font-semibold">Atribuições</h3>
              {hist.assignments.length === 0 ? (
                <p className="text-sm text-text-muted">Nenhuma atribuição registrada.</p>
              ) : (
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {hist.assignments.map((a) => (
                    <li key={a.id}>
                      {a.mode === "individual" ? (holderView ? a.holderName : "titular") : a.groupName}: {formatLocalDate(a.validFrom)} {a.validTo ? `até ${formatLocalDate(a.validTo)}` : "sem término"} ({a.state}
                      {a.endReason ? `, ${a.endReason}` : ""}); responsável: {a.responsible}; motivo: {a.reason}
                      {a.exceptions.length ? ` · liberações: ${a.exceptions.map((x) => `${x.kind === "release_to_shared" ? "compartilhado" : holderView ? x.beneficiaryName : "pessoa (nome restrito)"} ${formatLocalDate(x.startsOn)} a ${formatLocalDate(x.endsOn)}${x.revokedAt ? " (revogada)" : ""}`).join("; ")}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="mt-4 font-semibold">Eventos</h3>
              {hist.events.length === 0 ? (
                <p className="text-sm text-text-muted">Nenhum evento.</p>
              ) : (
                <Table caption="Eventos de auditoria da mesa">
                  <thead>
                    <tr>
                      <th className={th}>Quando</th>
                      <th className={th}>Ação</th>
                      <th className={th}>Ator</th>
                      <th className={th}>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hist.events.map((e) => (
                      <tr key={e.id}>
                        <td className={td}>{formatLocal(e.createdAt)}</td>
                        <td className={td}>{e.action}</td>
                        <td className={td}>{e.actorName ?? "sistema"}</td>
                        <td className={td}>{e.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </>
          )}
        </Card>
      ) : null}
    </>
  );
}
