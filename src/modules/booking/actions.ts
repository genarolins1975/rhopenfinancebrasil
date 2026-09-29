"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { actorOf, requireCurrent } from "@/modules/identity/session";
import { unexpected, type ActionState } from "@/modules/shared/action-state";
import { bookDesk, cancelDesk, planWeek, type WeekDayInput } from "./service";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Reserva própria a partir do mapa, da lista ou do detalhe. A chave de idempotência vem do formulário. */
export async function bookDeskAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  const date = str(fd, "date");
  const back = str(fd, "back") || `/escritorio?data=${date}`;
  try {
    const r = await bookDesk(db, actor, { employeeId: current.employee.id, resourceId: str(fd, "resourceId"), date, idempotencyKey: str(fd, "idempotencyKey") });
    revalidatePath("/escritorio");
    revalidatePath("/inicio");
    // PAR-06 ativa: quem reserva para hoje antes do limite fica sabendo do prazo no ato (segunda revisão, ID-10).
    const { pendingUseConfirmation } = await import("@/modules/checkin/service");
    const { localToday } = await import("@/modules/shared/dates");
    const deadline = r.created && date === localToday() ? await pendingUseConfirmation(db, current.employee.id) : null;
    const note = deadline ? ` Confirme o uso até ${deadline}; sem confirmação, a mesa é liberada para outra pessoa.` : "";
    return { ok: true, message: `Mesa ${r.resourceCode} reservada para ${date.split("-").reverse().join("/")}.${note}`, data: { bookingId: r.bookingId, back } };
  } catch (e) {
    return unexpected(e, "reservar mesa", actor.requestId);
  }
}

export async function cancelDeskAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  try {
    // A tela envia a situação que mostrou; sem ela (página antiga ou outro cliente), a decisão pode valer para outra coisa.
    const status = str(fd, "status");
    if (status !== "held" && status !== "confirmed") return { error: "A tela está desatualizada. Atualize a página e tente de novo." };
    const r = await cancelDesk(db, actor, str(fd, "bookingId"), { reason: str(fd, "reason") || undefined, message: str(fd, "message") || undefined, expectedStatus: status });
    revalidatePath("/escritorio");
    revalidatePath("/escritorio/minhas-reservas");
    revalidatePath("/admin/reservas");
    const when = r.date.split("-").reverse().join("/");
    if (r.kind === "withdrawn") return { ok: true, message: `Oferta da mesa ${r.resourceCode} em ${when} retirada. A pessoa continua na fila, na mesma posição, e foi avisada; esta mesa não volta a ser oferecida a ela nesta data.` };
    if (r.kind === "declined") return { ok: true, message: `Oferta da mesa ${r.resourceCode} em ${when} recusada. Você saiu da fila dessa data.` };
    return { ok: true, message: `Reserva da mesa ${r.resourceCode} em ${when} cancelada. A política de uso da mesa não muda com isso.` };
  } catch (e) {
    return unexpected(e, "cancelar reserva", actor.requestId);
  }
}

/** Reserva em nome de outra pessoa (DIR-011): permissão própria, confirmação no formulário, ator registrado no serviço. */
export async function bookOnBehalfAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  if (str(fd, "confirm") !== "sim") return { error: "Confirme que a pessoa está ciente da reserva em nome dela." };
  try {
    const r = await bookDesk(db, actor, { employeeId: str(fd, "employeeId"), resourceId: str(fd, "resourceId"), date: str(fd, "date"), idempotencyKey: str(fd, "idempotencyKey") });
    revalidatePath("/admin/reservas");
    return { ok: true, message: `Mesa ${r.resourceCode} reservada em nome da pessoa. Ela foi notificada.` };
  } catch (e) {
    return unexpected(e, "reservar em nome", actor.requestId);
  }
}

/** Planejar a semana: intenção por dia e mesa opcional; atômica; repetição da chave não duplica. */
export async function planWeekAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  const dates = fd.getAll("dates").filter((v): v is string => typeof v === "string");
  const days: WeekDayInput[] = dates.map((date) => {
    const intent = (str(fd, `intent:${date}`) || "not_informed") as WeekDayInput["intent"];
    const resourceId = str(fd, `desk:${date}`) || null;
    return { date, intent, resourceId: intent === "onsite" ? resourceId : null };
  });
  try {
    const r = await planWeek(db, actor, { idempotencyKey: str(fd, "idempotencyKey"), days });
    if (!r.ok) {
      return {
        error: `Não foi possível confirmar a semana. ${r.conflicts.length} dia(s) com impedimento; nada foi gravado. Ajuste a seleção e confirme de novo.`,
        data: { conflicts: r.conflicts, idempotencyKey: crypto.randomUUID() },
      };
    }
    revalidatePath("/inicio");
    revalidatePath("/escritorio");
  } catch (e) {
    return unexpected(e, "planejar semana", actor.requestId);
  }
  redirect("/inicio?aviso=semana-planejada");
}
