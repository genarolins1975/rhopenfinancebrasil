"use client";

import { useActionState, useState } from "react";
import { ActionMessages, SubmitButton } from "@/components/forms";
import { Alert, Button, Field, Table, td, th } from "@/components/ui";
import { applyImportAction, discardImportAction, previewImportAction } from "@/modules/employees/actions";
import type { ActionState } from "@/modules/identity/actions";

type Row = { line: number; status: "ok" | "erro" | "duplicado"; messages: string[]; display: Record<string, string> };
type Preview = { batchId: string; expiresAt: string; summary: { total: number; ok: number; erro: number; duplicado: number }; rows: Row[]; warnings: string[] };

export function ImportWizard() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewState, previewAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await previewImportAction(prev, fd);
    if (r.ok && r.data) setPreview(r.data as unknown as Preview);
    return r;
  }, {} as ActionState);
  const [applyState, applyAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await applyImportAction(prev, fd);
    if (r.ok) setPreview(null);
    return r;
  }, {} as ActionState);
  const [discardState, discardAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await discardImportAction(prev, fd);
    if (r.ok) setPreview(null);
    return r;
  }, {} as ActionState);

  if (!preview) {
    return (
      <div className="flex flex-col gap-4">
        <ActionMessages state={applyState} />
        <ActionMessages state={discardState} />
        <p className="text-sm">
          1.{" "}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- download servido por route handler */}
          <a href="/admin/colaboradores/importar/modelo" className="underline">
            Baixe o modelo CSV
          </a>{" "}
          e preencha uma linha por pessoa. Colunas de perfil são ignoradas: perfis são concedidos em Acessos.
        </p>
        <form action={previewAction} className="flex flex-col gap-4" encType="multipart/form-data">
          <ActionMessages state={previewState} />
          <Field id="file" label="2. Arquivo CSV (até 2 MB, até 1000 linhas)">
            <input id="file" name="file" type="file" accept=".csv,text/csv" required className="block text-sm" />
          </Field>
          <SubmitButton pendingText="Validando…">Gerar prévia</SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ActionMessages state={applyState} />
      {preview.warnings.map((w) => (
        <Alert key={w} kind="warning">
          {w}
        </Alert>
      ))}
      <p className="text-sm">
        {preview.summary.total} linha(s): <strong>{preview.summary.ok} prontas</strong>, {preview.summary.erro} com erro, {preview.summary.duplicado} em conflito. Só as linhas prontas
        são importadas; as demais ficam de fora sem impedir o lote.
      </p>
      <Table caption="Prévia da importação">
        <thead>
          <tr>
            <th className={th}>Linha</th>
            <th className={th}>Resultado</th>
            <th className={th}>Nome</th>
            <th className={th}>Email</th>
            <th className={th}>CPF</th>
            <th className={th}>Área</th>
            <th className={th}>Admissão</th>
            <th className={th}>Observações</th>
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((r) => (
            <tr key={r.line}>
              <td className={td}>{r.line}</td>
              <td className={td}>{r.status === "ok" ? "pronta" : r.status === "erro" ? "erro" : "conflito"}</td>
              <td className={td}>{r.display.nome}</td>
              <td className={td}>{r.display.email}</td>
              <td className={td}>
                <span className="font-mono">{r.display.cpf}</span>
              </td>
              <td className={td}>{r.display.area}</td>
              <td className={td}>{r.display.dataAdmissao}</td>
              <td className={td}>{r.messages.join("; ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="flex flex-wrap gap-2">
        <form action={applyAction}>
          <input type="hidden" name="batchId" value={preview.batchId} />
          <SubmitButton pendingText="Importando…">Confirmar importação de {preview.summary.ok} pessoa(s)</SubmitButton>
        </form>
        <form action={discardAction}>
          <input type="hidden" name="batchId" value={preview.batchId} />
          <Button type="submit" variant="ghost">
            Descartar prévia
          </Button>
        </form>
      </div>
    </div>
  );
}
