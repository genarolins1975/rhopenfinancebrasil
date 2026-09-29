"use client";

/** Falha do próprio layout raiz: página mínima, sem dependências de estilo. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "40rem", margin: "0 auto" }}>
        <h1>Algo deu errado</h1>
        <p>Tente de novo em instantes. Identificador: {error.digest ?? "indisponível"}.</p>
        <button type="button" onClick={() => reset()} style={{ padding: "0.5rem 1rem" }}>
          Tentar de novo
        </button>
      </body>
    </html>
  );
}
