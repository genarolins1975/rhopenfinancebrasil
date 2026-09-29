import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { TZ } from "@/modules/shared/dates";

/*
 * Regras puras de salas e cabines: intervalo semiaberto no mesmo dia local, granularidade de 15 minutos, limites por
 * recurso (PAR-18, sem constante fixa), visibilidade do título (privado, gestor direto, todos).
 */

export const SLOT_MINUTES = 15;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type Interval = { start: Date; end: Date };

const END = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** Constrói o intervalo local `[start, end)` de uma data com horas HH:MM; o fim aceita 24:00 (meia-noite ao fim do dia). */
export function intervalOf(isoDate: string, startHHMM: string, endHHMM: string): Interval {
  if (!HHMM.test(startHHMM) || !END.test(endHHMM)) throw new Error("hora inválida");
  const [y, m, d] = isoDate.split("-").map(Number);
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  return { start: new TZDate(y, m - 1, d, sh, sm, 0, 0, TZ), end: new TZDate(y, m - 1, d, eh, em, 0, 0, TZ) };
}

export function durationMinutes(i: Interval): number {
  return Math.round((i.end.getTime() - i.start.getTime()) / 60_000);
}

/** Motivo pelo qual um intervalo é inválido para reserva, ou null. `maxMinutes` vem do recurso (PAR-18). */
export function intervalProblem(i: Interval, opts: { now: Date; maxMinutes: number | null; minMinutes?: number }): string | null {
  const min = opts.minMinutes ?? SLOT_MINUTES;
  const dur = durationMinutes(i);
  if (dur <= 0) return "o término precisa ser depois do início";
  if (i.start.getMinutes() % SLOT_MINUTES !== 0 || i.end.getMinutes() % SLOT_MINUTES !== 0) return `horários em múltiplos de ${SLOT_MINUTES} minutos`;
  if (dur < min) return `duração mínima de ${min} minutos`;
  if (opts.maxMinutes != null && dur > opts.maxMinutes) return `duração máxima deste recurso: ${opts.maxMinutes} minutos`;
  if (i.end.getTime() <= opts.now.getTime()) return "intervalo já encerrado";
  const floor = Math.floor(opts.now.getTime() / (SLOT_MINUTES * 60_000)) * SLOT_MINUTES * 60_000;
  if (i.start.getTime() < floor) return "o início não pode estar no passado";
  return null;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

export function formatSlot(i: Interval): string {
  const end = format(new TZDate(i.end, TZ), "HH:mm");
  // Fim à meia-noite do dia seguinte é exibido como 24:00, o fim do próprio dia.
  const endLabel = end === "00:00" && i.end.getTime() > i.start.getTime() ? "24:00" : end;
  return `${format(new TZDate(i.start, TZ), "HH:mm")} às ${endLabel}`;
}

export type TitleVisibility = "private" | "manager" | "all";

/** Quem vê o título: a própria pessoa; todos quando `all`; o gestor direto vigente quando `manager`. Administrar não dá acesso ao conteúdo. */
export function canSeeTitle(b: { employeeId: string; titleVisibility: TitleVisibility }, viewer: { id: string; managesEmployeeIds: ReadonlySet<string> }): boolean {
  if (b.employeeId === viewer.id) return true;
  if (b.titleVisibility === "all") return true;
  if (b.titleVisibility === "manager") return viewer.managesEmployeeIds.has(b.employeeId);
  return false;
}

/** Limite de duração do recurso a partir dos atributos verificados (PAR-18). Ausente = sem limite além do dia. */
export function maxMinutesOf(attributes: Record<string, unknown>): number | null {
  const v = attributes.max_duration_minutes;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/** Semanas inteiras entre a semana de hoje e a da data (segunda a domingo, dia local). */
export function weeksAhead(today: string, date: string): number {
  const monday = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const wd = (dt.getUTCDay() + 6) % 7;
    return Date.UTC(y, m - 1, d) - wd * 86_400_000;
  };
  return Math.round((monday(date) - monday(today)) / (7 * 86_400_000));
}

/** Próximo trecho sugerido na busca: o próximo múltiplo de 15 minutos por uma hora; depois das 23:00, amanhã às 09:00. */
export function suggestedSlot(now: Date): { dayOffset: 0 | 1; start: string; end: string } {
  const local = new TZDate(now, TZ);
  const minutes = local.getHours() * 60 + local.getMinutes();
  const start = Math.ceil(minutes / SLOT_MINUTES) * SLOT_MINUTES;
  if (start + 60 > 24 * 60) return { dayOffset: 1, start: "09:00", end: "10:00" };
  const hhmm = (n: number) => (n === 24 * 60 ? "24:00" : `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`);
  return { dayOffset: 0, start: hhmm(start), end: hhmm(start + 60) };
}
