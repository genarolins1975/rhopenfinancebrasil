import pino from "pino";

/** Padrões que nunca podem sair em log: CPF com ou sem máscara, tokens longos. */
const CPF_DIGITS = /\b\d{11}\b/g;
const CPF_MASKED = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{40,}\b/g;

/** Redação restrita ao CPF, para cargas que precisam conservar links e tokens de uso único (outbox). */
export function scrubCpf(value: unknown): unknown {
  if (typeof value === "string") return value.replace(CPF_MASKED, "[cpf]").replace(CPF_DIGITS, "[cpf]");
  if (Array.isArray(value)) return value.map(scrubCpf);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /cpf/i.test(k) ? "[redigido]" : scrubCpf(v);
    }
    return out;
  }
  return value;
}

export function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(CPF_MASKED, "[cpf]")
      .replace(CPF_DIGITS, "[cpf]")
      .replace(LONG_TOKEN, "[token]");
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /cpf|password|senha|token|secret|authorization|cookie/i.test(k) ? "[redigido]" : scrub(v);
    }
    return out;
  }
  return value;
}

const level = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level,
  base: { app: "rhopenfinancebrasil" },
  redact: {
    paths: ["*.cpf", "*.password", "*.senha", "*.token", "*.secret", "req.headers.cookie", "req.headers.authorization"],
    censor: "[redigido]",
  },
  formatters: {
    log(obj) {
      return scrub(obj) as Record<string, unknown>;
    },
  },
  hooks: {
    logMethod(args, method) {
      const scrubbed = args.map((a) => scrub(a)) as Parameters<typeof method>;
      return method.apply(this, scrubbed);
    },
  },
  transport:
    (process.env.APP_ENV ?? "development") === "development" && process.env.NODE_ENV !== "test"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
