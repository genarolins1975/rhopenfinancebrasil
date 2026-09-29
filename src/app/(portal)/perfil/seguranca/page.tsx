import { Alert, Card, PageHeader } from "@/components/ui";
import { requireCurrent } from "@/modules/identity/session";
import { ChangePasswordForm, SessionsForm, TwoFactorSetup } from "./security-forms";

export default async function SegurancaPage({ searchParams }: { searchParams: Promise<{ mfa?: string }> }) {
  const current = await requireCurrent();
  const sp = await searchParams;
  const mfaRequired = current.access.mfaRequired || sp.mfa === "obrigatorio";
  return (
    <>
      <PageHeader title="Segurança" lead="Senha, segundo fator e sessões ativas." />
      {mfaRequired && !current.user.twoFactorEnabled ? (
        <div className="mb-4">
          <Alert kind="warning" title="Segundo fator obrigatório para o seu perfil">
            Ative o aplicativo autenticador abaixo. Até lá, as permissões administrativas não valem.
          </Alert>
        </div>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Segundo fator">
          <TwoFactorSetup enabled={current.user.twoFactorEnabled} privileged={current.access.hasPrivilegedGrant} />
        </Card>
        <Card title="Trocar senha">
          <ChangePasswordForm />
        </Card>
        <Card title="Sessões">
          <p className="mb-3 text-sm text-text-muted">Encerre as outras sessões se usou um computador compartilhado.</p>
          <SessionsForm />
        </Card>
      </div>
    </>
  );
}
