"use client";
/**
 * Randevu ayrıntısı → Kullanılan malzeme ve klinik gideri (ADR-097). Hasta geldikten sonra (Geldi / Tedavide / Tamamlandı)
 * ek kullanılan ürün ve miktar girilir; stoktan düşülür, birim maliyet o anki değerle saklanır. İşlemin sarf reçetesiyle otomatik
 * düşülen malzeme de burada görünür. İşlem bedeli ve katkı yalnız finans yetkisiyle döner.
 */
import { useState } from "react";
import { PackagePlus, Trash2 } from "lucide-react";
import { STOCK_UNIT_LABELS, formatTRY } from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { Alert, Loading, SelectField, TextField } from "@/components/ui";
import type { Item } from "@/components/operations/stock";

type Unit = keyof typeof STOCK_UNIT_LABELS;
interface Line {
  id: string; itemId: string; code: string; name: string; unit: Unit; quantity: string; unitCost: string | null; lineCost: string | null; lotNo: string | null;
  source: "manual" | "recipe"; procedure: string | null; reversal: boolean; reversed: boolean;
}
interface Data { status: string; editable: boolean; items: Line[]; totals: { materialCost: string; unknownCostLines: number }; revenue: string | null; contribution: string | null }
const qty = (v: string) => { const n = Number(v); return (Number.isInteger(n) ? String(n) : String(n).replace(".", ",")); };
const normQty = (v: string) => v.trim().replace(",", ".");
const QTY_RE = /^\d{1,9}(\.\d{1,3})?$/;

export function AppointmentMaterialsCard({ appointmentId, onSaved }: { appointmentId: string; onSaved?: (m: string) => void }) {
  const { can } = useSession();
  const d = useData<Data>(`/appointments/${appointmentId}/materials`);
  const stock = useData<{ items: Item[] }>(can("stock.write") ? "/stock/items" : null);
  const [form, setForm] = useState<null | { lines: { itemId: string; lotId: string; quantity: string }[]; note: string; key: string }>(null);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  if (d.loading && !d.data) return <Loading rows={1} />;
  if (d.error || !d.data) return null;
  const m = d.data;
  const avail = (stock.data?.items ?? []).filter((i) => i.active && Number(i.balance) > 0);
  const valid = !!form && form.lines.length > 0 && form.lines.every((l) => l.itemId && QTY_RE.test(normQty(l.quantity)) && Number(normQty(l.quantity)) > 0);

  async function save() {
    if (!form || !valid) return;
    setBusy(true); setErr(null);
    try {
      await api(`/appointments/${appointmentId}/materials`, { idempotencyKey: form.key, body: {
        items: form.lines.map((l) => ({ itemId: l.itemId, lotId: l.lotId || undefined, quantity: normQty(l.quantity) })), note: form.note || undefined } });
      setForm(null); void d.reload(); void stock.reload(); onSaved?.("Kullanılan malzeme kaydedildi.");
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  const setLine = (i: number, patch: Partial<{ itemId: string; lotId: string; quantity: string }>) =>
    setForm(form && { ...form, lines: form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  return (
    <section className="stack" style={{ gap: 8 }} aria-label="Kullanılan malzeme">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>Kullanılan malzeme ve gider</h3>
        {m.editable && !form && <button className="btn btn-sm" onClick={() => setForm({ lines: [{ itemId: "", lotId: "", quantity: "1" }], note: "", key: newIdempotencyKey() })}>
          <PackagePlus size={15} aria-hidden />Malzeme ekle</button>}
      </div>
      {m.status === "completed" && m.items.length === 0 && m.editable && !form && <p className="small muted">Randevu tamamlandı. İşlemde ek ürün kullanıldıysa miktarını girin; kliniğin malzeme gideri hesaplanır.</p>}
      {m.items.length > 0 && (
        <ul className="list small">{m.items.map((l) => (
          <li key={l.id} className="row" style={{ justifyContent: "space-between", padding: "4px 0", gap: 8 }}>
            <span style={{ minWidth: 0 }}><strong>{l.name}</strong> × {qty(l.quantity)} {STOCK_UNIT_LABELS[l.unit]}{l.lotNo ? ` · lot ${l.lotNo}` : ""}
              <span className="muted"> · {l.source === "recipe" ? `sarf reçetesi${l.procedure ? ` (${l.procedure})` : ""}` : "ek malzeme"}</span>
              {(l.reversal || l.reversed) && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>{l.reversal ? "Ters kayıt" : "Geri alındı"}</span>}</span>
            <span>{l.lineCost ? formatTRY(l.lineCost) : <span className="badge badge-warning">Fiyat tanımsız</span>}</span>
          </li>))}</ul>
      )}
      {(m.items.length > 0 || m.revenue !== null) && (
        <div className="money-strip" role="group" aria-label="Randevu gideri">
          <div><span className="muted small">Malzeme gideri</span><strong>{formatTRY(m.totals.materialCost)}</strong>
            {m.totals.unknownCostLines > 0 && <span className="small muted">{m.totals.unknownCostLines} kalem fiyatsız</span>}</div>
          {m.revenue !== null && <div><span className="muted small">İşlem bedeli</span><strong>{formatTRY(m.revenue)}</strong></div>}
          {m.contribution !== null && <div><span className="muted small">Malzeme sonrası katkı</span><strong>{formatTRY(m.contribution)}</strong></div>}
        </div>
      )}
      {m.items.length === 0 && !form && !(m.status === "completed" && m.editable) && <p className="small muted">Bu randevuda kayıtlı malzeme kullanımı yok.</p>}
      {form && (
        <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          {err && <Alert kind="error">{err.message}</Alert>}
          {avail.length === 0 && !stock.loading ? <Alert kind="warning">Stokta kullanılabilir ürün yok. Önce Operasyon → Stok'tan giriş yapın.</Alert> : (
            <div className="material-lines">
              {form.lines.map((l, i) => {
                const it = avail.find((x) => x.id === l.itemId);
                return (
                  <div key={i} className="stack" style={{ gap: 4 }}>
                    <div className="material-line">
                      <SelectField label={`Ürün ${i + 1}`} value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value, lotId: "" })}>
                        <option value="">Seçin</option>
                        {avail.map((x) => <option key={x.id} value={x.id}>{x.name} · stok {qty(x.balance)} {STOCK_UNIT_LABELS[x.unit]}</option>)}
                      </SelectField>
                      <TextField label="Miktar" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                      <button className="btn btn-sm btn-ghost" aria-label={`Ürün ${i + 1} satırını kaldır`} disabled={form.lines.length === 1}
                        onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}><Trash2 size={15} aria-hidden /></button>
                    </div>
                    {it?.trackLots && (
                      <SelectField label="Lot" value={l.lotId} onChange={(e) => setLine(i, { lotId: e.target.value })} hint="Seçilmezse son kullanma tarihi en yakın yeterli lot düşülür.">
                        <option value="">Otomatik (en yakın SKT)</option>
                        {it.lots.filter((x) => Number(x.balance) > 0 && !x.expired).map((x) => <option key={x.id} value={x.id}>{x.lotNo} · {qty(x.balance)}</option>)}
                      </SelectField>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <button className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} disabled={form.lines.length >= 30}
            onClick={() => setForm({ ...form, lines: [...form.lines, { itemId: "", lotId: "", quantity: "1" }] })}>+ Satır ekle</button>
          <TextField label="Not" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} />
          <div className="row">
            <button className="btn btn-sm" onClick={() => { setForm(null); setErr(null); }}>Vazgeç</button>
            <button className="btn btn-sm btn-primary" disabled={busy || !valid} onClick={() => void save()}>Malzemeyi kaydet</button>
          </div>
          <p className="small muted">Kayıt stoktan düşer ve silinmez; yanlış giriş Operasyon → Stok → Hareketler'den ters kayıtla düzeltilir.</p>
        </div>
      )}
    </section>
  );
}
