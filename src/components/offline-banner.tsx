"use client";

import { useEffect, useState } from "react";

/** Conexão perdida: aviso persistente, com texto, enquanto o navegador estiver sem rede. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="alert" className="border-b border-warning/40 bg-warning-soft px-4 py-2 text-sm text-warning">
      <span aria-hidden="true">! </span>Sem conexão. O que você digitar fica na tela; envie de novo quando a rede voltar.
    </div>
  );
}
