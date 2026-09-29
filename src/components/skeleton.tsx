/** Esqueleto de carregamento anunciado para leitores de tela; sem animação sob movimento reduzido. */
export function Skeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Carregando…</span>
      <div aria-hidden="true" className="h-8 w-1/2 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
      <div aria-hidden="true" className="h-32 w-full animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
      <div aria-hidden="true" className="h-32 w-full animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
    </div>
  );
}
