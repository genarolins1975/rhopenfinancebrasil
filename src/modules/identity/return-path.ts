/**
 * Retorno depois do login, restrito a rotas conhecidas (hoje só a do QR da mesa), para não abrir redirecionamento
 * para fora do portal. Qualquer outro valor é ignorado.
 */
const ALLOWED = [/^\/escritorio\/qr\/[A-Za-z0-9-]{2,12}$/];

export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  return ALLOWED.some((re) => re.test(value)) ? value : null;
}
