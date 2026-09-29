import { describe, expect, it } from "vitest";
import { formatCpf, maskCpf, normalizeCpf, syntheticCpf } from "@/modules/employees/cpf";

describe("CPF", () => {
  it("normaliza e valida dígitos, preservando zeros à esquerda", () => {
    const c = syntheticCpf(1);
    expect(normalizeCpf(formatCpf(c))).toBe(c);
    expect(normalizeCpf("012.345.678-90")).toBe("01234567890");
  });
  it("rejeita sequências repetidas, tamanho errado e dígito verificador errado", () => {
    expect(normalizeCpf("11111111111")).toBeNull();
    expect(normalizeCpf("1234567890")).toBeNull();
    const c = syntheticCpf(7);
    const wrong = c.slice(0, 10) + String((Number(c[10]) + 1) % 10);
    expect(normalizeCpf(wrong)).toBeNull();
  });
  it("CPF sintético é válido e usa prefixo reservado", () => {
    for (let i = 0; i < 50; i++) {
      const c = syntheticCpf(i);
      expect(c.startsWith("999")).toBe(true);
      expect(normalizeCpf(c)).toBe(c);
    }
  });
  it("máscara mostra só os dois últimos dígitos", () => {
    expect(maskCpf("90")).toBe("•••.•••.•••-90");
    expect(maskCpf("90")).not.toMatch(/\d{3}/);
  });
});
