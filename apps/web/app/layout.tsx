import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PİA-DENT", template: "%s · PİA-DENT" },
  description: "Kliniğin akışı, tek yerde.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#123C34" };

// Nonce'lu CSP için her sayfa istek anında üretilir (statik ön üretim nonce taşıyamaz).
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers(); // istek başlıklarını okuyarak dinamik işlemeyi zorunlu kılar (nonce middleware'den gelir)
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
