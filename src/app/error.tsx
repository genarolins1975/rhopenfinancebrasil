"use client";

import { Alert, Button, ButtonLink } from "@/components/ui";

/** Erro inesperado: mensagem sem detalhes técnicos, com identificador para o suporte. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="conteudo" className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">Algo deu errado</h1>
      <div className="mt-4">
        <Alert kind="danger" title="Não foi possível concluir">
          Tente de novo em instantes. Se o problema continuar, informe ao RH o identificador {error.digest ? <span className="font-mono">{error.digest}</span> : "desta página"}.
        </Alert>
      </div>
      <div className="mt-4 flex gap-2">
        <Button type="button" onClick={() => reset()}>
          Tentar de novo
        </Button>
        <ButtonLink href="/inicio" variant="secondary">
          Ir para o início
        </ButtonLink>
      </div>
    </main>
  );
}
