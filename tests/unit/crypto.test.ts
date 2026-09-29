import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptGcm, encryptGcm } from "@/modules/shared/crypto";

describe("AES GCM com AAD", () => {
  const key = randomBytes(32);
  it("cifra e decifra com nonce diferente a cada gravação", () => {
    const a = encryptGcm(key, 1, Buffer.from("01234567890"), Buffer.from("pessoa-a"));
    const b = encryptGcm(key, 1, Buffer.from("01234567890"), Buffer.from("pessoa-a"));
    expect(a.equals(b)).toBe(false);
    expect(a[0]).toBe(1);
    expect(decryptGcm({ 1: key }, a, Buffer.from("pessoa-a")).toString()).toBe("01234567890");
  });
  it("troca de texto cifrado entre pessoas falha pelo AAD", () => {
    const a = encryptGcm(key, 1, Buffer.from("01234567890"), Buffer.from("pessoa-a"));
    expect(() => decryptGcm({ 1: key }, a, Buffer.from("pessoa-b"))).toThrow();
  });
  it("versão de chave desconhecida falha sem tentar decifrar", () => {
    const a = encryptGcm(key, 2, Buffer.from("x"), Buffer.from("p"));
    expect(() => decryptGcm({ 1: key }, a, Buffer.from("p"))).toThrow(/versão 2/);
  });
});
