import type { Metadata } from "next";
import { DemoBanner } from "@/components/demo-banner";
import { OfflineBanner } from "@/components/offline-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Portal do Colaborador", template: "%s · Portal do Colaborador" },
  description: "Portal do Colaborador da Associação Open Finance Brasil",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full flex flex-col bg-bg text-text">
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
        >
          Ir para o conteúdo
        </a>
        <DemoBanner />
        <OfflineBanner />
        {children}
      </body>
    </html>
  );
}
