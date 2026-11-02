"use client";
import { useState } from "react";
import { FileText, Plus, Printer, Trash2 } from "lucide-react";
import {
  BUYER_TYPES, BUYER_TYPE_LABELS, INVOICE_DOC_TYPES, INVOICE_DOC_TYPE_LABELS, INVOICE_STATUS_LABELS, VAT_RATES, formatTRY, mulMoney, vatOf, addMoney,
  type InvoiceDocType, type InvoiceStatus,
} from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime } from "@/lib/format";
import { Alert, Drawer, SelectField, TextAreaField, TextField } from "@/components/ui";
import { printHeaderHtml } from "@/components/brand";
import { parseMoneyInput } from "./money-input";

interface InvoiceRow { id: string; docType: InvoiceDocType; status: InvoiceStatus; buyerType: string; buyerName: string; subtotal: string; vatTotal: string; grandTotal: string; invoiceNo: string | null; issuedAt: string | null; createdAt: string; cancelReason: string | null; lineCount: number }
interface InvoiceDetail extends Omit<InvoiceRow, "lineCount"> {
  providerMock: boolean | null; providerLabel: string | null; providerRef: string | null; rejectedReason: string | null;
  patient: { fullName: string; fileNo: number }; buyer: { type: string; name: string; taxNo: string | null; taxOffice: string | null; address: string | null; email: string | null }; note: string | null;
  lines: { lineNo: number; description: string; quantity: number; unitPrice: string; vatRate: number; lineTotal: string; vatAmount: string }[]; notice: string; createdBy: string; providerConnected: boolean; clinic: { name: string };
}
interface Receivable { id: string; description: string; amount: string; status: string; open: string }
type LineDraft = { description: string; quantity: string; unitPrice: string; vatRate: (typeof VAT_RATES)[number]; receivableId?: string };
const TONE: Record<InvoiceStatus, string> = { draft: "neutral", pending_provider: "warning", issued: "success", rejected: "error", cancelled: "neutral" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function Invoices({ patientId, receivables }: { patientId: string; receivables: Receivable[] }) {
  const { can } = useSession();
  const list = useData<{ items: InvoiceRow[]; providerConnected: boolean; providerMock: boolean | null }>(`/patients/${patientId}/invoices`);
  const [open, setOpen] = useState<null | "new" | { view: string }>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "warning"; text: string } | null>(null);
  const items = list.data?.items ?? [];
  return (
    <section className="card">
      <div className="card-head">
        <div><h2><FileText size={18} aria-hidden style={{ verticalAlign: "-3px" }} /> Fatura taslakları</h2>
          <p className="muted small">PİA-DENT fatura numarası üretmez. Taslak burada hazırlanır; resmî belge yalnız bağlı e-belge sağlayıcısı düzenler.
            {list.data && !list.data.providerConnected && <> <span className="badge badge-warning">e-Belge sağlayıcısı bağlı değil</span></>}
            {list.data?.providerMock && <> <span className="badge badge-warning">MOCK e-belge sağlayıcısı — numaralar resmî değildir</span></>}</p></div>
        {can("invoice.write") && <button className="btn btn-sm" onClick={() => setOpen("new")}><Plus size={15} aria-hidden />Taslak oluştur</button>}
      </div>
      {msg && <div style={{ padding: "0 20px" }}><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      {items.length === 0 ? <p className="muted small" style={{ padding: "8px 20px 16px" }}>Fatura taslağı yok.</p> : (
        <div className="table-wrap" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Tarih</th><th>Belge</th><th>Alıcı</th><th className="money">KDV hariç</th><th className="money">KDV</th><th className="money">Toplam</th><th>Durum</th><th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id}>
                <td>{fmtDateTime(i.createdAt)}</td>
                <td>{INVOICE_DOC_TYPE_LABELS[i.docType]}<div className="small muted">{i.invoiceNo ? <><span className="mono">{i.invoiceNo}</span>{i.invoiceNo.startsWith("MOCK") && <> <span className="badge badge-warning">MOCK</span></>}</> : i.status === "pending_provider" ? "sağlayıcı yanıtı bekleniyor" : "numara yok"}</div></td>
                <td>{i.buyerName}<div className="small muted">{BUYER_TYPE_LABELS[i.buyerType as "individual"] ?? i.buyerType} · {i.lineCount} satır</div></td>
                <td className="money">{formatTRY(i.subtotal)}</td><td className="money">{formatTRY(i.vatTotal)}</td><td className="money"><strong>{formatTRY(i.grandTotal)}</strong></td>
                <td><span className={`badge badge-${TONE[i.status]}`}>{INVOICE_STATUS_LABELS[i.status]}</span></td>
                <td style={{ textAlign: "right" }}><button className="btn btn-sm btn-ghost" onClick={() => setOpen({ view: i.id })}>Aç</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {open === "new" && <NewInvoiceDrawer patientId={patientId} receivables={receivables.filter((r) => r.status === "active")} onClose={() => setOpen(null)}
        onSaved={() => { setOpen(null); setMsg({ kind: "success", text: "Fatura taslağı kaydedildi. Numara yalnız sağlayıcı düzenleyince oluşur." }); void list.reload(); }} />}
      {open && open !== "new" && <InvoiceDrawer id={open.view} onClose={() => setOpen(null)} onChanged={(t) => { setMsg(t); void list.reload(); }} />}
    </section>
  );
}

function NewInvoiceDrawer({ patientId, receivables, onClose, onSaved }: { patientId: string; receivables: Receivable[]; onClose: () => void; onSaved: () => void }) {
  const [key] = useState(newIdempotencyKey);
  const [buyerType, setBuyerType] = useState<(typeof BUYER_TYPES)[number]>("individual");
  const [docType, setDocType] = useState<InvoiceDocType>("e_arsiv");
  const [buyerName, setBuyerName] = useState(""); const [taxNo, setTaxNo] = useState(""); const [taxOffice, setTaxOffice] = useState(""); const [address, setAddress] = useState(""); const [email, setEmail] = useState(""); const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ description: "", quantity: "1", unitPrice: "", vatRate: 10 }]);
  const [err, setErr] = useState<ApiFailure | null>(null); const [busy, setBusy] = useState(false);
  const addFromReceivable = (r: Receivable) => setLines((ls) => [...ls.filter((l) => l.description || l.unitPrice), { description: r.description, quantity: "1", unitPrice: r.open.replace(".", ","), vatRate: 10, receivableId: r.id }]);
  const totals = (() => {
    try {
      const rows = lines.map((l) => { const p = parseMoneyInput(l.unitPrice); const q = Number(l.quantity); if (!p || !Number.isInteger(q) || q < 1) throw 0; const t = mulMoney(p, q); return { t, v: vatOf(t, l.vatRate) }; });
      const sub = addMoney("0", ...rows.map((r) => r.t)); const vat = addMoney("0", ...rows.map((r) => r.v)); return { sub, vat, total: addMoney(sub, vat) };
    } catch { return null; }
  })();
  async function save() {
    setBusy(true); setErr(null);
    try {
      const body = { patientId, docType, buyerType, buyerName, buyerTaxNo: taxNo || undefined, buyerTaxOffice: taxOffice || undefined, buyerAddress: address || undefined, buyerEmail: email || undefined, note: note || undefined,
        lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: parseMoneyInput(l.unitPrice) ?? l.unitPrice, vatRate: l.vatRate, receivableId: l.receivableId })) };
      await api("/invoices", { body, idempotencyKey: key }); onSaved();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Fatura taslağı" subtitle="Numara üretilmez; sağlayıcı bağlı değilken yalnız taslak" onClose={onClose} dirty={!!buyerName || lines.some((l) => l.description)}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !totals} onClick={() => void save()}>Taslağı kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <div className="grid grid-2">
          <SelectField label="Alıcı türü" value={buyerType} onChange={(e) => { const v = e.target.value as typeof buyerType; setBuyerType(v); setDocType(v === "company" ? "e_fatura" : "e_arsiv"); }}>
            {BUYER_TYPES.map((b) => <option key={b} value={b}>{BUYER_TYPE_LABELS[b]}</option>)}
          </SelectField>
          <SelectField label="Belge türü" value={docType} onChange={(e) => setDocType(e.target.value as InvoiceDocType)} error={err?.fieldErrors.docType}>
            {INVOICE_DOC_TYPES.map((d) => <option key={d} value={d}>{INVOICE_DOC_TYPE_LABELS[d]}</option>)}
          </SelectField>
        </div>
        <TextField label="Alıcı adı / unvanı" required value={buyerName} onChange={(e) => setBuyerName(e.target.value)} error={err?.fieldErrors.buyerName} />
        {buyerType === "company" && <div className="grid grid-2">
          <TextField label="VKN (10 hane)" required inputMode="numeric" value={taxNo} onChange={(e) => setTaxNo(e.target.value.replace(/\D/g, "").slice(0, 10))} error={err?.fieldErrors.buyerTaxNo} />
          <TextField label="Vergi dairesi" value={taxOffice} onChange={(e) => setTaxOffice(e.target.value)} />
        </div>}
        {buyerType === "individual" && <p className="small muted">Şahıs alıcının kimlik numarası hasta kartındaki kayıttan alınır; faturaya kopyalanmaz.</p>}
        <TextField label="Adres" value={address} onChange={(e) => setAddress(e.target.value)} />
        <TextField label="E-posta (e-Arşiv iletimi için)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={err?.fieldErrors.buyerEmail} />
        {receivables.length > 0 && <div className="field"><span className="label">Açık alacaktan satır ekle</span>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{receivables.map((r) => <button key={r.id} type="button" className="btn btn-sm btn-ghost" onClick={() => addFromReceivable(r)}>{r.description} · {formatTRY(r.open)}</button>)}</div></div>}
        <div className="field"><span className="label">Satırlar</span>
          {lines.map((l, i) => (
            <div key={i} className="row" style={{ gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
              <TextField label={`Açıklama ${i + 1}`} value={l.description} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} style={{ minWidth: 180 }} />
              <TextField label="Adet" inputMode="numeric" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, quantity: e.target.value.replace(/\D/g, "") } : x))} style={{ width: 70 }} />
              <TextField label="Birim (₺)" inputMode="decimal" value={l.unitPrice} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))} style={{ width: 110 }} />
              <SelectField label="KDV" value={String(l.vatRate)} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, vatRate: Number(e.target.value) as LineDraft["vatRate"] } : x))}>
                {VAT_RATES.map((v) => <option key={v} value={v}>%{v}</option>)}
              </SelectField>
              <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={`Satır ${i + 1} sil`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
            </div>))}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines((ls) => [...ls, { description: "", quantity: "1", unitPrice: "", vatRate: 10 }])}><Plus size={14} aria-hidden />Satır ekle</button>
          {err?.fieldErrors.lines && <span className="err">{err.fieldErrors.lines}</span>}
        </div>
        <TextAreaField label="Not" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="card" style={{ padding: 12 }}>
          {totals ? <><div className="row" style={{ justifyContent: "space-between" }}><span>KDV hariç</span><strong>{formatTRY(totals.sub)}</strong></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span>KDV</span><strong>{formatTRY(totals.vat)}</strong></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span>Genel toplam</span><strong>{formatTRY(totals.total)}</strong></div></> : <span className="muted small">Satırları tamamlayın.</span>}
        </div>
        <p className="small muted">KDV oranı kliniğin seçimidir; sistem vergi danışmanlığı yapmaz. Hesaplar kuruş hassasiyetinde, satır bazında yuvarlanır.</p>
      </div>
    </Drawer>
  );
}

function InvoiceDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (m: { kind: "success" | "error" | "warning"; text: string }) => void }) {
  const { can } = useSession();
  const d = useData<InvoiceDetail>(`/invoices/${id}`);
  const [reason, setReason] = useState(""); const [cancelling, setCancelling] = useState(false); const [err, setErr] = useState<ApiFailure | null>(null);
  async function submit() {
    try { const r = await api<{ mock: boolean }>(`/invoices/${id}/submit`, { body: {} }); onChanged({ kind: r.mock ? "warning" : "success", text: r.mock ? "MOCK sağlayıcıya iletildi (gerçek belge düzenlenmez); sonuç PİA Köprü işlendikçe görünür." : "Sağlayıcıya iletildi; numara yanıt gelince görünür." }); await d.reload(); }
    catch (e) { const f = e as ApiFailure; setErr(f); onChanged({ kind: "warning", text: f.message }); }
  }
  async function cancel() {
    try { await api(`/invoices/${id}/cancel`, { body: { reason } }); onChanged({ kind: "success", text: "Taslak iptal edildi." }); await d.reload(); setCancelling(false); }
    catch (e) { setErr(e as ApiFailure); }
  }
  function print() {
    const x = d.data; if (!x) return;
    const w = window.open("", "_blank"); if (!w) return;
    w.document.title = `Fatura taslağı · ${x.patient.fullName}`;
    w.document.body.insertAdjacentHTML("afterbegin", printHeaderHtml(x.clinic.name));
    w.document.body.insertAdjacentHTML("beforeend", `<main style="margin:24px 32px;font:14px/1.5 system-ui;color:#172b27;max-width:760px;position:relative">
      <div style="position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;opacity:.08;font:800 72px system-ui;transform:rotate(-20deg)">TASLAK</div>
      <h2 style="margin:0 0 4px;font-size:20px">${esc(INVOICE_DOC_TYPE_LABELS[x.docType])} — TASLAK</h2>
      <p style="margin:0 0 16px;color:#b42318;font-weight:600">${esc(x.notice)}</p>
      <p><strong>Alıcı:</strong> ${esc(x.buyer.name)}${x.buyer.taxNo ? ` · VKN ${esc(x.buyer.taxNo)}` : ""}${x.buyer.taxOffice ? ` · ${esc(x.buyer.taxOffice)}` : ""}<br/>${esc(x.buyer.address ?? "")}</p>
      <p><strong>Hasta:</strong> ${esc(x.patient.fullName)} · dosya no ${esc(x.patient.fileNo)}</p>
      <table style="border-collapse:collapse;width:100%;margin-top:12px"><thead><tr style="text-align:left;color:#4f625d"><th style="padding:6px 0">Açıklama</th><th>Adet</th><th>Birim</th><th>KDV</th><th style="text-align:right">Tutar</th></tr></thead>
      <tbody>${x.lines.map((l) => `<tr><td style="padding:6px 0;border-top:1px solid #eef2f0">${esc(l.description)}</td><td style="border-top:1px solid #eef2f0">${l.quantity}</td><td style="border-top:1px solid #eef2f0">${esc(formatTRY(l.unitPrice))}</td><td style="border-top:1px solid #eef2f0">%${l.vatRate}</td><td style="border-top:1px solid #eef2f0;text-align:right">${esc(formatTRY(l.lineTotal))}</td></tr>`).join("")}</tbody></table>
      <p style="text-align:right;margin-top:12px">KDV hariç <strong>${esc(formatTRY(x.subtotal))}</strong> · KDV <strong>${esc(formatTRY(x.vatTotal))}</strong> · Genel toplam <strong style="font-size:16px">${esc(formatTRY(x.grandTotal))}</strong></p>
      <p style="margin-top:24px;color:#4f625d;font-size:12px">Fatura no: <strong>yok</strong> (sağlayıcı düzenlemedi) · Hazırlayan: ${esc(x.createdBy)} · ${esc(fmtDateTime(x.createdAt))}</p></main>`);
    w.print();
  }
  const x = d.data;
  return (
    <Drawer title={x ? `${INVOICE_DOC_TYPE_LABELS[x.docType]} · ${INVOICE_STATUS_LABELS[x.status]}` : "Fatura taslağı"} subtitle={x?.buyer.name} onClose={onClose}
      footer={x && <>
        <button className="btn" onClick={print}><Printer size={15} aria-hidden />Taslağı yazdır</button>
        {can("invoice.write") && (x.status === "draft" || x.status === "rejected" || (x.status === "issued" && x.providerConnected && !x.cancelReason)) && !cancelling && <button className="btn btn-ghost" onClick={() => setCancelling(true)}>{x.status === "issued" ? "Sağlayıcıdan iptal iste" : "İptal et"}</button>}
        {can("invoice.write") && x.status === "draft" && <button className="btn btn-primary" onClick={() => void submit()} title={x.providerConnected ? "Sağlayıcıya gönder" : "e-Belge sağlayıcısı bağlı değil"}>Sağlayıcıya gönder</button>}
      </>}>
      {!x ? <p className="muted">Yükleniyor…</p> : (
        <div className="stack">
          <Alert kind="warning">{x.notice}{!x.providerConnected && " e-Belge sağlayıcısı bağlı değil; gönderim denemesi reddedilir ve kaydedilir."}</Alert>
          {err && <Alert kind="error">{err.message}</Alert>}
          <dl className="kv">
            <dt>Alıcı</dt><dd>{x.buyer.name}{x.buyer.taxNo && <> · VKN <span className="mono">{x.buyer.taxNo}</span></>}{x.buyer.taxOffice && <> · {x.buyer.taxOffice}</>}</dd>
            {x.buyer.address && <><dt>Adres</dt><dd>{x.buyer.address}</dd></>}
            <dt>Fatura no</dt><dd>{x.invoiceNo ? <><span className="mono">{x.invoiceNo}</span>{x.invoiceNo.startsWith("MOCK") && <> <span className="badge badge-warning">MOCK sağlayıcı — resmî belge değil</span></>}</> : <span className="muted">yok — yalnız sağlayıcı verir</span>}</dd>
            {x.providerLabel && <><dt>Sağlayıcı</dt><dd>{x.providerLabel}{x.providerRef && <> · ref <span className="mono">{x.providerRef}</span></>}</dd></>}
            {x.rejectedReason && <><dt>Ret gerekçesi</dt><dd>{x.rejectedReason}</dd></>}
            <dt>Hazırlayan</dt><dd>{x.createdBy} · {fmtDateTime(x.createdAt)}</dd>
            {x.cancelReason && <><dt>İptal gerekçesi</dt><dd>{x.cancelReason}</dd></>}
          </dl>
          <div className="table-wrap" tabIndex={0}><table className="table">
            <thead><tr><th>#</th><th>Açıklama</th><th className="money">Adet</th><th className="money">Birim</th><th className="money">KDV</th><th className="money">Tutar</th></tr></thead>
            <tbody>{x.lines.map((l) => <tr key={l.lineNo}><td>{l.lineNo}</td><td>{l.description}</td><td className="money">{l.quantity}</td><td className="money">{formatTRY(l.unitPrice)}</td><td className="money">%{l.vatRate} · {formatTRY(l.vatAmount)}</td><td className="money">{formatTRY(l.lineTotal)}</td></tr>)}</tbody>
          </table></div>
          <div className="row" style={{ justifyContent: "flex-end", gap: 16 }}><span>KDV hariç <strong>{formatTRY(x.subtotal)}</strong></span><span>KDV <strong>{formatTRY(x.vatTotal)}</strong></span><span>Toplam <strong>{formatTRY(x.grandTotal)}</strong></span></div>
          {cancelling && <div className="stack"><TextField label="İptal gerekçesi" required value={reason} onChange={(e) => setReason(e.target.value)} error={err?.fieldErrors.reason} />
            <div className="row" style={{ gap: 6 }}><button className="btn" onClick={() => setCancelling(false)}>Vazgeç</button><button className="btn btn-danger" disabled={reason.trim().length < 3} onClick={() => void cancel()}>Taslağı iptal et</button></div></div>}
        </div>
      )}
    </Drawer>
  );
}
