"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Links de navegação com estado atual anunciado (aria-current), não só destacado por cor. */
export function NavLinks({ items, horizontal = false }: { items: Array<{ href: string; label: string }>; horizontal?: boolean }) {
  const pathname = usePathname();
  return (
    <ul className={horizontal ? "flex justify-around" : "flex flex-col gap-1"}>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href} className={horizontal ? "flex-1" : undefined}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={[
                "block rounded-md px-3 py-2 text-sm",
                horizontal ? "text-center" : "",
                active ? "bg-primary-soft font-semibold text-primary-strong" : "text-text hover:bg-surface-muted",
              ].join(" ")}
            >
              {active ? <span className="sr-only">Página atual: </span> : null}
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
