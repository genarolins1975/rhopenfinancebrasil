"use client";

import { useActionState, useState } from "react";
import { ActionForm, ActionMessages, SubmitButton } from "@/components/forms";
import { Button, Field, Input } from "@/components/ui";
import { changePasswordAction, confirmTwoFactorAction, enableTwoFactorAction, revokeOtherSessionsAction, type ActionState } from "@/modules/identity/actions";

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction}>
      {() => (
        <>
          <Field id="currentPassword" label="Senha atual">
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <Field id="password" label="Nova senha" description="Pelo menos 15 caracteres.">
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required />
          </Field>
          <Field id="confirm" label="Repita a nova senha">
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton pendingText="Salvando…">Trocar senha</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function SessionsForm() {
  const [state, action] = useActionState(async () => revokeOtherSessionsAction(), {} as ActionState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <ActionMessages state={state} />
      <SubmitButton variant="secondary" pendingText="Encerrando…">
        Encerrar outras sessões
      </SubmitButton>
    </form>
  );
}

export function TwoFactorSetup({ enabled, privileged }: { enabled: boolean; privileged: boolean }) {
  const [setup, setSetup] = useState<{ svg: string; backupCodes: string[] } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [enableState, enableAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await enableTwoFactorAction(prev, fd);
    if (r.ok && r.data) setSetup(r.data as { svg: string; backupCodes: string[] });
    return r;
  }, {} as ActionState);
  const [confirmState, confirmAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await confirmTwoFactorAction(prev, fd);
    if (r.ok) setConfirmed(true);
    return r;
  }, {} as ActionState);

  if (enabled || confirmed) {
    return (
      <div className="text-sm">
        <p>
          <span aria-hidden="true">✓ </span>Segundo fator ativo com aplicativo autenticador.
        </p>
        {privileged ? <p className="mt-2 text-text-muted">Perfis administrativos não podem desativar o segundo fator.</p> : null}
      </div>
    );
  }

  if (!setup) {
    return (
      <form action={enableAction} className="flex flex-col gap-4">
        <ActionMessages state={enableState} />
        <p className="text-sm text-text-muted">Confirme sua senha para gerar o código do aplicativo autenticador.</p>
        <Field id="password2fa" label="Senha atual">
          <Input id="password2fa" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton pendingText="Gerando…">Ativar segundo fator</SubmitButton>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">1. Leia o código no aplicativo autenticador.</p>
      <div className="w-fit rounded-md border border-border bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.svg }} aria-label="Código QR para o aplicativo autenticador" role="img" />
      <p className="text-sm">2. Guarde os códigos de recuperação em local seguro. Cada um vale uma vez.</p>
      <ul className="grid grid-cols-2 gap-1 rounded-md bg-surface-muted p-3 font-mono text-sm">
        {setup.backupCodes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <form action={confirmAction} className="flex flex-col gap-3">
        <ActionMessages state={confirmState} />
        <Field id="code" label="3. Digite o código de 6 dígitos para confirmar">
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
        </Field>
        <SubmitButton pendingText="Confirmando…">Confirmar ativação</SubmitButton>
        <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
          Cancelar
        </Button>
      </form>
    </div>
  );
}
