"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { requestPasswordResetAction } from "@/modules/identity/actions";

export function RecoverForm() {
  return (
    <ActionForm action={requestPasswordResetAction}>
      {(state) =>
        state.ok ? null : (
          <>
            <Field id="email" label="Email corporativo">
              <Input id="email" name="email" type="email" autoComplete="username" required />
            </Field>
            <SubmitButton pendingText="Enviando…">Enviar instruções</SubmitButton>
          </>
        )
      }
    </ActionForm>
  );
}
