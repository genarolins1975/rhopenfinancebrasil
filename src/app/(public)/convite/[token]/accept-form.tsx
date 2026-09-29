"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { acceptInvitationAction } from "@/modules/identity/actions";

export function AcceptInviteForm({ token }: { token: string }) {
  return (
    <ActionForm action={acceptInvitationAction}>
      {(state) => (
        <>
          <input type="hidden" name="token" value={token} />
          <Field id="password" label="Nova senha" description="Pelo menos 15 caracteres. Uma frase longa e pessoal funciona bem; gerenciadores de senha são bem-vindos.">
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required aria-describedby="password-desc" aria-invalid={!!state.error} />
          </Field>
          <Field id="confirm" label="Repita a senha">
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton pendingText="Salvando…">Definir senha</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
