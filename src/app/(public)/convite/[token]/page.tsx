import { Alert, Card } from "@/components/ui";
import { db } from "@/db/client";
import { lookupInvitation } from "@/modules/identity/invitations";
import { AcceptInviteForm } from "./accept-form";

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await lookupInvitation(db, token);
  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <h1 className="text-2xl font-semibold">Primeiro acesso</h1>
        {!found.ok ? (
          <div className="mt-4">
            <Alert kind="warning" title="Convite inválido">
              Este link não está mais disponível. Peça um novo convite ao RH.
            </Alert>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-text-muted">
              Olá, {found.name}. Este convite foi enviado para {found.emailMasked}. Defina sua senha para começar.
            </p>
            <div className="mt-4">
              <AcceptInviteForm token={token} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
