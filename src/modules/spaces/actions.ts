"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { actorOf, requireCurrent } from "@/modules/identity/session";
import { unexpected, type ActionState } from "@/modules/shared/action-state";
import { formatLocalDate } from "@/modules/shared/dates";
import { bookSpace, cancelSpace } from "./service";
import type { TitleVisibility } from "./rules";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function refresh() {
  revalidatePath("/escritorio/salas");
  revalidatePath("/escritorio/minhas-reservas");
  revalidatePath("/admin/reservas");
}

export async function bookSpaceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  try {
    const r = await bookSpace(db, actor, {
      resourceId: str(fd, "resourceId"),
      date: str(fd, "date"),
      start: str(fd, "start"),
      end: str(fd, "end"),
      title: str(fd, "title") || null,
      titleVisibility: (str(fd, "titleVisibility") || "private") as TitleVisibility,
      idempotencyKey: str(fd, "idempotencyKey"),
    });
    refresh();
    return { ok: true, message: `${r.resourceCode} reservada em ${formatLocalDate(str(fd, "date"))}, das ${r.slot}.` };
  } catch (e) {
    return unexpected(e, "reservar sala", actor.requestId);
  }
}

export async function cancelSpaceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  try {
    const r = await cancelSpace(db, actor, str(fd, "bookingId"), { reason: str(fd, "reason") || undefined, message: str(fd, "message") || undefined });
    refresh();
    return { ok: true, message: `Reserva de ${r.resourceCode} em ${formatLocalDate(r.date)} (${r.slot}) cancelada.` };
  } catch (e) {
    return unexpected(e, "cancelar sala", actor.requestId);
  }
}
