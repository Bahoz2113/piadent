"use client";
import Link from "next/link";
import { ReadinessPanel } from "@/components/care/readiness-panel";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, UserPlus, Ban } from "lucide-react";
import { addDays, addMoney, APPOINTMENT_PAST_GRACE_MINUTES, APPOINTMENT_STATUS_LABELS, APPOINTMENT_TRANSITIONS, CONTACT_OUTCOME_LABELS, formatPhone, formatTRY, zonedToUtc, type AppointmentStatus } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime, fmtLongDay, fmtTime, minutesOfDay, todayIn } from "@/lib/format";
import type { AgendaContext, Appt, Resources } from "@/lib/types";
import { Alert, ContactBadge, Drawer, EmptyState, ErrorState, Loading, SelectField, StatusBadge, TextAreaField, TextField, useToast, DateField } from "@/components/ui";
import { NewPatientDrawer } from "@/components/patient-form";
import { isPastPending, PastPendingBadge } from "@/components/appointment-status";

const DAY_START = 8 * 60;
const DAY_END = 20 * 60;
const SLOT = 30;
const PX_PER_MIN = 48 / SLOT;
const SHORT_DAYS = ["", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

interface Prefill { date: string; time?: string; practitionerId?: string; chairId?: string; patientId?: string }
interface Column { key: string; label: string; sub?: string; date: string; practitionerId?: string; chairId?: string; match: (a: Appt) => boolean }

/** ISO haftagünü (1 = Pazartesi). */
function isoDow(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return ((new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7) + 1;
}
const mondayOf = (date: string) => addDays(date, 1 - isoDow(date));
const localDay = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function AgendaInner() {
  const { tz, can } = useSession();
  const params = useSearchParams() ?? new URLSearchParams();
  const [date, setDate] = useState(params.get("tarih") ?? todayIn(tz));
  const [view, setView] = useState<"day" | "week">(params.get("gorunum") === "hafta" ? "week" : "day");
  const [mode, setMode] = useState<"practitioner" | "chair">("practitioner");
  const [weekPrac, setWeekPrac] = useState<string>(params.get("hekim") ?? "");
  const [creating, setCreating] = useState<Prefill | null>(params.get("yeni") === "1" ? { date: params.get("tarih") ?? todayIn(tz), patientId: params.get("hasta") ?? undefined } : null);
  const [selected, setSelected] = useState<Appt | null>(null);
  const toast = useToast();
  const res = useData<Resources>("/resources");
  const start = view === "week" ? mondayOf(date) : date;
  const days = view === "week" ? 7 : 1;
  const range = useData<{ items: Appt[] }>(`/appointments?from=${start}&days=${days}`);
  const ctx = useData<AgendaContext>(`/agenda-context?from=${start}&days=${days}`);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  // URL eşitleme (QA-004): yalnız adres çubuğu/paylaşım için; sunucuya gitmez. `router.replace` her yüklenişte RSC
  // isteği + metadata (<title>) yeniden kurulumu yapıyordu; istek aksarsa tam sayfa yüklemeye düşüyor ve geçiş anında
  // belge başlıksız yakalanabiliyordu. Next.js `history.replaceState`'i router durumuyla (useSearchParams) eşler.
  useEffect(() => {
    const href = `/ajanda?tarih=${date}${view === "week" ? `&gorunum=hafta${weekPrac ? `&hekim=${weekPrac}` : ""}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(null, "", href);
  }, [date, view, weekPrac]);
  useEffect(() => { if (!weekPrac && res.data?.practitioners[0]) setWeekPrac(res.data.practitioners[0].id); }, [res.data, weekPrac]);

  const items = range.data?.items ?? [];
  const today = todayIn(tz);
  const nowMin = minutesOfDay(new Date(now).toISOString(), tz);
  const reload = () => { void range.reload(); void ctx.reload(); };

  const cols: Column[] = useMemo(() => {
    if (!res.data) return [];
    if (view === "week") {
      const p = res.data.practitioners.find((x) => x.id === weekPrac) ?? res.data.practitioners[0];
      if (!p) return [];
      return Array.from({ length: 7 }, (_, i) => {
        const d = addDays(start, i);
        return { key: d, label: `${SHORT_DAYS[isoDow(d)]} ${d.slice(8)}.${d.slice(5, 7)}`, date: d, practitionerId: p.id,
          match: (a: Appt) => a.practitionerId === p.id && localDay(a.startsAt, tz) === d };
      });
    }
    const list = mode === "practitioner" ? res.data.practitioners : res.data.chairs;
    return list.map((r) => ({
      key: r.id, label: r.name, date,
      ...(mode === "practitioner" ? { practitionerId: r.id } : { chairId: r.id }),
      match: (a: Appt) => (mode === "practitioner" ? a.practitionerId : a.chairId) === r.id,
    }));
  }, [res.data, view, weekPrac, start, date, mode, tz]);

  /** Sütunun o günkü çalışma blokları (hekim için; tanımsızsa null = kısıt yok). */
  function workBlocks(col: Column) {
    if (!col.practitionerId || !ctx.data) return null;
    const all = ctx.data.schedules.filter((s) => s.practitionerId === col.practitionerId);
    if (!all.length) return null;
    return all.filter((s) => s.weekday === isoDow(col.date));
  }
  function closuresFor(col: Column) {
    return (ctx.data?.closures ?? []).filter((c) =>
      (c.scope === "clinic" || (col.practitionerId && c.practitionerId === col.practitionerId) || (col.chairId && c.chairId === col.chairId)) &&
      localDay(c.startsAt, tz) <= col.date && localDay(new Date(new Date(c.endsAt).getTime() - 1).toISOString(), tz) >= col.date);
  }

  const title = view === "week"
    ? `${fmtLongDay(start)} – ${fmtLongDay(addDays(start, 6))}`
    : fmtLongDay(date);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Randevular</h1>
          <p>{title}</p>
        </div>
        {can("appointment.write") && <button className="btn btn-primary" onClick={() => setCreating({ date, practitionerId: view === "week" ? weekPrac : undefined })}><Plus size={18} aria-hidden />Randevu ver</button>}
      </div>
      <div className="agenda-bar">
        <button className="btn icon-btn" aria-label={view === "week" ? "Önceki hafta" : "Önceki gün"} onClick={() => setDate(addDays(date, view === "week" ? -7 : -1))}><ChevronLeft size={18} /></button>
        <button className="btn" onClick={() => setDate(today)}>Bugün</button>
        <button className="btn icon-btn" aria-label={view === "week" ? "Sonraki hafta" : "Sonraki gün"} onClick={() => setDate(addDays(date, view === "week" ? 7 : 1))}><ChevronRight size={18} /></button>
        <DateField id="ag-date" label="Tarih seç" hideLabel className="compact" style={{ width: 200 }} value={date} today={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <div style={{ flex: 1 }} />
        <div className="row" role="group" aria-label="Süre">
          <button className={`btn btn-sm ${view === "day" ? "btn-primary" : ""}`} aria-pressed={view === "day"} onClick={() => setView("day")}>Gün</button>
          <button className={`btn btn-sm ${view === "week" ? "btn-primary" : ""}`} aria-pressed={view === "week"} onClick={() => setView("week")}>Hafta</button>
        </div>
        {view === "day" ? (
          <div className="row desktop-only" role="group" aria-label="Sütunlar">
            <button className={`btn btn-sm ${mode === "practitioner" ? "btn-primary" : ""}`} aria-pressed={mode === "practitioner"} onClick={() => setMode("practitioner")}>Hekime göre</button>
            <button className={`btn btn-sm ${mode === "chair" ? "btn-primary" : ""}`} aria-pressed={mode === "chair"} onClick={() => setMode("chair")}>Koltuğa göre</button>
          </div>
        ) : (
          <label className="row small">
            <span className="sr-only">Hekim</span>
            <select className="select" style={{ minHeight: 38, width: 210 }} value={weekPrac} onChange={(e) => setWeekPrac(e.target.value)} aria-label="Haftalık görünüm hekimi">
              {res.data?.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <section className="card" aria-label="Randevular">
        {(range.loading && !range.data) || (res.loading && !res.data) ? <Loading rows={6} /> : range.error ? <ErrorState error={range.error} onRetry={reload} /> : (
          <>
            <div className={`agenda-grid desktop-only ${view === "week" ? "week" : ""}`} style={{ gridTemplateColumns: `64px repeat(${Math.max(cols.length, 1)}, minmax(${view === "week" ? 130 : 200}px, 1fr))` }}>
              <div className="agenda-times">
                <div className="agenda-col-head" aria-hidden>&nbsp;</div>
                {Array.from({ length: (DAY_END - DAY_START) / SLOT }, (_, i) => {
                  const m = DAY_START + i * SLOT;
                  return <div key={m} className="agenda-time">{m % 60 === 0 ? hhmm(m) : ""}</div>;
                })}
              </div>
              {cols.map((c) => {
                const blocks = workBlocks(c);
                const closed = closuresFor(c);
                return (
                  <div key={c.key} className="agenda-col">
                    <div className={`agenda-col-head ${c.date === today && view === "week" ? "is-today" : ""}`}>
                      {c.label}
                      {blocks && blocks.length === 0 && <span className="small muted" style={{ display: "block", fontWeight: 400 }}>Çalışma günü değil</span>}
                    </div>
                    <div style={{ position: "relative" }}>
                      {Array.from({ length: (DAY_END - DAY_START) / SLOT }, (_, i) => {
                        const m = DAY_START + i * SLOT;
                        const off = blocks ? !blocks.some((b) => b.start <= m && b.end >= m + SLOT) : false;
                        const label = `${c.label}, ${hhmm(m)}${off ? " (çalışma saati dışı)" : ""} için randevu ver`;
                        // Geçmiş saat dilimine randevu verilemez (madde 1): dilim tıklanamaz, gri görünür.
                        const slotPast = c.date < today || (c.date === today && m + SLOT <= nowMin - APPOINTMENT_PAST_GRACE_MINUTES);
                        return can("appointment.write") && !slotPast ? (
                          <button key={m} className={`agenda-slot ${off ? "is-off" : ""}`} style={{ display: "block", width: "100%", border: 0 }} aria-label={label}
                            onClick={() => setCreating({ date: c.date, time: hhmm(m), practitionerId: c.practitionerId, chairId: c.chairId })} />
                        ) : <div key={m} className={`agenda-slot ${off ? "is-off" : ""} ${slotPast ? "is-past" : ""}`} />;
                      })}
                      {closed.map((cl) => {
                        const s = localDay(cl.startsAt, tz) < c.date ? DAY_START : Math.max(minutesOfDay(cl.startsAt, tz), DAY_START);
                        const endDay = localDay(new Date(new Date(cl.endsAt).getTime() - 1).toISOString(), tz);
                        const e = endDay > c.date ? DAY_END : Math.min(minutesOfDay(cl.endsAt, tz) || DAY_END, DAY_END);
                        if (e <= s) return null;
                        return (
                          <div key={cl.id} className="closure-block" style={{ top: (s - DAY_START) * PX_PER_MIN, height: (e - s) * PX_PER_MIN }} title={cl.reason}>
                            <Ban size={13} aria-hidden /> <span>Kapalı · {cl.reason}</span>
                          </div>
                        );
                      })}
                      {items.filter(c.match).map((a) => {
                        const s = Math.max(minutesOfDay(a.startsAt, tz), DAY_START);
                        const e = Math.min(minutesOfDay(a.endsAt, tz) || DAY_END, DAY_END);
                        const pending = isPastPending(a, now);
                        return (
                          <button key={a.id} className={`appt s-${a.status} ${pending ? "is-past-pending" : ""}`} style={{ top: (s - DAY_START) * PX_PER_MIN + 1, height: Math.max((e - s) * PX_PER_MIN - 2, 22) }}
                            onClick={() => setSelected(a)} aria-label={`${fmtTime(a.startsAt, tz)} ${a.patientName}, ${APPOINTMENT_STATUS_LABELS[a.status]}`}>
                            <div className="t">{fmtTime(a.startsAt, tz)} · {a.patientName}</div>
                            <div className="small muted">{pending ? "Sonuç bekliyor" : APPOINTMENT_STATUS_LABELS[a.status]}{a.reason ? ` · ${a.reason}` : ""}</div>
                          </button>
                        );
                      })}
                      {c.date === today && nowMin >= DAY_START && nowMin <= DAY_END && <div className="now-line" style={{ top: (nowMin - DAY_START) * PX_PER_MIN }} aria-hidden />}
                    </div>
                  </div>
                );
              })}
              {cols.length === 0 && <EmptyState title="Tanımlı kaynak yok">Yönetim &gt; Hekim ve koltuklar bölümünden tanımlayın.</EmptyState>}
            </div>
            {/* Telefon: gün listesi (Plan §04) */}
            <div className="mobile-only day-list">
              {Array.from({ length: days }, (_, i) => addDays(start, i)).map((d) => {
                const dayItems = items.filter((a) => localDay(a.startsAt, tz) === d && (view === "day" || a.practitionerId === weekPrac));
                const dayClosures = (ctx.data?.closures ?? []).filter((cl) => localDay(cl.startsAt, tz) <= d && localDay(new Date(new Date(cl.endsAt).getTime() - 1).toISOString(), tz) >= d && cl.scope === "clinic");
                if (view === "week" && dayItems.length === 0 && dayClosures.length === 0) return null;
                return (
                  <div key={d}>
                    {view === "week" && <h3 className="small" style={{ padding: "12px 16px 4px" }}>{fmtLongDay(d)}</h3>}
                    {dayClosures.map((cl) => <div key={cl.id} style={{ padding: "0 16px 8px" }}><Alert kind="warning">Klinik kapalı: {cl.reason}</Alert></div>)}
                    {dayItems.length === 0 ? (view === "day" && <EmptyState icon={<CalendarDays size={28} aria-hidden />} title="Bu gün randevu yok" />) : (
                      <ul className="list" style={{ width: "100%" }}>
                        {dayItems.map((a) => (
                          <li key={a.id}>
                            <button className="appt-row" onClick={() => setSelected(a)}>
                              <span className="time">{fmtTime(a.startsAt, tz)}</span>
                              <span style={{ minWidth: 0 }}>
                                <strong style={{ display: "block" }}>{a.patientName}</strong>
                                <span className="muted small" style={{ display: "block" }}>{a.practitionerName}{a.chairName ? ` · ${a.chairName}` : ""}</span>
                                <span className="row" style={{ marginTop: 4 }}>{isPastPending(a, now) ? <PastPendingBadge /> : <StatusBadge status={a.status} />}<ContactBadge outcome={a.contactOutcome} /></span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {view === "week" && items.filter((a) => a.practitionerId === weekPrac).length === 0 && <EmptyState title="Bu hafta randevu yok" />}
            </div>
          </>
        )}
      </section>

      {creating && res.data && (
        <NewAppointment prefill={creating} resources={res.data} onClose={() => setCreating(null)}
          onCreated={(a) => { setCreating(null); setDate(a.date); toast.show("success", "Randevu oluşturuldu."); reload(); }} />
      )}
      {selected && (
        <AppointmentDetail appt={selected} onClose={() => setSelected(null)}
          onChanged={(msg) => { setSelected(null); toast.show("success", msg); reload(); }}
          onConflict={(msg) => { setSelected(null); toast.show("error", msg); reload(); }} />
      )}
      {toast.node}
    </>
  );
}

/** Bugün için ilk uygun başlangıç: şimdiden sonraki 15 dakikalık dilim. */
function nextQuarter(tz: string): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const m = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 15) * 15;
  return m >= 24 * 60 ? "23:45" : hhmm(m);
}

function NewAppointment({ prefill, resources, onClose, onCreated }: { prefill: Prefill; resources: Resources; onClose: () => void; onCreated: (a: { date: string }) => void }) {
  const { tz, can } = useSession();
  const today = todayIn(tz);
  const [patient, setPatient] = useState<{ id: string; fullName: string; fileNo?: number } | null>(null);
  const [q, setQ] = useState("");
  const [newPatient, setNewPatient] = useState(false);
  const [f, setF] = useState({
    date: prefill.date < today ? today : prefill.date,
    startTime: prefill.time ?? (prefill.date <= today ? nextQuarter(tz) : "09:00"), durationMinutes: "30", appointmentTypeId: "", procedureId: "",
    practitionerId: prefill.practitionerId ?? resources.practitioners[0]?.id ?? "", chairId: prefill.chairId ?? "", reason: "", note: "",
  });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useData<{ items: { id: string; fullName: string; fileNo: number; phone: string | null; birthDate: string | null }[] }>(q.trim().length >= 2 ? `/patients?limit=8&q=${encodeURIComponent(q)}` : null);
  const pre = useData<{ id: string; fullName: string; fileNo: number }>(prefill.patientId ? `/patients/${prefill.patientId}` : null);
  useEffect(() => { if (pre.data && !patient) setPatient(pre.data); }, [pre.data, patient]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setF({ ...f, [k]: e.target.value }); if (err?.code === "OUTSIDE_WORKING_HOURS") setErr(null); };
  const durations = Array.from(new Set([15, 20, 30, 45, 60, 90, 120, Number(f.durationMinutes)])).sort((a, b) => a - b);
  const procedures = resources.procedures ?? [];
  // Planlanan işlemin tarife fiyatı (bilgi amaçlı; borç yalnız işlem gerçekleşince oluşur) ve hastanın güncel bakiyesi.
  const price = useData<{ price: string | null }>(f.procedureId && f.practitionerId ? `/price?procedureId=${f.procedureId}&practitionerId=${f.practitionerId}&date=${f.date}` : null);
  const account = useData<{ totals: { openDebt: string; advance: string } }>(patient && can("account.read") ? `/patients/${patient.id}/account` : null);
  const startsAt = f.date && /^\d{2}:\d{2}$/.test(f.startTime) ? zonedToUtc(f.date, f.startTime, tz) : null;
  const inPast = !!startsAt && startsAt.getTime() < Date.now() - APPOINTMENT_PAST_GRACE_MINUTES * 60_000;

  function pickType(id: string) {
    const t = resources.appointmentTypes.find((x) => x.id === id);
    const proc = t?.procedureId ? procedures.find((p) => p.id === t.procedureId) : undefined;
    setF({ ...f, appointmentTypeId: id, durationMinutes: t ? String(t.defaultMinutes) : f.durationMinutes, procedureId: proc ? proc.id : f.procedureId });
  }
  function pickProcedure(id: string) {
    const p = procedures.find((x) => x.id === id);
    setF({ ...f, procedureId: id, durationMinutes: p?.defaultMinutes && !f.appointmentTypeId ? String(p.defaultMinutes) : f.durationMinutes });
  }

  async function save(allowOutsideHours = false) {
    if (busy) return;
    if (!patient) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Önce hasta seçin.", field_errors: { patientId: "Hasta seçin" } })); return; }
    if (inPast) { setErr(new ApiFailure(422, { code: "APPOINTMENT_IN_PAST", message: "Geçmiş bir tarih veya saate randevu oluşturulamaz. Lütfen ileri bir saat seçin.", field_errors: { startTime: "Geçmiş saat seçilemez" } })); return; }
    setBusy(true); setErr(null);
    try {
      await api("/appointments", { body: {
        patientId: patient.id, practitionerId: f.practitionerId, chairId: f.chairId || undefined, appointmentTypeId: f.appointmentTypeId || undefined, procedureId: f.procedureId || undefined,
        date: f.date, startTime: f.startTime, durationMinutes: Number(f.durationMinutes), reason: f.reason || undefined, note: f.note || undefined,
        allowOutsideHours: allowOutsideHours || undefined,
      } });
      onCreated({ date: f.date });
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }

  if (newPatient) return <NewPatientDrawer initialName={q} onClose={() => setNewPatient(false)} onCreated={(p) => { setPatient(p); setNewPatient(false); }} />;

  const outside = err?.code === "OUTSIDE_WORKING_HOURS";
  const blocks = (err?.body.details as { blocks?: { start: number; end: number }[] } | undefined)?.blocks ?? [];
  return (
    <Drawer title="Randevu ver" subtitle="Müsaitlik, çalışma saati ve kapatmalar kayıt anında sunucuda kontrol edilir." onClose={onClose} dirty={!!patient || !!f.reason}
      footer={<>
        <button className="btn" onClick={onClose}>Vazgeç</button>
        {outside
          ? <button className="btn btn-primary" disabled={busy} onClick={() => void save(true)}>Çalışma saati dışında yine de kaydet</button>
          : <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Kaydediliyor…" : "Randevuyu kaydet"}</button>}
      </>}>
      <div className="stack">
        {err && (outside ? (
          <Alert kind="warning" title="Çalışma saati dışı">
            {err.message} {blocks.length ? `O günkü çalışma saatleri: ${blocks.map((b) => `${hhmm(b.start)}–${hhmm(b.end)}`).join(", ")}.` : "Hekim o gün çalışmıyor."} Kayıt yine de yapılırsa geçmişe not düşülür.
          </Alert>
        ) : (
          <Alert kind={err.code === "APPOINTMENT_CONFLICT" || err.code === "RESOURCE_CLOSED" || err.code === "APPOINTMENT_IN_PAST" ? "warning" : "error"}
            title={err.code === "APPOINTMENT_CONFLICT" ? "Çakışma" : err.code === "RESOURCE_CLOSED" ? "Kapalı aralık" : err.code === "APPOINTMENT_IN_PAST" ? "Geçmiş saat" : undefined}>{err.message}</Alert>
        ))}
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
          <SelectField label="İşlem türü" value={f.appointmentTypeId} onChange={(e) => pickType(e.target.value)} hint="Seçilince süre varsayılana ayarlanır." error={err?.fieldErrors.appointmentTypeId}>
            <option value="">Seçilmedi</option>
            {resources.appointmentTypes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.defaultMinutes} dk)</option>)}
          </SelectField>
          <SelectField label="Hekim" required value={f.practitionerId} onChange={set("practitionerId")} error={err?.fieldErrors.practitionerId}>
            {resources.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
          <SelectField label="Planlanan işlem" value={f.procedureId} onChange={(e) => pickProcedure(e.target.value)} error={err?.fieldErrors.procedureId}
            hint={!f.procedureId ? "Fiyat ve hasta bakiyesi için işlem seçin." : price.loading ? "Fiyat okunuyor…" : price.data?.price ? `Tarife fiyatı: ${formatTRY(price.data.price)}` : "Bu işlem için yayında tarife fiyatı yok."}>
            <option value="">Seçilmedi</option>
            {[...new Set(procedures.map((p) => p.category ?? "Diğer"))].map((cat) => (
              <optgroup key={cat} label={cat}>
                {procedures.filter((p) => (p.category ?? "Diğer") === cat).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </optgroup>
            ))}
          </SelectField>
          <DateField label="Tarih" required min={today} value={f.date} onChange={set("date")} error={err?.fieldErrors.date} />
          <TextField label="Saat" type="time" required step={300} value={f.startTime} onChange={set("startTime")}
            error={err?.fieldErrors.startTime ?? (inPast ? "Geçmiş saat seçilemez" : undefined)} />
          <SelectField label="Süre" value={f.durationMinutes} onChange={set("durationMinutes")} error={err?.fieldErrors.durationMinutes}>
            {durations.map((m) => <option key={m} value={m}>{m} dakika</option>)}
          </SelectField>
          <SelectField label="Koltuk" value={f.chairId} onChange={set("chairId")} error={err?.fieldErrors.chairId}>
            <option value="">Seçilmedi</option>
            {resources.chairs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
          {patient && can("account.read") && (
            <div className="full money-strip" aria-live="polite">
              {account.loading && !account.data ? <span className="muted small">Hasta bakiyesi okunuyor…</span> : account.data && (
                <>
                  <span><span className="muted small">Açık borç</span><strong>{formatTRY(account.data.totals.openDebt)}</strong></span>
                  <span><span className="muted small">Avans</span><strong>{formatTRY(account.data.totals.advance)}</strong></span>
                  {price.data?.price && <span><span className="muted small">İşlem sonrası tahmini borç</span><strong>{formatTRY(addMoney(account.data.totals.openDebt, price.data.price))}</strong></span>}
                </>
              )}
            </div>
          )}
          <TextField label="Açıklama" className="full" value={f.reason} onChange={set("reason")} placeholder="Boşsa işlem türü / işlem adı kullanılır" />
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
          <dt>Durum</dt><dd>{isPastPending(appt) ? <><PastPendingBadge /> <span className="muted small">({APPOINTMENT_STATUS_LABELS[appt.status]})</span></> : <StatusBadge status={appt.status} />}</dd>
          <dt>İletişim sonucu</dt><dd><ContactBadge outcome={appt.contactOutcome} /></dd>
          <dt>Hekim</dt><dd>{appt.practitionerName}</dd>
          <dt>Koltuk</dt><dd>{appt.chairName ?? "Belirtilmedi"}</dd>
          <dt>İşlem / neden</dt><dd>{appt.reason ?? "Belirtilmedi"}</dd>
          <dt>Planlanan işlem</dt><dd>{appt.procedureLabel ?? "Seçilmedi"}{appt.plannedPrice ? <span className="muted"> · tarife {formatTRY(appt.plannedPrice)}</span> : appt.procedureLabel ? <span className="muted"> · tarifede fiyat yok</span> : null}</dd>
          <dt>Not</dt><dd>{appt.note ?? "Belirtilmedi"}</dd>
          {appt.cancelReason && <><dt>İptal nedeni</dt><dd>{appt.cancelReason}</dd></>}
        </dl>
        {can("account.read") && <PatientBalance patientId={appt.patientId} plannedPrice={appt.status === "completed" ? null : appt.plannedPrice ?? null} />}
        <Link href={`/hastalar/${appt.patientId}`} className="btn btn-sm" style={{ alignSelf: "flex-start" }}>Hasta kartını aç</Link>
        {["planned", "confirmed"].includes(appt.status) && <ReadinessPanel appointmentId={appt.id} />}
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

/** Randevu ayrıntısında hastanın güncel bakiyesi ve (tamamlanmamışsa) planlanan işlemle tahmini borç. */
function PatientBalance({ patientId, plannedPrice }: { patientId: string; plannedPrice: string | null }) {
  const account = useData<{ totals: { openDebt: string; advance: string } }>(`/patients/${patientId}/account`);
  if (account.loading && !account.data) return <div className="money-strip"><span className="muted small">Hasta bakiyesi okunuyor…</span></div>;
  if (!account.data) return null;
  const t = account.data.totals;
  return (
    <div className="money-strip" aria-label="Hasta bakiyesi">
      <span><span className="muted small">Açık borç</span><strong>{formatTRY(t.openDebt)}</strong></span>
      <span><span className="muted small">Avans</span><strong>{formatTRY(t.advance)}</strong></span>
      {plannedPrice && <span><span className="muted small">İşlem sonrası tahmini borç</span><strong>{formatTRY(addMoney(t.openDebt, plannedPrice))}</strong></span>}
    </div>
  );
}
