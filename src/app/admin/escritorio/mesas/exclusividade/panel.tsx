"use client";

import { Field, Input, Select, Textarea } from "@/components/ui";
import { PreviewForm, SimpleForm } from "@/components/office-forms";
import { addMemberAction, assignAction, cancelAssignmentAction, endAssignmentAction, exceptionAction, removeMemberAction, reviewAction, revokeExceptionAction, transferAction } from "@/modules/exclusivity/actions";
import type { AssignmentRow } from "@/modules/exclusivity/service";

export type Director = { id: string; name: string };
export type DeskSummary = { id: string; code: string; zone: string | null; deskClass: string; stateLabel: string; holder: string | null };

const fmt = (d: string) => d.split("-").reverse().join("/");

function AssignFields({ input, directors, groupId, mode, today, previewing }: { input: Record<string, string>; directors: Director[]; groupId: string; mode: "individual" | "group"; today: string; previewing: boolean }) {
  return (
    <>
      <input type="hidden" name="mode" value={mode} />
      {mode === "individual" ? (
        <Field id="holderEmployeeId" label="Titular (pessoa ativa com condição de diretor, PAR-23)">
          <Select id="holderEmployeeId" name="holderEmployeeId" defaultValue={input.holderEmployeeId ?? ""} required disabled={previewing}>
            <option value="">Escolha</option>
            {directors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          {previewing ? <input type="hidden" name="holderEmployeeId" value={input.holderEmployeeId ?? ""} /> : null}
        </Field>
      ) : (
        <input type="hidden" name="accessGroupId" value={groupId} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="validFrom" label="Início (padrão hoje)">
          <Input id="validFrom" name="validFrom" type="date" defaultValue={input.validFrom ?? today} required readOnly={previewing} />
        </Field>
        <Field id="validTo" label="Término (opcional; vazio = sem término definido)">
          <Input id="validTo" name="validTo" type="date" defaultValue={input.validTo ?? ""} readOnly={previewing} />
        </Field>
      </div>
      <Field id="reason" label="Justificativa">
        <Textarea id="reason" name="reason" rows={2} required defaultValue={input.reason ?? ""} readOnly={previewing} />
      </Field>
      <Field id="responsible" label="Responsável pela decisão (pessoa ou área, PAR-27)">
        <Input id="responsible" name="responsible" required defaultValue={input.responsible ?? ""} readOnly={previewing} />
      </Field>
    </>
  );
}

function assignSummary(preview: Record<string, unknown>) {
  const items = (Array.isArray(preview) ? preview : [preview]) as Array<Record<string, unknown>>;
  return (
    <ul className="list-disc pl-5">
      {items.map((p) => (
        <li key={String(p.resourceCode)}>
          A mesa {String(p.resourceCode)} deixa o conjunto compartilhado a partir de {fmt(String(p.startsOn))}
          {p.endsOn ? ` até ${fmt(String(p.endsOn))}` : ", sem término definido"}. {Number(p.daysAffected)} dia(s) afetado(s) no horizonte visível.
          {Array.isArray(p.periods) && p.periods.length ? ` Manutenção ou bloqueio vigente no período: ${(p.periods as Array<{ status: string; startsOn: string }>).map((x) => `${x.status === "maintenance" ? "manutenção" : "bloqueio"} desde ${fmt(x.startsOn)}`).join("; ")} (continua valendo).` : ""}
          {Array.isArray(p.notifications) ? ` Notificações: ${(p.notifications as string[]).join(", ")}.` : ""}
        </li>
      ))}
    </ul>
  );
}

export function AssignPanel({ desk, directors, groupId, today }: { desk: DeskSummary; directors: Director[]; groupId: string; today: string }) {
  return (
    <div className="grid gap-6">
      <section aria-labelledby="travar-titulo">
        <h3 id="travar-titulo" className="font-semibold">
          Travar e vincular a um titular (ou agendar com início futuro)
        </h3>
        <PreviewForm action={assignAction} hidden={{ resourceId: desk.id }} summary={assignSummary} confirmLabel="Confirmar atribuição" fields={(input, previewing) => <AssignFields input={input} directors={directors} groupId={groupId} mode="individual" today={today} previewing={previewing} />} />
      </section>
      <section aria-labelledby="grupo-titulo">
        <h3 id="grupo-titulo" className="font-semibold">
          Travar para o grupo da diretoria
        </h3>
        <PreviewForm action={assignAction} hidden={{ resourceId: desk.id }} summary={assignSummary} confirmLabel="Confirmar atribuição de grupo" fields={(input, previewing) => <AssignFields input={input} directors={directors} groupId={groupId} mode="group" today={today} previewing={previewing} />} />
      </section>
    </div>
  );
}

export function BatchPanel({ resourceIds, codes, groupId, today, directors }: { resourceIds: string[]; codes: string[]; groupId: string; today: string; directors: Director[] }) {
  return (
    <section aria-labelledby="lote-titulo" className="rounded-md border border-border p-4">
      <h3 id="lote-titulo" className="font-semibold">
        Lote: {codes.join(", ")}
      </h3>
      <p className="mb-2 text-sm text-text-muted">Mesma ação para todas as mesas, prévia consolidada e aplicação atômica: qualquer conflito sem decisão bloqueia o lote inteiro.</p>
      <PreviewForm
        action={assignAction}
        summary={assignSummary}
        confirmLabel="Confirmar lote"
        fields={(input, previewing) => (
          <>
            {resourceIds.map((id) => (
              <input key={id} type="hidden" name="resourceIds" value={id} />
            ))}
            <AssignFields input={input} directors={directors} groupId={groupId} mode="group" today={today} previewing={previewing} />
          </>
        )}
      />
    </section>
  );
}

export function ExclusivePanel({ assignment, directors, employees, today }: { assignment: AssignmentRow; directors: Director[]; employees: Director[]; today: string }) {
  const a = assignment;
  const isIndividual = a.mode === "individual";
  return (
    <div className="grid gap-6">
      {isIndividual ? (
        <section aria-labelledby="transferir-titulo">
          <h3 id="transferir-titulo" className="font-semibold">
            Transferir a outro titular
          </h3>
          <PreviewForm
            action={transferAction}
            hidden={{ assignmentId: a.id }}
            confirmLabel="Confirmar transferência"
            summary={(p) => (
              <p>
                Encerra a atribuição atual no dia anterior e cria a nova a partir de {fmt(String(p.startsOn))}. Reservas do novo titular em outras mesas nas mesmas datas: {Array.isArray(p.newHolderElsewhere) ? (p.newHolderElsewhere as unknown[]).length : 0} (informadas, não canceladas).
              </p>
            )}
            fields={(input, previewing) => (
              <>
                <Field id="newHolderEmployeeId" label="Novo titular">
                  <Select id="newHolderEmployeeId" name="newHolderEmployeeId" defaultValue={input.newHolderEmployeeId ?? ""} required disabled={previewing}>
                    <option value="">Escolha</option>
                    {directors
                      .filter((d) => d.id !== a.holderEmployeeId)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </Select>
                  {previewing ? <input type="hidden" name="newHolderEmployeeId" value={input.newHolderEmployeeId ?? ""} /> : null}
                </Field>
                <Field id="from" label="Data da transferência">
                  <Input id="from" name="from" type="date" defaultValue={input.from ?? today} required readOnly={previewing} />
                </Field>
                <Field id="t-reason" label="Motivo">
                  <Input id="t-reason" name="reason" required defaultValue={input.reason ?? ""} readOnly={previewing} />
                </Field>
                <Field id="t-responsible" label="Responsável">
                  <Input id="t-responsible" name="responsible" required defaultValue={input.responsible ?? ""} readOnly={previewing} />
                </Field>
              </>
            )}
          />
        </section>
      ) : null}
      <section aria-labelledby="encerrar-titulo">
        <h3 id="encerrar-titulo" className="font-semibold">
          Encerrar
        </h3>
        <p className="mb-2 text-sm text-text-muted">Grava só o término. A mesa volta ao conjunto compartilhado no dia seguinte; as reservas do titular continuam válidas como reservas comuns.</p>
        <SimpleForm action={endAssignmentAction} submitLabel="Encerrar atribuição" variant="secondary">
          <input type="hidden" name="assignmentId" value={a.id} />
          <Field id="e-validTo" label="Término (hoje ou futuro)">
            <Input id="e-validTo" name="validTo" type="date" defaultValue={today} required />
          </Field>
          <Field id="e-reason" label="Motivo">
            <Input id="e-reason" name="reason" required />
          </Field>
        </SimpleForm>
      </section>
      {a.state === "scheduled" ? (
        <section aria-labelledby="anular-titulo">
          <h3 id="anular-titulo" className="font-semibold">
            Anular (atribuição agendada, ainda não iniciada)
          </h3>
          <SimpleForm action={cancelAssignmentAction} submitLabel="Anular" variant="danger">
            <input type="hidden" name="assignmentId" value={a.id} />
            {a.transferredFromId ? (
              <Field id="successorDecision" label="Esta atribuição é sucessora de uma transferência. Decisão sobre a mesa">
                <Select id="successorDecision" name="successorDecision" defaultValue="" required>
                  <option value="">Escolha</option>
                  <option value="release">Liberar ao conjunto compartilhado a partir da data</option>
                  <option value="reopen">Reabrir para o titular anterior</option>
                </Select>
              </Field>
            ) : null}
            <Field id="c-reason" label="Motivo">
              <Input id="c-reason" name="reason" required />
            </Field>
          </SimpleForm>
        </section>
      ) : null}
      <section aria-labelledby="liberar-titulo">
        <h3 id="liberar-titulo" className="font-semibold">
          Liberar temporariamente
        </h3>
        <PreviewForm
          action={exceptionAction}
          hidden={{ assignmentId: a.id }}
          confirmLabel="Confirmar liberação"
          summary={(p) => (
            <p>
              {Number(p.days)} dia(s) liberado(s). {Array.isArray(p.periods) && (p.periods as unknown[]).length ? "Há manutenção ou bloqueio no período; continuam valendo." : "Sem manutenção ou bloqueio no período."} Na liberação ao conjunto compartilhado as reservas do titular continuam válidas; na liberação a pessoa específica, as reservas do titular no período entram no diálogo de conflito.
            </p>
          )}
          fields={(input, previewing) => (
            <>
              <Field id="kind" label="Tipo">
                <Select id="kind" name="kind" defaultValue={input.kind ?? "release_to_shared"} disabled={previewing}>
                  <option value="release_to_shared">Para o conjunto compartilhado</option>
                  <option value="release_to_employee">Para pessoa específica</option>
                </Select>
                {previewing ? <input type="hidden" name="kind" value={input.kind ?? "release_to_shared"} /> : null}
              </Field>
              <Field id="beneficiaryEmployeeId" label="Pessoa beneficiária (só para liberação nominal)">
                <Select id="beneficiaryEmployeeId" name="beneficiaryEmployeeId" defaultValue={input.beneficiaryEmployeeId ?? ""} disabled={previewing}>
                  <option value="">Nenhuma</option>
                  {employees.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
                {previewing ? <input type="hidden" name="beneficiaryEmployeeId" value={input.beneficiaryEmployeeId ?? ""} /> : null}
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="startsOn" label="Início">
                  <Input id="startsOn" name="startsOn" type="date" defaultValue={input.startsOn ?? today} required readOnly={previewing} />
                </Field>
                <Field id="endsOn" label="Fim (obrigatório)">
                  <Input id="endsOn" name="endsOn" type="date" defaultValue={input.endsOn ?? today} required readOnly={previewing} />
                </Field>
              </div>
              <Field id="x-reason" label="Motivo">
                <Input id="x-reason" name="reason" required defaultValue={input.reason ?? ""} readOnly={previewing} />
              </Field>
            </>
          )}
        />
      </section>
      {a.exceptions.filter((x) => !x.revokedAt).length ? (
        <section aria-labelledby="revogar-titulo">
          <h3 id="revogar-titulo" className="font-semibold">
            Liberações vigentes ou agendadas
          </h3>
          <ul className="grid gap-3">
            {a.exceptions
              .filter((x) => !x.revokedAt)
              .map((x) => (
                <li key={x.id} className="rounded-md border border-border p-3 text-sm">
                  {x.kind === "release_to_shared" ? "Ao conjunto compartilhado" : `Para ${x.beneficiaryName ?? "pessoa"}`}, de {fmt(x.startsOn)} a {fmt(x.endsOn)}: {x.reason}
                  <div className="mt-2">
                    <PreviewForm
                      action={revokeExceptionAction}
                      hidden={{ exceptionId: x.id }}
                      previewLabel="Revogar: ver impacto"
                      confirmLabel="Confirmar revogação"
                      fields={(input, previewing) => (
                        <Field id={`rv-${x.id}`} label="Motivo">
                          <Input id={`rv-${x.id}`} name="reason" required defaultValue={input.reason ?? ""} readOnly={previewing} />
                        </Field>
                      )}
                    />
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
      {isIndividual ? (
        <section aria-labelledby="revisar-titulo">
          <h3 id="revisar-titulo" className="font-semibold">
            Revisão do vínculo
          </h3>
          <p className="mb-2 text-sm text-text-muted">{a.needsReview ? "Em revisão: ninguém é elegível, nem por reserva em nome. A mesa permanece restrita até decisão do RH." : "Marcar para revisão restringe a mesa a todos até a decisão."}</p>
          <SimpleForm action={reviewAction} submitLabel={a.needsReview ? "Concluir revisão (manter vínculo)" : "Marcar para revisão"} variant="secondary">
            <input type="hidden" name="assignmentId" value={a.id} />
            <input type="hidden" name="needsReview" value={a.needsReview ? "no" : "yes"} />
            <Field id="r-reason" label="Nota">
              <Input id="r-reason" name="reason" required />
            </Field>
          </SimpleForm>
        </section>
      ) : null}
    </div>
  );
}

export function GroupPanel({ groupId, directors, members, today }: { groupId: string; directors: Director[]; members: Array<{ id: string; name: string; validFrom: string; validTo: string | null; state: string }>; today: string }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section aria-labelledby="add-membro">
        <h3 id="add-membro" className="font-semibold">
          Adicionar integrante
        </h3>
        <SimpleForm action={addMemberAction} submitLabel="Adicionar">
          <input type="hidden" name="groupId" value={groupId} />
          <Field id="m-employee" label="Pessoa (diretor ativo)">
            <Select id="m-employee" name="employeeId" defaultValue="" required>
              <option value="">Escolha</option>
              {directors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="m-from" label="Início da vigência">
            <Input id="m-from" name="validFrom" type="date" defaultValue={today} required />
          </Field>
          <Field id="m-reason" label="Motivo">
            <Input id="m-reason" name="reason" required />
          </Field>
        </SimpleForm>
      </section>
      <section aria-labelledby="rem-membro">
        <h3 id="rem-membro" className="font-semibold">
          Encerrar vigência de integrante
        </h3>
        {members.filter((m) => m.state !== "encerrado").length === 0 ? (
          <p className="text-sm text-text-muted">Nenhum integrante vigente ou agendado.</p>
        ) : (
          <ul className="grid gap-3">
            {members
              .filter((m) => m.state !== "encerrado")
              .map((m) => (
                <li key={m.id} className="rounded-md border border-border p-3 text-sm">
                  {m.name}: desde {fmt(m.validFrom)}
                  {m.validTo ? ` até ${fmt(m.validTo)}` : ""} ({m.state})
                  <div className="mt-2">
                    <PreviewForm
                      action={removeMemberAction}
                      hidden={{ memberId: m.id }}
                      previewLabel="Remover: ver impacto"
                      confirmLabel="Confirmar remoção"
                      fields={(input, previewing) => (
                        <>
                          <Field id={`rm-to-${m.id}`} label="Último dia no grupo">
                            <Input id={`rm-to-${m.id}`} name="validTo" type="date" defaultValue={input.validTo ?? today} required readOnly={previewing} />
                          </Field>
                          <Field id={`rm-reason-${m.id}`} label="Motivo">
                            <Input id={`rm-reason-${m.id}`} name="reason" required defaultValue={input.reason ?? ""} readOnly={previewing} />
                          </Field>
                        </>
                      )}
                    />
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
