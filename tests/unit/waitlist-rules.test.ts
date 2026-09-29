import { TZDate } from "@date-fns/tz";
import { describe, expect, it } from "vitest";
import { TZ } from "@/modules/shared/dates";
import { addBusinessMinutes, endOfLocalDay, isBusinessDay, offerExpiresAt } from "@/modules/waitlist/rules";

/* PAR-05: prazo da oferta em horas úteis, dentro do calendário do escritório. Datas de referência: outubro de 2026. */

const cfg = { start: "09:00", end: "18:00", closedDates: new Set<string>(["2026-10-12"]) };
const local = (y: number, m: number, d: number, h: number, min: number) => new TZDate(y, m - 1, d, h, min, 0, 0, TZ);
const fmt = (d: Date) => new TZDate(d, TZ).toISOString().replace(/\.\d{3}/, "");

describe("horas úteis da oferta (PAR-05)", () => {
  it("dentro do expediente: soma direta", () => {
    expect(fmt(addBusinessMinutes(local(2026, 10, 6, 10, 0), 120, cfg))).toBe(fmt(local(2026, 10, 6, 12, 0)));
  });
  it("atravessa o fim do expediente e continua no dia útil seguinte", () => {
    expect(fmt(addBusinessMinutes(local(2026, 10, 6, 17, 30), 120, cfg))).toBe(fmt(local(2026, 10, 7, 10, 30)));
  });
  it("fora do expediente: começa a contar no próximo início", () => {
    expect(fmt(addBusinessMinutes(local(2026, 10, 6, 22, 0), 120, cfg))).toBe(fmt(local(2026, 10, 7, 11, 0)));
    expect(fmt(addBusinessMinutes(local(2026, 10, 7, 6, 0), 30, cfg))).toBe(fmt(local(2026, 10, 7, 9, 30)));
  });
  it("sexta à tarde pula o fim de semana; feriado do calendário também é pulado", () => {
    // 09/10/2026 é sexta; 12/10 (segunda) fechado no calendário; 13/10 terça.
    expect(fmt(addBusinessMinutes(local(2026, 10, 9, 17, 0), 120, cfg))).toBe(fmt(local(2026, 10, 13, 10, 0)));
    expect(isBusinessDay(local(2026, 10, 10, 12, 0), cfg.closedDates)).toBe(false);
    expect(isBusinessDay(local(2026, 10, 12, 12, 0), cfg.closedDates)).toBe(false);
    expect(isBusinessDay(local(2026, 10, 13, 12, 0), cfg.closedDates)).toBe(true);
  });
  it("minutos inválidos e expediente invertido são recusados", () => {
    expect(() => addBusinessMinutes(local(2026, 10, 6, 10, 0), 0, cfg)).toThrow();
    expect(() => addBusinessMinutes(local(2026, 10, 6, 10, 0), 60, { ...cfg, start: "18:00", end: "09:00" })).toThrow();
  });
});

describe("vencimento da oferta limitado ao dia da reserva", () => {
  it("oferta para data futura: só as horas úteis contam", () => {
    expect(fmt(offerExpiresAt(local(2026, 10, 6, 17, 30), "2026-10-08", 120, cfg)!)).toBe(fmt(local(2026, 10, 7, 10, 30)));
  });
  it("oferta para o próprio dia, no fim da tarde: vence no fim do dia local, não no dia seguinte", () => {
    expect(fmt(offerExpiresAt(local(2026, 10, 6, 17, 30), "2026-10-06", 120, cfg)!)).toBe(fmt(local(2026, 10, 7, 0, 0)));
    expect(fmt(endOfLocalDay("2026-10-06"))).toBe(fmt(local(2026, 10, 7, 0, 0)));
  });
  it("sem tempo mínimo no dia: não há oferta", () => {
    expect(offerExpiresAt(local(2026, 10, 6, 23, 50), "2026-10-06", 120, cfg)).toBeNull();
  });
});

describe("oferta para data que não é dia útil (PAR-43, T-08, N2)", () => {
  it("no próprio sábado: minutos corridos a partir do início do horário comercial ou de agora, limitados ao fim do dia", () => {
    // 10/10/2026 é sábado
    expect(fmt(offerExpiresAt(local(2026, 10, 10, 8, 0), "2026-10-10", 120, cfg)!)).toBe(fmt(local(2026, 10, 10, 11, 0)));
    expect(fmt(offerExpiresAt(local(2026, 10, 10, 14, 0), "2026-10-10", 120, cfg)!)).toBe(fmt(local(2026, 10, 10, 16, 0)));
    expect(fmt(offerExpiresAt(local(2026, 10, 10, 23, 0), "2026-10-10", 120, cfg)!)).toBe(fmt(local(2026, 10, 11, 0, 0)));
  });
  it("feita na sexta à noite para o sábado: não vence de madrugada; conta a partir do horário comercial do sábado", () => {
    expect(fmt(offerExpiresAt(local(2026, 10, 9, 17, 0), "2026-10-10", 120, cfg)!)).toBe(fmt(local(2026, 10, 10, 11, 0)));
    expect(fmt(offerExpiresAt(local(2026, 10, 9, 22, 0), "2026-10-10", 120, cfg)!)).toBe(fmt(local(2026, 10, 10, 11, 0)));
  });
  it("feita com folga em dia útil anterior: vale o prazo útil, que termina antes da data", () => {
    expect(fmt(offerExpiresAt(local(2026, 10, 7, 10, 0), "2026-10-10", 120, cfg)!)).toBe(fmt(local(2026, 10, 7, 12, 0)));
  });
  it("dia fechado no calendário segue a mesma regra", () => {
    expect(fmt(offerExpiresAt(local(2026, 10, 12, 8, 0), "2026-10-12", 120, cfg)!)).toBe(fmt(local(2026, 10, 12, 11, 0)));
    expect(fmt(offerExpiresAt(local(2026, 10, 9, 16, 0), "2026-10-12", 120, cfg)!)).toBe(fmt(local(2026, 10, 9, 18, 0)));
    expect(fmt(offerExpiresAt(local(2026, 10, 9, 17, 0), "2026-10-12", 120, cfg)!)).toBe(fmt(local(2026, 10, 12, 11, 0)));
  });
});
