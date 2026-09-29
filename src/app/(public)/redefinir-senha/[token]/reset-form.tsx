"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { resetPasswordAction } from "@/modules/identity/actions";

export function ResetForm({ token }: { token: string }) {
  return (
    <ActionForm action={resetPasswordAction}>
      {(state) => (
        <>
          <input type="hidden" name="token" value={token} />
          <Field id="password" label="Nova senha" description="Pelo menos 15 caracteres, sem exigência de símbolos.">
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required aria-invalid={!!state.error} />
          </Field>
          <Field id="confirm" label="Repita a senha">
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton pendingText="Salvando…">Salvar nova senha</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
