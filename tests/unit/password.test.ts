import { describe, expect, it } from "vitest";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@/modules/identity/password";

describe("política de senha", () => {
  it("exige 15 caracteres e aceita frases longas sem composição", () => {
    expect(checkPasswordPolicy("curta demais").ok).toBe(false);
    expect(checkPasswordPolicy("uma frase longa e pessoal sem simbolos").ok).toBe(true);
    expect(checkPasswordPolicy("a".repeat(129)).ok).toBe(false);
    expect(checkPasswordPolicy("a".repeat(64)).ok).toBe(true);
  });
  it("bloqueia senhas comuns, sequência de 11 dígitos e partes do email ou nome", () => {
    expect(checkPasswordPolicy("openfinancebrasil").ok).toBe(false);
    expect(checkPasswordPolicy("minha senha 12345678901 ok").ok).toBe(false);
    expect(checkPasswordPolicy("maria.silva e mais coisas", { email: "maria.silva@x.org" }).ok).toBe(false);
    expect(checkPasswordPolicy("Fernanda gosta de cafe forte", { name: "Fernanda Souza" }).ok).toBe(false);
  });
  it("usa Argon2id e verifica", async () => {
    const h = await hashPassword("uma frase longa e pessoal");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).toContain("m=47104,t=1,p=1");
    expect(await verifyPassword({ hash: h, password: "uma frase longa e pessoal" })).toBe(true);
    expect(await verifyPassword({ hash: h, password: "outra" })).toBe(false);
    expect(await verifyPassword({ hash: "lixo", password: "x" })).toBe(false);
  });
});
