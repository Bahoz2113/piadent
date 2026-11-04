"use client";
/**
 * Yönetim → Ürün ve fiyat listesi (ADR-097): kurumun hastada kullanabileceği ürünler (stok kalemleri) ve tedarikçi fiyat listesi.
 * Tahmini birim maliyet randevu malzeme giderine snapshot olarak yazılır: son alışın tedarikçisinin geçerli fiyatı → en düşük geçerli
 * tedarikçi fiyatı → son alış maliyeti. Fiyat silinmez; yeni fiyat yeni tarihle eklenir.
 */
import { Fragment, useMemo, useState } from "react";
import { Boxes, Plus, Search } from "lucide-react";
import { STANDARD_PRODUCTS, STOCK_UNIT_LABELS, formatTRY } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, todayIn } from "@/lib/format";
import { Alert, DateField, Drawer, EmptyState, ErrorState, Loading, SelectField, TextField } from "@/components/ui";
import { ItemDrawer } from "@/components/operations/stock";
import { parseMoneyInput } from "@/components/finance/money-input";
import { confirmDialog } from "@/components/dialogs";

type Unit = keyof typeof STOCK_UNIT_LABELS;
interface Price { id: string; supplierId: string; supplier: string; unitPrice: string; validFrom: string; supplierCode: string | null; note: string | null; state: "current" | "scheduled" | "superseded" }
interface Product {
  id: string; code: string; name: string; unit: Unit; category: string | null; trackLots: boolean; active: boolean; minLevel: string; balance: string;
  lastCost: string | null; unitCost: string | null; costSource: "supplier_price" | "last_receipt" | null; prices: Price[];
}
const qty = (v: string) => { const n = Number(v); return Number.isInteger(n) ? String(n) : String(n).replace(".", ","); };
const SOURCE_LABEL = { supplier_price: "tedarikçi fiyatı", last_receipt: "son alış" } as const;

export function ProductsPanel({ notify }: { notify: (k: "success" | "error", t: string) => void }) {
  const { can } = useSession();
  const d = useData<{ today: string; items: Product[] }>("/stock/catalog");
  const sup = useData<{ items: { id: string; kind: string; name: string; active: boolean }[] }>(can("stock.manage") && can("lab.read") ? "/suppliers" : null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [price, setPrice] = useState<Product | null>(null);
  const [edit, setEdit] = useState<"new" | null>(null);
  const groups = useMemo(() => {
    const t = q.trim().toLocaleLowerCase("tr-TR");
    const list = (d.data?.items ?? []).filter((p) => !t || `${p.code} ${p.name} ${p.category ?? ""} ${p.prices.map((x) => x.supplier).join(" ")}`.toLocaleLowerCase("tr-TR").includes(t));
    const m = new Map<string, Product[]>();
    for (const p of list) { const k = p.category ?? "Kategorisiz"; m.set(k, [...(m.get(k) ?? []), p]); }
    return [...m.entries()];
  }, [d.data, q]);
  if (d.loading && !d.data) return <div className="card"><Loading /></div>;
  if (d.error) return <div className="card"><ErrorState error={d.error} onRetry={d.reload} /></div>;
  const done = (m: string) => { setPrice(null); setEdit(null); notify("success", m); void d.reload(); };
  async function importStandard() {
    const ok = await confirmDialog({ title: "Standart ürün listesini ekle", confirmLabel: "Ekle",
      message: `Diş kliniğinde sık kullanılan ${STANDARD_PRODUCTS.length} sarf/malzeme kalemi (marka içermez) eklenir. Var olan kodlar atlanır; fiyatlar boş gelir, tedarikçi fiyatını siz girersiniz.` });
    if (!ok) return;
    try { const r = await api<{ added: number; skipped: number }>("/stock/items/standard-import", { body: {} }); done(`${r.added} ürün eklendi, ${r.skipped} kod zaten vardı.`); }
    catch (e) { notify("error", (e as ApiFailure).message); }
  }
  const total = d.data!.items.length;
  const unpriced = d.data!.items.filter((p) => p.active && !p.unitCost).length;
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Ürün ve fiyat listesi</h2>
          <p className="muted small">Hastada kullanılabilecek ürünler ve tedarikçi fiyatları. Randevuda kullanılan malzemenin gideri buradaki birim maliyetle hesaplanır ve o anki değerle saklanır.</p></div>
        {can("stock.manage") && <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn btn-sm" onClick={() => void importStandard()}>Standart listeyi ekle</button>
          <button className="btn btn-sm btn-primary" onClick={() => setEdit("new")}><Plus size={15} aria-hidden />Ürün ekle</button></div>}
      </div>
      {unpriced > 0 && <div style={{ padding: "0 20px" }}><Alert kind="warning">{unpriced} etkin üründe fiyat tanımlı değil; bu ürünlerin gideri "fiyat tanımsız" görünür, sıfır sayılmaz.</Alert></div>}
      {total === 0 ? <EmptyState icon={<Boxes size={28} />} title="Ürün yok">Önce ürün ekleyin; sonra tedarikçi fiyatı girin.</EmptyState> : (
        <>
          <div className="card-pad" style={{ paddingBottom: 8 }}>
            <label className="search-field" style={{ maxWidth: 360 }}>
              <Search size={16} aria-hidden /><span className="sr-only">Ürün ara</span>
              <input className="input" placeholder="Ürün, kod, kategori veya tedarikçi ara" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          </div>
          <div className="table-wrap" tabIndex={0}>
            <table className="table table-wide">
              <thead><tr><th>Ürün</th><th className="money">Stok</th><th className="money">Birim maliyet</th><th>Tedarikçi fiyatları (geçerli)</th><th><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>{groups.map(([cat, list]) => (
                <Fragment key={cat}>
                  <tr className="group-row"><th colSpan={5} scope="colgroup">{cat} <span className="muted small">({list.length})</span></th></tr>
                  {list.map((p) => {
                    const cur = p.prices.filter((x) => x.state === "current").sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice));
                    const isOpen = open === p.id;
                    return (
                      <Fragment key={p.id}>
                        <tr style={!p.active ? { color: "var(--text-secondary)" } : undefined}>
                          <td><strong>{p.name}</strong><div className="small muted">{p.code} · {STOCK_UNIT_LABELS[p.unit]}{p.trackLots ? " · lot takipli" : ""}{!p.active ? " · pasif" : ""}</div></td>
                          <td className="money">{qty(p.balance)}</td>
                          <td className="money">{p.unitCost ? <><strong>{formatTRY(p.unitCost)}</strong><div className="small muted">{SOURCE_LABEL[p.costSource!]}</div></> : <span className="badge badge-warning">Fiyat tanımsız</span>}</td>
                          <td className="small">{cur.length === 0 ? <span className="muted">—</span> : cur.map((x) => <div key={x.id}>{x.supplier}: <strong>{formatTRY(x.unitPrice)}</strong>{x.supplierCode ? <span className="muted"> · {x.supplierCode}</span> : null}</div>)}</td>
                          <td><div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            {p.prices.length > 0 && <button className="btn btn-sm btn-ghost" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}>{isOpen ? "Geçmişi gizle" : "Fiyat geçmişi"}</button>}
                            {can("stock.manage") && p.active && <button className="btn btn-sm" onClick={() => setPrice(p)}>Fiyat ekle</button>}
                          </div></td>
                        </tr>
                        {isOpen && (
                          <tr className="detail-row"><td colSpan={5}>
                            <ul className="list small">{p.prices.map((x) => (
                              <li key={x.id} className="row" style={{ justifyContent: "space-between", padding: "4px 0" }}>
                                <span>{x.supplier} · <strong>{formatTRY(x.unitPrice)}</strong> · {fmtDate(x.validFrom)} itibarıyla{x.note ? ` · ${x.note}` : ""}</span>
                                <span className={`badge ${x.state === "current" ? "badge-success" : x.state === "scheduled" ? "badge-info" : "badge-neutral"}`}>
                                  {x.state === "current" ? "Geçerli" : x.state === "scheduled" ? "Planlı" : "Önceki"}</span>
                              </li>))}</ul>
                            {p.lastCost && <p className="muted small">Son alış birim maliyeti: {formatTRY(p.lastCost)}</p>}
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {price && <PriceDrawer product={price} suppliers={(sup.data?.items ?? []).filter((s) => s.active)} onClose={() => setPrice(null)} onSaved={() => done("Fiyat eklendi.")} />}
      {edit && <ItemDrawer item={null} onClose={() => setEdit(null)} onSaved={done} />}
    </section>
  );
}

function PriceDrawer({ product, suppliers, onClose, onSaved }: { product: Product; suppliers: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { tz } = useSession();
  const today = todayIn(tz);
  const [f, setF] = useState({ supplierId: suppliers[0]?.id ?? "", unitPrice: "", validFrom: today, supplierCode: "", note: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = parseMoneyInput(f.unitPrice);
  async function save() {
    setBusy(true); setErr(null);
    try {
      await api("/supplier-prices", { body: { supplierId: f.supplierId, stockItemId: product.id, unitPrice: amount ?? f.unitPrice, validFrom: f.validFrom,
        supplierCode: f.supplierCode || undefined, note: f.note || undefined } });
      onSaved();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Tedarikçi fiyatı ekle" subtitle={`${product.name} · birim: ${STOCK_UNIT_LABELS[product.unit]}`} onClose={onClose} dirty={!!f.unitPrice}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !amount || !f.supplierId} onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        {suppliers.length === 0 ? <Alert kind="warning">Etkin tedarikçi yok. Önce Operasyon → Tedarikçiler'den tedarikçi ekleyin.</Alert> : (
          <SelectField label="Tedarikçi" required value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} error={err?.fieldErrors.supplierId}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
        )}
        <TextField label={`Birim fiyat (₺ / ${STOCK_UNIT_LABELS[product.unit]})`} inputMode="decimal" required value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })}
          error={err?.fieldErrors.unitPrice} hint="KDV dahil/hariç tercihinizi tüm fiyatlarda aynı tutun." />
        <DateField label="Geçerlilik başlangıcı" required min={today} today={today} value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} error={err?.fieldErrors.validFrom} />
        <TextField label="Tedarikçi ürün kodu" value={f.supplierCode} onChange={(e) => setF({ ...f, supplierCode: e.target.value })} maxLength={60} />
        <TextField label="Not" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} />
        <p className="small muted">Fiyat silinmez; değişiklik için yeni tarihli fiyat ekleyin. Geçmiş randevuların gideri değişmez.</p>
      </div>
    </Drawer>
  );
}
