"use client";
/**
 * Laboratuvar (ADR-108, 08.11.2026 ürün sahibi geri bildirimi): tedarikçiye sipariş ve takibi tek menüde.
 *  - Hasta işleri: laboratuvar iş emirleri (ölçü türü/tarihi, istenen malzeme, diş, renk, hedef teslim); yeni iş emri hasta seçilerek buradan da açılır.
 *  - Malzeme siparişleri: tedarikçiye sipariş, teslim takibi, teslimde stok girişi (+ isteğe bağlı cari borç).
 *  - Tedarikçiler: tedarikçi / laboratuvar tanımı ve cari; ürün ve fiyat listesi.
 * Eski bağlantılar (/operasyon?is=…, ?sekme=laboratuvar|tedarikci) buraya yönlenir.
 */
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { Permission } from "@viadent/contracts";
import { formatTRY } from "@viadent/contracts";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { EmptyState, ErrorState, Loading, useToast } from "@/components/ui";
import { LabOrderDrawer, LabOrdersTable, NewLabOrderDrawer, type LabOrder } from "@/components/operations/lab";
import { PurchaseOrdersPanel } from "@/components/operations/purchase-orders";
import { SuppliersPanel } from "@/components/operations/suppliers";
import { ProductsPanel } from "@/components/admin/products";

const TABS: { id: string; label: string; perm: Permission }[] = [
  { id: "hasta-isleri", label: "Hasta işleri", perm: "lab.read" },
  { id: "siparisler", label: "Malzeme siparişleri", perm: "stock.read" },
  { id: "tedarikci", label: "Tedarikçiler", perm: "lab.read" },
];
const FILTERS = [["open", "Açık"], ["overdue", "Geciken"], ["received", "Kabul bekliyor"], ["closed", "Kapanan"], ["all", "Tümü"]] as const;

export default function LaboratoryPage() {
  const { can } = useSession();
  const toast = useToast();
  const tabs = TABS.filter((t) => can(t.perm));
  const [tab, setTab] = useState(tabs[0]?.id ?? "");
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const want = q.get("sekme");
    if (want && tabs.some((t) => t.id === want)) setTab(want);
    if (q.get("is")) { setTab("hasta-isleri"); setOpenId(q.get("is")); }
  }, [tabs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="page-head"><div><h1>Laboratuvar</h1><p>Hasta işleri (ölçü, istenen malzeme), tedarikçiye malzeme siparişi ve takibi, tedarikçiler.</p></div></div>
      {tabs.length === 0 ? <div className="card"><EmptyState title="Bu bölüm için yetkiniz yok" /></div> : (
        <>
          <div className="subtabs" role="tablist" aria-label="Laboratuvar bölümleri">
            {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`btn btn-sm ${tab === t.id ? "btn-primary" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
          </div>
          <div role="tabpanel">
            {tab === "hasta-isleri" && <LabBoard openId={openId} setOpenId={setOpenId} notify={toast.show} />}
            {tab === "siparisler" && <PurchaseOrdersPanel notify={toast.show} />}
            {tab === "tedarikci" && <div className="stack" style={{ gap: 16 }}><SuppliersPanel notify={toast.show} />{can("stock.read") && <ProductsPanel notify={toast.show} />}</div>}
          </div>
        </>
      )}
      {toast.node}
    </>
  );
}

function LabBoard({ openId, setOpenId, notify }: { openId: string | null; setOpenId: (id: string | null) => void; notify: (k: "success" | "error", t: string) => void }) {
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("open");
  const sum = useData<{ atLab: number; overdue: number; awaitingDecision: number; drafts: number; costThisMonth?: string }>("/lab-orders-summary");
  const list = useData<{ items: LabOrder[] }>(`/lab-orders${filter === "all" ? "" : `?status=${filter}`}`);
  const tile = (label: string, value: string | number, f?: (typeof FILTERS)[number][0]) => (
    <button className="card stat" style={{ textAlign: "left", cursor: f ? "pointer" : "default" }} onClick={() => f && setFilter(f)} aria-pressed={f ? filter === f : undefined}>
      <div className="label">{label}</div><div className="value">{value}</div></button>
  );
  return (
    <div className="stack" style={{ gap: 16 }}>
      {sum.data && (
        <div className="stats">
          {tile("Laboratuvarda", sum.data.atLab, "open")}
          {tile("Geciken", sum.data.overdue, "overdue")}
          {tile("Kabul bekleyen", sum.data.awaitingDecision, "received")}
          {sum.data.costThisMonth !== undefined ? tile("Bu ay maliyet", formatTRY(sum.data.costThisMonth)) : tile("Taslak", sum.data.drafts)}
        </div>
      )}
      <section className="card">
        <div className="card-head">
          <div><h2>Hasta işleri</h2><p className="muted small">Hastadan alınan ölçü, istenen malzeme ve laboratuvar iş emirleri. Teslim alındı ≠ kabul edildi.</p></div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {FILTERS.map(([k, l]) => <button key={k} className={`btn btn-sm ${filter === k ? "btn-primary" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
            {can("lab.write") && <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}><Plus size={15} aria-hidden />Yeni iş emri</button>}
          </div>
        </div>
        {list.error ? <ErrorState error={list.error} /> : !list.data ? <Loading /> : list.data.items.length === 0 ? <EmptyState title="Bu süzgeçte iş emri yok" /> :
          <LabOrdersTable items={list.data.items} onOpen={(o) => setOpenId(o.id)} />}
      </section>
      {creating && <NewLabOrderDrawer onClose={() => setCreating(false)} onSaved={(no, id) => { setCreating(false); notify("success", `İş emri ${no} taslak olarak açıldı.`); void list.reload(); void sum.reload(); setOpenId(id); }} />}
      {openId && <LabOrderDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => { void list.reload(); void sum.reload(); }} />}
    </div>
  );
}
