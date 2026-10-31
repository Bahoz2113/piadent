import type { Metadata } from "next";

// Sayfa başlığı (QA-004 / erişilebilirlik): kök şablonla "Ajanda · VİADENT" olur; ilk HTML'de ve istemci geçişlerinde dolu.
export const metadata: Metadata = { title: "Ajanda" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
