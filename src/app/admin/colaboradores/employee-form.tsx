"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, Select } from "@/components/ui";
import type { ActionState } from "@/modules/identity/actions";

type Option = { id: string; name: string };

export function EmployeeForm({
  action,
  areas,
  managers,
  initial,
  mode,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  areas: Option[];
  managers: Option[];
  initial?: { id: string; fullName: string; corporateEmail: string; areaId: string | null; jobTitle: string | null; managerEmployeeId: string | null; orgCondition: string; status: string };
  mode: "create" | "edit";
}) {
  const emailLocked = mode === "edit" && initial?.status !== "invited";
  return (
    <ActionForm action={action}>
      {(state) => {
        const kept = (state.data ?? {}) as Record<string, string | undefined>;
        const v = (key: keyof NonNullable<typeof initial> | "hireDate", fallback: string) => kept[key] ?? fallback;
        return (
        <>
          {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
          <Field id="fullName" label="Nome completo">
            <Input id="fullName" name="fullName" required minLength={3} defaultValue={v("fullName", initial?.fullName ?? "")} />
          </Field>
          <Field
            id="corporateEmail"
            label="Email corporativo"
            description={emailLocked ? "Pessoa com acesso definido troca o email pelo próprio perfil, com confirmação no endereço atual." : undefined}
          >
            <Input id="corporateEmail" name="corporateEmail" type="email" required defaultValue={v("corporateEmail", initial?.corporateEmail ?? "")} readOnly={emailLocked} aria-describedby={emailLocked ? "corporateEmail-desc" : undefined} />
          </Field>
          {mode === "create" ? (
            <Field id="cpf" label="CPF" description="Onze dígitos. É verificado o formato, não a identidade. Fica cifrado e mascarado.">
              <Input id="cpf" name="cpf" inputMode="numeric" autoComplete="off" required aria-describedby="cpf-desc" />
            </Field>
          ) : null}
          <Field id="areaId" label="Área">
            <Select id="areaId" name="areaId" defaultValue={v("areaId", initial?.areaId ?? "")}>
              <option value="">Não informada</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="jobTitle" label="Cargo">
            <Input id="jobTitle" name="jobTitle" defaultValue={v("jobTitle", initial?.jobTitle ?? "")} />
          </Field>
          <Field id="managerEmployeeId" label="Gestor">
            <Select id="managerEmployeeId" name="managerEmployeeId" defaultValue={v("managerEmployeeId", initial?.managerEmployeeId ?? "")}>
              <option value="">Não informado</option>
              {managers
                .filter((m) => m.id !== initial?.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field id="orgCondition" label="Condição organizacional" description="Diretor é condição organizacional, não perfil de sistema.">
            <Select id="orgCondition" name="orgCondition" defaultValue={v("orgCondition", initial?.orgCondition ?? "standard")} aria-describedby="orgCondition-desc">
              <option value="standard">Colaborador</option>
              <option value="director">Diretor</option>
            </Select>
          </Field>
          {mode === "create" ? (
            <>
              <Field id="hireDate" label="Data de admissão">
                <Input id="hireDate" name="hireDate" type="date" required defaultValue={v("hireDate", "")} />
              </Field>
              <div className="flex items-center gap-2">
                <input id="sendInvitation" name="sendInvitation" type="checkbox" value="yes" defaultChecked className="h-4 w-4" />
                <label htmlFor="sendInvitation" className="text-sm">
                  Enviar convite de primeiro acesso agora
                </label>
              </div>
            </>
          ) : (
            <Field id="reason" label="Motivo da alteração">
              <Input id="reason" name="reason" />
            </Field>
          )}
          <SubmitButton pendingText="Salvando…">{mode === "create" ? "Cadastrar" : "Salvar alterações"}</SubmitButton>
        </>
        );
      }}
    </ActionForm>
  );
}
