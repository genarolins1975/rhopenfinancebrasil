import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/** Fuso de todas as regras de negócio. Instantes ficam em UTC; datas e regras são locais. */
export const TZ = "America/Sao_Paulo";

/** Dia local de São Paulo como string ISO (aaaa-mm-dd), única fonte de "hoje" na aplicação. */
export function localToday(now: Date = new Date()): string {
  return format(new TZDate(now, TZ), "yyyy-MM-dd");
}

/** Instante local de São Paulo para exibição. */
export function formatLocal(instant: Date, pattern = "dd/MM/yyyy HH:mm"): string {
  return format(new TZDate(instant, TZ), pattern);
}

export function formatLocalDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
