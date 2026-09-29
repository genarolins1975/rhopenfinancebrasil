import { env } from "@/modules/shared/env";
import { decryptGcm, encryptGcm, hmacSha256, keyFromBase64 } from "@/modules/shared/crypto";

/**
 * CPF é texto de 11 dígitos, normalizado, com zeros à esquerda preservados.
 * Verificar formato e dígitos não verifica identidade.
 */
export function normalizeCpf(input: string): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  if (digits.length !== 11) return null;
  if (/^(\d)\1{10}$/.test(digits)) return null;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  if (calc(9) !== Number(digits[9])) return null;
  if (calc(10) !== Number(digits[10])) return null;
  return digits;
}

/** Gera CPF sintético válido para ambientes de teste, com prefixo reservado 999. */
export function syntheticCpf(seed: number): string {
  const base = `999${String(seed % 1_000_000).padStart(6, "0")}`;
  const d = (s: string, len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(s[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = d(base, 9);
  const d2 = d(base + d1, 10);
  return `${base}${d1}${d2}`;
}

export function maskCpf(suffix: string): string {
  return `•••.•••.•••-${suffix}`;
}

export function formatCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

function encKeys(): Record<number, Buffer> {
  return { 1: keyFromBase64(env().CPF_ENC_KEY_V1) };
}
function hmacKeys(): Record<number, Buffer> {
  return { 1: keyFromBase64(env().CPF_HMAC_KEY_V1) };
}

export type ProtectedCpf = {
  cpfCiphertext: Buffer;
  cpfKeyVersion: number;
  cpfHmac: Buffer;
  cpfHmacKeyVersion: number;
  cpfSuffix: string;
};

/** Cifra com AAD = id da pessoa; índice HMAC com chave separada; sufixo para máscara sem decifrar. */
export function protectCpf(cpf: string, employeeId: string): ProtectedCpf {
  const version = env().CPF_KEY_VERSION;
  const key = encKeys()[version];
  if (!key) throw new Error("versão de chave do CPF sem chave configurada");
  return {
    cpfCiphertext: encryptGcm(key, version, Buffer.from(cpf, "utf8"), Buffer.from(employeeId, "utf8")),
    cpfKeyVersion: version,
    cpfHmac: cpfHmac(cpf),
    cpfHmacKeyVersion: version,
    cpfSuffix: cpf.slice(9),
  };
}

export function cpfHmac(cpf: string): Buffer {
  const version = env().CPF_KEY_VERSION;
  const key = hmacKeys()[version];
  if (!key) throw new Error("versão de chave HMAC sem chave configurada");
  return hmacSha256(key, cpf);
}

export function revealCpf(ciphertext: Buffer, employeeId: string): string {
  return decryptGcm(encKeys(), ciphertext, Buffer.from(employeeId, "utf8")).toString("utf8");
}
