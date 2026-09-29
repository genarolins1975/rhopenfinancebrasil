import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Alert, Card, PageHeader } from "@/components/ui";
import { db } from "@/db/client";
import { ownBookingTodayOn } from "@/modules/checkin/service";
import { getResourceByCode } from "@/modules/workplace/service";
import { getCurrentResult } from "@/modules/identity/session";
import { formatLocal, formatLocalDate, localToday } from "@/modules/shared/dates";
import { ConfirmUseForm } from "../../operation-forms";

/*
 * Destino do QR impresso na mesa ou na sala. O QR só carrega o código do recurso; a reserva é resolvida no servidor
 * a partir da sessão. Nada sobre reservas de terceiros é exibido (CHK-02).
 */
export default async function QrPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Za-z0-9-]{2,12}$/.test(code)) notFound();
  const upper = code.toUpperCase();
  const r = await getCurrentResult();
  if (!r.current) redirect(`/entrar?volta=${encodeURIComponent(`/escritorio/qr/${upper}`)}`);
  const booking = await ownBookingTodayOn(db, r.current.employee.id, upper);
  const res = await getResourceByCode(db, upper);
  const kind = res?.type ?? "desk";
  return (
    <>
      <PageHeader title={`Confirmar uso de ${upper}`} lead={`Hoje, ${formatLocalDate(localToday())}.`} />
      <Card>
        {!booking ? (
          <>
            <Alert kind="info">Você não tem reserva confirmada em {upper} hoje.</Alert>
            <p className="mt-3 text-sm">
              <Link href={kind === "desk" ? `/escritorio/recursos/${upper}` : `/escritorio/salas?data=${localToday()}`} className="underline">
                {kind === "desk" ? `Ver a situação de ${upper}` : "Buscar sala ou cabine"}
              </Link>{" "}
              ou{" "}
              <Link href="/escritorio/minhas-reservas" className="underline">
                abrir Minhas reservas
              </Link>
              .
            </p>
          </>
        ) : booking.confirmedAt ? (
          <Alert kind="success">Uso de {upper} já confirmado hoje às {formatLocal(booking.confirmedAt, "HH:mm")}.</Alert>
        ) : (
          <>
            <p className="mb-3 text-sm">Sua reserva de hoje em {upper} está confirmada. Confirmar o uso é uma declaração sua. Não é registro de presença, ponto nem produtividade.</p>
            <ConfirmUseForm resourceCode={upper} method="qr" />
          </>
        )}
      </Card>
    </>
  );
}
