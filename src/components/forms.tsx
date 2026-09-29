"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/modules/shared/action-state";
import { Alert, Button } from "./ui";

/** Botão que reflete o envio em andamento, com texto e atributo, não só cor. */
export function SubmitButton({ children, pendingText = "Enviando…", variant, name, value }: { children: React.ReactNode; pendingText?: string; variant?: "primary" | "secondary" | "danger" | "ghost"; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} variant={variant} name={name} value={value}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function ActionMessages({ state }: { state: ActionState }) {
  return (
    <div aria-live="polite">
      {state.error ? <Alert kind="danger">{state.error}</Alert> : null}
      {state.ok && state.message ? <Alert kind="success">{state.message}</Alert> : null}
    </div>
  );
}

/**
 * Formulário ligado a uma server action com estado. Conserva os campos em erro
 * e anuncia mensagens para leitores de tela.
 */
export function ActionForm({
  action,
  children,
  className,
  initial = {},
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: (state: ActionState) => React.ReactNode;
  className?: string;
  initial?: ActionState;
}) {
  const [state, formAction] = useActionState(action, initial);
  return (
    <form action={formAction} className={className ?? "flex flex-col gap-4"} noValidate>
      <ActionMessages state={state} />
      {children(state)}
    </form>
  );
}
