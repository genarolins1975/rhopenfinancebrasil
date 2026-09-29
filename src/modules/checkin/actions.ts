"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { actorOf, requireCurrent } from "@/modules/identity/session";
import { unexpected, type ActionState } from "@/modules/shared/action-state";
import { confirmUse } from "./service";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Confirmação de uso pelo portal ou pelo QR: o servidor resolve a reserva da sessão; o formulário só diz o método. */
export async function confirmUseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  try {
    const method = str(fd, "method") === "qr" ? "qr" : "portal";
    const r = await confirmUse(db, actor, { bookingId: str(fd, "bookingId") || undefined, spaceBookingId: str(fd, "spaceBookingId") || undefined, resourceCode: str(fd, "resourceCode") || undefined, method });
    revalidatePath("/escritorio/minhas-reservas");
    revalidatePath("/escritorio/qr/[code]", "page");
    const what = r.slot ? `${r.resourceCode} (${r.slot})` : r.resourceCode;
    return { ok: true, message: r.already ? `Uso de ${what} já estava confirmado hoje.` : `Uso de ${what} confirmado. Isso é uma declaração sua, não registro de presença ou ponto.` };
  } catch (e) {
    return unexpected(e, "confirmar uso", actor.requestId);
  }
}
