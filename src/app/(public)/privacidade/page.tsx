import { Alert, Card } from "@/components/ui";

export default function PrivacidadePage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card>
        <h1 className="text-2xl font-semibold">Aviso de privacidade</h1>
        <div className="mt-4">
          <Alert kind="warning" title="Texto provisório">
            Este aviso será substituído pela versão aprovada pelo encarregado de proteção de dados e pelo jurídico antes do piloto.
          </Alert>
        </div>
        <div className="prose mt-4 max-w-none text-sm">
          <p>
            O Portal do Colaborador trata dados de cadastro, reservas, solicitações e pesquisas para operar o escritório e o atendimento
            interno da Associação Open Finance Brasil. O CPF fica cifrado, mascarado por padrão e é revelado apenas por pessoas autorizadas,
            com motivo registrado.
          </p>
          <p>Respostas de pesquisa nunca são conectadas a CPF, reservas ou histórico de utilização para avaliar pessoas.</p>
        </div>
      </Card>
    </div>
  );
}
