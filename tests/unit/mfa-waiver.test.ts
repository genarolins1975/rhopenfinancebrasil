import { afterEach, describe, expect, it, vi } from "vitest";

/* DEC-46: segundo fator dispensado só na demonstração; fora dela, a variável impede o processo de subir. */

const saved = { APP_ENV: process.env.APP_ENV, DEMO_MFA_OPTIONAL: process.env.DEMO_MFA_OPTIONAL };

async function freshEnv() {
  vi.resetModules();
  return import("@/modules/shared/env");
}

describe("dispensa do segundo fator", () => {
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("vale só com APP_ENV=demo e DEMO_MFA_OPTIONAL=on", async () => {
    const { mfaWaived } = await freshEnv();
    for (const [app, flag, expected] of [
      ["demo", "on", true],
      ["demo", "off", false],
      ["demo", undefined, false],
      ["production", "on", false],
      ["homolog", "on", false],
      ["test", "on", false],
    ] as const) {
      process.env.APP_ENV = app;
      if (flag === undefined) delete process.env.DEMO_MFA_OPTIONAL;
      else process.env.DEMO_MFA_OPTIONAL = flag;
      expect(mfaWaived()).toBe(expected);
    }
  });

  it("fora da demonstração, DEMO_MFA_OPTIONAL=on é recusada na validação do ambiente", async () => {
    process.env.APP_ENV = "production";
    process.env.DEMO_MFA_OPTIONAL = "on";
    const { env } = await freshEnv();
    expect(() => env()).toThrow(/DEMO_MFA_OPTIONAL/);
  });

  it("na demonstração, DEMO_MFA_OPTIONAL=on é aceita", async () => {
    process.env.APP_ENV = "demo";
    process.env.DEMO_MFA_OPTIONAL = "on";
    const { env } = await freshEnv();
    expect(env().DEMO_MFA_OPTIONAL).toBe("on");
  });
});
