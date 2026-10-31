"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, UserPlus } from "lucide-react";
import { addDays, APPOINTMENT_STATUS_LABELS, APPOINTMENT_TRANSITIONS, CONTACT_OUTCOME_LABELS, type AppointmentStatus } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { formatPhone } from "@viadent/contracts";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtLongDay, fmtTime, minutesOfDay, todayIn } from "@/lib/format";
import type { Appt, Resources } from "@/lib/types";
import { Alert, ContactBadge, Drawer, EmptyState, ErrorState, Loading, SelectField, StatusBadge, TextAreaField, TextField, useToast } from "@/components/ui";
import { NewPatientDrawer } from "@/components/patient-form";

const DAY_START = 8 * 60;
const DAY_END = 20 * 60;
const SLOT = 30;
const PX_PER_MIN = 48 / SLOT;

interface Prefill { date: string; time?: string; practitionerId?: string; chairId?: string; patientId?: string }

function AgendaInner() {
  const { tz, can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const [date, setDate] = useState(params.get("tarih") ?? todayIn(tz));
  const [mode, setMode] = useState<"practitioner" | "chair">("practitioner");
  const [creating, setCreating] = useState<Prefill | null>(params.get("yeni") === "1" ? { date: params.get("tarih") ?? todayIn(tz), patientId: params.get("hasta") ?? undefined } : null);
  const [selected, setSelected] = useState<Appt | null>(null);
  const toast = useToast();
  const res = useData<Resources>("/resources");
  const day = useData<{ items: Appt[] }>(`/appointments?date=${date}`);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => { router.replace(`/ajanda?tarih=${date}`, { scroll: false }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [date]);

  const cols = useMemo(() => (mode === "practitioner" ? res.data?.practitioners : res.data?.chairs) ?? [], [mode, res.data]);
  const items = day.data?.items ?? [];
  const isToday = date === todayIn(tz);
  const nowMin = minutesOfDay(new Date(now).toISOString(), tz);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ajanda</h1>
          <p>{fmtLongDay(date)}</p>
        </div>
        {can("appointment.write") && <button className="btn btn-primary" onClick={() => setCreating({ date })}><Plus size={18} aria-hidden />Randevu ver</button>}
      </div>
      <div className="agenda-bar">
        <button className="btn icon-btn" aria-label="Önceki gün" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={18} /></button>
        <button className="btn" onClick={() => setDate(todayIn(tz))} aria-pressed={isToday}>Bugün</button>
        <button className="btn icon-btn" aria-label="Sonraki gün" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={18} /></button>
        <label className="sr-only" htmlFor="ag-date">Tarih seç</label>
        <input id="ag-date" type="date" className="input" style={{ width: 170, minHeight: 40 }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <div className="grow" style={{ flex: 1 }} />
        <div className="row desktop-only" role="group" aria-label="Görünüm">
          <button className={`btn btn-sm ${mode === "practitioner" ? "btn-primary" : ""}`} aria-pressed={mode === "practitioner"} onClick={() => setMode("practitioner")}>Hekime göre</button>
          <button className={`btn btn-sm ${mode === "chair" ? "btn-primary" : ""}`} aria-pressed={mode === "chair"} onClick={() => setMode("chair")}>Koltuğa göre</button>
        </div>
      </div>

      <section className="card" aria-label="Günün randevuları">
        {(day.loading && !day.data) || (res.loading && !res.data) ? <Loading rows={6} /> : day.error ? <ErrorState error={day.error} onRetry={day.reload} /> : (
          <>
            {/* Masaüstü / tablet: kaynak sütunlu zaman çizelgesi */}
            <div className="agenda-grid desktop-only" style={{ gridTemplateColumns: `64px repeat(${Math.max(cols.length, 1)}, minmax(200px, 1fr))` }}>
              <div className="agenda-times">
                <div className="agenda-col-head" aria-hidden>&nbsp;</div>
                {Array.from({ length: (DAY_END - DAY_START) / SLOT }, (_, i) => {
                  const m = DAY_START + i * SLOT;
                  return <div key={m} className="agenda-time">{m % 60 === 0 ? `${String(m / 60).padStart(2, "0")}:00` : ""}</div>;
                })}
              </div>
              {cols.map((c) => {
                const colItems = items.filter((a) => (mode === "practitioner" ? a.practitionerId : a.chairId) === c.id);
                return (
                  <div key={c.id} className="agenda-col">
                    <div className="agenda-col-head">{c.name}</div>
                    <div style={{ position: "relative" }}>
                      {Array.from({ length: (DAY_END - DAY_START) / SLOT }, (_, i) => {
                        const m = DAY_START + i * SLOT;
                        const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
                        return can("appointment.write") ? (
                          <button key={m} className="agenda-slot" style={{ display: "block", width: "100%", border: 0, background: "transparent" }}
                            aria-label={`${c.name}, ${time} için randevu ver`}
                            onClick={() => setCreating({ date, time, ...(mode === "practitioner" ? { practitionerId: c.id } : { chairId: c.id }) })} />
                        ) : <div key={m} className="agenda-slot" />;
                      })}
                      {colItems.map((a) => {
                        const s = Math.max(minutesOfDay(a.startsAt, tz), DAY_START);
                        const e = Math.min(minutesOfDay(a.endsAt, tz) || DAY_END, DAY_END);
                        return (
                          <button key={a.id} className={`appt s-${a.status}`} style={{ top: (s - DAY_START) * PX_PER_MIN + 1, height: Math.max((e - s) * PX_PER_MIN - 2, 22) }}
                            onClick={() => setSelected(a)} aria-label={`${fmtTime(a.startsAt, tz)} ${a.patientName}, ${APPOINTMENT_STATUS_LABELS[a.status]}`}>
                            <div className="t">{fmtTime(a.startsAt, tz)} · {a.patientName}</div>
                            <div className="small muted">{APPOINTMENT_STATUS_LABELS[a.status]}{a.reason ? ` · ${a.reason}` : ""}</div>
                          </button>
                        );
                      })}
                      {isToday && nowMin >= DAY_START && nowMin <= DAY_END && <div className="now-line" style={{ top: (nowMin - DAY_START) * PX_PER_MIN }} aria-hidden />}
                    </div>
                  </div>
                );
              })}
              {cols.length === 0 && <EmptyState title="Tanımlı kaynak yok">Yönetim bölümünden hekim ve koltuk tanımlanmalı.</EmptyState>}
            </div>
            {/* Telefon: masaüstü takvimini küçültmek yerine gün listesi (Plan §04) */}
            <div className="mobile-only day-list">
              {items.length === 0 ? (
                <EmptyState icon={<CalendarDays size={28} aria-hidden />} title="Bu gün randevu yok" />
              ) : (
                <ul className="list" style={{ width: "100%" }}>
                  {items.map((a) => (
                    <li key={a.id}>
                      <button className="appt-row" onClick={() => setSelected(a)}>
                        <span className="time">{fmtTime(a.startsAt, tz)}</span>
                        <span style={{ minWidth: 0 }}>
                          <strong style={{ display: "block" }}>{a.patientName}</strong>
                          <span className="muted small" style={{ display: "block" }}>{a.practitionerName}{a.chairName ? ` · ${a.chairName}` : ""}</span>
                          <span className="row" style={{ marginTop: 4 }}><StatusBadge status={a.status} /><ContactBadge outcome={a.contactOutcome} /></span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      {creating && res.data && (
        <NewAppointment prefill={creating} resources={res.data} onClose={() => setCreating(null)}
          onCreated={(a) => { setCreating(null); setDate(a.date); toast.show("success", "Randevu oluşturuldu."); void day.reload(); }} />
      )}
      {selected && (
        <AppointmentDetail appt={selected} onClose={() => setSelected(null)}
          onChanged={(msg) => { setSelected(null); toast.show("success", msg); void day.reload(); }}
          onConflict={(msg) => { setSelected(null); toast.show("error", msg); void day.reload(); }} />
      )}
      {toast.node}
    </>
  );
}

function NewAppointment({ prefill, resources, onClose, onCreated }: { prefill: Prefill; resources: Resources; onClose: () => void; onCreated: (a: { date: string }) => void }) {
  const [patient, setPatient] = useState<{ id: string; fullName: string; fileNo?: number } | null>(null);
  const [q, setQ] = useState("");
  const [newPatient, setNewPatient] = useState(false);
  const [f, setF] = useState({
    date: prefill.date, startTime: prefill.time ?? "09:00", durationMinutes: "30",
    practitionerId: prefill.practitionerId ?? resources.practitioners[0]?.id ?? "", chairId: prefill.chairId ?? "", reason: "", note: "",
  });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useData<{ items: { id: string; fullName: string; fileNo: number; phone: string | null; birthDate: string | null }[] }>(q.trim().length >= 2 ? `/patients?limit=8&q=${encodeURIComponent(q)}` : null);
  const pre = useData<{ id: string; fullName: string; fileNo: number }>(prefill.patientId ? `/patients/${prefill.patientId}` : null);
  useEffect(() => { if (pre.data && !patient) setPatient(pre.data); }, [pre.data, patient]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (busy) return;
    if (!patient) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Önce hasta seçin.", field_errors: { patientId: "Hasta seçin" } })); return; }
    setBusy(true); setErr(null);
    try {
      await api("/appointments", { body: {
        patientId: patient.id, practitionerId: f.practitionerId, chairId: f.chairId || undefined, date: f.date, startTime: f.startTime,
        durationMinutes: Number(f.durationMinutes), reason: f.reason || undefined, note: f.note || undefined,
      } });
      onCreated({ date: f.date });
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }

  if (newPatient) return <NewPatientDrawer initialName={q} onClose={() => setNewPatient(false)} onCreated={(p) => { setPatient(p); setNewPatient(false); }} />;

  return (
    <Drawer title="Randevu ver" subtitle="Hekim ve koltuk müsaitliği kayıt anında sunucuda yeniden kontrol edilir." onClose={onClose} dirty={!!patient || !!f.reason}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Kaydediliyor…" : "Randevuyu kaydet"}</button></>}>
      <div className="stack">
        {err && <Alert kind={err.code === "APPOINTMENT_CONFLICT" ? "warning" : "error"} title={err.code === "APPOINTMENT_CONFLICT" ? "Çakışma" : undefined}>{err.message}</Alert>}
        {patient ? (
          <div className="alert alert-success" role="status">
            <div style={{ flex: 1 }}><strong>{patient.fullName}</strong>{patient.fileNo ? <span className="small"> · Dosya #{patient.fileNo}</span> : null}</div>
            <button className="btn btn-sm" onClick={() => setPatient(null)}>Değiştir</button>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="ap-q">Hasta<span className="req" aria-hidden>*</span></label>
            <input id="ap-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, telefon veya dosya no" aria-invalid={!!err?.fieldErrors.patientId} autoComplete="off" />
            {err?.fieldErrors.patientId && <span className="err">{err.fieldErrors.patientId}</span>}
            {q.trim().length >= 2 && (
              <div className="picker-results" role="listbox" aria-label="Hasta sonuçları">
                {search.loading && <div className="card-pad muted small">Aranıyor…</div>}
                {search.data?.items.map((p) => (
                  <button key={p.id} role="option" aria-selected={false} onClick={() => setPatient(p)}>
                    <strong>{p.fullName}</strong> <span className="muted small">· #{p.fileNo}{p.phone ? ` · ${formatPhone(p.phone)}` : ""}</span>
                  </button>
                ))}
                {search.data && search.data.items.length === 0 && <div className="card-pad muted small">Eşleşen hasta yok.</div>}
                <button onClick={() => setNewPatient(true)}><UserPlus size={15} aria-hidden style={{ verticalAlign: "-2px" }} /> Yeni hasta oluştur{q ? `: “${q}”` : ""}</button>
              </div>
            )}
          </div>
        )}
        <div className="form-grid">
          <SelectField label="Hekim" required value={f.practitionerId} onChange={set("practitionerId")} error={err?.fieldErrors.practitionerId}>
            {resources.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
          <SelectField label="Koltuk" value={f.chairId} onChange={set("chairId")} error={err?.fieldErrors.chairId}>
            <option value="">Seçilmedi</option>
            {resources.chairs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
          <TextField label="Tarih" type="date" required value={f.date} onChange={set("date")} error={err?.fieldErrors.date} />
          <TextField label="Saat" type="time" required step={300} value={f.startTime} onChange={set("startTime")} error={err?.fieldErrors.startTime} />
          <SelectField label="Süre" value={f.durationMinutes} onChange={set("durationMinutes")} error={err?.fieldErrors.durationMinutes}>
            {[15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} dakika</option>)}
          </SelectField>
          <TextField label="İşlem / neden" value={f.reason} onChange={set("reason")} placeholder="Örn. Kontrol, dolgu" />
          <TextAreaField label="Not" className="full" value={f.note} onChange={set("note")} rows={3} hint="Klinik bilgi yazmayın; idari not içindir." />
        </div>
      </div>
    </Drawer>
  );
}

function AppointmentDetail({ appt, onClose, onChanged, onConflict }: { appt: Appt; onClose: () => void; onChanged: (m: string) => void; onConflict: (m: string) => void }) {
  const { tz, can } = useSession();
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = APPOINTMENT_TRANSITIONS[appt.status].filter((s) => s !== "cancelled" && !(s === "no_show" && new Date(appt.startsAt) > new Date()));

  async function run(path: string, body: Record<string, unknown>, msg: string) {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await api(`/appointments/${appt.id}/${path}`, { body: { version: appt.version, ...body } }); onChanged(msg); }
    catch (e) {
      const f = e as ApiFailure;
      if (f.code === "VERSION_CONFLICT") onConflict("Randevu başka bir kullanıcı tarafından değiştirildi; liste yenilendi.");
      else setErr(f);
    } finally { setBusy(false); }
  }

  return (
    <Drawer title={appt.patientName ?? "Randevu"} subtitle={`${fmtLongDay(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(appt.startsAt)))} · ${fmtTime(appt.startsAt, tz)}–${fmtTime(appt.endsAt, tz)}`} onClose={onClose}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <dl className="kv">
          <dt>Durum</dt><dd><StatusBadge status={appt.status} /></dd>
          <dt>İletişim sonucu</dt><dd><ContactBadge outcome={appt.contactOutcome} /></dd>
          <dt>Hekim</dt><dd>{appt.practitionerName}</dd>
          <dt>Koltuk</dt><dd>{appt.chairName ?? "Belirtilmedi"}</dd>
          <dt>İşlem / neden</dt><dd>{appt.reason ?? "Belirtilmedi"}</dd>
          <dt>Not</dt><dd>{appt.note ?? "Belirtilmedi"}</dd>
          {appt.cancelReason && <><dt>İptal nedeni</dt><dd>{appt.cancelReason}</dd></>}
        </dl>
        <Link href={`/hastalar/${appt.patientId}`} className="btn btn-sm" style={{ alignSelf: "flex-start" }}>Hasta kartını aç</Link>
        {can("appointment.write") && (
          <>
            <hr className="divider" />
            {allowed.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <h3>Durumu güncelle</h3>
                <div className="row">
                  {allowed.map((s: AppointmentStatus) => (
                    <button key={s} className={`btn btn-sm ${s === "checked_in" || s === "completed" ? "btn-primary" : ""}`} disabled={busy}
                      onClick={() => void run("status", { status: s }, `Durum: ${APPOINTMENT_STATUS_LABELS[s]}`)}>{APPOINTMENT_STATUS_LABELS[s]}</button>
                  ))}
                </div>
              </div>
            )}
            {!["completed", "cancelled", "no_show"].includes(appt.status) && (
              <div className="stack" style={{ gap: 8 }}>
                <h3>İletişim sonucu</h3>
                <p className="small muted">“Bilgi verildi” hastanın geldiği anlamına gelmez; durumdan ayrı kaydedilir.</p>
                <div className="row">
                  {(["informed", "unreachable", "not_contacted"] as const).filter((o) => o !== appt.contactOutcome).map((o) => (
                    <button key={o} className="btn btn-sm" disabled={busy} onClick={() => void run("contact", { contactOutcome: o }, `İletişim: ${CONTACT_OUTCOME_LABELS[o]}`)}>{CONTACT_OUTCOME_LABELS[o]}</button>
                  ))}
                </div>
              </div>
            )}
            {APPOINTMENT_TRANSITIONS[appt.status].includes("cancelled") && (
              cancelling ? (
                <div className="stack" style={{ gap: 8 }}>
                  <TextField label="İptal nedeni" required value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} error={err?.fieldErrors.cancelReason} />
                  <div className="row">
                    <button className="btn btn-danger btn-sm" disabled={busy || !cancelReason.trim()} onClick={() => void run("status", { status: "cancelled", cancelReason }, "Randevu iptal edildi")}>İptali onayla</button>
                    <button className="btn btn-sm" onClick={() => setCancelling(false)}>Vazgeç</button>
                  </div>
                </div>
              ) : <button className="btn btn-danger btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setCancelling(true)}>Randevuyu iptal et</button>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

export default function AgendaPage() {
  return <Suspense fallback={<Loading />}><AgendaInner /></Suspense>;
}
