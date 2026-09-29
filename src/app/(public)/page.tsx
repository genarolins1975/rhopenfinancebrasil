import { ButtonLink, Card } from "@/components/ui";

export default function EntradaPage() {
  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <h1 className="text-2xl font-semibold">Portal do Colaborador</h1>
        <p className="mt-2 text-text-muted">
          Planejamento da semana, reserva de lugares, ajuda e benefícios para quem trabalha na Associação Open Finance Brasil.
        </p>
        <p className="mt-2 text-sm text-text-muted">O acesso é individual e criado pelo RH. Não há cadastro público.</p>
        <div className="mt-6">
          <ButtonLink href="/entrar">Entrar</ButtonLink>
        </div>
      </Card>
    </div>
  );
}
