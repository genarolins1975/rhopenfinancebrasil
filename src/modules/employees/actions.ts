"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import type { ActionState } from "@/modules/identity/actions";
import { actorOf, requirePermission } from "@/modules/identity/session";
import { isDomainError } from "@/modules/shared/errors";
import { logger } from "@/modules/shared/logger";
import { applyImport, discardImport, previewImport } from "./import";
import {
  createEmployee,
  deactivateEmployee,
  readmitEmployee,
  reactivateEmployee,
  resendInvitation,
  revealCpf,
  revokeInvitation,
  suspendEmployee,
  updateEmployee,
} from "./service";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function fail(e: unknown, fallback: string): ActionState {
  if (isDomainError(e)) return { error: e.message };
  logger.error({ err: e instanceof Error ? e.message : String(e) }, fallback);
  return { error: "Não foi possível concluir agora. Tente de novo em instantes." };
}

function keepValues(fd: FormData) {
  return { data: { fullName: str(fd, "fullName"), corporateEmail: str(fd, "corporateEmail"), areaId: str(fd, "areaId"), jobTitle: str(fd, "jobTitle"), managerEmployeeId: str(fd, "managerEmployeeId"), orgCondition: str(fd, "orgCondition"), hireDate: str(fd, "hireDate") } };
}

export async function createEmployeeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("employee.manage");
  let id: string;
  try {
    const r = await createEmployee(db, actorOf(current), {
      fullName: str(fd, "fullName"),
      corporateEmail: str(fd, "corporateEmail"),
      cpf: str(fd, "cpf"),
      areaId: str(fd, "areaId") || null,
      jobTitle: str(fd, "jobTitle") || null,
      managerEmployeeId: str(fd, "managerEmployeeId") || null,
      orgCondition: str(fd, "orgCondition") === "director" ? "director" : "standard",
      hireDate: str(fd, "hireDate"),
      sendInvitation: str(fd, "sendInvitation") !== "no",
    });
    id = r.employeeId;
  } catch (e) {
    return { ...fail(e, "erro ao criar colaborador"), ...keepValues(fd) };
  }
  redirect(`/admin/colaboradores/${id}?aviso=criado`);
}

export async function updateEmployeeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("employee.manage");
  const id = str(fd, "id");
  try {
    await updateEmployee(db, actorOf(current), id, {
      fullName: str(fd, "fullName"),
      corporateEmail: str(fd, "corporateEmail"),
      areaId: str(fd, "areaId") || null,
      jobTitle: str(fd, "jobTitle") || null,
      managerEmployeeId: str(fd, "managerEmployeeId") || null,
      orgCondition: str(fd, "orgCondition") === "director" ? "director" : "standard",
      reason: str(fd, "reason") || undefined,
    });
  } catch (e) {
    return { ...fail(e, "erro ao editar colaborador"), ...keepValues(fd) };
  }
  redirect(`/admin/colaboradores/${id}?aviso=editado`);
}

async function simple(fd: FormData, run: (actor: ReturnType<typeof actorOf>, id: string) => Promise<void>, fallback: string, message: string): Promise<ActionState> {
  const current = await requirePermission("employee.manage");
  const id = str(fd, "id");
  try {
    await run(actorOf(current), id);
  } catch (e) {
    return fail(e, fallback);
  }
  revalidatePath(`/admin/colaboradores/${id}`);
  revalidatePath("/admin/colaboradores");
  return { ok: true, message };
}

export async function resendInvitationAction(_prev: ActionState, fd: FormData) {
  return simple(fd, (a, id) => resendInvitation(db, a, id), "erro ao reenviar convite", "Novo convite enfileirado. O anterior foi invalidado.");
}
export async function revokeInvitationAction(_prev: ActionState, fd: FormData) {
  return simple(fd, (a, id) => revokeInvitation(db, a, id), "erro ao revogar convite", "Convite revogado.");
}
export async function suspendEmployeeAction(_prev: ActionState, fd: FormData) {
  return simple(fd, (a, id) => suspendEmployee(db, a, id, str(fd, "reason")), "erro ao suspender", "Pessoa suspensa. Sessões encerradas.");
}
export async function reactivateEmployeeAction(_prev: ActionState, fd: FormData) {
  return simple(fd, (a, id) => reactivateEmployee(db, a, id, str(fd, "reason")), "erro ao reativar", "Pessoa reativada.");
}
export async function deactivateEmployeeAction(_prev: ActionState, fd: FormData) {
  return simple(fd, (a, id) => deactivateEmployee(db, a, id, { reason: str(fd, "reason"), exitDate: str(fd, "exitDate") || undefined }), "erro ao desativar", "Pessoa desativada. Sessões, convites e concessões encerrados.");
}
export async function readmitEmployeeAction(_prev: ActionState, fd: FormData) {
  return simple(fd, (a, id) => readmitEmployee(db, a, id, { hireDate: str(fd, "hireDate"), reason: str(fd, "reason") }), "erro ao readmitir", "Pessoa readmitida. Novo convite enfileirado.");
}

export async function revealCpfAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("cpf.reveal");
  try {
    const cpf = await revealCpf(db, actorOf(current), str(fd, "id"), str(fd, "reason"));
    return { ok: true, data: { cpf } };
  } catch (e) {
    return fail(e, "erro ao revelar CPF");
  }
}

export async function previewImportAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("employee.import");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Selecione um arquivo CSV." };
  if (file.size > 2 * 1024 * 1024) return { error: "Arquivo acima de 2 MB." };
  try {
    const text = await file.text();
    const preview = await previewImport(db, actorOf(current), text);
    return { ok: true, data: { ...preview, expiresAt: preview.expiresAt.toISOString() } };
  } catch (e) {
    return fail(e, "erro na prévia da importação");
  }
}

export async function applyImportAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("employee.import");
  try {
    const r = await applyImport(db, actorOf(current), str(fd, "batchId"));
    revalidatePath("/admin/colaboradores");
    return { ok: true, message: `${r.created} pessoa(s) cadastrada(s) e convidada(s).` };
  } catch (e) {
    return fail(e, "erro ao aplicar importação");
  }
}

export async function discardImportAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("employee.import");
  try {
    await discardImport(db, actorOf(current), str(fd, "batchId"));
    return { ok: true, message: "Prévia descartada." };
  } catch (e) {
    return fail(e, "erro ao descartar importação");
  }
}
