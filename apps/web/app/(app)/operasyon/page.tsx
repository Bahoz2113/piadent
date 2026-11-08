"use client";
/**
 * Operasyon → Stok. 08.11.2026 (ADR-108): laboratuvar iş emirleri, malzeme siparişleri ve tedarikçiler "Laboratuvar" menüsüne taşındı;
 * eski bağlantılar (?is=…, ?sekme=laboratuvar|tedarikci) oraya yönlenir.
 */
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { EmptyState, useToast } from "@/components/ui";
import { StockPanel } from "@/components/operations/stock";

export default function OperationsPage() {
  const { can } = useSession();
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const is = q.get("is");
    const sekme = q.get("sekme");
    if (is) router.replace(`/laboratuvar?is=${encodeURIComponent(is)}`);
    else if (sekme === "laboratuvar") router.replace("/laboratuvar");
    else if (sekme === "tedarikci") router.replace("/laboratuvar?sekme=tedarikci");
  }, [router]);
  return (
    <>
      <div className="page-head"><div><h1>Operasyon</h1><p>Stok: kalemler, giriş, kullanım, fire, sayım. Laboratuvar işleri, malzeme siparişleri ve tedarikçiler <Link href="/laboratuvar">Laboratuvar</Link> menüsünde.</p></div></div>
      {can("stock.read") ? <StockPanel notify={toast.show} /> : <div className="card"><EmptyState title="Bu bölüm için yetkiniz yok" /></div>}
      {toast.node}
    </>
  );
}
