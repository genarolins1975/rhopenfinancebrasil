import { safeErrorInfo, translateDbError } from "@/modules/shared/db-errors";
import { isDomainError } from "@/modules/shared/errors";
import { logger } from "@/modules/shared/logger";

/** Estado devolvido por toda server action: mensagem para a tela, nunca detalhe técnico. */
export type ActionState = { ok?: boolean; error?: string; message?: string; data?: Record<string, unknown> };

/** Erro inesperado: mensagem genérica com identificador; no log só código e constraint, nunca a consulta. */
export function unexpected(e: unknown, context: string, requestId?: string): ActionState {
  const translated = translateDbError(e);
  if (translated) return { error: translated.message };
  if (isDomainError(e)) return { error: e.message };
  logger.error({ context, requestId, err: safeErrorInfo(e) }, "erro inesperado em ação");
  return { error: `Não foi possível concluir agora. Tente de novo em instantes.${requestId ? ` Identificador: ${requestId.slice(0, 8)}.` : ""}` };
}
