import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/modules/identity/auth";

/**
 * O portal usa server actions para tudo o que envolve sessão. Pela rede, só os caminhos
 * que chegam por link de email são servidos. Tudo o mais responde 404.
 */
const handler = toNextJsHandler(auth);

const ALLOWED_GET = new Set(["/api/auth/verify-email", "/api/auth/ok"]);

function normalize(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export async function GET(request: Request) {
  const path = normalize(new URL(request.url).pathname);
  if (!ALLOWED_GET.has(path)) return new Response("Não encontrado", { status: 404 });
  return handler.GET(request);
}

export async function POST() {
  return new Response("Não encontrado", { status: 404 });
}
