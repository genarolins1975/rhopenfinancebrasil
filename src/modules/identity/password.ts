import { createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { env } from "@/modules/shared/env";
import { logger } from "@/modules/shared/logger";

/** Parâmetros do cheat sheet OWASP (PAR-10): m = 47104 KiB, t = 1, p = 1. */
// Argon2id é o algoritmo padrão da biblioteca; o teste de unidade confere o prefixo $argon2id$.
const ARGON2 = { memoryCost: 47104, timeCost: 1, parallelism: 1 } as const;

export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 128;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}

export async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(data.hash, data.password);
  } catch {
    return false;
  }
}

/** Lista curta de senhas notoriamente comuns; complementa a consulta por k anonimato. */
const COMMON = new Set(
  [
    "password", "senha", "123456", "12345678", "123456789", "1234567890", "qwerty", "abc123", "111111", "iloveyou",
    "admin", "welcome", "letmein", "monkey", "dragon", "football", "baseball", "master", "sunshine", "princess",
    "openfinance", "open finance", "openfinancebrasil", "rhopenfinancebrasil", "portal do colaborador",
  ].map((s) => s.toLowerCase()),
);

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

/**
 * Política: 15 a 128 caracteres, sem exigência de composição, sem partes do email,
 * sem sequência de 11 dígitos (CPF), sem senhas notoriamente comuns.
 */
export function checkPasswordPolicy(password: string, context: { email?: string; name?: string } = {}): PasswordCheck {
  if (password.length < PASSWORD_MIN) return { ok: false, reason: `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.` };
  if (password.length > PASSWORD_MAX) return { ok: false, reason: `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.` };
  const lower = password.toLowerCase();
  if (COMMON.has(lower.trim())) return { ok: false, reason: "Esta senha é muito comum. Escolha uma frase longa e pessoal." };
  if (/\d{11}/.test(password.replace(/\D/g, ""))) return { ok: false, reason: "A senha não pode conter uma sequência de 11 dígitos." };
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return { ok: false, reason: "A senha não pode conter o seu email." };
  const nameParts = (context.name ?? "").toLowerCase().split(/\s+/).filter((p) => p.length >= 4);
  if (nameParts.some((p) => lower.includes(p))) return { ok: false, reason: "A senha não pode conter o seu nome." };
  return { ok: true };
}

/**
 * Consulta por k anonimato: só os cinco primeiros caracteres do SHA1 saem do servidor (PAR-20).
 * Indisponibilidade do serviço não bloqueia a operação; fica registrada.
 */
export async function isPasswordBreached(password: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (env().PASSWORD_BREACH_CHECK !== "on") return false;
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "rhopenfinancebrasil" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.text();
    return body.split("\n").some((line) => {
      const [hashSuffix, count] = line.trim().split(":");
      return hashSuffix === suffix && Number(count) > 0;
    });
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "verificação de senha comprometida indisponível");
    return false;
  }
}
