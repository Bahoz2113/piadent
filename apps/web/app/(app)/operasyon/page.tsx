"use client";
import { useEffect, useState } from "react";
import type { Permission } from "@viadent/contracts";
import { formatTRY } from "@viadent/contracts";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { EmptyState, ErrorState, Loading, useToast } from "@/components/ui";
import { LabOrderDrawer, LabOrdersTable, type LabOrder } from "@/components/operations/lab";
import { StockPanel } from "@/components/operations/stock";
import { SuppliersPanel } from "@/components/operations/suppliers";

const TABS: { id: string; label: string; perm: Permission }[] = [
  { id: "laboratuvar", label: "Laboratuvar", perm: "lab.read" },
  { id: "stok", label: "Stok", perm: "stock.read" },
  { id: "tedarikci", label: "Tedarikçiler ve cari", perm: "lab.read" },
];
const FILTERS = [["open", "Açık"], ["overdue", "Geciken"], ["received", "Kabul bekliyor"], ["closed", "Kapanan"], ["all", "Tümü"]] as const;

export default function OperationsPage() {
  const { can } = useSession();
  const toast = useToast();
  const tabs = TABS.filter((t) => can(t.perm));
  const [tab, setTab] = useState(tabs[0]?.id ?? "");
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const want = q.get("sekme");
    if (want && tabs.some((t) => t.id === want)) setTab(want);
    if (q.get("is")) { setTab("laboratuvar"); setOpenId(q.get("is")); }
  }, [tabs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="page-head"><div><h1>Operasyon</h1><p>Laboratuvar işleri, stok ve tedarikçi carisi.</p></div></div>
      {tabs.length === 0 ? <div className="card"><EmptyState title="Bu bölüm için yetkiniz yok" /></div> : (
        <>
          <div className="subtabs" role="tablist" aria-label="Operasyon bölümleri">
            {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`btn btn-sm ${tab === t.id ? "btn-primary" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
          </div>
          <div role="tabpanel">
            {tab === "laboratuvar" && <LabBoard openId={openId} setOpenId={setOpenId} />}
            {tab === "stok" && <StockPanel notify={toast.show} />}
            {tab === "tedarikci" && <SuppliersPanel notify={toast.show} />}
          </div>
        </>
      )}
      {toast.node}
    </>
  );
}

function LabBoard({ openId, setOpenId }: { openId: string | null; setOpenId: (id: string | null) => void }) {
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
          <div><h2>İş emirleri</h2><p className="muted small">Yeni iş emri hastanın kartındaki Laboratuvar sekmesinden açılır. Teslim alındı ≠ kabul edildi.</p></div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {FILTERS.map(([k, l]) => <button key={k} className={`btn btn-sm ${filter === k ? "btn-primary" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
        </div>
        {list.error ? <ErrorState error={list.error} /> : !list.data ? <Loading /> : list.data.items.length === 0 ? <EmptyState title="Bu süzgeçte iş emri yok" /> :
          <LabOrdersTable items={list.data.items} onOpen={(o) => setOpenId(o.id)} />}
      </section>
      {openId && <LabOrderDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => { void list.reload(); void sum.reload(); }} />}
    </div>
  );
}
