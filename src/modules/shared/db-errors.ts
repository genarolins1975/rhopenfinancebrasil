import { ConflictError, DomainError, ValidationError } from "./errors";
import { scrub } from "./logger";

type PgError = { code?: string; constraint?: string; table?: string; column?: string };

/** Localiza o erro do driver PostgreSQL dentro da cadeia de causas (Drizzle envolve o erro original). */
export function pgErrorOf(e: unknown): PgError | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const c = cur as { code?: unknown; cause?: unknown };
    if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code)) return cur as PgError;
    cur = c.cause;
  }
  return null;
}

/** Converte erro de banco em erro de domínio com mensagem genérica. Nunca repassa a mensagem do driver. */
export function translateDbError(e: unknown): DomainError | null {
  const pg = pgErrorOf(e);
  if (!pg) return null;
  switch (pg.code) {
    case "23505":
      return new ConflictError("Já existe registro com estes dados.");
    case "23503":
      return new ValidationError("Referência inválida. Confira os dados informados.");
    case "23502":
    case "23514":
    case "22P02":
    case "22007":
    case "22008":
    case "22001":
      return new ValidationError("Dados inválidos. Confira os campos informados.");
    case "40001":
    case "40P01":
    case "55P03":
      return new ConflictError("A operação disputou com outra. Tente de novo.");
    default:
      return null;
  }
}

/** Informação segura para log: código e constraint, nunca a mensagem do driver, que carrega os parâmetros da consulta. */
export function safeErrorInfo(e: unknown): Record<string, unknown> {
  const pg = pgErrorOf(e);
  if (pg) return { kind: "pg", code: pg.code, constraint: pg.constraint, table: pg.table };
  if (e instanceof DomainError) return { kind: "domain", code: e.code };
  if (e && typeof e === "object" && "status" in e) return { kind: "api", status: (e as { status: unknown }).status };
  if (e instanceof Error) return { kind: e.name, message: e.message.startsWith("Failed query") ? "[consulta redigida]" : scrub(e.message) };
  return { kind: typeof e };
}

/** Executa uma operação de banco convertendo erros do driver em erros de domínio. */
export async function withDbErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const translated = translateDbError(e);
    if (translated) throw translated;
    throw e;
  }
}
