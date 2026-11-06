"use client";
import { useMemo, useRef, useState } from "react";
import { AlarmClock, BellRing, MessageSquare, Send, X } from "lucide-react";
import { COMM_PURPOSE_LABELS, MESSAGE_PURPOSES_INFO, zonedToUtc } from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime, todayIn } from "@/lib/format";
import { Alert, DateField, EmptyState, ErrorState, Loading, SelectField, TextAreaField, TextField, useToast } from "@/components/ui";
import { confirmDialog } from "@/components/dialogs";

type Purpose = (typeof MESSAGE_PURPOSES_INFO)[number];
interface Status { provider: string | null; realSending: boolean; label: string; netgsm: { connection: string | null; configured: boolean; gateOpen: boolean; sender: string | null; missing: string[] } }
interface Pat { id: string; fileNo: number; fullName: string; phone: string | null; hasPhone: boolean; consent: Record<Purpose, boolean>; lastMessage: { at: string; status: string } | null; nextAppointmentAt: string | null }
interface Sched { id: string; patient: string; purposeLabel: string; body: string; sendAt: string; status: string; statusReason: string | null; by: string; messageStatus: string | null }
interface Rule { kind: string; label: string; hours: number; body: string; active: boolean; saved: boolean }
interface Msg { id: string; patient: string; purpose: string; recipient: string; body: string; provider: string; status: string; statusLabel: string; statusReason: string | null; source: string; createdAt: string; by: string }

const TABS = [["hastalar", "Hastalar ve gönderim"], ["zamanli", "Zamanlanmış mesajlar"], ["otomatik", "Otomatik mesajlar"], ["gecmis", "Gönderilen mesajlar"]] as const;
const SCHED_STATUS: Record<string, [string, string]> = { scheduled: ["Bekliyor", "info"], queued: ["Gönderime alındı", "success"], skipped: ["Gönderilmedi", "warning"], cancelled: ["İptal", "neutral"] };

/**
 * Mesajlar (07.11.2026, ADR-102): tüm hastalar listelenir; hekim/sekreter bilgi mesajı gönderir veya ileri tarihe kurar ("alarm");
 * klinik randevudan önce/sonra otomatik mesaj kuralı tanımlar. Yalnız SMS izni olan hastaya gider. Gerçek gönderim yalnız Netgsm hazırsa.
 */
export default function MessagesPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("hastalar");
  const toast = useToast();
  const status = useData<Status>(can("message.send") ? "/messaging/status" : null);
  if (!can("message.send")) return <div className="card"><EmptyState icon={<MessageSquare size={28} aria-hidden />} title="Mesaj gönderme rolünüze kapalı" /></div>;
  const s = status.data;
  return (
    <>
      <div className="page-head"><div><h1>Mesajlar</h1><p>Hastalara bilgi mesajı, zamanlanmış mesaj ve randevu öncesi/sonrası otomatik mesaj. Yalnız SMS izni olan hastaya gönderilir.</p></div></div>
      {s && (s.realSending
        ? <Alert kind="success" title="Netgsm bağlı">{s.label}. Mesajlar hastanın telefonuna gerçekten gider.</Alert>
        : <Alert kind="warning" title={s.provider ? "DENEME — gerçek mesaj gönderilmez" : "SMS sağlayıcısı yok"}>
            {s.provider ? "Mesajlar sistemde kaydedilir ve akış izlenir ama hastaya gitmez." : "Yönetim → Entegrasyonlar'dan SMS bağlantısı ekleyin."}
            {s.netgsm.missing.length > 0 && <> Netgsm için eksik: {s.netgsm.missing.join(", ")}. Bu bilgiler barındırma ortamının ayarlarına girilir; ekrana veya sohbete yazılmaz.</>}
          </Alert>)}
      <div className="subtabs" role="tablist" aria-label="Mesaj bölümleri" style={{ marginTop: 12 }}>
        {TABS.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className={`btn btn-sm ${tab === id ? "btn-primary" : ""}`} onClick={() => setTab(id)}>{l}</button>)}
      </div>
      <div role="tabpanel">
        {tab === "hastalar" && <PatientsTab notify={toast.show} />}
        {tab === "zamanli" && <SchedulesTab notify={toast.show} />}
        {tab === "otomatik" && <RulesTab notify={toast.show} />}
        {tab === "gecmis" && <HistoryTab />}
      </div>
      {toast.node}
    </>
  );
}

function PatientsTab({ notify }: { notify: (k: "success" | "error", t: string) => void }) {
  const { tz } = useSession();
  const today = todayIn(tz);
  const [q, setQ] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("treatment_followup");
  const list = useData<{ items: Pat[] }>(`/messaging/patients${q.trim().length >= 2 ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [body, setBody] = useState("");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("10:00");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [result, setResult] = useState<{ queued: number; skipped: number; results: { patientId: string; ok: boolean; reason?: string }[] } | null>(null);
  const key = useRef(newIdempotencyKey());
  const items = list.data?.items ?? [];
  const eligible = useMemo(() => items.filter((p) => p.hasPhone && p.consent[purpose]), [items, purpose]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function submit() {
    setBusy(true); setErr(null); setResult(null);
    try {
      const patientIds = [...sel];
      if (when === "now") {
        const r = await api<{ queued: number; skipped: number; results: { patientId: string; ok: boolean; reason?: string }[] }>("/messaging/send", { idempotencyKey: key.current, body: { patientIds, purpose, body } });
        setResult(r); notify("success", `${r.queued} mesaj gönderime alındı${r.skipped ? `, ${r.skipped} hasta atlandı` : ""}.`);
      } else {
        const sendAt = zonedToUtc(date, time, tz).toISOString();
        const r = await api<{ created: number }>("/messaging/schedules", { idempotencyKey: key.current, body: { patientIds, purpose, body, sendAt } });
        notify("success", `${r.created} mesaj ${date.split("-").reverse().join(".")} ${time} için zamanlandı.`);
      }
      key.current = newIdempotencyKey(); setSel(new Set()); setBody(""); void list.reload();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  const name = (id: string) => items.find((p) => p.id === id)?.fullName ?? "Hasta";
  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <section className="card">
        <div className="card-head">
          <div><h2>Hastalar</h2><p className="muted small">{items.length} hasta · seçilen amaç için SMS izni olan: {eligible.length}</p></div>
          <TextField label="Hasta ara" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, telefon veya dosya no" />
        </div>
        <div className="card-pad row" style={{ gap: 8, paddingTop: 0, flexWrap: "wrap" }}>
          <button className="btn btn-sm" onClick={() => setSel(new Set(eligible.map((p) => p.id)))}>İzni olanların tümünü seç ({eligible.length})</button>
          {sel.size > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}><X size={14} aria-hidden />Seçimi temizle</button>}
        </div>
        {list.loading && !list.data ? <Loading /> : list.error ? <ErrorState error={list.error} /> : items.length === 0 ? <EmptyState title="Hasta bulunamadı" /> : (
          <div className="table-wrap" tabIndex={0} style={{ maxHeight: 560, overflowY: "auto" }}>
            <table className="table">
              <thead><tr><th><span className="sr-only">Seç</span></th><th>Hasta</th><th>Telefon</th><th>SMS izni</th><th>Sıradaki randevu</th></tr></thead>
              <tbody>{items.map((p) => {
                const ok = p.hasPhone && p.consent[purpose];
                return (
                  <tr key={p.id}>
                    <td><input type="checkbox" aria-label={`${p.fullName} seç`} checked={sel.has(p.id)} disabled={!ok} onChange={() => toggle(p.id)} /></td>
                    <td><strong>{p.fullName}</strong><div className="small muted">#{p.fileNo}</div></td>
                    <td className="small">{p.phone ?? <span className="muted">Yok</span>}</td>
                    <td className="small">{p.consent[purpose] ? <span className="badge badge-success">Var</span> : <span className="badge badge-neutral">Yok</span>}</td>
                    <td className="small">{p.nextAppointmentAt ? fmtDateTime(p.nextAppointmentAt, tz) : "—"}</td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card card-pad stack" aria-labelledby="ms-yaz">
        <h2 id="ms-yaz">Mesaj yaz</h2>
        {err && <Alert kind="error">{err.message}</Alert>}
        <SelectField label="Mesaj amacı" value={purpose} onChange={(e) => { setPurpose(e.target.value as Purpose); setSel(new Set()); }} hint="Hastanın bu amaç için SMS izni olmalı.">
          {MESSAGE_PURPOSES_INFO.map((p) => <option key={p} value={p}>{COMM_PURPOSE_LABELS[p]}</option>)}
        </SelectField>
        <TextAreaField label="Mesaj" required rows={5} maxLength={640} value={body} onChange={(e) => setBody(e.target.value)} hint={`${body.length}/640 karakter · klinik/sağlık ayrıntısı yazmayın.`} error={err?.fieldErrors.body} />
        <div className="row" role="radiogroup" aria-label="Gönderim zamanı" style={{ gap: 8 }}>
          <button type="button" role="radio" aria-checked={when === "now"} className={`btn btn-sm ${when === "now" ? "btn-primary" : ""}`} onClick={() => setWhen("now")}><Send size={14} aria-hidden />Şimdi gönder</button>
          <button type="button" role="radio" aria-checked={when === "later"} className={`btn btn-sm ${when === "later" ? "btn-primary" : ""}`} onClick={() => setWhen("later")}><AlarmClock size={14} aria-hidden />Zamanla</button>
        </div>
        {when === "later" && (
          <div className="form-grid">
            <DateField label="Gün" required min={today} value={date} onChange={(e) => setDate(e.target.value)} />
            <TextField label="Saat" type="time" required step={300} value={time} onChange={(e) => setTime(e.target.value)} error={err?.fieldErrors.sendAt} />
          </div>
        )}
        <p className="small">{sel.size ? <>Seçilen: <strong>{sel.size} hasta</strong> ({[...sel].slice(0, 3).map(name).join(", ")}{sel.size > 3 ? "…" : ""})</> : <span className="muted">Listeden hasta seçin.</span>}</p>
        <button className="btn btn-primary" disabled={busy || sel.size === 0 || body.trim().length < 2} onClick={() => void submit()}>{busy ? "Gönderiliyor…" : when === "now" ? "Gönder" : "Zamanla"}</button>
        {result && result.skipped > 0 && (
          <Alert kind="warning" title="Atlanan hastalar">
            <ul style={{ margin: 0, paddingLeft: 18 }}>{result.results.filter((r) => !r.ok).map((r) => <li key={r.patientId}>{name(r.patientId)}: {r.reason}</li>)}</ul>
          </Alert>)}
      </section>
    </div>
  );
}

function SchedulesTab({ notify }: { notify: (k: "success" | "error", t: string) => void }) {
  const { tz } = useSession();
  const list = useData<{ items: Sched[] }>("/messaging/schedules");
  async function cancel(s: Sched) {
    if (!(await confirmDialog({ title: "Zamanlanmış mesajı iptal et", message: `${s.patient} için ${fmtDateTime(s.sendAt, tz)} mesajı iptal edilsin mi?`, confirmLabel: "İptal et", cancelLabel: "Vazgeç", danger: true }))) return;
    try { await api(`/messaging/schedules/${s.id}/cancel`, { body: {} }); notify("success", "Zamanlanmış mesaj iptal edildi."); void list.reload(); } catch (e) { notify("error", (e as ApiFailure).message); }
  }
  return (
    <section className="card">
      <div className="card-head"><div><h2>Zamanlanmış mesajlar</h2><p className="muted small">Zamanı gelince gönderilir; gönderim anında izin ve telefon yeniden kontrol edilir.</p></div></div>
      {list.loading && !list.data ? <Loading /> : list.error ? <ErrorState error={list.error} /> : list.data!.items.length === 0 ? <EmptyState icon={<AlarmClock size={28} aria-hidden />} title="Zamanlanmış mesaj yok" /> : (
        <ul className="list">{list.data!.items.map((s) => (
          <li key={s.id} className="row" style={{ padding: "10px 20px", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <strong>{fmtDateTime(s.sendAt, tz)}</strong> · {s.patient} <span className={`badge badge-${SCHED_STATUS[s.status]?.[1] ?? "neutral"}`}>{SCHED_STATUS[s.status]?.[0] ?? s.status}</span>
              {s.messageStatus && <span className="small muted"> · {s.messageStatus}</span>}
              <div className="small">{s.body}</div>
              <div className="small muted">{s.purposeLabel} · {s.by}{s.statusReason ? ` · ${s.statusReason}` : ""}</div>
            </div>
            {s.status === "scheduled" && <button className="btn btn-sm btn-ghost" onClick={() => void cancel(s)}>İptal et</button>}
          </li>))}</ul>)}
    </section>
  );
}

function RulesTab({ notify }: { notify: (k: "success" | "error", t: string) => void }) {
  const rules = useData<{ canEdit: boolean; items: Rule[]; placeholders: string[] }>("/messaging/rules");
  if (rules.loading && !rules.data) return <div className="card"><Loading /></div>;
  if (rules.error) return <div className="card"><ErrorState error={rules.error} /></div>;
  const d = rules.data!;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Alert kind="info">Kural açıkken her uygun randevu için mesaj bir kez gider: randevudan önce <strong>Randevu hatırlatma</strong>, tamamlanan randevudan sonra <strong>Tedavi/kontrol takibi</strong> izni olan hastalara. Yer tutucular: {d.placeholders.join(" ")}.</Alert>
      {d.items.map((r) => <RuleCard key={r.kind} rule={r} canEdit={d.canEdit} notify={notify} onSaved={() => void rules.reload()} />)}
    </div>
  );
}

function RuleCard({ rule, canEdit, notify, onSaved }: { rule: Rule; canEdit: boolean; notify: (k: "success" | "error", t: string) => void; onSaved: () => void }) {
  const [f, setF] = useState({ hours: String(rule.hours), body: rule.body, active: rule.active });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const before = rule.kind === "before_appointment";
  async function save() {
    setBusy(true); setErr(null);
    try { await api(`/messaging/rules/${rule.kind}`, { method: "PUT", body: { hours: Number(f.hours), body: f.body, active: f.active } }); notify("success", "Otomatik mesaj kuralı kaydedildi."); onSaved(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <section className="card card-pad stack">
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h2><BellRing size={18} aria-hidden style={{ verticalAlign: "-3px" }} /> {rule.label}</h2>
        <span className={`badge ${rule.active ? "badge-success" : "badge-neutral"}`}>{rule.active ? "Açık" : "Kapalı"}</span>
      </div>
      {err && <Alert kind="error">{err.message}</Alert>}
      <div className="form-grid">
        <TextField label={before ? "Randevudan kaç saat önce" : "Randevu tamamlandıktan kaç saat sonra"} type="number" min={1} max={168} value={f.hours} disabled={!canEdit}
          onChange={(e) => setF({ ...f, hours: e.target.value })} error={err?.fieldErrors.hours} />
        <label className="row small" style={{ gap: 8, alignSelf: "end" }}><input type="checkbox" checked={f.active} disabled={!canEdit} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Kural açık</label>
        <TextAreaField label="Mesaj şablonu" className="full" rows={3} maxLength={640} value={f.body} disabled={!canEdit} onChange={(e) => setF({ ...f, body: e.target.value })} error={err?.fieldErrors.body} />
      </div>
      {canEdit ? <div><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Kaydet</button></div> : <p className="small muted">Kuralı yalnız yönetici değiştirir.</p>}
    </section>
  );
}

function HistoryTab() {
  const { tz } = useSession();
  const list = useData<{ items: Msg[] }>("/messaging/messages?days=30");
  return (
    <section className="card">
      <div className="card-head"><div><h2>Gönderilen mesajlar</h2><p className="muted small">Son 30 gün. “İletildi” sağlayıcının teslim raporudur; “Sağlayıcıya iletildi” teslim değildir.</p></div></div>
      {list.loading && !list.data ? <Loading /> : list.error ? <ErrorState error={list.error} /> : list.data!.items.length === 0 ? <EmptyState title="Bu dönemde mesaj yok" /> : (
        <div className="table-wrap" tabIndex={0}>
          <table className="table table-wide">
            <thead><tr><th>Zaman</th><th>Hasta</th><th>Mesaj</th><th>Tür</th><th>Durum</th><th>Sağlayıcı</th></tr></thead>
            <tbody>{list.data!.items.map((m) => (
              <tr key={m.id}>
                <td className="small">{fmtDateTime(m.createdAt, tz)}</td>
                <td><strong>{m.patient}</strong><div className="small muted">{m.recipient}</div></td>
                <td className="small" style={{ maxWidth: 360 }}>{m.body}<div className="muted">{m.purpose} · {m.by}</div></td>
                <td className="small">{m.source}</td>
                <td className="small">{m.statusLabel}{m.statusReason && <div className="muted">{m.statusReason}</div>}</td>
                <td className="small">{m.provider}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
