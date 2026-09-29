import { NextResponse, type NextRequest } from "next/server";

/**
 * Verificação otimista pelo cookie de sessão: sem cookie, nem chega a renderizar.
 * A verificação real (banco, status, permissões) acontece nos layouts e nas ações.
 */
const PROTECTED = ["/inicio", "/perfil", "/admin"];
const QR = /^\/escritorio\/qr\/[A-Za-z0-9-]{2,12}$/;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // QR da mesa sem sessão: login com retorno à própria rota do QR (lista fechada em identity/return-path).
  if (QR.test(pathname)) {
    if (request.cookies.getAll().some((c) => c.name.endsWith("session_token"))) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = `?volta=${encodeURIComponent(pathname.toUpperCase().replace("/ESCRITORIO/QR/", "/escritorio/qr/"))}`;
    return NextResponse.redirect(url);
  }
  if (!PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  const hasSession = request.cookies.getAll().some((c) => c.name.endsWith("session_token"));
  if (hasSession) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/entrar";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/inicio/:path*", "/perfil/:path*", "/admin/:path*", "/inicio", "/perfil", "/admin", "/escritorio/qr/:path*"],
};
