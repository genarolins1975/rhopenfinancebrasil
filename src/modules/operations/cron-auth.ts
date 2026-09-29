import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Autorização da rota agendada (DEC-45): só com `CRON_SECRET` configurado e o cabeçalho `Authorization: Bearer <segredo>`,
 * que a Vercel envia nas execuções agendadas. Comparação em tempo constante sobre os resumos, sem vazar o tamanho.
 */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header) return false;
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}
