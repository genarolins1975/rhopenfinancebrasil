"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button, Field, Input } from "@/components/ui";
import { verifyTotpAction } from "@/modules/identity/actions";

export function TotpForm() {
  const [kind, setKind] = useState<"totp" | "backup">("totp");
  return (
    <ActionForm action={verifyTotpAction}>
      {(state) => (
        <>
          <input type="hidden" name="kind" value={kind} />
          <Field id="code" label={kind === "totp" ? "Código de 6 dígitos" : "Código de recuperação"}>
            <Input id="code" name="code" inputMode={kind === "totp" ? "numeric" : "text"} autoComplete="one-time-code" required aria-invalid={!!state.error} />
          </Field>
          <SubmitButton pendingText="Verificando…">Confirmar</SubmitButton>
          <Button type="button" variant="ghost" onClick={() => setKind(kind === "totp" ? "backup" : "totp")}>
            {kind === "totp" ? "Usar código de recuperação" : "Usar aplicativo autenticador"}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
