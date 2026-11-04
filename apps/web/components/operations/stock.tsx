"use client";
import { useState } from "react";
import { Boxes, Plus } from "lucide-react";
import { STOCK_MOVEMENT_LABELS, STOCK_UNITS, STOCK_UNIT_LABELS, formatTRY } from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Alert, Drawer, EmptyState, ErrorState, Loading, SelectField, TextAreaField, TextField, DateField } from "@/components/ui";
import { parseMoneyInput } from "@/components/finance/money-input";

interface Lot { id: string; lotNo: string; expiry: string | null; balance: string; expired: boolean; expiringSoon: boolean }
export interface Item { id: string; code: string; name: string; unit: keyof typeof STOCK_UNIT_LABELS; category: string | null; trackLots: boolean; minLevel: string; active: boolean; balance: string; low: boolean; lots: Lot[] }
type Op = "receipt" | "usage" | "waste" | "count";
const qty = (v: string) => { const n = Number(v); return Number.isInteger(n) ? String(n) : String(n).replace(".", ","); };
const normQty = (v: string) => v.trim().replace(",", ".");

export function StockPanel({ notify }: { notify: (k: "success" | "error", t: string) => void }) {
  const { can } = useSession();
  const d = useData<{ today: string; items: Item[] }>("/stock/items");
  const [op, setOp] = useState<null | { op: Op; item: Item }>(null);
  const [hist, setHist] = useState<Item | null>(null);
  const [edit, setEdit] = useState<null | Item | "new">(null);
  if (d.loading && !d.data) return <div className="card"><Loading /></div>;
  if (d.error) return <div className="card"><ErrorState error={d.error} /></div>;
  const items = d.data!.items;
  const done = (m: string) => { setOp(null); setEdit(null); notify("success", m); void d.reload(); };
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Stok</h2><p className="muted small">Bakiye yalnız hareketlerden hesaplanır (giriş, kullanım, fire, sayım düzeltmesi, iade); miktar elle ezilmez. Lot takipli kalemde son kullanma tarihi geçmiş lot hastada kullanılamaz.</p></div>
        {can("stock.manage") && <button className="btn btn-sm btn-primary" onClick={() => setEdit("new")}><Plus size={15} aria-hidden />Yeni kalem</button>}
      </div>
      {items.length === 0 ? <EmptyState icon={<Boxes size={28} />} title="Stok kalemi yok" /> : (
        <div className="table-wrap" tabIndex={0}>
          <table className="table table-wide">
            <thead><tr><th>Kalem</th><th className="money">Bakiye</th><th>Lotlar</th><th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id} style={!i.active ? { color: "var(--text-secondary)" } : undefined}>
                <td><strong>{i.name}</strong><div className="small muted">{i.code}{i.category ? ` · ${i.category}` : ""}{i.trackLots ? " · lot takipli" : ""}</div></td>
                <td className="money"><strong>{qty(i.balance)}</strong> {STOCK_UNIT_LABELS[i.unit]}
                  {i.low && <div><span className="badge badge-warning">En az seviye ({qty(i.minLevel)})</span></div>}{!i.active && <div><span className="badge badge-neutral">Pasif</span></div>}</td>
                <td className="small">{i.lots.filter((l) => Number(l.balance) > 0).map((l) => (
                  <div key={l.id}>{l.lotNo} · {qty(l.balance)} · SKT {l.expiry ? fmtDate(l.expiry) : "—"}
                    {l.expired && <span className="badge badge-danger" style={{ marginLeft: 4 }}>SKT geçmiş</span>}{l.expiringSoon && <span className="badge badge-warning" style={{ marginLeft: 4 }}>SKT yaklaşıyor</span>}</div>
                ))}{i.trackLots && !i.lots.some((l) => Number(l.balance) > 0) && <span className="muted">—</span>}</td>
                <td><div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {can("stock.write") && i.active && <>
                    <button className="btn btn-sm" onClick={() => setOp({ op: "receipt", item: i })}>Giriş</button>
                    <button className="btn btn-sm" onClick={() => setOp({ op: "usage", item: i })}>Kullanım</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setOp({ op: "waste", item: i })}>Fire / iade</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setOp({ op: "count", item: i })}>Sayım</button></>}
                  <button className="btn btn-sm btn-ghost" onClick={() => setHist(i)}>Hareketler</button>
                  {can("stock.manage") && <button className="btn btn-sm btn-ghost" onClick={() => setEdit(i)}>Düzenle</button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {op && <StockOpDrawer op={op.op} item={op.item} onClose={() => setOp(null)} onSaved={done} />}
      {hist && <MovementsDrawer item={hist} onClose={() => setHist(null)} onChanged={() => void d.reload()} />}
      {edit && <ItemDrawer item={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={done} />}
    </section>
  );
}

export function ItemDrawer({ item, onClose, onSaved }: { item: Item | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [f, setF] = useState({ code: item?.code ?? "", name: item?.name ?? "", unit: item?.unit ?? "adet", category: item?.category ?? "", trackLots: item?.trackLots ?? false,
    minLevel: item ? qty(item.minLevel) : "0", active: item?.active ?? true });
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function save() {
    setErr(null);
    const body = { ...f, minLevel: normQty(f.minLevel || "0") };
    try {
      if (item) await api(`/stock/items/${item.id}`, { method: "PATCH", body }); else await api("/stock/items", { body });
      onSaved(item ? "Kalem güncellendi." : "Kalem eklendi.");
    } catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title={item ? "Stok kalemini düzenle" : "Yeni stok kalemi"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <TextField label="Kod" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} error={err?.fieldErrors.code} />
        <TextField label="Ad" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={err?.fieldErrors.name} />
        <SelectField label="Birim" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as Item["unit"] })}>{STOCK_UNITS.map((u) => <option key={u} value={u}>{STOCK_UNIT_LABELS[u]}</option>)}</SelectField>
        <TextField label="Kategori" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <TextField label="En az seviye" inputMode="decimal" value={f.minLevel} onChange={(e) => setF({ ...f, minLevel: e.target.value })} error={err?.fieldErrors.minLevel}
          hint="Bakiye bu değere inince asistana görev düşer. 0 = uyarı yok." />
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.trackLots} onChange={(e) => setF({ ...f, trackLots: e.target.checked })} />Lot ve son kullanma tarihi takibi (implant, anestezik vb.)</label>
        {item && <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Etkin</label>}
        <p className="small muted">Hareketi olan kalemin kodu, birimi ve lot takibi değiştirilemez.</p>
      </div>
    </Drawer>
  );
}

const OP_TITLE: Record<Op, string> = { receipt: "Stok girişi", usage: "Kullanım", waste: "Fire / imha veya tedarikçiye iade", count: "Sayım" };

function StockOpDrawer({ op, item, onClose, onSaved }: { op: Op; item: Item; onClose: () => void; onSaved: (m: string) => void }) {
  const { can } = useSession();
  const sups = useData<{ items: { id: string; name: string; active: boolean; kind: string }[] }>(op === "receipt" ? "/suppliers" : null);
  const [key] = useState(newIdempotencyKey);
  const lots = item.lots.filter((l) => op === "receipt" || Number(l.balance) > 0 || op === "count");
  const [f, setF] = useState({ quantity: "", lotId: lots.find((l) => !l.expired)?.id ?? "", lotNo: "", expiryDate: "", unitCost: "", supplierId: "", createBill: false, documentNo: "",
    reason: "", kind: "waste" as "waste" | "return", counted: "", patientQuery: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr(null);
    try {
      if (op === "receipt") {
        await api("/stock/receipts", { idempotencyKey: key, body: { itemId: item.id, quantity: normQty(f.quantity), lotNo: item.trackLots ? f.lotNo : undefined,
          expiryDate: item.trackLots && f.expiryDate ? f.expiryDate : undefined, unitCost: f.unitCost ? parseMoneyInput(f.unitCost) ?? f.unitCost : undefined,
          supplierId: f.supplierId || undefined, createBill: f.createBill, documentNo: f.documentNo } });
        onSaved(`${item.name}: ${f.quantity} ${STOCK_UNIT_LABELS[item.unit]} giriş kaydedildi${f.createBill ? "; tedarikçi carisine borç yazıldı" : ""}.`);
      } else if (op === "usage") {
        await api("/stock/usages", { idempotencyKey: key, body: { itemId: item.id, lotId: item.trackLots ? f.lotId : undefined, quantity: normQty(f.quantity), reason: f.reason } });
        onSaved(`${item.name}: kullanım kaydedildi.`);
      } else if (op === "waste") {
        await api("/stock/waste", { body: { itemId: item.id, lotId: item.trackLots ? f.lotId : undefined, quantity: normQty(f.quantity), kind: f.kind, reason: f.reason } });
        onSaved(`${item.name}: ${f.kind === "waste" ? "fire/imha" : "iade"} kaydedildi.`);
      } else {
        const r = await api<{ difference: string }>("/stock/counts", { body: { itemId: item.id, lotId: item.trackLots ? f.lotId : undefined, countedQuantity: normQty(f.counted), reason: f.reason } });
        onSaved(Number(r.difference) === 0 ? "Sayım sistemle aynı; düzeltme gerekmedi." : `Sayım farkı ${qty(r.difference)} ${STOCK_UNIT_LABELS[item.unit]} düzeltme hareketi olarak yazıldı.`);
      }
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  const lotSelect = item.trackLots && op !== "receipt" && (
    <SelectField label="Lot" required value={f.lotId} onChange={(e) => setF({ ...f, lotId: e.target.value })} error={err?.fieldErrors.lotId}>
      <option value="">Seçin</option>
      {lots.map((l) => <option key={l.id} value={l.id} disabled={op === "usage" && l.expired}>{l.lotNo} · bakiye {qty(l.balance)} · SKT {l.expiry ? fmtDate(l.expiry) : "—"}{l.expired ? " (SKT geçmiş)" : ""}</option>)}
    </SelectField>
  );
  return (
    <Drawer title={OP_TITLE[op]} subtitle={`${item.name} · bakiye ${qty(item.balance)} ${STOCK_UNIT_LABELS[item.unit]}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        {op === "receipt" && <>
          <TextField label={`Miktar (${STOCK_UNIT_LABELS[item.unit]})`} required inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} error={err?.fieldErrors.quantity} />
          {item.trackLots && <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <TextField label="Lot no" required value={f.lotNo} onChange={(e) => setF({ ...f, lotNo: e.target.value })} error={err?.fieldErrors.lotNo} />
            <DateField label="Son kullanma" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} /></div>}
          <SelectField label="Tedarikçi (isteğe bağlı)" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
            <option value="">—</option>{sups.data?.items.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
          <TextField label="Birim maliyet (₺, isteğe bağlı)" inputMode="decimal" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} error={err?.fieldErrors.unitCost} />
          {can("supplier.ledger") && <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.createBill} onChange={(e) => setF({ ...f, createBill: e.target.checked })} />
            Tedarikçi carisine borç yaz (miktar × birim maliyet{f.unitCost && f.quantity && parseMoneyInput(f.unitCost) ? ` = ${formatTRY((Number(parseMoneyInput(f.unitCost)) * Number(normQty(f.quantity))).toFixed(2))}` : ""})</label>}
          {f.createBill && <TextField label="Fatura / irsaliye no" value={f.documentNo} onChange={(e) => setF({ ...f, documentNo: e.target.value })} />}
        </>}
        {op === "usage" && <>
          {lotSelect}
          <TextField label={`Miktar (${STOCK_UNIT_LABELS[item.unit]})`} required inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} error={err?.fieldErrors.quantity} />
          <TextField label="Not (isteğe bağlı)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          <p className="small muted">Hastaya bağlı kullanım (lot izlenebilirliği) hasta kartındaki Laboratuvar sekmesinden kaydedilir.</p>
        </>}
        {op === "waste" && <>
          <SelectField label="Tür" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "waste" | "return" })}><option value="waste">Fire / imha</option><option value="return">Tedarikçiye iade</option></SelectField>
          {lotSelect}
          <TextField label="Miktar" required inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} error={err?.fieldErrors.quantity} />
          <TextAreaField label="Gerekçe" required rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={err?.fieldErrors.reason} />
        </>}
        {op === "count" && <>
          {lotSelect}
          <TextField label="Sayılan miktar" required inputMode="decimal" value={f.counted} onChange={(e) => setF({ ...f, counted: e.target.value })} error={err?.fieldErrors.countedQuantity} />
          <TextAreaField label="Açıklama" required rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={err?.fieldErrors.reason} />
          <p className="small muted">Sistem bakiyesi ezilmez: fark (sayılan − sistem) gerekçeli “sayım düzeltmesi” hareketi olarak yazılır.</p>
        </>}
      </div>
    </Drawer>
  );
}

function MovementsDrawer({ item, onClose, onChanged }: { item: Item; onClose: () => void; onChanged: () => void }) {
  const { can, tz } = useSession();
  const d = useData<{ items: { id: string; kind: keyof typeof STOCK_MOVEMENT_LABELS; quantity: string; unitCost: string | null; reason: string | null; at: string; lotNo: string | null;
    supplier: string | null; patient: string | null; by: string; reversal: boolean; reversed: boolean; balanceAfter: string }[] }>(`/stock/items/${item.id}/movements`);
  const [rev, setRev] = useState<null | { id: string; reason: string }>(null);
  const [err, setErr] = useState<ApiFailure | null>(null);
  return (
    <Drawer title={`Hareketler · ${item.name}`} subtitle={`Bakiye ${qty(item.balance)} ${STOCK_UNIT_LABELS[item.unit]}`} onClose={onClose}>
      {err && <Alert kind="error">{err.message}</Alert>}
      {d.loading && !d.data ? <Loading /> : d.error ? <ErrorState error={d.error} /> : d.data!.items.length === 0 ? <p className="muted">Hareket yok.</p> : (
        <ul className="list">{d.data!.items.map((m) => (
          <li key={m.id} className="row small" style={{ justifyContent: "space-between", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
            <span><strong>{STOCK_MOVEMENT_LABELS[m.kind]}</strong>{m.reversal && " (ters kayıt)"} · {fmtDateTime(m.at, tz)} · {m.by}
              <div className="muted">{[m.lotNo && `lot ${m.lotNo}`, m.supplier, m.patient && `hasta: ${m.patient}`, m.unitCost && `birim ${formatTRY(m.unitCost)}`, m.reason].filter(Boolean).join(" · ")}</div></span>
            <span style={{ textAlign: "right" }}><strong>{Number(m.quantity) > 0 ? "+" : ""}{qty(m.quantity)}</strong><div className="muted">→ {qty(m.balanceAfter)}</div>
              {can("stock.write") && !m.reversal && !m.reversed && <button className="btn btn-sm btn-ghost" onClick={() => setRev({ id: m.id, reason: "" })}>Ters kayıt</button>}</span>
          </li>))}</ul>)}
      {rev && (
        <div className="card card-pad stack" style={{ gap: 8, marginTop: 12 }}>
          <TextAreaField label="Ters kayıt gerekçesi" required rows={2} value={rev.reason} onChange={(e) => setRev({ ...rev, reason: e.target.value })} />
          <div className="row" style={{ gap: 8 }}><button className="btn btn-sm" onClick={() => setRev(null)}>Vazgeç</button>
            <button className="btn btn-sm btn-primary" disabled={rev.reason.trim().length < 3}
              onClick={() => void api(`/stock/movements/${rev.id}/reverse`, { body: { reason: rev.reason } }).then(() => { setRev(null); void d.reload(); onChanged(); }, (e) => setErr(e as ApiFailure))}>Ters kayda al</button></div>
        </div>
      )}
    </Drawer>
  );
}

/** Hasta kartı: hastaya kullanılan malzeme ve lot (geriye dönük izlenebilirlik) + kullanım kaydı. */
export function PatientMaterials({ patientId }: { patientId: string }) {
  const { can, tz } = useSession();
  const used = useData<{ items: { id: string; quantity: string; at: string; code: string; name: string; unit: keyof typeof STOCK_UNIT_LABELS; lotNo: string | null; expiry: string | null;
    procedure: string | null; reversal: boolean; reversed: boolean }[] }>(`/patients/${patientId}/stock-usage`);
  const items = useData<{ items: Item[] }>(can("stock.write") ? "/stock/items" : null);
  const [form, setForm] = useState<null | { itemId: string; lotId: string; quantity: string; key: string }>(null);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const item = items.data?.items.find((i) => i.id === form?.itemId);
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Kullanılan malzeme (lot)</h2><p className="muted small">İmplant, anestezik gibi lot takipli malzemenin hangi hastada kullanıldığı geriye dönük izlenir. Resmî ürün takip sistemine bildirim yapılmaz.</p></div>
        {can("stock.write") && !form && <button className="btn btn-sm" onClick={() => setForm({ itemId: "", lotId: "", quantity: "1", key: newIdempotencyKey() })}><Plus size={15} aria-hidden />Kullanım kaydet</button>}
      </div>
      {err && <div style={{ padding: "0 20px" }}><Alert kind="error">{err.message}</Alert></div>}
      {form && (
        <div className="card-pad filters" style={{ borderTop: "1px solid var(--border)" }}>
          <SelectField label="Kalem" value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value, lotId: "" })}>
            <option value="">Seçin</option>{items.data?.items.filter((i) => i.active && Number(i.balance) > 0).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </SelectField>
          {item?.trackLots && <SelectField label="Lot" value={form.lotId} onChange={(e) => setForm({ ...form, lotId: e.target.value })}>
            <option value="">Seçin</option>{item.lots.filter((l) => Number(l.balance) > 0 && !l.expired).map((l) => <option key={l.id} value={l.id}>{l.lotNo} · SKT {l.expiry ? fmtDate(l.expiry) : "—"}</option>)}
          </SelectField>}
          <TextField label="Miktar" inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          <button className="btn btn-sm" onClick={() => setForm(null)}>Vazgeç</button>
          <button className="btn btn-sm btn-primary" disabled={!form.itemId || (!!item?.trackLots && !form.lotId)}
            onClick={() => void api("/stock/usages", { idempotencyKey: form.key, body: { itemId: form.itemId, lotId: form.lotId || undefined, quantity: normQty(form.quantity), patientId } })
              .then(() => { setForm(null); setErr(null); void used.reload(); void items.reload(); }, (e) => setErr(e as ApiFailure))}>Kaydet</button>
        </div>
      )}
      {used.loading && !used.data ? <Loading rows={1} /> : (used.data?.items.length ?? 0) === 0 ? <p className="muted small" style={{ padding: "8px 20px 16px" }}>Kayıtlı malzeme kullanımı yok.</p> : (
        <ul className="list" style={{ padding: "0 20px 12px" }}>{used.data!.items.map((u) => (
          <li key={u.id} className="row small" style={{ justifyContent: "space-between", padding: "6px 0" }}>
            <span><strong>{u.name}</strong> {u.lotNo && <>· lot <code>{u.lotNo}</code></>}{u.expiry && ` · SKT ${fmtDate(u.expiry)}`}{u.procedure && ` · ${u.procedure}`}
              {(u.reversal || u.reversed) && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>{u.reversal ? "Ters kayıt" : "Geri alındı"}</span>}
              <div className="muted">{fmtDateTime(u.at, tz)}</div></span>
            <span>{qty(String(Math.abs(Number(u.quantity))))} {STOCK_UNIT_LABELS[u.unit]}</span>
          </li>))}</ul>)}
    </section>
  );
}
