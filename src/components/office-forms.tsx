"use client";

import { useActionState, type ReactNode } from "react";
import { ActionMessages, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui";
import type { ActionState } from "@/modules/shared/action-state";
import { ConflictTable } from "./conflict-dialog";
import type { ConflictView } from "@/modules/office/decisions";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Input = Record<string, string>;

/**
 * Formulário em duas etapas: "Ver impacto" gera a prévia no servidor; "Confirmar" só existe dentro da prévia e
 * envia as decisões do diálogo de conflito. Os campos são reenviados com os valores preservados.
 */
export function PreviewForm({
  action,
  fields,
  summary,
  previewLabel = "Ver impacto",
  confirmLabel = "Confirmar",
  allowRealloc = true,
  hidden = {},
  alternatives,
}: {
  action: Action;
  fields: (input: Input, previewing: boolean) => ReactNode;
  summary?: (preview: Record<string, unknown>) => ReactNode;
  previewLabel?: string;
  confirmLabel?: string;
  allowRealloc?: boolean;
  hidden?: Record<string, string>;
  /** Opções excludentes do diálogo de conflito (DIR-016): iniciar após, escolher outra mesa, tratar reservas. */
  alternatives?: (preview: Record<string, unknown>) => ReactNode;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  const input = ((state.data?.input as Input | undefined) ?? {}) as Input;
  const preview = state.data?.preview as Record<string, unknown> | undefined;
  const conflicts = preview ? collectConflicts(preview) : [];
  const blockers = preview ? collectBlockers(preview) : [];
  if (state.ok) {
    return (
      <div role="status" className="rounded-md border border-success bg-success-soft p-3 text-sm">
        {state.message}
      </div>
    );
  }
  return (
    <form action={formAction} className="flex min-w-0 flex-col gap-3" noValidate>
      <ActionMessages state={state} />
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields(input, !!preview)}
      {preview ? (
        <section className="min-w-0 rounded-md border border-border bg-surface-muted p-3" aria-label="Prévia de impacto">
          <h3 className="font-semibold">Prévia de impacto</h3>
          {summary ? <div className="mt-1 text-sm">{summary(preview)}</div> : null}
          {blockers.length ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-danger" aria-label="Impedimentos">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
          {conflicts.length && alternatives ? <div className="mt-3">{alternatives(preview)}</div> : null}
          <div className="mt-3">
            <ConflictTable conflicts={conflicts} allowRealloc={allowRealloc && !preview.noRealloc} />
          </div>
          {blockers.length === 0 ? (
            <div className="mt-3 flex gap-2">
              {/* O passo de confirmação viaja no próprio botão: outros botões da prévia (iniciar após) refazem a prévia. */}
              <SubmitButton pendingText="Aplicando…" name="step" value="confirm">
                {confirmLabel}
              </SubmitButton>
            </div>
          ) : (
            <p className="mt-3 text-sm">Corrija os impedimentos e gere a prévia de novo.</p>
          )}
        </section>
      ) : (
        <div>
          <Button type="submit" variant="secondary" name="step" value="preview">
            {previewLabel}
          </Button>
        </div>
      )}
    </form>
  );
}

function collectConflicts(preview: Record<string, unknown>): ConflictView[] {
  if (Array.isArray(preview)) return preview.flatMap((p) => ((p as Record<string, unknown>).conflicts as ConflictView[]) ?? []);
  return (preview.conflicts as ConflictView[] | undefined) ?? [];
}

function collectBlockers(preview: Record<string, unknown>): string[] {
  if (Array.isArray(preview)) return preview.flatMap((p) => ((p as Record<string, unknown>).blockers as string[]) ?? []);
  return (preview.blockers as string[] | undefined) ?? [];
}

/** Formulário de um passo com mensagem de resultado. */
export function SimpleForm({ action, children, submitLabel, variant = "primary", pendingText = "Aplicando…" }: { action: Action; children: ReactNode; submitLabel: string; variant?: "primary" | "secondary" | "danger"; pendingText?: string }) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  if (state.ok) {
    return (
      <div role="status" className="rounded-md border border-success bg-success-soft p-3 text-sm">
        {state.message}
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <ActionMessages state={state} />
      {children}
      <div>
        <SubmitButton pendingText={pendingText} variant={variant}>
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
