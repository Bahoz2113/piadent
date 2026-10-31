"use client";
import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import {
  COMM_CHANNELS, COMM_CHANNEL_LABELS, COMM_PURPOSES, COMM_PURPOSE_LABELS, COMM_SOURCES, COMM_SOURCE_LABELS, MESSAGE_STATUS_LABELS,
  type CommChannel, type CommPurpose,
} from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime } from "@/lib/format";
import { Alert, Drawer, EmptyState, ErrorState, Loading, SelectField, TextAreaField, TextField } from "@/components/ui";

interface Comm {
  current: Record<string, { status: "granted" | "withdrawn"; at: string; source: string }>;
  history: { purpose: CommPurpose; channel: CommChannel; status: string; source: string; note: string | null; at: string; by: string }[];
  messages: { id: string; purpose: CommPurpose; channel: CommChannel; recipient: string; body: string; status: string; statusReason: string | null; createdAt: string; by: string;
    events: { status: string; source: string; detail: string | null; at: string }[] }[];
  provider: { name: string; label: string };
}
const MSG_BADGE: Record<string, string> = { queued: "neutral", submitted: "info", delivered: "success", failed: "error", cancelled: "neutral", unknown: "warning", draft: "neutral" };

export function CommunicationTab({ patientId }: { patientId: string }) {
  const { can } = useSession();
  const d = useData<Comm>(`/patients/${patientId}/communication`);
  const [edit, setEdit] = useState<{ purpose: CommPurpose; channel: CommChannel } | null>(null);
  const [sending, setSending] = useState(false);
  if (d.loading && !d.data) return <div className="card"><Loading /></div>;
  if (d.error) return <div className="card"><ErrorState error={d.error} /></div>;
  const c = d.data!;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <div className="card-head"><div><h2>İletişim tercihleri</h2>
          <p className="muted small">Her amaç ve kanal ayrı izindir. Aydınlatma metni, iletişim izni ve tıbbi onam farklı kavramlardır; tek bir “KVKK onaylı” kutusu yoktur. Kayıt yok = izin yok.</p></div></div>
        <div className="table-wrap" tabIndex={0}>
          <table className="table table-wide">
            <thead><tr><th>Amaç</th>{COMM_CHANNELS.map((ch) => <th key={ch}>{COMM_CHANNEL_LABELS[ch]}</th>)}</tr></thead>
            <tbody>{COMM_PURPOSES.map((p) => (
              <tr key={p}>
                <td><strong>{COMM_PURPOSE_LABELS[p]}</strong></td>
                {COMM_CHANNELS.map((ch) => {
                  const cur = c.current[`${p}:${ch}`];
                  const label = cur?.status === "granted" ? "İzin var" : cur?.status === "withdrawn" ? "Geri çekildi" : "Kayıt yok";
                  return (
                    <td key={ch}>
                      {can("communication.write")
                        ? <button className={`btn btn-sm ${cur?.status === "granted" ? "" : "btn-ghost"}`} aria-label={`${COMM_PURPOSE_LABELS[p]} · ${COMM_CHANNEL_LABELS[ch]}: ${label}. Değiştir`}
                            onClick={() => setEdit({ purpose: p, channel: ch })}><span className={`dot dot-${cur?.status ?? "none"}`} aria-hidden />{label}</button>
                        : <span><span className={`dot dot-${cur?.status ?? "none"}`} aria-hidden />{label}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
        {c.history.length > 0 && (
          <details className="card-pad">
            <summary className="small">Tercih geçmişi ({c.history.length})</summary>
            <ul className="small" style={{ marginTop: 8 }}>{c.history.map((h, i) => (
              <li key={i}>{fmtDateTime(h.at)} · {COMM_PURPOSE_LABELS[h.purpose]} / {COMM_CHANNEL_LABELS[h.channel]}: <strong>{h.status === "granted" ? "izin verildi" : "geri çekildi"}</strong>
                {" "}({COMM_SOURCE_LABELS[h.source as keyof typeof COMM_SOURCE_LABELS]}, {h.by}){h.note ? ` — ${h.note}` : ""}</li>
            ))}</ul>
          </details>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div><h2>Mesajlar</h2><p className="muted small">Gönderim ve teslim ayrıdır: sağlayıcı teslimi bildirmedikçe “teslim edildi” yazılmaz; yanıt gelmezse durum “bilinmiyor” olur.</p></div>
          {can("message.send") && <button className="btn btn-sm btn-primary" onClick={() => setSending(true)}><MessageSquarePlus size={15} aria-hidden />Mesaj gönder</button>}
        </div>
        <div className="card-pad" style={{ paddingTop: 0 }}><Alert kind="warning">{c.provider.label}</Alert></div>
        {c.messages.length === 0 ? <EmptyState title="Mesaj yok" /> : (
          <ul className="list">{c.messages.map((m) => (
            <li key={m.id} style={{ padding: "10px 20px" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span><strong>{COMM_PURPOSE_LABELS[m.purpose]}</strong> · {COMM_CHANNEL_LABELS[m.channel]} · {m.recipient}</span>
                <span className={`badge badge-${MSG_BADGE[m.status]}`}>{MESSAGE_STATUS_LABELS[m.status]}</span>
              </div>
              <p className="small" style={{ margin: "4px 0" }}>{m.body}</p>
              <p className="small muted">{m.events.map((e) => `${fmtDateTime(e.at)} ${MESSAGE_STATUS_LABELS[e.status] ?? e.status}${e.detail ? ` (${e.detail})` : ""}`).join(" → ")}</p>
            </li>
          ))}</ul>
        )}
      </section>
      {edit && <PreferenceDrawer patientId={patientId} {...edit} current={c.current[`${edit.purpose}:${edit.channel}`]?.status} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void d.reload(); }} />}
      {sending && <SendDrawer patientId={patientId} comm={c} onClose={() => setSending(false)} onSaved={() => { setSending(false); void d.reload(); }} />}
    </div>
  );
}

function PreferenceDrawer({ patientId, purpose, channel, current, onClose, onSaved }: { patientId: string; purpose: CommPurpose; channel: CommChannel; current?: string; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<"granted" | "withdrawn">(current === "granted" ? "withdrawn" : "granted");
  const [source, setSource] = useState<(typeof COMM_SOURCES)[number]>("in_person");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function save() {
    try { await api(`/patients/${patientId}/communication-preferences`, { body: { purpose, channel, status, source, note: note || undefined } }); onSaved(); }
    catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title="İletişim tercihini kaydet" subtitle={`${COMM_PURPOSE_LABELS[purpose]} · ${COMM_CHANNEL_LABELS[channel]}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600 }}>Hastanın beyanı</legend>
          <label className="row"><input type="radio" name="st" checked={status === "granted"} onChange={() => setStatus("granted")} /> İzin veriyor</label>
          <label className="row"><input type="radio" name="st" checked={status === "withdrawn"} onChange={() => setStatus("withdrawn")} /> İzin vermiyor / geri çekiyor</label>
        </fieldset>
        <SelectField label="Nasıl alındı" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
          {COMM_SOURCES.map((s) => <option key={s} value={s}>{COMM_SOURCE_LABELS[s]}</option>)}
        </SelectField>
        <TextField label="Not" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="small muted">Kayıt silinmez; her değişiklik geçmişe eklenir.</p>
      </div>
    </Drawer>
  );
}

const TEMPLATES: Partial<Record<CommPurpose, string>> = {
  appointment_reminder: "Sayın hastamız, randevunuzu hatırlatırız. Değişiklik için kliniği arayabilirsiniz.",
  treatment_followup: "Sayın hastamız, kontrol zamanınız yaklaştı. Randevu için kliniği arayabilirsiniz.",
  payment_reminder: "Sayın hastamız, hesabınızla ilgili bilgi için kliniği arayabilirsiniz.",
};

function SendDrawer({ patientId, comm, onClose, onSaved }: { patientId: string; comm: Comm; onClose: () => void; onSaved: () => void }) {
  const [key] = useState(newIdempotencyKey);
  const [purpose, setPurpose] = useState<CommPurpose>("appointment_reminder");
  const [channel, setChannel] = useState<"sms" | "whatsapp" | "email">("sms");
  const [body, setBody] = useState(TEMPLATES.appointment_reminder!);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const allowed = comm.current[`${purpose}:${channel}`]?.status === "granted";
  async function save() {
    try { await api("/messages", { body: { patientId, purpose, channel, body }, idempotencyKey: key }); onSaved(); } catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title="Mesaj gönder" subtitle="MOCK sağlayıcı: mesaj dışarı GİTMEZ; akış ve durumlar test edilir." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={!allowed} onClick={() => void save()}>Kuyruğa al</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <SelectField label="Amaç" value={purpose} onChange={(e) => { const p = e.target.value as CommPurpose; setPurpose(p); if (TEMPLATES[p]) setBody(TEMPLATES[p]!); }}>
          {COMM_PURPOSES.map((p) => <option key={p} value={p}>{COMM_PURPOSE_LABELS[p]}</option>)}
        </SelectField>
        <SelectField label="Kanal" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
          {(["sms", "whatsapp", "email"] as const).map((ch) => <option key={ch} value={ch}>{COMM_CHANNEL_LABELS[ch]}</option>)}
        </SelectField>
        {!allowed && <Alert kind="warning">Bu amaç ve kanal için kayıtlı izin yok; mesaj gönderilemez.</Alert>}
        <TextAreaField label="Metin" value={body} onChange={(e) => setBody(e.target.value)} rows={3} hint="Mesaja tanı/tedavi ayrıntısı yazmayın." />
      </div>
    </Drawer>
  );
}
