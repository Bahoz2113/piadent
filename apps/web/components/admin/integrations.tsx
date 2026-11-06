"use client";
import { useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { INTEGRATION_KIND_LABELS, OPERATION_LABELS, OUTCOME_LABELS, TRANSPORT_LABELS, type IntegrationKind } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { useSession } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";
import { Alert, Drawer, ErrorState, Loading, SelectField, TextAreaField } from "@/components/ui";

type Notify = (k: "success" | "error", t: string) => void;
interface Conn { id: string; kind: IntegrationKind; provider: string; mode: string; status: "active" | "disabled" | "blocked"; blockedReason: string | null;
  mockBehavior: string; mockQueryResult: string; hasSecret: boolean; secretRotatedAt: string | null; webhookPath: string; rejections7d: number }
interface Overview { connections: Conn[]; readiness: Record<IntegrationKind, { mock: boolean; waitingFor: string }>; externalSendGate: "open" | "closed" }
export interface Job { id: string; operation: string; approvalStatus: string; transportStatus: string; outcomeStatus: string; attempts: number; maxAttempts: number;
  nextAttemptAt: string | null; lastError: string | null; providerRef: string | null; createdAt: string; provider: string; mode: string; requestedBy: string;
  approvedBy: string | null; mine: boolean; summary: string }
interface JobDetail { attempts: { attempt: number; kind: string; result: string; detail: string | null; started_at: string }[];
  webhooks: { provider_event_id: string; event_type: string; received_at: string; status: string; detail: string | null }[] }
interface Hooks { events: { eventId: string; type: string; receivedAt: string; status: string; detail: string | null; kind: string }[]; rejections: { reason: string; n: number; last_at: string }[] }

const BEHAVIOR: Record<string, string> = { accept: "Kabul et", reject: "Reddet", timeout: "Zaman aşımı", unavailable: "Ulaşılamıyor (geçici hata)" };
const HOOK_STATUS: Record<string, [string, string]> = {
  processed: ["İşlendi", "success"], duplicate: ["Tekrar (yok sayıldı)", "neutral"], ignored_stale: ["Eski/ters sıra (yok sayıldı)", "neutral"],
  ignored_unknown: ["Eşleşmedi", "warning"], error: ["İnceleme gerekli", "danger"],
};
/** 07.11.2026: ekranda yabancı terim yok — sağlayıcı olay kodları Türkçe adla gösterilir. */
const EVENT_LABELS: Record<string, string> = {
  "message.delivered": "Mesaj teslim edildi", "message.failed": "Mesaj teslim edilemedi", "payment.succeeded": "Ödeme alındı", "payment.failed": "Ödeme başarısız",
  "refund.succeeded": "İade tamamlandı", "refund.failed": "İade başarısız",
};
const ATTEMPT_RESULT: Record<string, string> = { accepted: "Kabul edildi", rejected: "Reddedildi", timeout: "Zaman aşımı", unavailable: "Ulaşılamadı", not_found: "Kayıt yok", error: "Hata" };
const REJECT_REASON: Record<string, string> = { signature_invalid: "Geçersiz imza", timestamp_out_of_window: "Zaman sınırı dışı (yeniden gönderilmiş olabilir)", malformed: "Bozuk gövde" };
const EVENTS_FOR: Record<string, string[]> = {
  "sms.send": ["message.delivered", "message.failed"], "payment.create_link": ["payment.succeeded", "payment.failed"], "payment.refund": ["refund.succeeded", "refund.failed"],
};

export function transportBadge(j: Pick<Job, "transportStatus" | "outcomeStatus">) {
  const tone = j.transportStatus === "dead" || j.transportStatus === "rejected" || j.outcomeStatus === "failed" ? "danger"
    : j.transportStatus === "held" || j.transportStatus === "unknown" ? "warning" : j.outcomeStatus === "succeeded" ? "success" : "neutral";
  const label = j.outcomeStatus === "succeeded" || j.outcomeStatus === "failed" ? OUTCOME_LABELS[j.outcomeStatus] : TRANSPORT_LABELS[j.transportStatus] ?? j.transportStatus;
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

export function IntegrationsPanel({ notify }: { notify: Notify }) {
  const { can } = useSession();
  const ov = useData<Overview>("/integrations/overview");
  const [filter, setFilter] = useState<"attention" | "open" | "all">("attention");
  const jobs = useData<{ items: Job[] }>(`/integrations/jobs${filter === "all" ? "" : `?status=${filter}`}`);
  const hooks = useData<Hooks>("/integrations/webhooks");
  const [secret, setSecret] = useState<string | null>(null);
  const [reason, setReason] = useState<null | { job: Job; action: "reject" | "cancel" }>(null);
  const [detail, setDetail] = useState<Job | null>(null);
  const manage = can("integration.manage");
  const reloadAll = async () => { await Promise.all([ov.reload(), jobs.reload(), hooks.reload()]); };
  async function act(path: string, body: unknown, ok: string) {
    try { await api(path, { body }); notify("success", ok); await reloadAll(); } catch (e) { notify("error", (e as ApiFailure).message); }
  }
  async function patch(c: Conn, body: Record<string, string>) {
    try { await api(`/integrations/connections/${c.id}`, { method: "PATCH", body }); notify("success", "Bağlantı güncellendi."); await ov.reload(); } catch (e) { notify("error", (e as ApiFailure).message); }
  }
  if (ov.loading && !ov.data) return <div className="card"><Loading /></div>;
  if (ov.error) return <div className="card"><ErrorState error={ov.error} /></div>;
  const o = ov.data!;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Alert kind="info" title="PİA Köprü — dış servis bağlantıları">
        Bu ortamda yalnız <strong>DENEME</strong> (sahte, etiketli) SMS ve online ödeme sağlayıcısı vardır; gerçek mesaj gönderilmez, gerçek para hareket etmez.
        Canlı dış gönderim kapısı: <span className={`badge badge-${o.externalSendGate === "open" ? "warning" : "neutral"}`}>{o.externalSendGate === "open" ? "AÇIK" : "KAPALI"}</span>.
        Sağlayıcı “kabul etti” demek, mesajın teslim edildiği veya ödemenin alındığı anlamına gelmez; nihai sonuç yalnız imzası doğrulanmış bildirimle kaydedilir.
      </Alert>

      <section className="card">
        <div className="card-head"><div><h2>Bağlantılar</h2><p className="muted small">Erişim bekleyen servisler etkinleştirilemez; yerine sahte başarı gösterilmez.</p></div></div>
        <div className="table-wrap" tabIndex={0}>
          <table className="table table-wide">
            <thead><tr><th>Servis</th><th>Sağlayıcı</th><th>Durum</th><th>Deneme davranışı</th><th>Sağlayıcı bildirimi</th><th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>{o.connections.map((c) => (
              <tr key={c.id}>
                <td><strong>{INTEGRATION_KIND_LABELS[c.kind]}</strong>{c.blockedReason && <div className="small muted">{c.blockedReason}</div>}</td>
                <td>{c.provider === "mock" ? <span className="badge badge-warning">DENEME</span> : c.status === "blocked" ? <span className="muted">Seçilmedi</span> : c.provider}</td>
                <td>{c.status === "active" ? <span className="badge badge-success">Etkin</span> : c.status === "disabled" ? <span className="badge badge-neutral">Kapalı</span>
                  : <span className="badge badge-warning">Erişim bekliyor</span>}</td>
                <td>{c.provider === "mock" && manage ? (
                  <div className="row" style={{ gap: 6 }}>
                    <select aria-label={`${INTEGRATION_KIND_LABELS[c.kind]} gönderim davranışı`} value={c.mockBehavior} onChange={(e) => void patch(c, { mockBehavior: e.target.value })}>
                      {Object.entries(BEHAVIOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <select aria-label={`${INTEGRATION_KIND_LABELS[c.kind]} durum sorgusu sonucu`} value={c.mockQueryResult} onChange={(e) => void patch(c, { mockQueryResult: e.target.value })}>
                      <option value="accepted">Sorgu: kayıt var</option><option value="not_found">Sorgu: kayıt yok</option>
                    </select>
                  </div>) : c.provider === "mock" ? BEHAVIOR[c.mockBehavior] : "—"}</td>
                <td className="small">{c.hasSecret ? <><ShieldCheck size={14} aria-hidden /> İmzalı bildirim adresi · <code>{c.webhookPath}</code>
                  {c.rejections7d > 0 && <div><span className="badge badge-danger">{c.rejections7d} reddedilen istek (7 gün)</span></div>}</> : "—"}</td>
                <td>{manage && c.status !== "blocked" && (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => void patch(c, { status: c.status === "active" ? "disabled" : "active" })}>{c.status === "active" ? "Kapat" : "Etkinleştir"}</button>
                    {c.hasSecret && <button className="btn btn-sm btn-ghost" onClick={() => void api<{ webhookSecret: string }>(`/integrations/connections/${c.id}/rotate-secret`, { body: {} })
                      .then((r) => { setSecret(r.webhookSecret); void ov.reload(); }, (e) => notify("error", (e as ApiFailure).message))}>Anahtarı yenile</button>}
                  </div>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div><h2>Gönderim işleri</h2><p className="muted small">Her iş aynı tekilleştirme anahtarıyla gönderilir; zaman aşımında kör tekrar yapılmaz, önce sağlayıcıdan durum sorgulanır.</p></div>
          <div className="row" style={{ gap: 6 }}>
            {(["attention", "open", "all"] as const).map((f) => <button key={f} className={`btn btn-sm ${filter === f ? "btn-primary" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "attention" ? "Dikkat gerekenler" : f === "open" ? "Açık" : "Tümü"}</button>)}
            <button className="btn btn-sm btn-ghost" aria-label="Yenile" onClick={() => void reloadAll()}><RefreshCw size={14} aria-hidden /></button>
          </div>
        </div>
        {jobs.error ? <ErrorState error={jobs.error} /> : !jobs.data ? <Loading /> : jobs.data.items.length === 0 ? <p className="muted" style={{ padding: "12px 20px" }}>Bu filtrede iş yok.</p> : (
          <div className="table-wrap" tabIndex={0}>
            <table className="table table-wide">
              <thead><tr><th>İş</th><th>Durum</th><th>Deneme</th><th>İsteyen / onaylayan</th><th><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>{jobs.data.items.map((j) => (
                <tr key={j.id}>
                  <td><strong>{OPERATION_LABELS[j.operation] ?? j.operation}</strong> <span className="badge badge-warning">DENEME</span><div className="small muted">{j.summary} · {fmtDateTime(j.createdAt)}</div></td>
                  <td>{transportBadge(j)}{j.lastError && <div className="small muted">{j.lastError}</div>}</td>
                  <td className="small">{j.attempts}/{j.maxAttempts}{j.nextAttemptAt && ["queued", "unknown"].includes(j.transportStatus) && <div className="muted">Sonraki: {fmtDateTime(j.nextAttemptAt)}</div>}</td>
                  <td className="small">{j.requestedBy}{j.approvedBy && <div className="muted">Onay: {j.approvedBy}</div>}</td>
                  <td><div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {j.approvalStatus === "pending" && can("integration.approve") && (j.mine
                      ? <span className="small muted">Kendi isteğinizi onaylayamazsınız</span>
                      : <button className="btn btn-sm btn-primary" onClick={() => void act(`/integration-jobs/${j.id}/approve`, {}, "Onaylandı; iş kuyruğa alındı.")}>Onayla</button>)}
                    {j.approvalStatus === "pending" && can("integration.approve") && <button className="btn btn-sm" onClick={() => setReason({ job: j, action: "reject" })}>Reddet</button>}
                    {j.transportStatus === "dead" && manage && <button className="btn btn-sm btn-primary" onClick={() => void act(`/integration-jobs/${j.id}/retry`, {}, "Yeniden denemeye alındı.")}>Yeniden dene</button>}
                    {["queued", "dead"].includes(j.transportStatus) && manage && <button className="btn btn-sm btn-ghost" onClick={() => setReason({ job: j, action: "cancel" })}>İptal</button>}
                    <button className="btn btn-sm btn-ghost" onClick={() => setDetail(j)}>Ayrıntı</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Sağlayıcı bildirimleri</h2><p className="muted small">İmza ve zaman damgası doğrulanmayan istekler işlenmez, içeriği saklanmaz; aynı olay ikinci kez etki doğurmaz.</p></div></div>
        {hooks.data && hooks.data.rejections.length > 0 && (
          <div style={{ padding: "0 20px 8px" }}>{hooks.data.rejections.map((r) => <span key={r.reason} className="badge badge-danger" style={{ marginRight: 6 }}>{REJECT_REASON[r.reason] ?? r.reason}: {r.n}</span>)}</div>)}
        {!hooks.data ? <Loading /> : hooks.data.events.length === 0 ? <p className="muted" style={{ padding: "12px 20px" }}>Henüz bildirim yok.</p> : (
          <ul className="list" style={{ padding: "0 20px 12px" }}>{hooks.data.events.slice(0, 30).map((e) => (
            <li key={`${e.kind}-${e.eventId}`} className="row small" style={{ justifyContent: "space-between", padding: "6px 0", gap: 8 }}>
              <span>{EVENT_LABELS[e.type] ?? e.type} · {fmtDateTime(e.receivedAt)} <span className="muted">· olay no {e.eventId}</span>{e.detail && <span className="muted"> · {e.detail}</span>}</span>
              <span className={`badge badge-${HOOK_STATUS[e.status]?.[1] ?? "neutral"}`}>{HOOK_STATUS[e.status]?.[0] ?? e.status}</span>
            </li>))}</ul>)}
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Erişim bekleyen entegrasyonlar</h2><p className="muted small">Yetkili güncel doküman ve test erişimi olmadan gerçek adaptör yazılmaz.</p></div></div>
        <ul className="list" style={{ padding: "0 20px 12px" }}>{(Object.keys(o.readiness) as IntegrationKind[]).map((k) => (
          <li key={k} className="small" style={{ padding: "6px 0" }}><strong>{INTEGRATION_KIND_LABELS[k]}</strong>{" "}
            {o.readiness[k].mock ? <span className="badge badge-warning">Deneme hazır · gerçek sağlayıcı bekleniyor</span> : <span className="badge badge-neutral">Erişim bekliyor</span>}
            <div className="muted">{o.readiness[k].waitingFor}</div></li>))}</ul>
      </section>

      {secret && (
        <Drawer title="Yeni bildirim imza anahtarı" onClose={() => setSecret(null)} footer={<button className="btn btn-primary" onClick={() => setSecret(null)}>Kaydettim, kapat</button>}>
          <Alert kind="warning">Anahtar yalnız bir kez gösterilir. Sağlayıcı paneline girin; eski anahtarla imzalanan bildirimler artık reddedilir.</Alert>
          <p><code style={{ wordBreak: "break-all" }}>{secret}</code></p>
        </Drawer>)}
      {reason && <ReasonDrawer title={reason.action === "reject" ? "İsteği reddet" : "İşi iptal et"} onClose={() => setReason(null)}
        onSubmit={async (r) => { await act(`/integration-jobs/${reason.job.id}/${reason.action}`, { reason: r }, reason.action === "reject" ? "İstek reddedildi; gönderilmeyecek." : "İş iptal edildi."); setReason(null); }} />}
      {detail && <JobDrawer job={detail} canSimulate={manage} notify={notify} onClose={() => setDetail(null)} onChanged={reloadAll} />}
    </div>
  );
}

function ReasonDrawer({ title, onClose, onSubmit }: { title: string; onClose: () => void; onSubmit: (r: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Drawer title={title} onClose={onClose} dirty={!!text} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn btn-primary" disabled={busy || text.trim().length < 3} onClick={() => { setBusy(true); void onSubmit(text.trim()).finally(() => setBusy(false)); }}>Kaydet</button></>}>
      <TextAreaField label="Gerekçe" required value={text} onChange={(e) => setText(e.target.value)} hint="Denetim kaydına yazılır." />
    </Drawer>
  );
}

function JobDrawer({ job, canSimulate, notify, onClose, onChanged }: { job: Job; canSimulate: boolean; notify: Notify; onClose: () => void; onChanged: () => Promise<void> }) {
  const d = useData<JobDetail>(`/integrations/jobs/${job.id}`);
  const events = EVENTS_FOR[job.operation] ?? [];
  const [event, setEvent] = useState(events[0] ?? "");
  async function simulate() {
    try {
      const r = await api<{ status: string; detail?: string }>("/integrations/mock/simulate", { body: { jobId: job.id, event } });
      notify(r.status === "processed" ? "success" : "error", `Bildirim: ${HOOK_STATUS[r.status]?.[0] ?? r.status}${r.detail ? ` (${r.detail})` : ""}`);
      await d.reload(); await onChanged();
    } catch (e) { notify("error", (e as ApiFailure).message); }
  }
  return (
    <Drawer title={OPERATION_LABELS[job.operation] ?? job.operation} subtitle={<>{job.summary} · {transportBadge(job)}</>} onClose={onClose}>
      {job.providerRef && <p className="small">Sağlayıcı referansı: <code>{job.providerRef}</code></p>}
      <h3>Denemeler</h3>
      {!d.data ? <Loading rows={2} /> : d.data.attempts.length === 0 ? <p className="muted small">Henüz deneme yok.</p> : (
        <ul className="list">{d.data.attempts.map((a, i) => (
          <li key={i} className="small" style={{ padding: "4px 0" }}>{fmtDateTime(a.started_at)} · {a.kind === "status_query" ? "Durum sorgusu" : "Gönderim"} → <strong>{ATTEMPT_RESULT[a.result] ?? TRANSPORT_LABELS[a.result] ?? a.result}</strong>{a.detail ? ` · ${a.detail}` : ""}</li>))}</ul>)}
      <h3>Bildirimler</h3>
      {d.data && (d.data.webhooks.length === 0 ? <p className="muted small">Bildirim yok.</p> : (
        <ul className="list">{d.data.webhooks.map((w) => (
          <li key={w.provider_event_id} className="small" style={{ padding: "4px 0" }}>{EVENT_LABELS[w.event_type] ?? w.event_type} · {fmtDateTime(w.received_at)} · {HOOK_STATUS[w.status]?.[0] ?? w.status}</li>))}</ul>))}
      {canSimulate && job.mode === "mock" && events.length > 0 && (
        <div className="stack" style={{ gap: 8, marginTop: 16 }}>
          <Alert kind="warning">Deneme sağlayıcı bildirimi: bağlantının anahtarıyla imzalanır ve gerçek sağlayıcı bildirimiyle aynı doğrulamadan geçer. Yalnız deneme içindir.</Alert>
          <SelectField label="Simüle edilecek olay" value={event} onChange={(e) => setEvent(e.target.value)}>{events.map((e) => <option key={e} value={e}>{EVENT_LABELS[e] ?? e}</option>)}</SelectField>
          <button className="btn btn-primary" onClick={() => void simulate()}>Deneme bildirimi gönder</button>
        </div>)}
    </Drawer>
  );
}
