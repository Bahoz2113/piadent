import type { Metadata } from "next";

// Sayfa başlığı (QA-004 / erişilebilirlik): kök şablonla "Hastalar · VİADENT" olur; ilk HTML'de ve istemci geçişlerinde dolu.
// Alt rota (/hastalar/[id]) şablonu yalnız bir üst katmandan alır; "Hasta · VİADENT" için şablon burada da verilir.
export const metadata: Metadata = { title: { default: "Hastalar", template: "%s · VİADENT" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
