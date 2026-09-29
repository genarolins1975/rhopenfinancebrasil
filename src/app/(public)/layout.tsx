import Link from "next/link";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/" className="font-semibold text-primary">
            Portal do Colaborador
          </Link>
          <span className="text-sm text-text-muted">Associação Open Finance Brasil</span>
        </div>
      </header>
      <main id="conteudo" className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10">
        {children}
      </main>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-4 px-4 py-4 text-sm text-text-muted">
          <Link href="/privacidade" className="underline">
            Aviso de privacidade
          </Link>
          <span>Acesso restrito a colaboradores cadastrados.</span>
        </div>
      </footer>
    </div>
  );
}
