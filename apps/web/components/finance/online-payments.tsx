"use client";
import { useState } from "react";
import { Link2 } from "lucide-react";
import { ONLINE_PAYMENT_STATUS_LABELS, formatTRY } from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime } from "@/lib/format";
import { Alert, Drawer, Loading, TextAreaField, TextField } from "@/components/ui";
import { parseMoneyInput } from "./money-input";

interface OnlineReq { id: string; amount: string; description: string; status: string; checkoutUrl: string | null; failureReason: string | null; createdAt: string;
  paidAt: string | null; isMock: boolean; by: string }
const TONE: Record<string, string> = { paid: "success", link_ready: "warning", created: "neutral", failed: "danger", cancelled: "neutral", expired: "neutral" };

/** Online ödeme istekleri (VİA Köprü, MOCK sağlayıcı). Bağlantı oluşturmak tahsilat değildir; ödeme yalnız imzalı sağlayıcı bildirimiyle deftere girer. */
export function OnlinePayments({ patientId, onChanged }: { patientId: string; onChanged: () => void }) {
  const { can } = useSession();
  const list = useData<{ items: OnlineReq[] }>(`/patients/${patientId}/online-payments`);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  async function cancel(o: OnlineReq) {
    try { await api(`/online-payments/${o.id}/cancel`, { body: {} }); setMsg({ kind: "success", text: "Ödeme isteği iptal edildi." }); await list.reload(); }
    catch (e) { setMsg({ kind: "error", text: (e as ApiFailure).message }); }
  }
  const items = list.data?.items ?? [];
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Online ödeme istekleri</h2><p className="muted small">Bağlantı oluşturmak tahsilat değildir. Ödeme yalnız sağlayıcının imzalı bildirimiyle avans olarak kaydedilir; borca dağıtım ayrıca yapılır.</p></div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => { void list.reload(); onChanged(); }}>Yenile</button>
          {can("payment.write") && <button className="btn btn-sm" onClick={() => setOpen(true)}><Link2 size={15} aria-hidden />Ödeme bağlantısı (MOCK)</button>}
        </div>
      </div>
      {msg && <div style={{ padding: "0 20px" }}><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      {list.loading && !list.data ? <Loading rows={1} /> : items.length === 0 ? <p className="muted small" style={{ padding: "8px 20px 16px" }}>Online ödeme isteği yok.</p> : (
        <ul className="list" style={{ padding: "0 20px 12px" }}>{items.map((o) => (
          <li key={o.id} className="row" style={{ justifyContent: "space-between", padding: "8px 0", gap: 8, flexWrap: "wrap" }}>
            <span><strong>{formatTRY(o.amount)}</strong> · {o.description} {o.isMock && <span className="badge badge-warning">MOCK</span>}
              <div className="small muted">{fmtDateTime(o.createdAt)} · {o.by}{o.paidAt ? ` · ödendi ${fmtDateTime(o.paidAt)}` : ""}{o.failureReason ? ` · ${o.failureReason}` : ""}</div>
              {o.checkoutUrl && o.status === "link_ready" && <div className="small">Bağlantı: <code style={{ wordBreak: "break-all" }}>{o.checkoutUrl}</code> <span className="muted">(MOCK — gerçek ödeme sayfası değildir; hastaya gönderilmez)</span></div>}</span>
            <span className="row" style={{ gap: 6 }}>
              <span className={`badge badge-${TONE[o.status] ?? "neutral"}`}>{ONLINE_PAYMENT_STATUS_LABELS[o.status] ?? o.status}</span>
              {can("payment.write") && ["created", "link_ready"].includes(o.status) && <button className="btn btn-sm btn-ghost" onClick={() => void cancel(o)}>İptal</button>}
            </span>
          </li>))}</ul>)}
      {open && <CreateDrawer patientId={patientId} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); setMsg({ kind: "success", text: "Ödeme bağlantısı isteği sıraya alındı (MOCK)." }); void list.reload(); }} />}
    </section>
  );
}

function CreateDrawer({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: () => void }) {
  const [key] = useState(newIdempotencyKey);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("Diş tedavisi ödemesi");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const parsed = parseMoneyInput(amount);
    if (!parsed) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Tutarı girin.", field_errors: { amount: "Geçerli tutar girin." } })); return; }
    setBusy(true); setErr(null);
    try { await api(`/patients/${patientId}/online-payments`, { body: { amount: parsed, description }, idempotencyKey: key }); onSaved(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Online ödeme bağlantısı" subtitle="MOCK sağlayıcı · gerçek para hareketi yok" onClose={onClose} dirty={!!amount}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Bağlantı iste</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <Alert kind="info">Sağlayıcıya yalnız tutar, para birimi, genel açıklama ve VİADENT referansı gönderilir; hasta adı veya klinik bilgi gönderilmez. Kart bilgisi VİADENT'e hiç gelmez.</Alert>
        <TextField label="Tutar (₺)" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={err?.fieldErrors.amount} />
        <TextField label="Açıklama" value={description} onChange={(e) => setDescription(e.target.value)} error={err?.fieldErrors.description} />
      </div>
    </Drawer>
  );
}

export function ProviderRefundDrawer({ payment, onClose, onSaved }: { payment: { id: string; amount: string; refunded: string }; onClose: () => void; onSaved: (note: string) => void }) {
  const [key] = useState(newIdempotencyKey);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const parsed = parseMoneyInput(amount);
    if (!parsed) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Tutarı girin.", field_errors: { amount: "Geçerli tutar girin." } })); return; }
    setBusy(true); setErr(null);
    try { const r = await api<{ note: string }>(`/payments/${payment.id}/provider-refunds`, { body: { amount: parsed, reason }, idempotencyKey: key }); onSaved(r.note); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Sağlayıcı üzerinden iade" subtitle={`${formatTRY(payment.amount)} online ödemeden`} onClose={onClose} dirty={!!amount || !!reason}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || reason.trim().length < 3} onClick={() => void save()}>Onaya gönder</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <Alert kind="warning">Dört göz kuralı: iade, isteyen dışında yetkili bir kişi VİA Köprü ekranında onaylayınca sağlayıcıya iletilir. Hesaba iade kaydı, sağlayıcı iadeyi bildirdiğinde düşer.</Alert>
        <TextField label="İade tutarı (₺)" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={err?.fieldErrors.amount} />
        <TextAreaField label="Gerekçe" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={err?.fieldErrors.reason} />
      </div>
    </Drawer>
  );
}
