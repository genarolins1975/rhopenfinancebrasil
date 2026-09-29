import { describe, expect, it } from "vitest";
import { cronAuthorized } from "@/modules/operations/cron-auth";

/* DEC-45: a rota agendada só roda com o segredo configurado e o cabeçalho exato que a Vercel envia. */

const secret = "a".repeat(64);

describe("autorização da rota agendada de operação", () => {
  it("aceita só Bearer com o segredo exato", () => {
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(cronAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(cronAuthorized(secret, secret)).toBe(false);
    expect(cronAuthorized(`bearer ${secret}`, secret)).toBe(false);
  });
  it("sem segredo configurado, ou curto, nada passa, nem cabeçalho vazio", () => {
    expect(cronAuthorized("Bearer ", undefined)).toBe(false);
    expect(cronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(cronAuthorized(`Bearer ${"b".repeat(10)}`, "b".repeat(10))).toBe(false);
    expect(cronAuthorized(null, secret)).toBe(false);
  });
});
