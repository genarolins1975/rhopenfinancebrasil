import { Card } from "@/components/ui";
import { ResetForm } from "./reset-form";

export default async function RedefinirSenhaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <h1 className="text-2xl font-semibold">Nova senha</h1>
        <p className="mt-1 mb-4 text-sm text-text-muted">Ao salvar, todas as sessões anteriores serão encerradas.</p>
        <ResetForm token={token} />
      </Card>
    </div>
  );
}
