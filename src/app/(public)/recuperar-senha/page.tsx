import { Card } from "@/components/ui";
import { RecoverForm } from "./recover-form";

export default function RecuperarSenhaPage() {
  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <h1 className="text-2xl font-semibold">Recuperar senha</h1>
        <p className="mt-1 mb-4 text-sm text-text-muted">Informe o email corporativo. Se ele estiver cadastrado, você receberá um link válido por 60 minutos.</p>
        <RecoverForm />
      </Card>
    </div>
  );
}
