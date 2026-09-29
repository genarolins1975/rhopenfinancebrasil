import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfDay } from "date-fns";
import { TZ } from "@/modules/shared/dates";

/*
 * Regras puras da fila (PAR-05): o prazo da oferta conta em minutos úteis, de segunda a sexta, dentro do horário
 * comercial configurado e só em dias com escritório aberto no calendário. Sem banco: o serviço carrega os dados.
 */

export type BusinessHours = { start: string; end: string; closedDates: ReadonlySet<string> };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function at(day: TZDate, hhmm: string): TZDate {
  if (!HHMM.test(hhmm)) throw new Error(`hora inválida: ${hhmm}`);
  const [h, m] = hhmm.split(":").map(Number);
  return new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0, TZ);
}

function nextDayStart(day: TZDate): TZDate {
  return startOfDay(addDays(day, 1));
}

export function isBusinessDay(day: TZDate, closedDates: ReadonlySet<string>): boolean {
  const wd = day.getDay();
  if (wd === 0 || wd === 6) return false;
  return !closedDates.has(format(day, "yyyy-MM-dd"));
}

/** Soma minutos úteis a um instante. Fora do expediente, a contagem começa no próximo início de expediente útil. */
export function addBusinessMinutes(from: Date, minutes: number, cfg: BusinessHours): Date {
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("minutos úteis precisam ser positivos");
  let remaining = minutes;
  let cursor = new TZDate(from, TZ);
  for (let guard = 0; guard < 400; guard++) {
    const start = at(cursor, cfg.start);
    const end = at(cursor, cfg.end);
    if (end <= start) throw new Error("horário comercial inválido: fim antes do início");
    if (!isBusinessDay(cursor, cfg.closedDates) || cursor.getTime() >= end.getTime()) {
      cursor = nextDayStart(cursor);
      continue;
    }
    if (cursor.getTime() < start.getTime()) cursor = start;
    const available = (end.getTime() - cursor.getTime()) / 60_000;
    if (remaining <= available) return new Date(cursor.getTime() + remaining * 60_000);
    remaining -= available;
    cursor = nextDayStart(cursor);
  }
  throw new Error("sem dia útil nos próximos 400 dias");
}

/** Fim do dia local da data da reserva: a oferta nunca vive além do dia a que se refere. */
export function endOfLocalDay(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new TZDate(y, m - 1, d + 1, 0, 0, 0, 0, TZ);
}

/** Mínimo de vida de uma oferta para valer a pena ser feita; abaixo disso a mesa fica livre para reserva direta. */
export const MIN_OFFER_MINUTES = 15;

/**
 * Instante de vencimento de uma oferta feita em `from` para a data `date`: minutos úteis, limitado ao fim do dia local
 * da reserva. Devolve null quando não há tempo mínimo (oferta feita no fim do próprio dia).
 */
export function offerExpiresAt(from: Date, date: string, minutes: number, cfg: BusinessHours): Date | null {
  // Reserva para data que não é dia útil (fim de semana aberto ou dia sem expediente): minutos corridos, para a fila
  // continuar andando no próprio dia (PAR-43, T-08).
  const [y, m, d] = date.split("-").map(Number);
  const businessDate = isBusinessDay(new TZDate(y, m - 1, d, 12, 0, 0, 0, TZ), cfg.closedDates);
  const computed = businessDate ? addBusinessMinutes(from, minutes, cfg) : new Date(from.getTime() + minutes * 60_000);
  const cap = endOfLocalDay(date);
  const result = computed.getTime() < cap.getTime() ? computed : cap;
  if (result.getTime() - from.getTime() < MIN_OFFER_MINUTES * 60_000) return null;
  return result;
}
