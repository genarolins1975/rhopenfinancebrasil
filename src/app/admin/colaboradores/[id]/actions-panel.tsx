"use client";

import { useActionState, useRef, useState } from "react";
import { ActionForm, ActionMessages, SubmitButton } from "@/components/forms";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { grantPermissionAction, grantRoleAction, revokePermissionAction, revokeRoleAction } from "@/modules/access/actions";
import { PERMISSIONS, PRIVILEGED_ROLES, ROLES, isSensitivePermission } from "@/modules/access/permissions";
import {
  deactivateEmployeeAction,
  readmitEmployeeAction,
  reactivateEmployeeAction,
  resendInvitationAction,
  revealCpfAction,
  revokeInvitationAction,
  suspendEmployeeAction,
} from "@/modules/employees/actions";
import type { ActionState } from "@/modules/identity/actions";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Ação com prévia, motivo e confirmação em diálogo nativo, acessível por teclado. */
function ConfirmAction({
  id,
  label,
  title,
  preview,
  action,
  needsReason = true,
  extra,
  variant = "secondary",
}: {
  id: string;
  label: string;
  title: string;
  preview: string;
  action: Action;
  needsReason?: boolean;
  extra?: React.ReactNode;
  variant?: "secondary" | "danger" | "primary";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) ref.current?.close();
    return r;
  }, {} as ActionState);
  return (
    <div>
      <Button type="button" variant={variant} className="w-full" onClick={() => ref.current?.showModal()}>
        {label}
      </Button>
      <dialog ref={ref} className="w-full max-w-md rounded-md border border-border bg-surface p-5 shadow-lg backdrop:bg-black/40" aria-labelledby={`${label}-title`}>
        <form action={formAction} className="flex flex-col gap-4">
          <h2 id={`${label}-title`} className="text-lg font-semibold">
            {title}
          </h2>
          <p className="text-sm text-text-muted">{preview}</p>
          <ActionMessages state={state} />
          <input type="hidden" name="id" value={id} />
          {extra}
          {needsReason ? (
            <Field id={`${label}-reason`} label="Motivo (registrado na auditoria)">
              <Textarea id={`${label}-reason`} name="reason" required minLength={3} />
            </Field>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => ref.current?.close()}>
              Cancelar
            </Button>
            <SubmitButton pendingText="Aplicando…" variant={variant === "danger" ? "danger" : "primary"}>
              Confirmar
            </SubmitButton>
          </div>
        </form>
      </dialog>
      {state.ok && state.message ? (
        <p className="mt-2 text-sm text-success" role="status">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

export function EmployeeActions({ id, status, name }: { id: string; status: string; name: string }) {
  return (
    <div className="flex flex-col gap-3">
      {status === "invited" ? (
        <>
          <ConfirmAction id={id} label="Reenviar convite" title="Reenviar convite" preview={`Um novo convite será enviado a ${name}. O convite anterior deixa de valer.`} action={resendInvitationAction} needsReason={false} />
          <ConfirmAction id={id} label="Revogar convite" title="Revogar convite" preview="Os convites válidos deixam de funcionar. A pessoa continua cadastrada como convidada." action={revokeInvitationAction} needsReason={false} />
        </>
      ) : null}
      {status === "active" ? (
        <ConfirmAction id={id} label="Suspender" title="Suspender acesso" preview={`${name} perde o acesso imediatamente. Cadastro, perfis e reservas ficam como estão.`} action={suspendEmployeeAction} />
      ) : null}
      {status === "suspended" ? <ConfirmAction id={id} label="Reativar" title="Reativar acesso" preview={`${name} volta a entrar no portal.`} action={reactivateEmployeeAction} /> : null}
      {status === "active" || status === "suspended" || status === "invited" ? (
        <ConfirmAction
          id={id}
          label="Desativar"
          title="Desativar pessoa"
          variant="danger"
          preview={`${name} perde o acesso, os convites são invalidados e todos os perfis e permissões são encerrados. O histórico é preservado.`}
          action={deactivateEmployeeAction}
          extra={
            <Field id="exitDate" label="Data de saída">
              <Input id="exitDate" name="exitDate" type="date" />
            </Field>
          }
        />
      ) : null}
      {status === "deactivated" ? (
        <ConfirmAction
          id={id}
          label="Readmitir"
          title="Readmitir pessoa"
          preview={`${name} recebe um novo convite, com senha e segundo fator zerados. Perfis antigos continuam encerrados.`}
          action={readmitEmployeeAction}
          extra={
            <Field id="hireDate" label="Nova data de admissão">
              <Input id="hireDate" name="hireDate" type="date" required />
            </Field>
          }
        />
      ) : null}
    </div>
  );
}

export function RevealCpf({ id, masked, canReveal }: { id: string; masked: string; canReveal: boolean }) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await revealCpfAction(prev, fd);
    if (r.ok && r.data) {
      setRevealed(String(r.data.cpf));
      ref.current?.close();
    }
    return r;
  }, {} as ActionState);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono">{revealed ?? masked}</span>
      {canReveal && !revealed ? (
        <>
          <Button type="button" variant="ghost" className="min-h-8 px-2 py-1 text-xs" onClick={() => ref.current?.showModal()}>
            Revelar
          </Button>
          <dialog ref={ref} className="w-full max-w-md rounded-md border border-border bg-surface p-5 shadow-lg backdrop:bg-black/40" aria-labelledby="reveal-title">
            <form action={formAction} className="flex flex-col gap-4">
              <h2 id="reveal-title" className="text-lg font-semibold">
                Revelar CPF
              </h2>
              <p className="text-sm text-text-muted">A consulta fica registrada na auditoria com seu nome e o motivo.</p>
              <ActionMessages state={state} />
              <input type="hidden" name="id" value={id} />
              <Field id="reveal-reason" label="Motivo">
                <Textarea id="reveal-reason" name="reason" required minLength={5} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => ref.current?.close()}>
                  Cancelar
                </Button>
                <SubmitButton pendingText="Consultando…">Revelar</SubmitButton>
              </div>
            </form>
          </dialog>
        </>
      ) : null}
    </span>
  );
}

export function GrantForms({ id, roles, permissions, canPrivileged }: { id: string; roles: string[]; permissions: string[]; canPrivileged: boolean }) {
  const roleOptions = (Object.keys(ROLES) as Array<keyof typeof ROLES>).filter((r) => canPrivileged || !PRIVILEGED_ROLES.includes(r));
  const permOptions = (Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>).filter((p) => canPrivileged || !isSensitivePermission(p));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ActionForm action={grantRoleAction} className="flex flex-col gap-3 rounded-md border border-border p-3">
        {() => (
          <>
            <input type="hidden" name="id" value={id} />
            <Field id="grant-role" label="Conceder perfil">
              <Select id="grant-role" name="role" required>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ROLES[r].name} ({r})
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="grant-role-validTo" label="Válido até (opcional)">
              <Input id="grant-role-validTo" name="validTo" type="date" />
            </Field>
            <Field id="grant-role-reason" label="Motivo">
              <Input id="grant-role-reason" name="reason" required />
            </Field>
            <SubmitButton variant="secondary" pendingText="Concedendo…">
              Conceder perfil
            </SubmitButton>
          </>
        )}
      </ActionForm>
      <ActionForm action={grantPermissionAction} className="flex flex-col gap-3 rounded-md border border-border p-3">
        {() => (
          <>
            <input type="hidden" name="id" value={id} />
            <Field id="grant-perm" label="Conceder permissão">
              <Select id="grant-perm" name="permission" required>
                {permOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="grant-perm-validTo" label="Válido até (opcional)">
              <Input id="grant-perm-validTo" name="validTo" type="date" />
            </Field>
            <Field id="grant-perm-reason" label="Motivo">
              <Input id="grant-perm-reason" name="reason" required />
            </Field>
            <SubmitButton variant="secondary" pendingText="Concedendo…">
              Conceder permissão
            </SubmitButton>
          </>
        )}
      </ActionForm>
      {roles.length > 0 ? (
        <ActionForm action={revokeRoleAction} className="flex flex-col gap-3 rounded-md border border-border p-3">
          {() => (
            <>
              <input type="hidden" name="id" value={id} />
              <Field id="revoke-role" label="Revogar perfil">
                <Select id="revoke-role" name="role" required>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="revoke-role-reason" label="Motivo">
                <Input id="revoke-role-reason" name="reason" required />
              </Field>
              <SubmitButton variant="danger" pendingText="Revogando…">
                Revogar perfil
              </SubmitButton>
            </>
          )}
        </ActionForm>
      ) : null}
      {permissions.length > 0 ? (
        <ActionForm action={revokePermissionAction} className="flex flex-col gap-3 rounded-md border border-border p-3">
          {() => (
            <>
              <input type="hidden" name="id" value={id} />
              <Field id="revoke-perm" label="Revogar permissão">
                <Select id="revoke-perm" name="permission" required>
                  {permissions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="revoke-perm-reason" label="Motivo">
                <Input id="revoke-perm-reason" name="reason" required />
              </Field>
              <SubmitButton variant="danger" pendingText="Revogando…">
                Revogar permissão
              </SubmitButton>
            </>
          )}
        </ActionForm>
      ) : null}
    </div>
  );
}
