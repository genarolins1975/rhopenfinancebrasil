"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { actorOf, requirePermission } from "@/modules/identity/session";
import { parseDecisions, withReallocOptions } from "@/modules/office/decisions";
import { unexpected, type ActionState } from "@/modules/shared/action-state";
import { closeDay, createDraftFromExtraction, createResource, createStatusPeriod, openDay, previewCloseDay, previewStatusPeriod, publishPlan, approvePlan, releaseStatusPeriod, retireResource, updateResourceAttributes, updateSetting, type ExtractionFile } from "@/modules/workplace/service";
import {
  type AssignmentInput,
  addGroupMember,
  batchAssign,
  cancelAssignment,
  createException,
  endAssignment,
  previewAssignment,
  previewException,
  previewRemoveMember,
  previewRevokeException,
  previewTransfer,
  removeGroupMember,
  revokeException,
  setNeedsReview,
  transferAssignment,
} from "./service";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

const EXCL = "/admin/escritorio/mesas/exclusividade";
const RES = "/admin/escritorio/recursos";

function refresh() {
  revalidatePath(EXCL);
  revalidatePath(RES);
  revalidatePath("/escritorio");
  revalidatePath("/admin/reservas");
  revalidatePath("/admin");
}

/* Exclusividade: travar, agendar e lote. Passo "preview" devolve a prévia; passo "confirm" aplica com as decisões. */

function assignmentInputs(fd: FormData): AssignmentInput[] {
  const ids = fd.getAll("resourceIds").filter((v): v is string => typeof v === "string" && !!v);
  const single = str(fd, "resourceId");
  const targets = ids.length ? ids : single ? [single] : [];
  const mode = str(fd, "mode") === "group" ? "group" : "individual";
  return targets.map((resourceId) => ({
    resourceId,
    mode,
    holderEmployeeId: mode === "individual" ? str(fd, "holderEmployeeId") : null,
    accessGroupId: mode === "group" ? str(fd, "accessGroupId") : null,
    validFrom: str(fd, "validFrom"),
    validTo: str(fd, "validTo") || null,
    reason: str(fd, "reason"),
    responsible: str(fd, "responsible"),
  }));
}

export async function assignAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("manage_executive_seat_assignments");
  const actor = actorOf(current);
  const inputs = assignmentInputs(fd);
  const step = str(fd, "step");
  // Opção "iniciar após a última reserva incompatível": o início é substituído e a prévia refeita.
  const override = str(fd, "validFromOverride");
  if (override) for (const i of inputs) i.validFrom = override;
  try {
    if (inputs.length === 0) return { error: "Selecione ao menos uma mesa." };
    if (step !== "confirm") {
      const previews = [];
      for (const i of inputs) {
        const p = await previewAssignment(db, actor, i);
        previews.push({ ...p, resourceId: i.resourceId, conflicts: await withReallocOptions(db, p.conflicts, inputs.map((x) => x.resourceId)) });
      }
      const input = Object.fromEntries(fd.entries()) as Record<string, string>;
      if (override) input.validFrom = override;
      return { ok: false, message: "Prévia de impacto gerada. Confira e confirme.", data: { preview: previews, input } };
    }
    const ids = await batchAssign(db, actor, inputs, parseDecisions(fd));
    refresh();
    return { ok: true, message: `${ids.length} atribuição(ões) gravada(s). Titulares e RH notificados; detalhes no histórico.` };
  } catch (e) {
    return unexpected(e, "atribuição exclusiva", actor.requestId);
  }
}

export async function transferAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("manage_executive_seat_assignments");
  const actor = actorOf(current);
  const input = { assignmentId: str(fd, "assignmentId"), newHolderEmployeeId: str(fd, "newHolderEmployeeId"), from: str(fd, "from"), reason: str(fd, "reason"), responsible: str(fd, "responsible") };
  try {
    const override = str(fd, "validFromOverride");
    if (override) input.from = override;
    if (str(fd, "step") !== "confirm") {
      const p = await previewTransfer(db, actor, input);
      const echo = Object.fromEntries(fd.entries()) as Record<string, string>;
      if (override) echo.from = override;
      return { ok: false, message: "Prévia da transferência gerada.", data: { preview: { ...p, conflicts: await withReallocOptions(db, p.conflicts, []) }, input: echo } };
    }
    await transferAssignment(db, actor, input, parseDecisions(fd));
    refresh();
    return { ok: true, message: "Transferência aplicada. Titular anterior e novo titular notificados." };
  } catch (e) {
    return unexpected(e, "transferir atribuição", actor.requestId);
  }
}

export async function endAssignmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("manage_executive_seat_assignments");
  const actor = actorOf(current);
  try {
    await endAssignment(db, actor, { assignmentId: str(fd, "assignmentId"), validTo: str(fd, "validTo"), reason: str(fd, "reason") });
    refresh();
    return { ok: true, message: "Atribuição encerrada. A mesa volta ao conjunto compartilhado no dia seguinte ao término; nenhuma reserva foi cancelada." };
  } catch (e) {
    return unexpected(e, "encerrar atribuição", actor.requestId);
  }
}

export async function cancelAssignmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("manage_executive_seat_assignments");
  const actor = actorOf(current);
  const decision = str(fd, "successorDecision");
  try {
    await cancelAssignment(db, actor, { assignmentId: str(fd, "assignmentId"), reason: str(fd, "reason"), successorDecision: decision === "release" || decision === "reopen" ? decision : undefined });
    refresh();
    return { ok: true, message: "Atribuição agendada anulada." };
  } catch (e) {
    return unexpected(e, "anular atribuição", actor.requestId);
  }
}

export async function exceptionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("manage_executive_seat_assignments");
  const actor = actorOf(current);
  const kind = str(fd, "kind") === "release_to_employee" ? "release_to_employee" : "release_to_shared";
  const input = { assignmentId: str(fd, "assignmentId"), kind, beneficiaryEmployeeId: kind === "release_to_employee" ? str(fd, "beneficiaryEmployeeId") : null, startsOn: str(fd, "startsOn"), endsOn: str(fd, "endsOn"), reason: str(fd, "reason") } as const;
  try {
    if (str(fd, "step") !== "confirm") {
      const p = await previewException(db, actor, input);
      return { ok: false, message: "Prévia da liberação gerada.", data: { preview: { ...p, conflicts: await withReallocOptions(db, p.conflicts, []) }, input: Object.fromEntries(fd.entries()) } };
    }
    await createException(db, actor, input, parseDecisions(fd));
    refresh();
    return { ok: true, message: "Liberação temporária gravada. A exclusividade volta automaticamente ao fim da janela." };
  } catch (e) {
    return unexpected(e, "liberar temporariamente", actor.requestId);
  }
}

export async function revokeExceptionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("manage_executive_seat_assignments");
  const actor = actorOf(current);
  const exceptionId = str(fd, "exceptionId");
  try {
    if (str(fd, "step") !== "confirm") {
      const p = await previewRevokeException(db, actor, exceptionId);
      return { ok: false, message: "Prévia da revogação gerada.", data: { preview: { ...p, conflicts: await withReallocOptions(db, p.conflicts, []) }, input: Object.fromEntries(fd.entries()) } };
    }
    await revokeException(db, actor, { exceptionId, reason: str(fd, "reason") }, parseDecisions(fd));
    refresh();
    return { ok: true, message: "Liberação revogada." };
  } catch (e) {
    return unexpected(e, "revogar liberação", actor.requestId);
  }
}

export async function addMemberAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("manage_executive_seat_assignments");
  const actor = actorOf(current);
  try {
    await addGroupMember(db, actor, { groupId: str(fd, "groupId"), employeeId: str(fd, "employeeId"), validFrom: str(fd, "validFrom"), reason: str(fd, "reason") });
    refresh();
    return { ok: true, message: "Integrante adicionado." };
  } catch (e) {
    return unexpected(e, "adicionar integrante", actor.requestId);
  }
}

export async function removeMemberAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("manage_executive_seat_assignments");
  const actor = actorOf(current);
  const input = { memberId: str(fd, "memberId"), validTo: str(fd, "validTo"), reason: str(fd, "reason") };
  try {
    if (str(fd, "step") !== "confirm") {
      const p = await previewRemoveMember(db, actor, input);
      return { ok: false, message: "Prévia da remoção gerada.", data: { preview: { ...p, conflicts: await withReallocOptions(db, p.conflicts, []) }, input: Object.fromEntries(fd.entries()) } };
    }
    await removeGroupMember(db, actor, input, parseDecisions(fd));
    refresh();
    return { ok: true, message: "Vigência do integrante encerrada." };
  } catch (e) {
    return unexpected(e, "remover integrante", actor.requestId);
  }
}

export async function reviewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("manage_executive_seat_assignments");
  const actor = actorOf(current);
  try {
    await setNeedsReview(db, actor, { assignmentId: str(fd, "assignmentId"), needsReview: str(fd, "needsReview") === "yes", reason: str(fd, "reason") });
    refresh();
    return { ok: true, message: str(fd, "needsReview") === "yes" ? "Vínculo marcado para revisão. Ninguém é elegível enquanto durar." : "Revisão concluída." };
  } catch (e) {
    return unexpected(e, "revisar vínculo", actor.requestId);
  }
}

/* Recursos, situação operacional, calendário, configurações e planta. */

export async function createResourceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("resource.manage");
  const actor = actorOf(current);
  try {
    const type = (["desk", "room", "booth"].includes(str(fd, "type")) ? str(fd, "type") : "desk") as "desk" | "room" | "booth";
    const r = await createResource(db, actor, { code: str(fd, "code"), type, zoneId: str(fd, "zoneId") || null, capacity: type === "desk" ? null : Number(str(fd, "capacity") || 0) });
    revalidatePath(RES);
    return { ok: true, message: `Recurso ${r.code} criado.` };
  } catch (e) {
    return unexpected(e, "criar recurso", actor.requestId);
  }
}

export async function updateResourceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("resource.manage");
  const actor = actorOf(current);
  try {
    const attributes: Record<string, unknown> = {};
    for (const k of ["monitor", "docking", "altura_regulavel", "acessivel"]) attributes[k] = str(fd, k) === "on";
    if (str(fd, "observacao")) attributes.observacao = str(fd, "observacao");
    await updateResourceAttributes(db, actor, str(fd, "resourceId"), { attributes, zoneId: str(fd, "zoneId") || null, verified: str(fd, "verified") === "on" });
    revalidatePath(RES);
    return { ok: true, message: "Atributos gravados." };
  } catch (e) {
    return unexpected(e, "editar recurso", actor.requestId);
  }
}

export async function statusPeriodAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("resource.status.manage");
  const actor = actorOf(current);
  const input = { resourceId: str(fd, "resourceId"), status: (str(fd, "status") === "admin_block" ? "admin_block" : "maintenance") as "maintenance" | "admin_block", startsOn: str(fd, "startsOn"), endsOn: str(fd, "endsOn") || null, reason: str(fd, "reason"), publicReason: str(fd, "publicReason") || null };
  try {
    if (str(fd, "step") !== "confirm") {
      const p = await previewStatusPeriod(db, actor, input);
      return { ok: false, message: "Prévia gerada.", data: { preview: { conflicts: await withReallocOptions(db, p.conflicts, [input.resourceId]) }, input: Object.fromEntries(fd.entries()) } };
    }
    await createStatusPeriod(db, actor, input, parseDecisions(fd));
    refresh();
    return { ok: true, message: input.status === "maintenance" ? "Período de manutenção gravado." : "Bloqueio administrativo gravado." };
  } catch (e) {
    return unexpected(e, "período operacional", actor.requestId);
  }
}

export async function releasePeriodAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("resource.status.manage");
  const actor = actorOf(current);
  try {
    await releaseStatusPeriod(db, actor, str(fd, "periodId"), { releasedOn: str(fd, "releasedOn") || undefined, reason: str(fd, "reason") });
    refresh();
    return { ok: true, message: "Período liberado. A mesa volta pela vigência." };
  } catch (e) {
    return unexpected(e, "liberar período", actor.requestId);
  }
}

export async function retireResourceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("resource.manage");
  const actor = actorOf(current);
  try {
    if (str(fd, "step") !== "confirm") {
      const { listActiveBookings } = await import("@/modules/office/conflicts");
      const from = str(fd, "retiredOn") || undefined;
      const { localToday } = await import("@/modules/shared/dates");
      const bookings = await listActiveBookings(db, { resourceIds: [str(fd, "resourceId")], from: from ?? localToday(), to: null });
      return { ok: false, message: "Prévia gerada.", data: { preview: { conflicts: await withReallocOptions(db, bookings.map((b) => ({ ...b, why: "recurso desativado" })), [str(fd, "resourceId")]) }, input: Object.fromEntries(fd.entries()) } };
    }
    await retireResource(db, actor, str(fd, "resourceId"), { retiredOn: str(fd, "retiredOn") || undefined, reason: str(fd, "reason") }, parseDecisions(fd));
    refresh();
    return { ok: true, message: "Recurso desativado." };
  } catch (e) {
    return unexpected(e, "desativar recurso", actor.requestId);
  }
}

export async function calendarAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("resource.status.manage");
  const actor = actorOf(current);
  const date = str(fd, "date");
  try {
    if (str(fd, "open") === "yes") {
      await openDay(db, actor, { date, reason: str(fd, "reason") });
      refresh();
      return { ok: true, message: "Dia aberto." };
    }
    if (str(fd, "step") !== "confirm") {
      const p = await previewCloseDay(db, actor, date);
      return { ok: false, message: "Prévia do fechamento gerada.", data: { preview: { conflicts: await withReallocOptions(db, p.conflicts, []), noRealloc: true }, input: Object.fromEntries(fd.entries()) } };
    }
    await closeDay(db, actor, { date, reason: str(fd, "reason") }, parseDecisions(fd));
    refresh();
    return { ok: true, message: "Dia fechado. Pessoas com reserva foram comunicadas." };
  } catch (e) {
    return unexpected(e, "calendário", actor.requestId);
  }
}

export async function settingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("settings.manage");
  const actor = actorOf(current);
  try {
    await updateSetting(db, actor, str(fd, "key"), str(fd, "value"));
    refresh();
    return { ok: true, message: "Configuração gravada." };
  } catch (e) {
    return unexpected(e, "configuração", actor.requestId);
  }
}

export async function planDraftAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("floorplan.edit");
  const actor = actorOf(current);
  try {
    const file = JSON.parse(await readFile(path.join(process.cwd(), "docs/fontes/planta-r00-extracao.json"), "utf8")) as ExtractionFile;
    const r = await createDraftFromExtraction(db, actor, file, str(fd, "name") || "Planta R00 (extração)");
    revalidatePath("/admin/escritorio/planta");
    revalidatePath(RES);
    return { ok: true, message: `Rascunho criado com ${r.resourcesCreated} recurso(s) novo(s). Inventário marcado como não validado.` };
  } catch (e) {
    return unexpected(e, "rascunho da planta", actor.requestId);
  }
}

export async function planApproveAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("floorplan.publish");
  const actor = actorOf(current);
  try {
    await approvePlan(db, actor, str(fd, "planId"), str(fd, "notes"));
    revalidatePath("/admin/escritorio/planta");
    return { ok: true, message: "Versão aprovada." };
  } catch (e) {
    return unexpected(e, "aprovar planta", actor.requestId);
  }
}

export async function planPublishAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const current = await requirePermission("floorplan.publish");
  const actor = actorOf(current);
  try {
    await publishPlan(db, actor, str(fd, "planId"));
    refresh();
    revalidatePath("/admin/escritorio/planta");
    return { ok: true, message: "Versão publicada. Reservas e atribuições não mudam; o mapa passa a usar esta versão." };
  } catch (e) {
    return unexpected(e, "publicar planta", actor.requestId);
  }
}
