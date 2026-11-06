"use client";
import { useState } from "react";
import { AlertTriangle, HeartPulse, Pencil } from "lucide-react";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime } from "@/lib/format";
import { Alert, Drawer, ErrorState, Loading, TextAreaField } from "@/components/ui";

export interface HealthNotes { exists: boolean; restricted: boolean; chronicConditions?: string | null; regularMedications?: string | null; allergies?: string | null;
  updatedAt?: string | null; updatedBy?: string | null; canEdit?: boolean }

export const useHealthNotes = (patientId: string | null) => useData<HealthNotes>(patientId ? `/patients/${patientId}/health-notes` : null);

/**
 * Hastanın sağlık uyarısı (07.11.2026, ADR-100): kronik hastalık, sürekli ilaç, alerji. Randevu sayfasında ve hasta kartı başlığında kullanılır.
 * Sağlık yetkisi olmayan rol içeriği görmez; yalnız "uyarı var, ayrıntı hekimde" bilgisi.
 */
export function HealthAlert({ h, compact = false }: { h: HealthNotes | null | undefined; compact?: boolean }) {
  if (!h?.exists) return null;
  if (h.restricted) return <Alert kind="warning" title="Sağlık uyarısı">Bu hastada kronik hastalık / sürekli ilaç / alerji kaydı var. Ayrıntıyı hekim ve asistan görür.</Alert>;
  const rows = [["Kronik hastalık", h.chronicConditions], ["Sürekli kullandığı ilaç", h.regularMedications], ["Alerji", h.allergies]].filter(([, v]) => v) as [string, string][];
  return (
    <Alert kind="warning" title="Sağlık uyarısı">
      {compact ? rows.map(([l, v]) => `${l}: ${v}`).join(" · ") : <dl className="kv" style={{ margin: 0 }}>{rows.map(([l, v]) => <><dt key={`${l}-t`}>{l}</dt><dd key={`${l}-d`} style={{ whiteSpace: "pre-wrap" }}>{v}</dd></>)}</dl>}
    </Alert>
  );
}

export function HealthChips({ patientId }: { patientId: string }) {
  const h = useHealthNotes(patientId).data;
  if (!h?.exists) return null;
  if (h.restricted) return <span className="chip-alert"><AlertTriangle size={13} aria-hidden />Sağlık uyarısı var</span>;
  return (<>
    {h.chronicConditions && <span className="chip-alert" title={h.chronicConditions}><HeartPulse size={13} aria-hidden />Kronik: {short(h.chronicConditions)}</span>}
    {h.regularMedications && <span className="chip-alert" title={h.regularMedications}><AlertTriangle size={13} aria-hidden />İlaç: {short(h.regularMedications)}</span>}
    {h.allergies && <span className="chip-alert" title={h.allergies}><AlertTriangle size={13} aria-hidden />Alerji: {short(h.allergies)}</span>}
  </>);
}
const short = (t: string) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);

/** Hasta kartı → Sağlık: sağlık özeti kartı (görüntüle / düzenle). */
export function HealthNotesCard({ patientId, onSaved }: { patientId: string; onSaved?: () => void }) {
  const { tz } = useSession();
  const h = useHealthNotes(patientId);
  const [editing, setEditing] = useState(false);
  if (h.loading && !h.data) return <div className="card"><Loading /></div>;
  if (h.error) return <div className="card"><ErrorState error={h.error} onRetry={h.reload} /></div>;
  const d = h.data!;
  const row = (label: string, v: string | null | undefined) => <><dt>{label}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{v ?? <span className="muted">Kayıt yok</span>}</dd></>;
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Sağlık özeti</h2><p className="muted small">Kronik hastalık, sürekli kullanılan ilaç ve alerji. Randevu verilirken uyarı olarak gösterilir.</p></div>
        {d.canEdit && <button className="btn btn-sm" onClick={() => setEditing(true)}><Pencil size={15} aria-hidden />{d.exists ? "Düzenle" : "Ekle"}</button>}
      </div>
      <div className="card-pad">
        <dl className="kv">
          {row("Kronik hastalık", d.chronicConditions)}
          {row("Sürekli kullandığı ilaç", d.regularMedications)}
          {row("Alerji", d.allergies)}
        </dl>
        {d.updatedAt && <p className="small muted" style={{ marginTop: 8 }}>Son güncelleme: {fmtDateTime(d.updatedAt, tz)} · {d.updatedBy}</p>}
      </div>
      {editing && <HealthNotesDrawer patientId={patientId} initial={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void h.reload(); onSaved?.(); }} />}
    </section>
  );
}

export function HealthNotesDrawer({ patientId, initial, onClose, onSaved }: { patientId: string; initial: HealthNotes; onClose: () => void; onSaved: () => void }) {
  const init = { chronicConditions: initial.chronicConditions ?? "", regularMedications: initial.regularMedications ?? "", allergies: initial.allergies ?? "" };
  const [f, setF] = useState(init);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = (Object.keys(init) as (keyof typeof init)[]).some((k) => f[k] !== init[k]);
  async function save() {
    setBusy(true); setErr(null);
    try { await api(`/patients/${patientId}/health-notes`, { method: "PUT", body: f }); onSaved(); } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Sağlık özeti" subtitle="Sağlık verisidir; yalnız hekim, asistan ve yönetici görür." onClose={onClose} dirty={dirty}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <TextAreaField label="Kronik hastalık" value={f.chronicConditions} onChange={(e) => setF({ ...f, chronicConditions: e.target.value })} rows={3} placeholder="Ör. Tip 2 diyabet, hipertansiyon" error={err?.fieldErrors.chronicConditions} />
        <TextAreaField label="Sürekli kullandığı ilaç" value={f.regularMedications} onChange={(e) => setF({ ...f, regularMedications: e.target.value })} rows={3} placeholder="Ör. kan sulandırıcı, insülin" error={err?.fieldErrors.regularMedications} />
        <TextAreaField label="Alerji" value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} rows={2} placeholder="Ör. penisilin, lateks, lokal anestezik" error={err?.fieldErrors.allergies} />
        <p className="small muted">Boş bırakılan alan "kayıt yok" sayılır.</p>
      </div>
    </Drawer>
  );
}
