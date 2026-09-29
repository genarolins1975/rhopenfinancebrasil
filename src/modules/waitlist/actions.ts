"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { actorOf, requireCurrent } from "@/modules/identity/session";
import { unexpected, type ActionState } from "@/modules/shared/action-state";
import { formatLocal, formatLocalDate } from "@/modules/shared/dates";
import { acceptOffer, declineOffer, joinWaitlist, leaveWaitlist, offerManually } from "./service";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function refresh() {
  revalidatePath("/escritorio");
  revalidatePath("/escritorio/minhas-reservas");
  revalidatePath("/inicio");
  revalidatePath("/admin/reservas");
  revalidatePath("/admin");
}

export async function joinWaitlistAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  try {
    const r = await joinWaitlist(db, actor, { date: str(fd, "date"), preferences: { zoneCode: str(fd, "zoneCode") || null } });
    refresh();
    return { ok: true, message: r.created ? `Você entrou na fila para ${formatLocalDate(str(fd, "date"))}. Quando uma mesa for liberada, você recebe uma oferta por email e em Minhas reservas.` : "Você já está na fila para esta data." };
  } catch (e) {
    return unexpected(e, "entrar na fila", actor.requestId);
  }
}

export async function leaveWaitlistAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  try {
    const r = await leaveWaitlist(db, actor, str(fd, "entryId"), { reason: str(fd, "reason") || undefined });
    refresh();
    return { ok: true, message: r.declined ? `Oferta recusada e saída da fila de ${formatLocalDate(r.date)}.` : `Você saiu da fila de ${formatLocalDate(r.date)}.` };
  } catch (e) {
    return unexpected(e, "sair da fila", actor.requestId);
  }
}

export async function acceptOfferAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  try {
    const r = await acceptOffer(db, actor, str(fd, "offerId"));
    refresh();
    return { ok: true, message: `Mesa ${r.resourceCode} confirmada para ${formatLocalDate(r.date)}.` };
  } catch (e) {
    return unexpected(e, "aceitar oferta", actor.requestId);
  }
}

export async function declineOfferAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  try {
    const r = await declineOffer(db, actor, str(fd, "offerId"));
    refresh();
    return { ok: true, message: `Oferta recusada. Você saiu da fila de ${formatLocalDate(r.date)}; entre de novo se precisar.` };
  } catch (e) {
    return unexpected(e, "recusar oferta", actor.requestId);
  }
}

export async function offerManuallyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  try {
    const r = await offerManually(db, actor, { entryId: str(fd, "entryId"), resourceId: str(fd, "resourceId") });
    refresh();
    return { ok: true, message: `Oferta feita; a pessoa tem até ${formatLocal(r.expiresAt)} para aceitar.` };
  } catch (e) {
    return unexpected(e, "oferta manual", actor.requestId);
  }
}

/** Retirada da fila pela administração (aba Fila): motivo obrigatório, a pessoa é avisada; mensagem própria ao operador. */
export async function removeFromQueueAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  try {
    const r = await leaveWaitlist(db, actor, str(fd, "entryId"), { reason: str(fd, "reason") || undefined });
    refresh();
    return { ok: true, message: `Pessoa retirada da fila de ${formatLocalDate(r.date)}${r.declined ? " (a oferta aberta foi retirada)" : ""}. Ela foi avisada por email.` };
  } catch (e) {
    return unexpected(e, "retirar da fila", actor.requestId);
  }
}
