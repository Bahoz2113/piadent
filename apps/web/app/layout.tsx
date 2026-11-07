import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { appearanceBootScript } from "@/lib/appearance";

export const metadata: Metadata = {
  title: { default: "PİA-DENT", template: "%s · PİA-DENT" },
  description: "Kliniğin akışı, tek yerde.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1E3A8A" };

// Nonce'lu CSP için her sayfa istek anında üretilir (statik ön üretim nonce taşıyamaz).
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined; // CSP nonce'ı middleware üretir; görünüm betiği bununla çalışır
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        {/* Görünüm tercihi (ADR-082): hidrasyondan önce uygulanır, ilk boyamada şema titremesi olmaz. localStorage dışında hiçbir şey okumaz. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: appearanceBootScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
