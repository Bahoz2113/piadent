import type { Metadata } from "next";

// Sayfa başlığı (QA-004 / erişilebilirlik): kök şablonla "Yönetim · PİA-DENT" olur; ilk HTML'de ve istemci geçişlerinde dolu.
export const metadata: Metadata = { title: "Yönetim" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
