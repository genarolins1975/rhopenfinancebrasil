import { TZDate } from "@date-fns/tz";
import { describe, expect, it } from "vitest";
import { TZ } from "@/modules/shared/dates";
import { formatSlot, intervalOf, intervalProblem, suggestedSlot, weeksAhead } from "@/modules/spaces/rules";

/* Salas: grade de 15 minutos, fim 24:00, horizonte em semanas e sugestão de trecho (PAR-45, DEC-26). Datas de outubro de 2026. */

describe("regras de salas", () => {
  it("fim 24:00 é a meia-noite ao fim do dia e é exibido como 24:00", () => {
    const i = intervalOf("2026-10-06", "23:00", "24:00");
    expect(i.end.getTime() - i.start.getTime()).toBe(60 * 60_000);
    expect(formatSlot(i)).toBe("23:00 às 24:00");
    expect(() => intervalOf("2026-10-06", "24:00", "24:00")).toThrow();
  });
  it("problemas de intervalo: grade, ordem, limite do recurso", () => {
    const now = new TZDate(2026, 9, 6, 8, 0, 0, 0, TZ);
    expect(intervalProblem(intervalOf("2026-10-06", "10:05", "11:00"), { now, maxMinutes: null })).toMatch(/múltiplos de 15/);
    expect(intervalProblem(intervalOf("2026-10-06", "11:00", "10:00"), { now, maxMinutes: null })).toMatch(/depois do início/);
    expect(intervalProblem(intervalOf("2026-10-06", "10:00", "12:00"), { now, maxMinutes: 60 })).toMatch(/máxima/);
    expect(intervalProblem(intervalOf("2026-10-06", "10:00", "11:00"), { now, maxMinutes: 60 })).toBeNull();
  });
  it("semanas à frente contadas de segunda a domingo", () => {
    expect(weeksAhead("2026-10-06", "2026-10-11")).toBe(0);
    expect(weeksAhead("2026-10-06", "2026-10-12")).toBe(1);
    expect(weeksAhead("2026-10-11", "2026-11-09")).toBe(5);
  });
  it("sugestão de trecho: próximo múltiplo de 15 minutos; depois das 23:00, amanhã às 09:00", () => {
    expect(suggestedSlot(new TZDate(2026, 9, 6, 10, 7, 0, 0, TZ))).toEqual({ dayOffset: 0, start: "10:15", end: "11:15" });
    expect(suggestedSlot(new TZDate(2026, 9, 6, 22, 50, 0, 0, TZ))).toEqual({ dayOffset: 0, start: "23:00", end: "24:00" });
    expect(suggestedSlot(new TZDate(2026, 9, 6, 23, 10, 0, 0, TZ))).toEqual({ dayOffset: 1, start: "09:00", end: "10:00" });
  });
});
