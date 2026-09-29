"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { signInAction } from "@/modules/identity/actions";

export function SignInForm({ volta }: { volta?: string | null }) {
  return (
    <ActionForm action={signInAction}>
      {(state) => (
        <>
          {volta ? <input type="hidden" name="volta" value={volta} /> : null}
          <Field id="email" label="Email corporativo">
            <Input id="email" name="email" type="email" autoComplete="username" required aria-invalid={!!state.error} defaultValue={typeof state.data?.email === "string" ? state.data.email : ""} />
          </Field>
          <Field id="password" label="Senha">
            <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!state.error} />
          </Field>
          <SubmitButton pendingText="Entrando…">Entrar</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
