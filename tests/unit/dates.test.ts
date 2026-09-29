import { describe, expect, it } from "vitest";
import { addDays, localToday } from "@/modules/shared/dates";

describe("dia local", () => {
  it("vira o dia às 00:00 de Brasília, não às 00:00 UTC", () => {
    expect(localToday(new Date("2026-10-01T02:59:00Z"))).toBe("2026-09-30");
    expect(localToday(new Date("2026-10-01T03:00:00Z"))).toBe("2026-10-01");
    expect(localToday(new Date("2026-09-30T23:59:00-03:00"))).toBe("2026-09-30");
  });
  it("soma dias em calendário", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});
