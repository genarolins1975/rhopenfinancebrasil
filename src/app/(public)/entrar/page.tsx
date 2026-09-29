import Link from "next/link";
import { Alert, Card } from "@/components/ui";
import { safeReturnPath } from "@/modules/identity/return-path";
import { SignInForm } from "./sign-in-form";

const AVISOS: Record<string, { kind: "success" | "info" | "warning"; text: string }> = {
  "senha-definida": { kind: "success", text: "Senha definida. Entre com seu email e a nova senha." },
  "senha-redefinida": { kind: "success", text: "Senha redefinida. Entre com a nova senha." },
  sessao: { kind: "info", text: "Sua sessão administrativa expirou. Entre de novo." },
  saida: { kind: "info", text: "Você saiu do portal." },
  "confirmar-email": { kind: "info", text: "Para concluir a troca de email, entre com sua senha atual e reabra o link recebido no novo endereço." },
};

export default async function EntrarPage({ searchParams }: { searchParams: Promise<{ aviso?: string; motivo?: string; volta?: string }> }) {
  const sp = await searchParams;
  const aviso = AVISOS[sp.aviso ?? sp.motivo ?? ""];
  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <h1 className="text-2xl font-semibold">Entrar</h1>
        <p className="mt-1 mb-4 text-sm text-text-muted">Use o email corporativo cadastrado pelo RH.</p>
        {aviso ? (
          <div className="mb-4">
            <Alert kind={aviso.kind}>{aviso.text}</Alert>
          </div>
        ) : null}
        {safeReturnPath(sp.volta) ? (
          <div className="mb-4">
            <Alert kind="info">Entre para confirmar o uso da mesa lida pelo QR.</Alert>
          </div>
        ) : null}
        <SignInForm volta={safeReturnPath(sp.volta)} />
        <p className="mt-4 text-sm">
          <Link href="/recuperar-senha" className="underline">
            Esqueci minha senha
          </Link>
        </p>
      </Card>
    </div>
  );
}
