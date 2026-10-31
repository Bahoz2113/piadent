import type { NextConfig } from "next";

const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const dev = process.env.NODE_ENV !== "production";
// İçerik güvenliği politikası: yalnız kendi origin; çerçeveye alınamaz; dış betik/font/görsel yok (hepsi yerel).
// Next.js satır içi önyükleme betiği için 'unsafe-inline' gerekir (nonce'lu sürüm: backlog, ADR-047). Geliştirmede HMR için 'unsafe-eval'.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${dev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@viadent/contracts"],
  // Web ve API aynı origin altında: çerez SameSite=Lax + CSRF başlığı (ADR-005).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: csp },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // HSTS yalnız üretimde (TLS sonlandırıcı arkasında); yerelde http kullanıldığı için verilmez.
          ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default config;
