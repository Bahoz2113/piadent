/**
 * Nonce'lu içerik güvenliği politikası (Görev 8, ADR-050 güncellemesi): her sayfa isteğinde tek kullanımlık nonce üretilir;
 * Next.js kendi betiklerine bu nonce'ı ekler. `script-src 'unsafe-inline'` kaldırıldı → enjekte edilmiş satır içi betik çalışmaz.
 * 'strict-dynamic': nonce'lu betiğin yüklediği parçalar (Next chunk'ları) güvenilir sayılır.
 * Stil için 'unsafe-inline' kalır (React `style` öznitelikleri); stil enjeksiyonu betik çalıştıramaz.
 */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp); // Next.js nonce'ı istek başlığındaki CSP'den okur
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  // API (vekil), statik dosyalar ve ön yüklemeler hariç tüm sayfalar
  matcher: [{ source: "/((?!api/|_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};
