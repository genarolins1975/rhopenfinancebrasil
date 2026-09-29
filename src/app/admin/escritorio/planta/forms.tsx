"use client";

import { Field, Input, Select } from "@/components/ui";
import { SimpleForm } from "@/components/office-forms";
import { planApproveAction, planDraftAction, planPublishAction } from "@/modules/exclusivity/actions";

export function PlanForms({ versions, canEdit, canPublish }: { versions: Array<{ id: string; name: string; status: string }>; canEdit: boolean; canPublish: boolean }) {
  const drafts = versions.filter((v) => v.status === "draft");
  const approved = versions.filter((v) => v.status === "approved");
  return (
    <div className="grid gap-6">
      {canEdit ? (
        <section aria-labelledby="rascunho">
          <h3 id="rascunho" className="font-semibold">
            Criar rascunho a partir da extração da planta R00
          </h3>
          <p className="mb-2 text-sm text-text-muted">Cria zonas por bloco, 84 mesas, 4 cabines, 3 salas, a mesa aberta e 2 booths com ids provisórios. Recurso já existente não é duplicado.</p>
          <SimpleForm action={planDraftAction} submitLabel="Criar rascunho" variant="secondary">
            <Field id="plan-name" label="Nome da versão">
              <Input id="plan-name" name="name" defaultValue="Planta R00 (extração, não validada)" required />
            </Field>
          </SimpleForm>
        </section>
      ) : null}
      {canPublish ? (
        <>
          <section aria-labelledby="aprovar">
            <h3 id="aprovar" className="font-semibold">
              Aprovar rascunho
            </h3>
            {drafts.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhum rascunho.</p>
            ) : (
              <SimpleForm action={planApproveAction} submitLabel="Aprovar" variant="secondary">
                <Field id="approve-plan" label="Rascunho">
                  <Select id="approve-plan" name="planId" defaultValue={drafts[0].id}>
                    {drafts.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="approve-notes" label="Nota de aprovação (quem validou e o quê)">
                  <Input id="approve-notes" name="notes" required />
                </Field>
              </SimpleForm>
            )}
          </section>
          <section aria-labelledby="publicar">
            <h3 id="publicar" className="font-semibold">
              Publicar versão aprovada
            </h3>
            {approved.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhuma versão aprovada.</p>
            ) : (
              <SimpleForm action={planPublishAction} submitLabel="Publicar">
                <Field id="publish-plan" label="Versão aprovada">
                  <Select id="publish-plan" name="planId" defaultValue={approved[0].id}>
                    {approved.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </SimpleForm>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
