import Link from "next/link";
import { NavLinks } from "@/components/nav";
import { signOutAction } from "@/modules/identity/actions";
import { requireAdminArea } from "@/modules/identity/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const current = await requireAdminArea();
  const p = current.access.permissions;
  const items = [{ href: "/admin", label: "Visão geral" }];
  if (p.has("employee.manage") || p.has("employee.read.full")) items.push({ href: "/admin/colaboradores", label: "Colaboradores" });
  if (p.has("role.assign.standard") || p.has("role.assign.privileged") || p.has("audit.view")) items.push({ href: "/admin/acessos", label: "Acessos" });
  if (p.has("audit.view")) items.push({ href: "/admin/auditoria", label: "Auditoria" });
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="w-full shrink-0 border-b border-border bg-primary-strong text-white md:w-64 md:border-b-0 md:border-r">
        <div className="px-5 py-5">
          <p className="text-xs uppercase tracking-wide opacity-80">Ambiente administrativo</p>
          <Link href="/admin" className="font-semibold">
            Portal do Colaborador
          </Link>
        </div>
        <nav aria-label="Navegação administrativa" className="px-3 pb-4 [&_a]:text-white [&_a:hover]:bg-white/10 [&_a[aria-current=page]]:bg-white/20 [&_a[aria-current=page]]:text-white">
          <NavLinks items={items} />
        </nav>
        <div className="border-t border-white/20 px-5 py-4 text-sm">
          <p className="font-medium">{current.user.name}</p>
          <p className="opacity-80">{current.access.effectiveRoles.join(", ") || "sem perfil"}</p>
          <Link href="/inicio" className="mt-2 block underline">
            Voltar ao portal
          </Link>
          <form action={signOutAction} className="mt-1">
            <button type="submit" className="underline">
              Sair
            </button>
          </form>
        </div>
      </aside>
      <main id="conteudo" className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
