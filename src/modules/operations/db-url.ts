/*
 * Conferência das URLs de banco antes do build de produção (DEC-45). Variável Secret não pode ser lida de volta na
 * Vercel; quando a URL está fora do formato, o build diz o que está errado e mostra a URL com toda senha mascarada.
 */

/** Esconde senhas e sequências longas que possam ser segredo; mantém esquema, usuário, servidor e banco. */
export function maskDbUrl(raw: string): string {
  return raw
    .replace(/:([^:@\s]+)@/g, ":****@")
    .replace(/npg_[A-Za-z0-9]+/g, "npg_****")
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, "****")
    .slice(0, 200);
}

/** Primeiro problema de formato encontrado na URL, ou null se ela serve para conectar. */
export function dbUrlProblem(raw: string, expectedUser?: string): string | null {
  if (raw !== raw.trim()) return "espaço ou quebra de linha no começo ou no fim";
  if (/["'<>()]/.test(raw)) return "aspas, parênteses ou sinais < > sobrando do modelo";
  if (/\s/.test(raw)) return "espaço no meio";
  if (!/^postgres(ql)?:\/\//.test(raw)) return "não começa com postgresql://";
  if ((raw.match(/@/g) ?? []).length !== 1) return "mais de um @ (texto colado a mais)";
  if ((raw.match(/:\/\//g) ?? []).length !== 1) return "mais de um :// (texto colado a mais)";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "endereço inválido";
  }
  if (!url.username) return "sem usuário";
  if (!url.password) return "sem senha";
  if (!url.hostname) return "sem servidor";
  if (!/^\/[^/]+$/.test(url.pathname)) return "nome do banco ausente ou com barra a mais";
  if (expectedUser && decodeURIComponent(url.username) !== expectedUser) return `usuário ${decodeURIComponent(url.username)}, esperado ${expectedUser}`;
  return null;
}
