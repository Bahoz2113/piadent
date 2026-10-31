import type { Metadata } from "next";

// Sayfa başlığı (QA-004 / erişilebilirlik): kök şablonla "Hastalar · PİA-DENT" olur; ilk HTML'de ve istemci geçişlerinde dolu.
// Alt rota (/hastalar/[id]) şablonu yalnız bir üst katmandan alır; "Hasta · PİA-DENT" için şablon burada da verilir.
export const metadata: Metadata = { title: { default: "Hastalar", template: "%s · PİA-DENT" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
