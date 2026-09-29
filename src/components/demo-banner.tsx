/** Ambiente de demonstração (DEC-45): aviso fixo em todas as telas; dados fictícios, nunca dados reais. */
export function DemoBanner() {
  if (process.env.APP_ENV !== "demo") return null;
  return (
    <div role="note" aria-label="Ambiente de demonstração" className="border-b border-warning/40 bg-warning-soft px-4 py-2 text-sm text-warning">
      <strong>Ambiente de demonstração.</strong> Pessoas, mesas e reservas são fictícias. Não informe dados reais, como CPF, nomes ou emails de colegas.
    </div>
  );
}
