"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CalendarPlus, History, Lock, NotebookPen, Pencil, FileText, Wallet, Stethoscope, MessageSquare, LayoutList, FlaskConical } from "lucide-react";
import {
  APPOINTMENT_STATUS_LABELS, CONTACT_OUTCOME_LABELS, GENDER_LABELS, GENDERS, NATIONAL_ID_LABELS,
  type AppointmentStatus,
} from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { formatPhone } from "@viadent/contracts";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime, initials } from "@/lib/format";
import { Alert, Drawer, EmptyState, ErrorState, Loading, SelectField, StatusBadge, TextAreaField, TextField, useToast } from "@/components/ui";
import type { Appt, Task } from "@/lib/types";
import { RelationsCard } from "@/components/patient/relations";
import { AnamnesisPanel } from "@/components/patient/anamnesis";
import { TreatmentTab } from "@/components/treatment/treatment-tab";
import { AccountTab } from "@/components/finance/account-tab";
import { DocumentsTab } from "@/components/documents/documents-tab";
import { CommunicationTab } from "@/components/communication/communication-tab";
import { FollowUpsCard } from "@/components/care/follow-ups";
import { PatientLabTab } from "@/components/operations/lab";
import { PatientMaterials } from "@/components/operations/stock";
import { questionLabel } from "@viadent/contracts";
import { AlertTriangle } from "lucide-react";

interface Patient {
  id: string; fileNo: number; firstName: string; lastName: string; fullName: string; birthDate: string | null; age: number | null;
  gender: keyof typeof GENDER_LABELS | null; nationalIdType: keyof typeof NATIONAL_ID_LABELS | null; nationalId: string | null; phone: string | null; phoneMasked: boolean;
  email: string | null; city: string | null; primaryPractitionerId: string | null; primaryPractitionerName: string | null; referralSource: string | null;
  createdAt: string; updatedAt: string; version: number; nextAppointmentAt: string | null; lastVisitAt: string | null; openTaskCount: number;
  isMinor: boolean; legalRepresentativeCount: number; relationCount: number;
  clinical: { criticalFlags: string[]; anamnesisVersion: number | null; anamnesisReviewed: boolean } | null;
}
interface HistoryItem { id: string; action: string; entityType: string; actorName: string; at: string; changes: Record<string, { from: unknown; to: unknown }> }

const TABS = [
  { id: "ozet", label: "Özet", icon: LayoutList },
  { id: "tedavi", label: "Tedavi", icon: Stethoscope },
  { id: "finans", label: "Finans", icon: Wallet },
  { id: "saglik", label: "Sağlık", icon: NotebookPen },
  { id: "belgeler", label: "Belgeler", icon: FileText },
  { id: "iletisim", label: "İletişim", icon: MessageSquare },
  { id: "lab", label: "Laboratuvar", icon: FlaskConical },
  { id: "gecmis", label: "Geçmiş", icon: History },
] as const;
type TabId = (typeof TABS)[number]["id"];

const ACTION_LABELS: Record<string, string> = {
  "patient.create": "Hasta kaydı oluşturuldu", "patient.update": "Hasta bilgileri güncellendi",
  "appointment.create": "Randevu oluşturuldu", "appointment.status": "Randevu durumu değişti", "appointment.contact": "İletişim sonucu kaydedildi",
  "clinical_note.create": "Klinik not eklendi", "clinical_note.correct": "Klinik not düzeltmesi eklendi", "task.status": "Takip görevi güncellendi",
};
const FIELD_LABELS: Record<string, string> = {
  first_name: "Ad", last_name: "Soyad", birth_date: "Doğum tarihi", gender: "Cinsiyet", national_id: "Kimlik no", phone_e164: "Telefon",
  email: "E-posta", city: "Şehir", primary_practitioner_id: "Sorumlu hekim", referral_source: "Nereden duydu", starts_at: "Randevu zamanı",
  practitioner_id: "Hekim", chair_id: "Koltuk", status: "Durum", contact_outcome: "İletişim sonucu", cancel_reason: "İptal nedeni", corrects_note_id: "Düzeltilen not",
};

function PatientInner() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { can, tz } = useSession();
  const [tab, setTab] = useState<TabId>(() => (TABS.some((t) => t.id === params.get("sekme")) ? (params.get("sekme") as TabId) : "ozet"));
  const [editing, setEditing] = useState(params.get("duzenle") === "1");
  const toast = useToast();
  const patient = useData<Patient>(`/patients/${id}`);
  const appts = useData<{ items: Appt[] }>(`/patients/${id}/appointments`);
  const tasks = useData<{ items: Task[] }>(`/tasks?patientId=${id}`);
  const res = useData<{ practitioners: { id: string; name: string }[]; chairs: { id: string; name: string }[] }>("/resources");
  useEffect(() => { if (params.get("yeni") === "1") toast.show("success", "Hasta kaydedildi. Şimdi randevu verebilirsiniz."); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (patient.loading && !patient.data) return <div className="card"><Loading rows={5} /></div>;
  if (patient.error) {
    return (
      <div className="card">
        {patient.error.status === 404
          ? <EmptyState title="Hasta bulunamadı">Kayıt bu klinikte yok veya erişiminiz bulunmuyor. <Link href="/hastalar">Hasta listesine dön</Link></EmptyState>
          : <ErrorState error={patient.error} onRetry={patient.reload} />}
      </div>
    );
  }
  const p = patient.data!;
  const upcoming = (appts.data?.items ?? []).filter((a) => new Date(a.startsAt) >= new Date() && !["cancelled", "no_show"].includes(a.status)).reverse();
  const past = (appts.data?.items ?? []).filter((a) => !upcoming.includes(a));

  return (
    <>
      <section className="card" aria-label="Hasta özeti">
        <div className="patient-head">
          <div className="avatar" aria-hidden>{initials(p.fullName)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="row"><h1>{p.fullName}</h1><span className="badge badge-neutral">Dosya #{p.fileNo}</span></div>
            <div className="facts">
              <span>Yaş: <b>{p.age ?? "Belirtilmedi"}</b></span>
              <span>Telefon: <b>{formatPhone(p.phone) ?? "Belirtilmedi"}</b>{p.phoneMasked && <span className="sr-only"> (maskelendi)</span>}</span>
              <span>Hekim: <b>{p.primaryPractitionerName ?? "Belirtilmedi"}</b></span>
              <span>Sıradaki randevu: <b>{p.nextAppointmentAt ? fmtDateTime(p.nextAppointmentAt, tz) : "Yok"}</b></span>
              <span>Açık takip: <b>{p.openTaskCount}</b></span>
            </div>
            {(p.isMinor || (p.clinical && p.clinical.criticalFlags.length > 0) || (p.clinical && p.clinical.anamnesisVersion === null)) && (
              <div className="row" style={{ marginTop: 8, gap: 6 }} aria-label="Uyarılar">
                {p.clinical?.criticalFlags.map((f) => <span key={f} className="chip-alert"><AlertTriangle size={13} aria-hidden />{questionLabel(f)}</span>)}
                {p.clinical && p.clinical.anamnesisVersion !== null && !p.clinical.anamnesisReviewed && <span className="badge badge-warning">Anamnez onay bekliyor</span>}
                {p.clinical && p.clinical.anamnesisVersion === null && <span className="badge badge-neutral">Anamnez girilmemiş</span>}
                {p.isMinor && <span className="badge badge-info">18 yaş altı{p.legalRepresentativeCount === 0 ? " · yasal temsilci yok" : ""}</span>}
              </div>
            )}
          </div>
          <div className="row actions">
            {can("patient.write") && <button className="btn" onClick={() => setEditing(true)}><Pencil size={16} aria-hidden />Bilgileri düzenle</button>}
            {can("appointment.write") && <Link className="btn btn-primary" href={`/ajanda?yeni=1&hasta=${p.id}`}><CalendarPlus size={17} aria-hidden />Randevu ver</Link>}
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label="Hasta bölümleri">
          {TABS.map((t) => (
            <button key={t.id} role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
      </section>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} style={{ marginTop: 16 }}>
        {tab === "ozet" && (
          <div className="grid grid-2">
            <section className="card">
              <div className="card-head"><h2>Randevular</h2></div>
              {appts.loading && !appts.data ? <Loading /> : appts.error ? <ErrorState error={appts.error} /> : (appts.data?.items.length ?? 0) === 0 ? (
                <EmptyState title="Randevu yok" action={can("appointment.write") ? <Link className="btn btn-primary" href={`/ajanda?yeni=1&hasta=${p.id}`}>İlk randevuyu ver</Link> : undefined} />
              ) : (
                <ul className="list">
                  {[...upcoming, ...past].map((a) => (
                    <li key={a.id} style={{ padding: "12px 20px" }} className="row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong>{fmtDateTime(a.startsAt, tz)}</strong>
                        <div className="muted small">{a.practitionerName}{a.chairName ? ` · ${a.chairName}` : ""}{a.reason ? ` · ${a.reason}` : ""}</div>
                      </div>
                      <StatusBadge status={a.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div className="stack">
              <section className="card">
                <div className="card-head"><h2>Açık takipler</h2></div>
                {(tasks.data?.items.length ?? 0) === 0 ? <p className="card-pad muted">Bu hasta için açık takip yok.</p> : (
                  <ul className="list">{tasks.data!.items.map((t) => <li key={t.id} style={{ padding: "12px 20px" }}><strong>{t.title}</strong><p className="flow-why">{t.reason}</p></li>)}</ul>
                )}
              </section>
              <RelationsCard patientId={p.id} isMinor={p.isMinor} onChanged={() => void patient.reload()} />
              <section className="card card-pad">
                <h2 style={{ marginBottom: 12 }}>Kimlik ve iletişim</h2>
                <dl className="kv">
                  <dt>Doğum tarihi</dt><dd>{fmtDate(p.birthDate)}</dd>
                  <dt>Cinsiyet</dt><dd>{p.gender ? GENDER_LABELS[p.gender] : "Belirtilmedi"}</dd>
                  <dt>Kimlik belgesi</dt><dd>{p.nationalIdType ? `${NATIONAL_ID_LABELS[p.nationalIdType]}: ${p.nationalId}` : "Belirtilmedi"}</dd>
                  <dt>E-posta</dt><dd>{p.email ?? "Belirtilmedi"}</dd>
                  <dt>Şehir</dt><dd>{p.city ?? "Belirtilmedi"}</dd>
                  <dt>Nereden duydu</dt><dd>{p.referralSource ?? "Belirtilmedi"}</dd>
                  <dt>Kayıt</dt><dd>{fmtDateTime(p.createdAt, tz)}</dd>
                </dl>
              </section>
            </div>
          </div>
        )}
        {tab === "saglik" && (can("patient.health.read") ? (
          <div className="stack" style={{ gap: 16 }}>
            <AnamnesisPanel patientId={p.id} onSaved={() => { void patient.reload(); void tasks.reload(); }} />
            <ClinicalNotes patientId={p.id} canWrite={can("clinical_note.write")} />
          </div>
        ) : (
          <div className="card"><EmptyState icon={<Lock size={28} aria-hidden />} title="Sağlık bilgileri rolünüze kapalı">Anamnez ve klinik notlar yalnız yetkili klinik kullanıcılara görünür.</EmptyState></div>
        ))}
        {tab === "gecmis" && <Timeline patientId={p.id} resources={res.data} />}
        {tab === "tedavi" && <div className="stack" style={{ gap: 16 }}><TreatmentTab patientId={p.id} onChanged={() => { void tasks.reload(); }} /><FollowUpsCard patientId={p.id} /></div>}
        {tab === "belgeler" && <DocumentsTab patientId={p.id} patientName={p.fullName} />}
        {tab === "iletisim" && <CommunicationTab patientId={p.id} />}
        {tab === "lab" && (can("lab.read") || can("stock.read") ? (
          <div className="stack" style={{ gap: 16 }}>{can("lab.read") && <PatientLabTab patientId={p.id} />}{can("stock.read") && <PatientMaterials patientId={p.id} />}</div>
        ) : <div className="card"><EmptyState icon={<Lock size={28} />} title="Laboratuvar bilgisi rolünüze kapalı" /></div>)}
        {tab === "finans" && (can("account.read") ? <AccountTab patientId={p.id} patientName={p.fullName} /> : (
          <div className="card"><EmptyState icon={<Lock size={28} aria-hidden />} title="Hasta hesabı rolünüze kapalı">Borç, tahsilat ve iade bilgileri vezne ve finans yetkisi olan kullanıcılara görünür.</EmptyState></div>
        ))}
      </div>
      {editing && <EditPatient p={p} practitioners={res.data?.practitioners ?? []} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast.show("success", "Hasta bilgileri güncellendi."); void patient.reload(); void tasks.reload(); }} />}
      {toast.node}
    </>
  );
}


function ClinicalNotes({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const { tz } = useSession();
  const notes = useData<{ items: { id: string; body: string; createdAt: string; authorName: string; correctsNoteId: string | null; correctionReason: string | null }[] }>(`/patients/${patientId}/clinical-notes`);
  const [body, setBody] = useState("");
  const visits = useData<{ items: { id: string; startsAt: string; practitionerName: string }[] }>(canWrite ? `/patients/${patientId}/visits` : null);
  const [visit, setVisit] = useState("");
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      await api(`/patients/${patientId}/clinical-notes`, { body: { body, ...(visit && !correcting ? { appointmentId: visit } : {}), ...(correcting ? { correctsNoteId: correcting, correctionReason: reason } : {}) } });
      setBody(""); setReason(""); setCorrecting(null);
      await notes.reload();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <div className="grid grid-2">
      <section className="card">
        <div className="card-head"><h2>Klinik notlar</h2><span className="muted small">Notlar silinmez; düzeltme gerekçeyle eklenir.</span></div>
        {notes.loading && !notes.data ? <Loading /> : notes.error ? <ErrorState error={notes.error} /> : notes.data!.items.length === 0 ? <EmptyState title="Henüz klinik not yok" /> : (
          <ul className="list">
            {notes.data!.items.map((n) => (
              <li key={n.id} style={{ padding: "14px 20px" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong className="small">{n.authorName} · {fmtDateTime(n.createdAt, tz)}</strong>
                  {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => { setCorrecting(n.id); setBody(n.body); }}>Düzeltme ekle</button>}
                </div>
                {n.correctsNoteId && <p className="small" style={{ color: "var(--warning)" }}>Düzeltme · Gerekçe: {n.correctionReason}</p>}
                <p style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canWrite && (
        <section className="card card-pad stack">
          <h2>{correcting ? "Düzeltme notu" : "Yeni not"}</h2>
          <Alert kind="info">Demo ortamı: yalnız sentetik içerik girin.</Alert>
          {err && <Alert kind="error">{err.message}</Alert>}
          {!correcting && visits.data && visits.data.items.length > 0 && (
            <SelectField label="Ziyaret (isteğe bağlı)" value={visit} onChange={(e) => setVisit(e.target.value)}>
              <option value="">Ziyarete bağlama</option>
              {visits.data.items.map((v) => <option key={v.id} value={v.id}>{fmtDateTime(v.startsAt, tz)} · {v.practitionerName}</option>)}
            </SelectField>
          )}
          <TextAreaField label="Not" required value={body} onChange={(e) => setBody(e.target.value)} error={err?.fieldErrors.body} rows={6} />
          {correcting && <TextField label="Düzeltme gerekçesi" required value={reason} onChange={(e) => setReason(e.target.value)} error={err?.fieldErrors.correctionReason} />}
          <div className="row">
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !body.trim()}>{busy ? "Kaydediliyor…" : "Notu kaydet"}</button>
            {correcting && <button className="btn" onClick={() => { setCorrecting(null); setBody(""); }}>Vazgeç</button>}
          </div>
        </section>
      )}
    </div>
  );
}

function Timeline({ patientId, resources }: { patientId: string; resources: { practitioners: { id: string; name: string }[]; chairs: { id: string; name: string }[] } | null }) {
  const { tz } = useSession();
  const h = useData<{ items: HistoryItem[] }>(`/patients/${patientId}/history`);
  const names = new Map<string, string>([...(resources?.practitioners ?? []), ...(resources?.chairs ?? [])].map((r) => [r.id, r.name]));
  const show = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "Belirtilmedi";
    if (field === "status") return APPOINTMENT_STATUS_LABELS[v as AppointmentStatus] ?? String(v);
    if (field === "contact_outcome") return CONTACT_OUTCOME_LABELS[v as keyof typeof CONTACT_OUTCOME_LABELS] ?? String(v);
    if (field === "gender") return GENDER_LABELS[v as (typeof GENDERS)[number]] ?? String(v);
    if (field === "starts_at") return fmtDateTime(String(v), tz);
    if (field === "birth_date") return fmtDate(String(v));
    if (field.endsWith("_id")) return names.get(String(v)) ?? "Kayıt";
    return String(v);
  };
  return (
    <section className="card">
      <div className="card-head"><div><h2>VİA İz — hasta geçmişi</h2><p className="muted small">Kim, ne zaman, neyi değiştirdi. Yalnız değişen alanlar gösterilir.</p></div></div>
      {h.loading && !h.data ? <Loading /> : h.error ? <ErrorState error={h.error} /> : h.data!.items.length === 0 ? <EmptyState title="Kayıtlı olay yok" /> : (
        <ol className="timeline card-pad">
          {h.data!.items.map((e) => (
            <li key={e.id}>
              <span className="tl-dot" aria-hidden />
              <div>
                <strong>{ACTION_LABELS[e.action] ?? e.action}</strong>
                <div className="muted small">{e.actorName} · {fmtDateTime(e.at, tz)}</div>
                {Object.entries(e.changes ?? {}).length > 0 && (
                  <ul className="change" style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                    {Object.entries(e.changes).map(([k, v]) => (
                      <li key={k}>{FIELD_LABELS[k] ?? k}: {e.action.endsWith(".create") ? <ins>{show(k, v.to)}</ins> : <><del>{show(k, v.from)}</del> → <ins>{show(k, v.to)}</ins></>}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function EditPatient({ p, practitioners, onClose, onSaved }: { p: Patient; practitioners: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const init = { firstName: p.firstName, lastName: p.lastName, birthDate: p.birthDate ?? "", gender: p.gender ?? "", phone: p.phoneMasked ? "" : p.phone ?? "", email: p.email ?? "", city: p.city ?? "", primaryPractitionerId: p.primaryPractitionerId ?? "", referralSource: p.referralSource ?? "" };
  const [f, setF] = useState(init);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const set = (k: keyof typeof init) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (busy) return;
    setBusy(true); setErr(null);
    const body: Record<string, unknown> = { version: p.version };
    for (const k of Object.keys(init) as (keyof typeof init)[]) {
      if (f[k] === init[k]) continue;
      if (k === "phone" && p.phoneMasked && !f.phone) continue;
      body[k] = f[k] === "" ? (k === "firstName" || k === "lastName" ? f[k] : null) : f[k];
    }
    try { await api(`/patients/${p.id}`, { method: "PATCH", body }); onSaved(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Hasta bilgilerini düzenle" subtitle={`${p.fullName} · Dosya #${p.fileNo}`} onClose={onClose} dirty={dirty}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Kaydediliyor…" : "Değişiklikleri kaydet"}</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}{err.code === "VERSION_CONFLICT" && <div><button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => window.location.reload()}>Güncel hâlini yükle</button></div>}</Alert>}
        {p.phoneMasked && <Alert kind="info">Telefon rolünüz gereği maskeli. Yeni numara girerseniz mevcut numaranın yerine geçer.</Alert>}
        <div className="form-grid">
          <TextField label="Ad" required value={f.firstName} onChange={set("firstName")} error={err?.fieldErrors.firstName} />
          <TextField label="Soyad" required value={f.lastName} onChange={set("lastName")} error={err?.fieldErrors.lastName} />
          <TextField label="Doğum tarihi" type="date" value={f.birthDate} onChange={set("birthDate")} error={err?.fieldErrors.birthDate} />
          <SelectField label="Cinsiyet" value={f.gender} onChange={set("gender")}>
            <option value="">Seçilmedi</option>{GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}
          </SelectField>
          <TextField label="Telefon" type="tel" value={f.phone} onChange={set("phone")} error={err?.fieldErrors.phone} placeholder={p.phoneMasked ? p.phone ?? "" : ""} />
          <TextField label="E-posta" type="email" value={f.email} onChange={set("email")} error={err?.fieldErrors.email} />
          <SelectField label="Sorumlu hekim" value={f.primaryPractitionerId} onChange={set("primaryPractitionerId")}>
            <option value="">Seçilmedi</option>{practitioners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </SelectField>
          <TextField label="Şehir" value={f.city} onChange={set("city")} />
          <TextField label="Nereden duydu" className="full" value={f.referralSource} onChange={set("referralSource")} />
        </div>
      </div>
    </Drawer>
  );
}

export default function PatientPage() {
  return <Suspense fallback={<Loading />}><PatientInner /></Suspense>;
}
