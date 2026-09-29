import Link from "next/link";
import { canEnterAdminArea } from "@/modules/access/can";
import { signOutAction } from "@/modules/identity/actions";
import { requireCurrent } from "@/modules/identity/session";
import { NavLinks } from "@/components/nav";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const current = await requireCurrent();
  const admin = canEnterAdminArea(current.access) || current.access.mfaRequired;
  const items = [
    { href: "/inicio", label: "Início" },
    { href: "/perfil", label: "Perfil" },
  ];
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface md:flex md:flex-col">
        <div className="px-5 py-5">
          <Link href="/inicio" className="font-semibold text-primary">
            Portal do Colaborador
          </Link>
        </div>
        <nav aria-label="Navegação principal" className="flex-1 px-3">
          <NavLinks items={items} />
        </nav>
        <div className="border-t border-border px-5 py-4 text-sm">
          <p className="font-medium">{current.user.name}</p>
          {admin ? (
            <Link href="/admin" className="mt-1 block underline">
              Ambiente administrativo
            </Link>
          ) : null}
          <form action={signOutAction} className="mt-2">
            <button type="submit" className="underline">
              Sair
            </button>
          </form>
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
          <Link href="/inicio" className="font-semibold text-primary">
            Portal do Colaborador
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="text-sm underline">
              Sair
            </button>
          </form>
        </header>
        <main id="conteudo" className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 py-6 pb-24 md:pb-6">
          {children}
        </main>
        <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 border-t border-border bg-surface md:hidden">
          <NavLinks items={items} horizontal />
        </nav>
      </div>
    </div>
  );
}
