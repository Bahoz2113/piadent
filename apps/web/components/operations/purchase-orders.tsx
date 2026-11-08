"use client";
/**
 * Laboratuvar → Malzeme siparişleri (ADR-108): tedarikçiye sipariş ve takibi.
 * Taslak → Tedarikçiye gönderildi → Kısmen teslim alındı → Teslim alındı; İptal. Gecikme = beklenen teslim geçti, sipariş hâlâ açık.
 * Teslim alınan miktar stoğa girer (lot takipli kalemde lot no zorunlu); istenirse tedarikçi cari borcu aynı anda yazılır.
 */
import { useMemo, useState } from "react";
import { PackagePlus, Plus, Trash2 } from "lucide-react";
import { PURCHASE_MAX_LINES, PURCHASE_STATUS_LABELS, addMoney, formatTRY, type PurchaseStatus } from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime, todayIn } from "@/lib/format";
import { Alert, DateField, Drawer, EmptyState, ErrorState, Loading, SelectField, TextAreaField, TextField } from "@/components/ui";
import { parseMoneyInput } from "@/components/finance/money-input";

interface PurchaseOrder {
  id: string; orderNo: number; supplierId: string; supplier: string; status: PurchaseStatus; expectedDate: string | null; note: string | null;
  sentAt: string | null; receivedAt: string | null; cancelledAt: string | null; cancelReason: string | null; version: number; createdAt: string; createdBy: string;
  lineCount: number; doneLines: number; total: string | null; overdue: boolean;
}
interface PurchaseLine { id: string; position: number; itemId: string; item: string; unit: string; trackLots: boolean; quantity: string; unitPrice: string | null; receivedQty: string; remaining: string }
interface PurchaseDetail extends PurchaseOrder {
  lines: PurchaseLine[];
  receipts: { id: string; lineId: string; quantity: string; billId: string | null; lotNo: string | null; at: string; by: string }[];
}
type StockItem = { id: string; name: string; unit: string; active: boolean; balance: string; low: boolean; minLevel: string };

const FILTERS = [["open", "Açık"], ["overdue", "Geciken"], ["draft", "Taslak"], ["closed", "Kapanan"], ["all", "Tümü"]] as const;
const TONE: Record<PurchaseStatus, string> = { draft: "neutral", sent: "info", partial: "warning", received: "success", cancelled: "neutral" };
const qty = (s: string) => s.replace(/\.?0+$/, "").replace(".", ",");
const normQty = (s: string) => s.trim().replace(",", ".");

export function PurchaseBadge({ o }: { o: Pick<PurchaseOrder, "status" | "overdue"> }) {
  return <><span className={`badge badge-${TONE[o.status]}`}>{PURCHASE_STATUS_LABELS[o.status]}</span>{o.overdue && <span className="badge badge-danger" style={{ marginLeft: 6 }}>Gecikmiş</span>}</>;
}

export function PurchaseOrdersPanel({ notify }: { notify: (k: "success" | "error", t: string) => void }) {
  const { can } = useSession();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("open");
  const sum = useData<{ waiting: number; overdue: number; partial: number; drafts: number }>("/purchase-orders-summary");
  const list = useData<{ items: PurchaseOrder[] }>(`/purchase-orders${filter === "all" ? "" : `?status=${filter}`}`);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const reload = () => { void list.reload(); void sum.reload(); };
  const tile = (label: string, value: number, f?: (typeof FILTERS)[number][0]) => (
    <button className="card stat" style={{ textAlign: "left", cursor: f ? "pointer" : "default" }} onClick={() => f && setFilter(f)} aria-pressed={f ? filter === f : undefined}>
      <div className="label">{label}</div><div className="value">{value}</div></button>
  );
  return (
    <div className="stack" style={{ gap: 16 }}>
      {sum.data && (
        <div className="stats">
          {tile("Teslim bekleyen", sum.data.waiting, "open")}
          {tile("Geciken", sum.data.overdue, "overdue")}
          {tile("Kısmen gelen", sum.data.partial, "open")}
          {tile("Taslak", sum.data.drafts, "draft")}
        </div>
      )}
      <section className="card" aria-labelledby="po-h">
        <div className="card-head">
          <div><h2 id="po-h">Malzeme siparişleri</h2><p className="muted small">Tedarikçiye sipariş verin, teslimleri takip edin. Teslim alınan miktar stoğa girer; borç yalnız teslimde (isteğe bağlı) doğar.</p></div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {FILTERS.map(([k, l]) => <button key={k} className={`btn btn-sm ${filter === k ? "btn-primary" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
            {can("stock.write") && <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}><Plus size={15} aria-hidden />Yeni sipariş</button>}
          </div>
        </div>
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.items.length === 0 ? (
          <EmptyState icon={<PackagePlus size={32} aria-hidden />} title="Bu süzgeçte sipariş yok">{can("stock.write") ? "Yeni sipariş ile tedarikçiye malzeme isteyin." : null}</EmptyState>
        ) : (
          <div className="table-wrap" tabIndex={0}>
            <table className="table table-wide">
              <thead><tr><th>No</th><th>Tedarikçi</th><th>Durum</th><th>Kalem</th><th>Beklenen teslim</th><th className="money">Tutar</th><th><span className="sr-only">Aç</span></th></tr></thead>
              <tbody>{list.data.items.map((o) => (
                <tr key={o.id}>
                  <td>{o.orderNo}</td>
                  <td>{o.supplier}{o.note && <div className="small muted">{o.note}</div>}</td>
                  <td><PurchaseBadge o={o} /></td>
                  <td>{o.doneLines}/{o.lineCount} teslim</td>
                  <td>{o.expectedDate ? fmtDate(o.expectedDate) : "—"}</td>
                  <td className="money">{o.total ? formatTRY(o.total) : <span className="muted small">fiyatsız kalem</span>}</td>
                  <td><button className="btn btn-sm" aria-label={`Sipariş ${o.orderNo} aç`} onClick={() => setOpenId(o.id)}>Aç</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {creating && <NewPurchaseDrawer onClose={() => setCreating(false)} onSaved={(no, id) => { setCreating(false); notify("success", `Sipariş ${no} taslak olarak açıldı.`); reload(); setOpenId(id); }} />}
      {openId && <PurchaseDrawer id={openId} onClose={() => setOpenId(null)} onChanged={(m) => { notify("success", m); reload(); }} />}
    </div>
  );
}

function NewPurchaseDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: (no: number, id: string) => void }) {
  const { tz } = useSession();
  const sup = useData<{ items: { id: string; name: string; kind: string; active: boolean }[] }>("/suppliers");
  const stock = useData<{ items: StockItem[] }>("/stock/items");
  const [f, setF] = useState({ supplierId: "", expectedDate: "", note: "" });
  const [lines, setLines] = useState<{ itemId: string; quantity: string; unitPrice: string }[]>([]);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const active = (stock.data?.items ?? []).filter((i) => i.active);
  const low = active.filter((i) => i.low && !lines.some((l) => l.itemId === i.id));
  const itemOf = (id: string) => active.find((i) => i.id === id);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const body = { supplierId: f.supplierId, expectedDate: f.expectedDate || undefined, note: f.note || undefined,
        lines: lines.map((l) => ({ itemId: l.itemId, quantity: normQty(l.quantity), unitPrice: l.unitPrice.trim() ? parseMoneyInput(l.unitPrice) ?? l.unitPrice : undefined })) };
      const r = await api<{ id: string; orderNo: number }>("/purchase-orders", { body, idempotencyKey: key });
      onSaved(r.orderNo, r.id);
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  const ready = !!f.supplierId && lines.length > 0 && lines.every((l) => l.itemId && /^\d+([.,]\d{1,3})?$/.test(l.quantity.trim()) && Number(normQty(l.quantity)) > 0);
  return (
    <Drawer wide title="Yeni malzeme siparişi" subtitle="Taslak açılır; tedarikçiye gönderim ayrı adımdır." onClose={onClose} dirty={lines.length > 0 || !!f.supplierId}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !ready} onClick={() => void save()}>Taslak oluştur</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <div className="form-grid">
          <SelectField label="Tedarikçi" required value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} error={err?.fieldErrors.supplierId}
            hint="Fiyat girilmezse tedarikçinin bu kalem için geçerli liste fiyatı kullanılır.">
            <option value="">Seçin</option>{sup.data?.items.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
          <DateField label="Beklenen teslim" min={todayIn(tz)} value={f.expectedDate} onChange={(e) => setF({ ...f, expectedDate: e.target.value })} error={err?.fieldErrors.expectedDate} />
        </div>
        {low.length > 0 && (
          <div className="alert alert-warning" role="status"><div style={{ flex: 1 }}>En az seviyedeki kalemler: {low.slice(0, 6).map((i) => i.name).join(", ")}{low.length > 6 ? " …" : ""}</div>
            <button type="button" className="btn btn-sm" disabled={lines.length + low.length > PURCHASE_MAX_LINES}
              onClick={() => setLines([...lines, ...low.map((i) => ({ itemId: i.id, quantity: "1", unitPrice: "" }))])}>Siparişe ekle</button></div>
        )}
        <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
          <legend><strong>Kalemler</strong> <span className="muted small">({lines.length}/{PURCHASE_MAX_LINES})</span></legend>
          {err?.fieldErrors.lines && <Alert kind="error">{err.fieldErrors.lines}</Alert>}
          {lines.map((l, n) => {
            const it = itemOf(l.itemId);
            return (
              <div key={n} className="po-line" role="group" aria-label={`Kalem ${n + 1}`}>
                <SelectField label="Stok kalemi" required value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => (j === n ? { ...x, itemId: e.target.value } : x)))} error={err?.fieldErrors[`lines.${n}.itemId`]}>
                  <option value="">Seçin</option>{active.filter((i) => i.id === l.itemId || !lines.some((x) => x.itemId === i.id)).map((i) => <option key={i.id} value={i.id}>{i.name} · bakiye {qty(i.balance)} {i.unit}</option>)}
                </SelectField>
                <TextField label={`Miktar${it ? ` (${it.unit})` : ""}`} required inputMode="decimal" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === n ? { ...x, quantity: e.target.value } : x)))} error={err?.fieldErrors[`lines.${n}.quantity`]} />
                <TextField label="Birim fiyat (₺, isteğe bağlı)" inputMode="decimal" value={l.unitPrice} onChange={(e) => setLines(lines.map((x, j) => (j === n ? { ...x, unitPrice: e.target.value } : x)))} error={err?.fieldErrors[`lines.${n}.unitPrice`]} />
                <button type="button" className="btn btn-sm btn-ghost" aria-label={`Kalem ${n + 1} kaldır`} onClick={() => setLines(lines.filter((_, j) => j !== n))}><Trash2 size={15} aria-hidden /></button>
              </div>
            );
          })}
          <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} disabled={lines.length >= PURCHASE_MAX_LINES} onClick={() => setLines([...lines, { itemId: "", quantity: "1", unitPrice: "" }])}><Plus size={15} aria-hidden />Kalem ekle</button>
          {stock.data && active.length === 0 && <Alert kind="warning">Tanımlı stok kalemi yok. Önce Operasyon → Stok'tan kalem tanımlayın.</Alert>}
        </fieldset>
        <TextAreaField label="Not (tedarikçiye / iç not)" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} error={err?.fieldErrors.note} />
      </div>
    </Drawer>
  );
}

function PurchaseDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (m: string) => void }) {
  const { can, tz } = useSession();
  const d = useData<PurchaseDetail>(`/purchase-orders/${id}`);
  const [mode, setMode] = useState<null | "send" | "cancel" | "receive">(null);
  const [reason, setReason] = useState("");
  const [expected, setExpected] = useState("");
  const [rec, setRec] = useState<Record<string, { quantity: string; lotNo: string; expiryDate: string }>>({});
  const [bill, setBill] = useState({ create: false, documentNo: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const o = d.data;
  const receivable = useMemo(() => (o?.lines ?? []).filter((l) => Number(l.remaining) > 0), [o]);
  if (d.loading && !o) return <Drawer title="Sipariş" onClose={onClose}><Loading /></Drawer>;
  if (d.error || !o) return <Drawer title="Sipariş" onClose={onClose}><ErrorState error={d.error!} /></Drawer>;
  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true); setErr(null);
    try { await fn(); setMode(null); setReason(""); setRec({}); setBill({ create: false, documentNo: "" }); setKey(newIdempotencyKey()); await d.reload(); onChanged(msg); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  const recLines = receivable.map((l) => ({ l, v: rec[l.id] })).filter((x) => x.v && x.v.quantity.trim());
  const billTotal = bill.create && recLines.length && recLines.every((x) => x.l.unitPrice)
    ? addMoney(...recLines.map((x) => (Math.round(Number(normQty(x.v!.quantity)) * Number(x.l.unitPrice) * 100) / 100).toFixed(2))) : null;
  return (
    <Drawer wide title={`Sipariş ${o.orderNo} · ${o.supplier}`} subtitle={<PurchaseBadge o={o} />} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        {err && <Alert kind="error">{err.message}</Alert>}
        <dl className="kv">
          <dt>Beklenen teslim</dt><dd>{o.expectedDate ? fmtDate(o.expectedDate) : "—"}</dd>
          <dt>Oluşturan</dt><dd>{o.createdBy} · {fmtDateTime(o.createdAt, tz)}</dd>
          {o.sentAt && <><dt>Gönderildi</dt><dd>{fmtDateTime(o.sentAt, tz)}</dd></>}
          {o.receivedAt && <><dt>Tamamı teslim</dt><dd>{fmtDateTime(o.receivedAt, tz)}</dd></>}
          {o.note && <><dt>Not</dt><dd>{o.note}</dd></>}
          {o.cancelReason && <><dt>İptal gerekçesi</dt><dd>{o.cancelReason}</dd></>}
        </dl>
        <div className="table-wrap" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Kalem</th><th>Sipariş</th><th>Gelen</th><th className="money">Birim fiyat</th></tr></thead>
            <tbody>{o.lines.map((l) => (
              <tr key={l.id}><td>{l.item}</td><td>{qty(l.quantity)} {l.unit}</td>
                <td>{qty(l.receivedQty)} {l.unit}{Number(l.remaining) === 0 ? <span className="badge badge-success" style={{ marginLeft: 6 }}>Tamam</span> : null}</td>
                <td className="money">{l.unitPrice ? formatTRY(l.unitPrice) : "—"}</td></tr>))}</tbody>
          </table>
        </div>
        {o.total && <p className="small">Sipariş tutarı (bilgi): <strong>{formatTRY(o.total)}</strong></p>}
        {can("stock.write") && !mode && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {o.status === "draft" && <button className="btn btn-sm btn-primary" onClick={() => { setMode("send"); setExpected(o.expectedDate ?? ""); }}>Tedarikçiye gönderildi olarak işaretle</button>}
            {["sent", "partial"].includes(o.status) && <button className="btn btn-sm btn-primary" onClick={() => setMode("receive")}>Teslim al</button>}
            {["draft", "sent"].includes(o.status) && <button className="btn btn-sm" onClick={() => setMode("cancel")}>İptal et</button>}
          </div>
        )}
        {mode === "send" && (
          <div className="card card-pad stack" style={{ gap: 10 }}>
            <strong>Tedarikçiye gönderildi</strong>
            <p className="small muted">Sipariş tedarikçiye iletildiğinde işaretleyin (telefon, e-posta, portal). Beklenen teslim geçerse İş akışı'nda görev açılır.</p>
            <DateField label="Beklenen teslim" min={todayIn(tz)} value={expected} onChange={(e) => setExpected(e.target.value)} error={err?.fieldErrors.expectedDate} />
            <div className="row" style={{ gap: 8 }}><button className="btn btn-sm" onClick={() => setMode(null)}>Vazgeç</button>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run(() => api(`/purchase-orders/${o.id}/transition`, { body: { action: "send", expectedVersion: o.version, expectedDate: expected || undefined } }), `Sipariş ${o.orderNo} gönderildi.`)}>Kaydet</button></div>
          </div>
        )}
        {mode === "cancel" && (
          <div className="card card-pad stack" style={{ gap: 10 }}>
            <TextAreaField label="İptal gerekçesi" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={err?.fieldErrors.reason} />
            <div className="row" style={{ gap: 8 }}><button className="btn btn-sm" onClick={() => setMode(null)}>Vazgeç</button>
              <button className="btn btn-sm btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => void run(() => api(`/purchase-orders/${o.id}/transition`, { body: { action: "cancel", expectedVersion: o.version, reason } }), `Sipariş ${o.orderNo} iptal edildi.`)}>Siparişi iptal et</button></div>
          </div>
        )}
        {mode === "receive" && (
          <div className="card card-pad stack" style={{ gap: 10 }} aria-label="Teslim al">
            <strong>Teslim al</strong>
            <p className="small muted">Gelen miktarı girin (kalandan fazla olamaz). Lot takipli kalemde lot no zorunludur. Kayıt stoğa giriş olarak işlenir.</p>
            {err?.fieldErrors.lines && <Alert kind="error">{err.fieldErrors.lines}</Alert>}
            {receivable.map((l, n) => {
              const v = rec[l.id] ?? { quantity: "", lotNo: "", expiryDate: "" };
              const set = (p: Partial<typeof v>) => setRec({ ...rec, [l.id]: { ...v, ...p } });
              const idx = recLines.findIndex((x) => x.l.id === l.id);
              return (
                <div key={l.id} className="po-line" role="group" aria-label={l.item}>
                  <TextField label={`${l.item} — gelen (kalan ${qty(l.remaining)} ${l.unit})`} inputMode="decimal" value={v.quantity} onChange={(e) => set({ quantity: e.target.value })}
                    error={idx >= 0 ? err?.fieldErrors[`lines.${idx}.quantity`] ?? err?.fieldErrors[`lines.${idx}.lineId`] : undefined} />
                  <button type="button" className="btn btn-sm" onClick={() => set({ quantity: qty(l.remaining) })} aria-label={`${l.item} kalanın tamamı`}>Tamamı</button>
                  {l.trackLots && <TextField label="Lot no" required value={v.lotNo} onChange={(e) => set({ lotNo: e.target.value })} error={idx >= 0 ? err?.fieldErrors.lotNo : undefined} />}
                  {l.trackLots && <DateField label="Son kullanma" value={v.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} />}
                </div>
              );
            })}
            {can("supplier.ledger") && (
              <>
                <label className="row"><input type="checkbox" checked={bill.create} onChange={(e) => setBill({ ...bill, create: e.target.checked })} /> Tedarikçi cari borcunu (fatura) da yaz</label>
                {bill.create && <TextField label="Belge / fatura no (isteğe bağlı)" value={bill.documentNo} onChange={(e) => setBill({ ...bill, documentNo: e.target.value })} />}
                {bill.create && <p className="small">{billTotal ? <>Borç tutarı: <strong>{formatTRY(billTotal)}</strong> (gelen × sipariş birim fiyatı)</> : <span className="muted">Borç için gelen her kalemin sipariş birim fiyatı olmalı.</span>}</p>}
              </>
            )}
            <div className="row" style={{ gap: 8 }}><button className="btn btn-sm" onClick={() => setMode(null)}>Vazgeç</button>
              <button className="btn btn-sm btn-primary" disabled={busy || recLines.length === 0}
                onClick={() => void run(() => api(`/purchase-orders/${o.id}/receive`, { idempotencyKey: key, body: { expectedVersion: o.version, createBill: bill.create, documentNo: bill.documentNo || undefined,
                  lines: recLines.map((x) => ({ lineId: x.l.id, quantity: normQty(x.v!.quantity), lotNo: x.v!.lotNo || undefined, expiryDate: x.v!.expiryDate || undefined })) } }),
                  `Sipariş ${o.orderNo}: teslim stoğa işlendi.`)}>Teslimi kaydet</button></div>
          </div>
        )}
        {o.receipts.length > 0 && (
          <section>
            <h3>Teslimler</h3>
            <ul className="chosen-list">
              {o.receipts.map((r) => {
                const l = o.lines.find((x) => x.id === r.lineId);
                return <li key={r.id}><span className="grow">{l?.item ?? "Kalem"} · {qty(r.quantity)} {l?.unit}{r.lotNo ? ` · lot ${r.lotNo}` : ""}</span><span className="small muted">{fmtDateTime(r.at, tz)} · {r.by}{r.billId ? " · cari borç yazıldı" : ""}</span></li>;
              })}
            </ul>
          </section>
        )}
      </div>
    </Drawer>
  );
}
