"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { actorOf, requireCurrent } from "@/modules/identity/session";
import { unexpected, type ActionState } from "@/modules/shared/action-state";
import { setShareWithManager } from "./service";

export async function shareWithManagerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requireCurrent();
  const actor = actorOf(current);
  try {
    const value = fd.get("share") === "on";
    await setShareWithManager(db, actor, value);
    revalidatePath("/perfil");
    revalidatePath("/escritorio/meu-time");
    return { ok: true, message: value ? "Seus planos e reservas passam a ser visíveis ao seu gestor direto." : "Seus planos e reservas deixam de ser visíveis ao gestor." };
  } catch (e) {
    return unexpected(e, "preferência", actor.requestId);
  }
}
