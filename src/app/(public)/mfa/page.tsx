import { Card } from "@/components/ui";
import { TotpForm } from "./totp-form";

export default function MfaPage() {
  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <h1 className="text-2xl font-semibold">Segundo fator</h1>
        <p className="mt-1 mb-4 text-sm text-text-muted">Digite o código do seu aplicativo autenticador ou um código de recuperação.</p>
        <TotpForm />
      </Card>
    </div>
  );
}
