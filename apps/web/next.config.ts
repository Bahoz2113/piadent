import type { NextConfig } from "next";
import { join } from "node:path";

const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const dev = process.env.NODE_ENV !== "production";
// İçerik güvenliği politikası nonce'lu olarak middleware.ts'de üretilir (sayfa başına). Burada yalnız sabit başlıklar.

const config: NextConfig = {
  // Konteyner imajı için bağımsız çıktı (NEXT_OUTPUT=standalone); yerelde `next start` aynı kalır.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const, outputFileTracingRoot: join(__dirname, "../..") } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@viadent/contracts"],
  // Web ve API aynı origin altında: çerez SameSite=Lax + CSRF başlığı (ADR-005).
  // Serverless (tek proje) kurulumunda API aynı fonksiyonda gömülüdür (pages/api/v1/[[...path]].ts); yeniden yazma yapılmaz.
  async rewrites() {
    return process.env.VIADENT_SERVERLESS === "1" ? [] : [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
  // Gömülü API paketi webpack'e girmez; fonksiyon paketine dosya olarak eklenir.
  outputFileTracingIncludes: { "/api/v1/[[...path]]": ["./vendor/viadent-api.cjs"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // HSTS yalnız üretimde (TLS sonlandırıcı arkasında); yerelde http kullanıldığı için verilmez.
          ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default config;
