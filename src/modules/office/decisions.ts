import type { DbOrTx } from "@/db/client";
import { ValidationError } from "@/modules/shared/errors";
import type { ConflictDecision, IncompatibleBooking } from "./conflicts";

/*
 * Ponte entre o diálogo de conflito na tela e as decisões do serviço. O formulário envia, por reserva incompatível:
 * decision:<id> (cancel | realloc), reason:<id>, message:<id>, target:<id> e status:<id> (situação vista na prévia).
 * Nada aqui decide regra; só traduz.
 */

export type ConflictView = IncompatibleBooking & { options: Array<{ id: string; code: string }> };

export function parseDecisions(fd: FormData): ConflictDecision[] {
  const out: ConflictDecision[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("decision:") || typeof v !== "string" || !v) continue;
    const bookingId = k.slice("decision:".length);
    const str = (key: string) => {
      const x = fd.get(`${key}:${bookingId}`);
      return typeof x === "string" ? x.trim() : "";
    };
    // A situação vista na prévia é obrigatória: decisão sem ela (página antiga, outro cliente) valeria para qualquer
    // situação atual da reserva, inclusive oferta aceita depois da prévia.
    const status = str("status");
    if (status !== "held" && status !== "confirmed") throw new ValidationError("A prévia desta operação está desatualizada. Gere a prévia de novo e decida cada reserva.");
    out.push({ bookingId, action: v === "realloc" ? "realloc" : "cancel", reason: str("reason"), message: str("message") || undefined, targetResourceId: str("target") || undefined, expectedStatus: status });
  }
  return out;
}

/** Enriquecimento da prévia: mesas disponíveis para cada pessoa na data, filtradas pelo serviço de disponibilidade. */
export async function withReallocOptions(db: DbOrTx, conflicts: IncompatibleBooking[], excludeResourceIds: string[]): Promise<ConflictView[]> {
  const { availableDesksFor } = await import("@/modules/workplace/service");
  const out: ConflictView[] = [];
  for (const c of conflicts) {
    const options = c.kind === "space" || c.status === "held" ? [] : await availableDesksFor(db, c.employeeId, c.date, [...excludeResourceIds, c.resourceId], c.bookingId);
    out.push({ ...c, options });
  }
  return out;
}
