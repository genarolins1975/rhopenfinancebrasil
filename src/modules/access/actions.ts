"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { unexpected, type ActionState } from "@/modules/shared/action-state";
import { actorOf, requireCurrent } from "@/modules/identity/session";
import { grantPermission, grantRole, revokePermission, revokeRole } from "./grants";
import type { Permission, Role } from "./permissions";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function run(fd: FormData, fn: (actor: ReturnType<typeof actorOf>) => Promise<void>, message: string): Promise<ActionState> {
  const current = await requireCurrent();
  if (current.access.mfaRequired) return { error: "Ative o segundo fator antes de gerir acessos." };
  const actor = actorOf(current);
  try {
    await fn(actor);
  } catch (e) {
    return unexpected(e, "concessão", actor.requestId);
  }
  revalidatePath(`/admin/colaboradores/${str(fd, "id")}`);
  revalidatePath("/admin/acessos");
  return { ok: true, message };
}

export async function grantRoleAction(_p: ActionState, fd: FormData) {
  return run(fd, (a) => grantRole(db, a, { targetEmployeeId: str(fd, "id"), role: str(fd, "role") as Role, validTo: str(fd, "validTo") || null, reason: str(fd, "reason") }).then(() => undefined), "Perfil concedido.");
}
export async function revokeRoleAction(_p: ActionState, fd: FormData) {
  return run(fd, (a) => revokeRole(db, a, { targetEmployeeId: str(fd, "id"), role: str(fd, "role") as Role, reason: str(fd, "reason") }), "Perfil revogado.");
}
export async function grantPermissionAction(_p: ActionState, fd: FormData) {
  return run(fd, (a) => grantPermission(db, a, { targetEmployeeId: str(fd, "id"), permission: str(fd, "permission") as Permission, validTo: str(fd, "validTo") || null, reason: str(fd, "reason") }).then(() => undefined), "Permissão concedida.");
}
export async function revokePermissionAction(_p: ActionState, fd: FormData) {
  return run(fd, (a) => revokePermission(db, a, { targetEmployeeId: str(fd, "id"), permission: str(fd, "permission") as Permission, reason: str(fd, "reason") }), "Permissão revogada.");
}
