import type { Metadata } from "next";

// 08.11.2026: PİA Akış ayrı menü sekmesi. Sayfa başlığı "İş akışı · PİA-DENT".
export const metadata: Metadata = { title: "İş akışı" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
