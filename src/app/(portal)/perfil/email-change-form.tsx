"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { requestEmailChangeAction } from "@/modules/identity/actions";

export function EmailChangeForm() {
  return (
    <ActionForm action={requestEmailChangeAction}>
      {() => (
        <>
          <Field id="newEmail" label="Novo email corporativo">
            <Input id="newEmail" name="newEmail" type="email" required />
          </Field>
          <SubmitButton variant="secondary" pendingText="Enviando…">
            Pedir confirmação
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
