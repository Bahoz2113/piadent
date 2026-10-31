"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Lock, Plus, RotateCcw } from "lucide-react";
import {
  CASH_ACCOUNT_KINDS, CASH_ACCOUNT_KIND_LABELS, COMMISSION_BASIS_LABELS, EXPENSE_CATEGORIES, PAYMENT_METHOD_LABELS, addDays, formatTRY, type PaymentMethod,
} from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime, todayIn } from "@/lib/format";
import { Alert, Drawer, EmptyState, ErrorState, Loading, SelectField, TextField, useToast, DateField } from "@/components/ui";
import { parseMoneyInput } from "@/components/finance/money-input";

const TABS = [
  { id: "ozet", label: "Günlük özet", perm: "finance.read" },
  { id: "bakiye", label: "Hasta bakiyeleri", perm: "finance.read" },
  { id: "kasa", label: "Kasa ve banka", perm: "finance.read" },
  { id: "gider", label: "Giderler", perm: "finance.read" },
  { id: "prim", label: "Hekim primi", perm: "finance.read" },
  { id: "ayar", label: "Ayarlar", perm: "finance.settings" },
] as const;

export default function FinancePage() {
  const { can, tz } = useSession();
  const tabs = TABS.filter((t) => can(t.perm));
  const [tab, setTab] = useState<string>(tabs[0]?.id ?? "");
  const today = todayIn(tz);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const toast = useToast();
  if (!can("finance.read")) {
    return (
      <>
        <div className="page-head"><div><h1>Finans</h1></div></div>
        <div className="card"><EmptyState icon={<Lock size={28} aria-hidden />} title="Klinik finans raporları rolünüze kapalı">
          Tahsilat almak ve hasta hesabını görmek için hastanın kartındaki <strong>Finans</strong> sekmesini kullanın.</EmptyState></div>
      </>
    );
  }
  const ranged = tab === "ozet" || tab === "kasa" || tab === "gider" || tab === "prim";
  return (
    <>
      <div className="page-head">
        <div><h1>Finans · VİA Net</h1><p>İşlem tutarı, tahsilat, iade ve gider ayrı hesaplanır. Gün sınırı klinik saatine göre ({tz}). Para birimi: TRY.</p></div>
      </div>
      <div className="subtabs" role="tablist" aria-label="Finans bölümleri">
        {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`btn btn-sm ${tab === t.id ? "btn-primary" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {ranged && (
        <div className="row" style={{ gap: 8, marginBottom: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <DateField label="Başlangıç" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
          <DateField label="Bitiş" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          <div className="row" style={{ gap: 6, paddingBottom: 2 }}>
            <button className="btn btn-sm" onClick={() => { setFrom(today); setTo(today); }}>Bugün</button>
            <button className="btn btn-sm" onClick={() => { setFrom(addDays(today, -1)); setTo(addDays(today, -1)); }}>Dün</button>
            <button className="btn btn-sm" onClick={() => { setFrom(addDays(today, -6)); setTo(today); }}>Son 7 gün</button>
            <button className="btn btn-sm" onClick={() => { setFrom(`${today.slice(0, 7)}-01`); setTo(today); }}>Bu ay</button>
          </div>
        </div>
      )}
      <div role="tabpanel">
        {tab === "ozet" && <Summary from={from} to={to} />}
        {tab === "bakiye" && <Balances />}
        {tab === "kasa" && <Cash from={from} to={to} />}
        {tab === "gider" && <Expenses from={from} to={to} notify={toast.show} />}
        {tab === "prim" && <Commissions from={from} to={to} />}
        {tab === "ayar" && <Settings notify={toast.show} />}
      </div>
      {toast.node}
    </>
  );
}

// ------------------------------------------------------------------ özet
interface SummaryData {
  from: string; to: string;
  metrics: { procedureAmount: string; procedureCount: number; procedureCancelledAmount: string; procedureCancelledCount: number; collections: string; collectionCount: number;
    refunds: string; refundCount: number; netCollections: string; expenses: string; collectionsByMethod: Record<string, string> };
  days: { day: string; procedures: string; collections: string; refunds: string; expenses: string }[];
  rows: {
    procedures: { id: string; at: string; label: string; patientId: string; patient: string; practitioner: string; amount: string; status: string }[];
    collections: { id: string; at: string; method: PaymentMethod; account: string; patientId: string; patient: string; amount: string }[];
    refunds: { id: string; at: string; method: PaymentMethod; reason: string; patientId: string; patient: string; amount: string }[];
    expenses: { id: string; at: string; category: string; description: string; amount: string }[];
  };
}
type Metric = "procedures" | "collections" | "refunds" | "expenses";

function Summary({ from, to }: { from: string; to: string }) {
  const { tz } = useSession();
  const d = useData<SummaryData>(`/finance/summary?from=${from}&to=${to}`);
  const [open, setOpen] = useState<Metric | null>(null);
  if (d.loading && !d.data) return <div className="card"><Loading /></div>;
  if (d.error) return <div className="card"><ErrorState error={d.error} onRetry={() => void d.reload()} /></div>;
  const m = d.data!.metrics;
  const tile = (k: Metric, label: string, value: string, sub: string) => (
    <button type="button" className={`net-tile ${open === k ? "is-active" : ""}`} aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>
      <span className="small muted">{label}</span><span className="kpi">{formatTRY(value)}</span><span className="small muted">{sub}</span>
    </button>
  );
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card card-pad">
        <div className="net-tiles">
          {tile("procedures", "İşlem tutarı (gerçekleşen)", m.procedureAmount, `${m.procedureCount} işlem${m.procedureCancelledCount ? ` · iptal/düzeltme ${m.procedureCancelledCount} (${formatTRY(m.procedureCancelledAmount)}) ayrı` : ""}`)}
          {tile("collections", "Tahsilat", m.collections, `${m.collectionCount} ödeme`)}
          {tile("refunds", "İade", m.refunds, `${m.refundCount} iade`)}
          <div className="net-tile"><span className="small muted">Net tahsilat</span><span className="kpi">{formatTRY(m.netCollections)}</span><span className="small muted">tahsilat − iade · kâr değildir</span></div>
          {tile("expenses", "Gider", m.expenses, "ters kayıtlar düşülmüş")}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>İşlem tutarı tahsilat değildir; tahsilat önceki dönem borcunu veya avansı içerebilir. Tutarlar vergi dahil/hariç ayrımı yapılmadan kayıtlı bedeldir (mali müşavir onayı açık).</p>
        {Object.keys(m.collectionsByMethod).length > 0 && (
          <p className="small">Yönteme göre: {Object.entries(m.collectionsByMethod).map(([k, v]) => `${PAYMENT_METHOD_LABELS[k as PaymentMethod]} ${formatTRY(v)}`).join(" · ")}</p>
        )}
      </section>

      {open && <MetricRows metric={open} data={d.data!} tz={tz} />}

      {d.data!.days.length > 1 && (
        <section className="card">
          <div className="card-head"><h2>Günlere göre</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Gün</th><th className="money">İşlem tutarı</th><th className="money">Tahsilat</th><th className="money">İade</th><th className="money">Gider</th></tr></thead>
              <tbody>{d.data!.days.map((x) => <tr key={x.day}><td>{fmtDate(x.day)}</td><td className="money">{formatTRY(x.procedures)}</td><td className="money">{formatTRY(x.collections)}</td><td className="money">{formatTRY(x.refunds)}</td><td className="money">{formatTRY(x.expenses)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function MetricRows({ metric, data, tz }: { metric: Metric; data: SummaryData; tz: string }) {
  const titles: Record<Metric, string> = { procedures: "İşlem tutarını oluşturan kayıtlar", collections: "Tahsilatı oluşturan ödemeler", refunds: "İadeler", expenses: "Giderler" };
  const r = data.rows;
  return (
    <section className="card">
      <div className="card-head"><h2>{titles[metric]}</h2></div>
      <div className="table-wrap">
        <table className="table table-wide">
          {metric === "procedures" && <>
            <thead><tr><th>Zaman</th><th>Hasta</th><th>İşlem</th><th>Hekim</th><th>Durum</th><th className="money">Bedel</th></tr></thead>
            <tbody>{r.procedures.map((x) => <tr key={x.id} style={x.status !== "completed" ? { color: "var(--text-secondary)" } : undefined}><td>{fmtDateTime(x.at, tz)}</td><td><Link href={`/hastalar/${x.patientId}?sekme=finans`}>{x.patient}</Link></td><td>{x.label}</td><td>{x.practitioner}</td>
              <td>{x.status === "completed" ? "Tamamlandı" : x.status === "cancelled" ? "İptal (toplama girmez)" : "Düzeltildi (toplama girmez)"}</td><td className="money">{formatTRY(x.amount)}</td></tr>)}</tbody>
          </>}
          {metric === "collections" && <>
            <thead><tr><th>Zaman</th><th>Hasta</th><th>Yöntem</th><th>Kasa</th><th className="money">Tutar</th></tr></thead>
            <tbody>{r.collections.map((x) => <tr key={x.id}><td>{fmtDateTime(x.at, tz)}</td><td><Link href={`/hastalar/${x.patientId}?sekme=finans`}>{x.patient}</Link></td><td>{PAYMENT_METHOD_LABELS[x.method]}</td><td>{x.account}</td><td className="money">{formatTRY(x.amount)}</td></tr>)}</tbody>
          </>}
          {metric === "refunds" && <>
            <thead><tr><th>Zaman</th><th>Hasta</th><th>Yöntem</th><th>Gerekçe</th><th className="money">Tutar</th></tr></thead>
            <tbody>{r.refunds.map((x) => <tr key={x.id}><td>{fmtDateTime(x.at, tz)}</td><td><Link href={`/hastalar/${x.patientId}?sekme=finans`}>{x.patient}</Link></td><td>{PAYMENT_METHOD_LABELS[x.method]}</td><td>{x.reason}</td><td className="money">{formatTRY(x.amount)}</td></tr>)}</tbody>
          </>}
          {metric === "expenses" && <>
            <thead><tr><th>Zaman</th><th>Kategori</th><th>Açıklama</th><th className="money">Tutar</th></tr></thead>
            <tbody>{r.expenses.map((x) => <tr key={x.id}><td>{fmtDateTime(x.at, tz)}</td><td>{x.category}</td><td>{x.description}</td><td className="money">{formatTRY(x.amount)}</td></tr>)}</tbody>
          </>}
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ bakiyeler
function Balances() {
  const d = useData<{ items: { patientId: string; patient: string; fileNo: number; openDebt: string; advance: string; aging: Record<string, string> }[]; totals: { openDebt: string; advance: string } }>("/finance/balances");
  const [filter, setFilter] = useState<"debt" | "advance">("debt");
  const rows = useMemo(() => (d.data?.items ?? []).filter((x) => (filter === "debt" ? Number(x.openDebt) > 0 : Number(x.advance) > 0)), [d.data, filter]);
  if (d.loading && !d.data) return <div className="card"><Loading /></div>;
  if (d.error) return <div className="card"><ErrorState error={d.error} /></div>;
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Hasta bakiyeleri</h2><p className="muted small">Toplam açık borç {formatTRY(d.data!.totals.openDebt)} · toplam avans {formatTRY(d.data!.totals.advance)} — avans borçtan düşülmez, ayrı gösterilir.</p></div>
        <div className="row" role="group" aria-label="Bakiye türü">
          <button className={`btn btn-sm ${filter === "debt" ? "btn-primary" : ""}`} aria-pressed={filter === "debt"} onClick={() => setFilter("debt")}>Açık borç</button>
          <button className={`btn btn-sm ${filter === "advance" ? "btn-primary" : ""}`} aria-pressed={filter === "advance"} onClick={() => setFilter("advance")}>Avans</button>
        </div>
      </div>
      {rows.length === 0 ? <EmptyState title="Kayıt yok" /> : (
        <div className="table-wrap">
          <table className="table table-wide">
            <thead><tr><th>Hasta</th><th className="money">Açık borç</th><th className="money">Vadesi gelmemiş</th><th className="money">0–30 gün</th><th className="money">31–60</th><th className="money">61–90</th><th className="money">90+</th><th className="money">Avans</th></tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.patientId}>
                <td><Link href={`/hastalar/${x.patientId}?sekme=finans`}><strong>{x.patient}</strong></Link><div className="small muted">Dosya {x.fileNo}</div></td>
                <td className="money"><strong>{formatTRY(x.openDebt)}</strong></td>
                {(["notDue", "d0_30", "d31_60", "d61_90", "d90p"] as const).map((k) => <td key={k} className="money">{Number(x.aging[k]) ? formatTRY(x.aging[k]!) : "—"}</td>)}
                <td className="money">{Number(x.advance) ? formatTRY(x.advance) : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ kasa
function Cash({ from, to }: { from: string; to: string }) {
  const { tz } = useSession();
  const d = useData<{ accounts: { id: string; name: string; kind: string; opening: string; inflow: string; outflow: string; closing: string }[];
    movements: { id: string; accountId: string; amount: string; source: string; at: string; label: string }[] }>(`/finance/cash?from=${from}&to=${to}`);
  if (d.loading && !d.data) return <div className="card"><Loading /></div>;
  if (d.error) return <div className="card"><ErrorState error={d.error} /></div>;
  const name = new Map(d.data!.accounts.map((a) => [a.id, a.name]));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <div className="card-head"><div><h2>Hesap bakiyeleri</h2><p className="muted small">Kapanış = açılış + giriş + çıkış. Banka/POS mutabakatı (ekstreyle eşleştirme) henüz yok.</p></div></div>
        <div className="table-wrap">
          <table className="table table-wide">
            <thead><tr><th>Hesap</th><th>Tür</th><th className="money">Açılış</th><th className="money">Giriş</th><th className="money">Çıkış</th><th className="money">Kapanış</th></tr></thead>
            <tbody>{d.data!.accounts.map((a) => <tr key={a.id}><td><strong>{a.name}</strong></td><td>{CASH_ACCOUNT_KIND_LABELS[a.kind as keyof typeof CASH_ACCOUNT_KIND_LABELS]}</td>
              <td className="money">{formatTRY(a.opening)}</td><td className="money">{formatTRY(a.inflow)}</td><td className="money">{formatTRY(a.outflow)}</td><td className="money"><strong>{formatTRY(a.closing)}</strong></td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Hareketler</h2></div>
        {d.data!.movements.length === 0 ? <EmptyState title="Bu aralıkta hareket yok" /> : (
          <div className="table-wrap">
            <table className="table table-wide">
              <thead><tr><th>Zaman</th><th>Hesap</th><th>Açıklama</th><th className="money">Tutar</th></tr></thead>
              <tbody>{d.data!.movements.map((m) => <tr key={m.id}><td>{fmtDateTime(m.at, tz)}</td><td>{name.get(m.accountId)}</td><td>{m.label}</td><td className="money">{formatTRY(m.amount)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ giderler
function Expenses({ from, to, notify }: { from: string; to: string; notify: (k: "success" | "error", t: string) => void }) {
  const { can, tz } = useSession();
  const d = useData<{ items: { id: string; category: string; description: string; amount: string; occurredAt: string; reversesId: string | null; reversed: boolean; accountName: string; by: string }[]; total: string }>(`/expenses?from=${from}&to=${to}`);
  const [adding, setAdding] = useState(false);
  async function reverse(id: string) {
    try { await api(`/expenses/${id}/reverse`, { body: {}, idempotencyKey: newIdempotencyKey() }); notify("success", "Gider ters kayda alındı."); void d.reload(); }
    catch (e) { notify("error", (e as ApiFailure).message); }
  }
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Giderler</h2><p className="muted small">Gider silinmez; hatalı kayıt ters kayıtla düzeltilir. Toplam: {d.data ? formatTRY(d.data.total) : "…"}</p></div>
        {can("expense.write") && <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><Plus size={15} aria-hidden />Gider ekle</button>}
      </div>
      {d.loading && !d.data ? <Loading /> : d.error ? <ErrorState error={d.error} /> : d.data!.items.length === 0 ? <EmptyState title="Bu aralıkta gider yok" /> : (
        <div className="table-wrap">
          <table className="table table-wide">
            <thead><tr><th>Zaman</th><th>Kategori</th><th>Açıklama</th><th>Hesap</th><th className="money">Tutar</th><th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>{d.data!.items.map((e) => (
              <tr key={e.id} style={e.reversed || e.reversesId ? { color: "var(--text-secondary)" } : undefined}>
                <td>{fmtDateTime(e.occurredAt, tz)}<div className="small muted">{e.by}</div></td><td>{e.category}</td><td>{e.description}</td><td>{e.accountName}</td>
                <td className="money">{formatTRY(e.amount)}</td>
                <td>{can("expense.write") && !e.reversesId && !e.reversed && <button className="btn btn-sm btn-ghost" onClick={() => void reverse(e.id)}><RotateCcw size={14} aria-hidden />Ters kayıt</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {adding && <ExpenseDrawer onClose={() => setAdding(false)} onSaved={() => { setAdding(false); notify("success", "Gider kaydedildi."); void d.reload(); }} />}
    </section>
  );
}

function ExpenseDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const accts = useData<{ items: { id: string; name: string; active: boolean }[] }>("/cash-accounts");
  const [key] = useState(newIdempotencyKey);
  const [f, setF] = useState({ category: EXPENSE_CATEGORIES[0] as string, description: "", amount: "", cashAccountId: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const account = f.cashAccountId || accts.data?.items.find((a) => a.active)?.id || "";
  async function save() {
    const amount = parseMoneyInput(f.amount);
    if (!amount) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Tutarı girin.", field_errors: { amount: "Geçerli tutar girin." } })); return; }
    try { await api("/expenses", { body: { category: f.category, description: f.description, amount, cashAccountId: account }, idempotencyKey: key }); onSaved(); }
    catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title="Gider ekle" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <SelectField label="Kategori" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</SelectField>
        <TextField label="Açıklama" required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} error={err?.fieldErrors.description} />
        <TextField label="Tutar (₺)" required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} error={err?.fieldErrors.amount} />
        <SelectField label="Ödendiği hesap" value={account} onChange={(e) => setF({ ...f, cashAccountId: e.target.value })}>
          {accts.data?.items.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </SelectField>
      </div>
    </Drawer>
  );
}

// ------------------------------------------------------------------ prim
function Commissions({ from, to }: { from: string; to: string }) {
  const { tz, can } = useSession();
  const d = useData<{ groups: { practitionerId: string; practitioner: string; accrued: string; reversed: string; net: string; paidPeriod: string; payable: string }[];
    rows: { id: string; practitioner: string; basis: keyof typeof COMMISSION_BASIS_LABELS; patient: string; description: string; base: string; rate: string; amount: string; reversal: boolean; at: string }[];
    payouts: { id: string; practitioner: string; amount: string; periodFrom: string | null; periodTo: string | null; paidAt: string; note: string | null; reversal: boolean; reversed: boolean; reason: string | null; account: string; by: string }[] }>(`/commissions?from=${from}&to=${to}`);
  const accts = useData<{ items: { id: string; name: string; active: boolean }[] }>(can("commission.payout") ? "/cash-accounts" : null);
  const [pay, setPay] = useState<null | { practitionerId: string; practitioner: string; payable: string; amount: string; cashAccountId: string; note: string; key: string }>(null);
  const [rev, setRev] = useState<null | { id: string; reason: string }>(null);
  const [err, setErr] = useState<ApiFailure | null>(null);
  if (d.loading && !d.data) return <div className="card"><Loading /></div>;
  if (d.error) return <div className="card"><ErrorState error={d.error} /></div>;
  const done = () => { setPay(null); setRev(null); setErr(null); void d.reload(); };
  return (
    <div className="stack" style={{ gap: 16 }}>
      {err && <Alert kind="error">{err.message}</Alert>}
      <section className="card">
        <div className="card-head"><div><h2>Hekim primi</h2><p className="muted small">Tedavi bazlı prim gerçekleşen işlemden, tahsilat bazlı prim dağıtılan tahsilattan doğar. İptal/iade orijinal oranla ters prim doğurur. Prim kazanımı ve ödemesi ayrı harekettir; ödenecek bakiye = net tahakkuk − ödenen (tüm zamanlar).</p></div></div>
        {d.data!.groups.length === 0 ? <EmptyState title="Bu aralıkta tahakkuk yok" /> : (
          <div className="table-wrap">
            <table className="table table-wide">
              <thead><tr><th>Hekim</th><th className="money">Tahakkuk</th><th className="money">Ters prim</th><th className="money">Net (dönem)</th><th className="money">Ödenen (dönem)</th><th className="money">Ödenecek bakiye</th><th><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>{d.data!.groups.map((g) => <tr key={g.practitionerId}><td><strong>{g.practitioner}</strong></td><td className="money">{formatTRY(g.accrued)}</td><td className="money">{formatTRY(g.reversed)}</td>
                <td className="money">{formatTRY(g.net)}</td><td className="money">{formatTRY(g.paidPeriod)}</td><td className="money"><strong>{formatTRY(g.payable)}</strong></td>
                <td>{can("commission.payout") && Number(g.payable) > 0 && <button className="btn btn-sm" onClick={() => setPay({ practitionerId: g.practitionerId, practitioner: g.practitioner, payable: g.payable,
                  amount: g.payable.replace(".", ","), cashAccountId: accts.data?.items.find((a) => a.active)?.id ?? "", note: "", key: newIdempotencyKey() })}>Prim öde</button>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
      {d.data!.payouts.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Prim ödemeleri</h2></div>
          <ul className="list" style={{ padding: "0 20px 12px" }}>{d.data!.payouts.map((p) => (
            <li key={p.id} className="row small" style={{ justifyContent: "space-between", padding: "8px 0", gap: 8 }}>
              <span><strong>{p.practitioner}</strong>{p.reversal && " (ters kayıt)"} · {fmtDateTime(p.paidAt, tz)} · {p.account} · {p.by}{p.reason ? ` · ${p.reason}` : ""}{p.note ? ` · ${p.note}` : ""}</span>
              <span className="row" style={{ gap: 6 }}><strong>{formatTRY(p.amount)}</strong>
                {can("commission.payout") && !p.reversal && !p.reversed && <button className="btn btn-sm btn-ghost" onClick={() => setRev({ id: p.id, reason: "" })}>Ters kayıt</button>}</span>
            </li>))}</ul>
        </section>
      )}
      {d.data!.rows.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Tahakkuk satırları</h2></div>
          <div className="table-wrap">
            <table className="table table-wide">
              <thead><tr><th>Zaman</th><th>Hekim</th><th>Temel</th><th>Hasta</th><th>Kaynak</th><th className="money">Taban</th><th className="money">Oran</th><th className="money">Prim</th></tr></thead>
              <tbody>{d.data!.rows.map((r) => <tr key={r.id}><td>{fmtDateTime(r.at, tz)}</td><td>{r.practitioner}</td><td>{r.basis === "treatment" ? "Tedavi" : "Tahsilat"}</td><td>{r.patient}</td><td>{r.description}{r.reversal && <div className="small muted">Ters kayıt</div>}</td>
                <td className="money">{formatTRY(r.base)}</td><td className="money">%{r.rate.replace(".00", "")}</td><td className="money">{formatTRY(r.amount)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
      {pay && (
        <Drawer title="Prim ödemesi" subtitle={`${pay.practitioner} · ödenecek bakiye ${formatTRY(pay.payable)}`} onClose={() => setPay(null)}
          footer={<><button className="btn" onClick={() => setPay(null)}>Vazgeç</button><button className="btn btn-primary" disabled={!parseMoneyInput(pay.amount) || !pay.cashAccountId}
            onClick={() => void api("/commission-payouts", { idempotencyKey: pay.key, body: { practitionerId: pay.practitionerId, amount: parseMoneyInput(pay.amount), cashAccountId: pay.cashAccountId,
              periodFrom: from, periodTo: to, note: pay.note || undefined } }).then(done, (e) => setErr(e as ApiFailure))}>Ödemeyi kaydet</button></>}>
          <div className="stack">
            <Alert kind="info">Ödeme kasadan çıkış olarak kaydedilir ve ödenmemiş net tahakkuku aşamaz. Bordro/stopaj hesabı VİADENT kapsamı dışındadır; mali müşavirle doğrulayın.</Alert>
            <TextField label="Tutar (₺)" inputMode="decimal" required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            <SelectField label="Kasa / banka" required value={pay.cashAccountId} onChange={(e) => setPay({ ...pay, cashAccountId: e.target.value })}>
              {accts.data?.items.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</SelectField>
            <TextField label="Not" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
          </div>
        </Drawer>
      )}
      {rev && (
        <Drawer title="Prim ödemesini ters kayda al" onClose={() => setRev(null)}
          footer={<><button className="btn" onClick={() => setRev(null)}>Vazgeç</button><button className="btn btn-primary" disabled={rev.reason.trim().length < 3}
            onClick={() => void api(`/commission-payouts/${rev.id}/reverse`, { body: { reason: rev.reason } }).then(done, (e) => setErr(e as ApiFailure))}>Ters kayda al</button></>}>
          <TextField label="Gerekçe" required value={rev.reason} onChange={(e) => setRev({ ...rev, reason: e.target.value })} />
        </Drawer>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ayarlar
function Settings({ notify }: { notify: (k: "success" | "error", t: string) => void }) {
  const { tz } = useSession();
  const accts = useData<{ items: { id: string; name: string; kind: string; active: boolean }[] }>("/cash-accounts");
  const rules = useData<{ items: { id: string; practitionerName: string | null; basis: keyof typeof COMMISSION_BASIS_LABELS; rate: string; validFrom: string; note: string | null; by: string; createdAt: string }[] }>("/commission-rules");
  const res = useData<{ practitioners: { id: string; name: string }[] }>("/resources");
  const [acc, setAcc] = useState({ name: "", kind: "cash" as (typeof CASH_ACCOUNT_KINDS)[number] });
  const [rule, setRule] = useState({ practitionerId: "", basis: "collection" as keyof typeof COMMISSION_BASIS_LABELS, rate: "", validFrom: todayIn(tz), note: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function run(fn: () => Promise<unknown>, ok: string, reload: () => unknown) {
    setErr(null);
    try { await fn(); notify("success", ok); await reload(); } catch (e) { setErr(e as ApiFailure); notify("error", (e as ApiFailure).message); }
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      {err && <Alert kind="error">{err.message}</Alert>}
      <section className="card">
        <div className="card-head"><div><h2>Kasa ve banka hesapları</h2><p className="muted small">“POS (manuel kayıt)”: sanal/fiziksel POS entegrasyonu yoktur; yalnız kartla alınmış ödemenin kaydı.</p></div></div>
        <ul className="list">{accts.data?.items.map((a) => (
          <li key={a.id} className="row" style={{ padding: "10px 20px", justifyContent: "space-between" }}>
            <span><strong>{a.name}</strong> <span className="muted small">· {CASH_ACCOUNT_KIND_LABELS[a.kind as keyof typeof CASH_ACCOUNT_KIND_LABELS]}</span> {!a.active && <span className="badge badge-neutral">Pasif</span>}</span>
            <button className="btn btn-sm" onClick={() => void run(() => api(`/cash-accounts/${a.id}`, { method: "PATCH", body: { name: a.name, kind: a.kind, active: !a.active } }), "Güncellendi.", accts.reload)}>{a.active ? "Pasifleştir" : "Etkinleştir"}</button>
          </li>
        ))}</ul>
        <div className="card-pad row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <TextField label="Yeni hesap adı" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} error={err?.fieldErrors.name} />
          <SelectField label="Tür" value={acc.kind} onChange={(e) => setAcc({ ...acc, kind: e.target.value as typeof acc.kind })}>
            {CASH_ACCOUNT_KINDS.map((k) => <option key={k} value={k}>{CASH_ACCOUNT_KIND_LABELS[k]}</option>)}
          </SelectField>
          <button className="btn btn-primary" disabled={acc.name.trim().length < 2} onClick={() => void run(() => api("/cash-accounts", { body: acc }), "Hesap eklendi.", async () => { setAcc({ name: "", kind: "cash" }); await accts.reload(); })}>Ekle</button>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><div><h2>Prim kuralı sürümleri</h2><p className="muted small">Kural silinmez/değiştirilmez; yeni sürüm bugünden veya ileri bir tarihten geçerli olur. Hekime özel kural genel kuraldan önceliklidir; bir hekim için bir günde tek kural etkindir, temeli (tedavi veya tahsilat) hangi olayın prim doğuracağını belirler — aynı iş için çift prim oluşmaz. Oranlar DEMO; mali müşavirle doğrulanmalı.</p></div></div>
        {rules.data && rules.data.items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Geçerlilik</th><th>Kapsam</th><th>Temel</th><th className="money">Oran</th><th>Not</th><th>Ekleyen</th></tr></thead>
              <tbody>{rules.data.items.map((r) => <tr key={r.id}><td>{fmtDate(r.validFrom)}</td><td>{r.practitionerName ?? "Tüm hekimler"}</td><td>{COMMISSION_BASIS_LABELS[r.basis]}</td><td className="money">%{r.rate.replace(".00", "")}</td><td>{r.note ?? "—"}</td><td>{r.by}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <div className="card-pad row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <SelectField label="Kapsam" value={rule.practitionerId} onChange={(e) => setRule({ ...rule, practitionerId: e.target.value })}>
            <option value="">Tüm hekimler</option>
            {res.data?.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
          <SelectField label="Temel" value={rule.basis} onChange={(e) => setRule({ ...rule, basis: e.target.value as typeof rule.basis })}>
            {Object.entries(COMMISSION_BASIS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          <TextField label="Oran (%)" inputMode="decimal" value={rule.rate} onChange={(e) => setRule({ ...rule, rate: e.target.value.replace(",", ".") })} error={err?.fieldErrors.rate} />
          <DateField label="Geçerlilik" min={todayIn(tz)} value={rule.validFrom} onChange={(e) => setRule({ ...rule, validFrom: e.target.value })} error={err?.fieldErrors.validFrom} />
          <TextField label="Not" value={rule.note} onChange={(e) => setRule({ ...rule, note: e.target.value })} />
          <button className="btn btn-primary" disabled={!rule.rate} onClick={() => void run(() => api("/commission-rules", { body: { ...rule, practitionerId: rule.practitionerId || undefined, note: rule.note || undefined } }), "Yeni kural sürümü eklendi.", rules.reload)}>Sürüm ekle</button>
        </div>
      </section>
    </div>
  );
}
