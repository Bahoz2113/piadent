import type { Metadata } from "next";

// 08.11.2026 (ADR-108): Laboratuvar menüsü — hasta işleri, malzeme siparişleri, tedarikçiler. Sayfa başlığı "Laboratuvar · PİA-DENT".
export const metadata: Metadata = { title: "Laboratuvar" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
