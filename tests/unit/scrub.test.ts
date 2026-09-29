import { describe, expect, it } from "vitest";
import { scrub } from "@/modules/shared/logger";

describe("redação de logs", () => {
  it("remove CPF com e sem máscara e chaves sensíveis", () => {
    const out = scrub({ msg: "cpf 12345678901 e 123.456.789-01 informados", cpf: "12345678901", password: "abc", nested: { token: "t", fine: "ok" } }) as Record<string, unknown>;
    expect(out.msg).toBe("cpf [cpf] e [cpf] informados");
    expect(out.cpf).toBe("[redigido]");
    expect(out.password).toBe("[redigido]");
    expect((out.nested as Record<string, unknown>).token).toBe("[redigido]");
    expect((out.nested as Record<string, unknown>).fine).toBe("ok");
  });
  it("mantém números curtos e datas", () => {
    expect(scrub("2026-09-28 às 10:00, 90 mesas")).toBe("2026-09-28 às 10:00, 90 mesas");
  });
});
