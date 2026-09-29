import { NextResponse, type NextRequest } from "next/server";

/**
 * Verificação otimista pelo cookie de sessão: sem cookie, nem chega a renderizar.
 * A verificação real (banco, status, permissões) acontece nos layouts e nas ações.
 */
const PROTECTED = ["/inicio", "/perfil", "/admin"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  const hasSession = request.cookies.getAll().some((c) => c.name.endsWith("session_token"));
  if (hasSession) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/entrar";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/inicio/:path*", "/perfil/:path*", "/admin/:path*", "/inicio", "/perfil", "/admin"],
};
