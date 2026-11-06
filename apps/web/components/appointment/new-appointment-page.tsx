"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clock, UserPlus } from "lucide-react";
import {
  PAYMENT_METHODS, PAYMENT_METHOD_LABELS, addMoney, formatPhone, formatTRY, fromMinor, isMoney, toMinor, type PaymentMethod,
} from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, todayIn } from "@/lib/format";
import type { Resources } from "@/lib/types";
import { Alert, DateField, SelectField, TextAreaField, TextField } from "@/components/ui";
import { confirmDialog } from "@/components/dialogs";
import { NewPatientDrawer } from "@/components/patient-form";
import { HealthAlert, useHealthNotes } from "@/components/patient/health-notes";
import { appointmentPastState, APPOINTMENT_IN_PAST_MESSAGE, PAST_DAY_ERROR, PAST_DAY_SLOTS_NOTE, PAST_TIME_ERROR } from "./past-guard";

export interface Prefill { date: string; time?: string; practitionerId?: string; chairId?: string; patientId?: string }
interface Proc { id: string; code: string; name: string; category: string | null; defaultMinutes: number | null; price: string | null }
interface Availability { slots: string[]; blocks: { start: number; end: number }[]; workingHoursDefined: boolean; closedAllDay: { reason: string; kind: string } | null }
type PayMode = "none" | "partial" | "full";
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Randevu ver — tam sayfa (07.11.2026 ürün sahibi geri bildirimi):
 * hasta → sağlık uyarısı → tek "işlem" seçimi (fiyatıyla; ayrı işlem türü yok) → hekim ve gün → uygun boş saatlerin tamamı → ödeme planı (en altta).
 * Ödeme: "Ödeme alınmadı" / "Kısmi ödeme" / "Tamamı". Kısmi ve tam ödeme GERÇEK tahsilattır (avans; randevuya bağlı) — borç yalnız işlem
 * gerçekleşince oluşur. Randevu ve ödeme ayrı kayıttır: ödeme başarısız olursa randevu kalır ve bu açıkça söylenir.
 */
export function NewAppointmentPage({ prefill, resources, onCancel, onCreated }: { prefill: Prefill; resources: Resources; onCancel: () => void; onCreated: (a: { date: string; message: string }) => void }) {
  const { tz, can } = useSession();
  const today = todayIn(tz);
  const [patient, setPatient] = useState<{ id: string; fullName: string; fileNo?: number } | null>(null);
  const [q, setQ] = useState("");
  const [newPatient, setNewPatient] = useState(false);
  const [initialF] = useState(() => ({
    date: prefill.date < today ? today : prefill.date, startTime: prefill.time ?? "", durationMinutes: "30", procedureId: "",
    practitionerId: prefill.practitionerId ?? resources.practitioners[0]?.id ?? "", chairId: prefill.chairId ?? "", reason: "", note: "",
  }));
  const [f, setF] = useState(initialF);
  // QA-301: elle yazılan geçmiş gün / bugünün geçmiş saati (DateField min yalnız takvimi sınırlar).
  const { pastDay, inPast } = appointmentPastState(f.date, f.startTime, today, tz);
  const [pay, setPay] = useState<{ mode: PayMode; amount: string; method: PaymentMethod; cashAccountId: string }>({ mode: "none", amount: "", method: "cash", cashAccountId: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; date: string } | null>(null);
  const payKey = useRef(newIdempotencyKey());
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const search = useData<{ items: { id: string; fullName: string; fileNo: number; phone: string | null }[] }>(q.trim().length >= 2 ? `/patients?limit=8&q=${encodeURIComponent(q)}` : null);
  const pre = useData<{ id: string; fullName: string; fileNo: number }>(prefill.patientId ? `/patients/${prefill.patientId}` : null);
  useEffect(() => { if (pre.data && !patient) setPatient(pre.data); }, [pre.data, patient]);
  const health = useHealthNotes(patient?.id ?? null);
  const procs = useData<{ items: Proc[] }>("/procedures");
  const procedures = procs.data?.items ?? [];
  const proc = procedures.find((p) => p.id === f.procedureId);
  const price = useData<{ price: string | null }>(f.procedureId && f.practitionerId ? `/price?procedureId=${f.procedureId}&practitionerId=${f.practitionerId}&date=${f.date}` : null);
  const account = useData<{ totals: { openDebt: string; advance: string } }>(patient && can("account.read") ? `/patients/${patient.id}/account` : null);
  const avail = useData<Availability>(f.practitionerId && f.date && !pastDay ? `/availability?practitionerId=${f.practitionerId}&date=${f.date}&minutes=${f.durationMinutes}${f.chairId ? `&chairId=${f.chairId}` : ""}` : null);
  const canPay = can("payment.write") && can("account.read");
  const cash = useData<{ items: { id: string; name: string; kind: string; active: boolean }[] }>(canPay ? "/cash-accounts" : null);
  useEffect(() => {
    const first = cash.data?.items.find((a) => a.active !== false && a.kind !== "provider");
    if (first && !pay.cashAccountId) setPay((p) => ({ ...p, cashAccountId: first.id }));
  }, [cash.data, pay.cashAccountId]);
  // Seçili saat artık boş değilse (hekim/gün/süre değişti) seçim kalkar; kullanıcı listeden yeniden seçer.
  const [manualTime, setManualTime] = useState(false);
  useEffect(() => { if (f.startTime && avail.data && !avail.data.slots.includes(f.startTime) && !manualTime) setF((x) => ({ ...x, startTime: "" })); }, [avail.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectivePrice = price.data?.price ?? proc?.price ?? null;
  const payAmount = pay.mode === "full" ? (effectivePrice ?? "") : pay.mode === "partial" ? pay.amount.replace(",", ".") : "";
  const durations = useMemo(() => Array.from(new Set([15, 20, 30, 45, 60, 90, 120, Number(f.durationMinutes)])).sort((a, b) => a - b), [f.durationMinutes]);
  const dirty = !created && ((patient?.id ?? null) !== (pre.data?.id ?? null) || q.trim() !== "" || pay.mode !== "none"
    || (Object.keys(initialF) as (keyof typeof initialF)[]).some((k) => f[k] !== initialF[k]));
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setF({ ...f, [k]: e.target.value }); setErr(null); };
  function pickProcedure(id: string) {
    const p = procedures.find((x) => x.id === id);
    setF({ ...f, procedureId: id, durationMinutes: p?.defaultMinutes ? String(p.defaultMinutes) : f.durationMinutes });
  }
  async function cancel() {
    if (dirty && !(await confirmDialog({ title: "Kaydedilmemiş değişiklikler", message: "Girdiğiniz randevu bilgileri kaybolacak. Sayfadan çıkılsın mı?", confirmLabel: "Çık", cancelLabel: "Forma dön", danger: true }))) return;
    onCancel();
  }

  function payError(): string | null {
    if (pay.mode === "none") return null;
    if (!pay.cashAccountId) return "Kasa / banka seçin.";
    if (!payAmount || !isMoney(payAmount) || toMinor(payAmount) <= 0n) return pay.mode === "full" ? "Tam ödeme için işlemin fiyatı tanımlı olmalı." : "Geçerli bir tutar girin (ör. 500,00).";
    if (pay.mode === "partial" && effectivePrice && toMinor(payAmount) >= toMinor(effectivePrice)) return "Kısmi ödeme işlem fiyatından az olmalı; tamamı için “Tamamı”nı seçin.";
    return null;
  }

  async function takePayment(appointmentId: string, patientId: string) {
    await api("/payments", { idempotencyKey: payKey.current, body: { patientId, amount: payAmount, method: pay.method, cashAccountId: pay.cashAccountId, appointmentId, allocations: [],
      note: `Randevu ödemesi${proc ? ` · ${proc.name}` : ""}${pay.mode === "partial" ? " (kısmi)" : ""}` } });
  }

  async function save(allowOutsideHours = false) {
    if (busy) return;
    if (!created && inPast) {
      setErr(new ApiFailure(422, { code: "APPOINTMENT_IN_PAST", message: APPOINTMENT_IN_PAST_MESSAGE, field_errors: pastDay ? { date: PAST_DAY_ERROR } : { startTime: PAST_TIME_ERROR } }));
      return;
    }
    if (!patient) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Önce hasta seçin.", field_errors: { patientId: "Hasta seçin" } })); return; }
    if (!f.procedureId) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "İşlem seçin.", field_errors: { procedureId: "İşlem seçin" } })); return; }
    if (!f.startTime) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Uygun saatlerden birini seçin.", field_errors: { startTime: "Saat seçin" } })); return; }
    const pe = payError();
    if (pe) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: pe, field_errors: { payment: pe } })); return; }
    setBusy(true); setErr(null);
    try {
      let a = created;
      if (!a) {
        const r = await api<{ id: string }>("/appointments", { body: {
          patientId: patient.id, practitionerId: f.practitionerId, chairId: f.chairId || undefined, procedureId: f.procedureId,
          date: f.date, startTime: f.startTime, durationMinutes: Number(f.durationMinutes), reason: f.reason || undefined, note: f.note || undefined,
          allowOutsideHours: allowOutsideHours || undefined,
        } });
        a = { id: r.id, date: f.date }; setCreated(a);
      }
      if (pay.mode !== "none") {
        try { await takePayment(a.id, patient.id); }
        catch (e) {
          setErr(new ApiFailure((e as ApiFailure).status, { code: "PAYMENT_FAILED", message: `Randevu kaydedildi; ödeme alınamadı: ${(e as ApiFailure).message} Ödemeyi yeniden deneyin veya “Ödeme alınmadı” seçip bitirin.` }));
          return;
        }
      }
      onCreated({ date: a.date, message: pay.mode === "none" ? "Randevu oluşturuldu." : `Randevu oluşturuldu; ${formatTRY(payAmount)} ödeme alındı (avans).` });
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }

  const outside = err?.code === "OUTSIDE_WORKING_HOURS";
  const blocks = (err?.body.details as { blocks?: { start: number; end: number }[] } | undefined)?.blocks ?? [];
  const cats = [...new Set(procedures.map((p) => p.category ?? "Diğer"))];

  return (
    <>
      <div className="page-head">
        <div><h1>Randevu ver</h1><p>Müsaitlik, çalışma saati, izin ve tatiller kayıt anında sunucuda da kontrol edilir.</p></div>
        <button className="btn" onClick={() => void cancel()}><ArrowLeft size={16} aria-hidden />Randevulara dön</button>
      </div>
      <div className="stack" style={{ gap: 16, maxWidth: 980 }}>
        {err && (outside ? (
          <Alert kind="warning" title="Çalışma saati dışı">{err.message} {blocks.length ? `O günkü çalışma saatleri: ${blocks.map((b) => `${hhmm(b.start)}–${hhmm(b.end)}`).join(", ")}.` : "Hekim o gün çalışmıyor."} Kayıt yine de yapılırsa geçmişe not düşülür.</Alert>
        ) : (
          <Alert kind={["APPOINTMENT_CONFLICT", "RESOURCE_CLOSED", "APPOINTMENT_IN_PAST", "PAYMENT_FAILED"].includes(err.code) ? "warning" : "error"}
            title={err.code === "APPOINTMENT_CONFLICT" ? "Çakışma" : err.code === "RESOURCE_CLOSED" ? "Kapalı gün" : err.code === "PAYMENT_FAILED" ? "Ödeme alınamadı" : undefined}>{err.message}</Alert>
        ))}

        <section className="card card-pad stack" aria-labelledby="ra-hasta">
          <h2 id="ra-hasta">1 · Hasta</h2>
          {patient ? (
            <div className="alert alert-success" role="status">
              <div style={{ flex: 1 }}><strong>{patient.fullName}</strong>{patient.fileNo ? <span className="small"> · Dosya #{patient.fileNo}</span> : null}</div>
              {!created && <button className="btn btn-sm" onClick={() => setPatient(null)}>Değiştir</button>}
            </div>
          ) : (
            <div className="field">
              <label htmlFor="ra-q">Hasta<span className="req" aria-hidden>*</span></label>
              <input id="ra-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, telefon veya dosya no" aria-invalid={!!err?.fieldErrors.patientId} autoComplete="off" />
              {err?.fieldErrors.patientId && <span className="err">{err.fieldErrors.patientId}</span>}
              {q.trim().length >= 2 && (
                <div className="picker-results" role="listbox" aria-label="Hasta sonuçları">
                  {search.loading && <div className="card-pad muted small">Aranıyor…</div>}
                  {search.data?.items.map((p) => (
                    <button key={p.id} role="option" aria-selected={false} onClick={() => setPatient(p)}>
                      <strong>{p.fullName}</strong> <span className="muted small">· #{p.fileNo}{p.phone ? ` · ${formatPhone(p.phone)}` : ""}</span>
                    </button>))}
                  {search.data && search.data.items.length === 0 && <div className="card-pad muted small">Eşleşen hasta yok.</div>}
                  <button onClick={() => setNewPatient(true)}><UserPlus size={15} aria-hidden style={{ verticalAlign: "-2px" }} /> Yeni hasta oluştur{q ? `: “${q}”` : ""}</button>
                </div>
              )}
            </div>
          )}
          {patient && <HealthAlert h={health.data} />}
        </section>

        <section className="card card-pad stack" aria-labelledby="ra-islem">
          <h2 id="ra-islem">2 · İşlem, hekim ve gün</h2>
          <div className="form-grid">
            <SelectField label="İşlem" required className="full" value={f.procedureId} onChange={(e) => pickProcedure(e.target.value)} error={err?.fieldErrors.procedureId}
              hint={!f.procedureId ? "Süre işlemin varsayılan süresine ayarlanır." : price.loading ? "Fiyat okunuyor…" : effectivePrice ? `Fiyat: ${formatTRY(effectivePrice)}` : "Bu işlem için yayında fiyat yok."}>
              <option value="">Seçin</option>
              {cats.map((cat) => (
                <optgroup key={cat} label={cat}>
                  {procedures.filter((p) => (p.category ?? "Diğer") === cat).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.price ? formatTRY(p.price) : "fiyat tanımsız"}</option>)}
                </optgroup>))}
            </SelectField>
            <SelectField label="Hekim" required value={f.practitionerId} onChange={set("practitionerId")} error={err?.fieldErrors.practitionerId}>
              {resources.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectField>
            <DateField label="Gün" required min={today} value={f.date} onChange={set("date")} error={err?.fieldErrors.date ?? (pastDay ? PAST_DAY_ERROR : undefined)} />
            <SelectField label="Süre" value={f.durationMinutes} onChange={set("durationMinutes")} error={err?.fieldErrors.durationMinutes}>
              {durations.map((m) => <option key={m} value={m}>{m} dakika</option>)}
            </SelectField>
            <SelectField label="Koltuk" value={f.chairId} onChange={set("chairId")} error={err?.fieldErrors.chairId}>
              <option value="">Seçilmedi</option>
              {resources.chairs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
          </div>
        </section>

        <section className="card card-pad stack" aria-labelledby="ra-saat">
          <h2 id="ra-saat">3 · Uygun saatler <span className="muted small" style={{ fontWeight: 400 }}>· {fmtDate(f.date)}, {f.durationMinutes} dk</span></h2>
          {pastDay ? <Alert kind="warning" title="Geçmiş gün">{PAST_DAY_SLOTS_NOTE}</Alert> : avail.loading && !avail.data ? <p className="muted small">Boş saatler hesaplanıyor…</p> : avail.error ? <Alert kind="error">{avail.error.message}</Alert> : avail.data && (
            avail.data.closedAllDay ? <Alert kind="warning" title="Bu gün kapalı">{avail.data.closedAllDay.reason}. Başka gün seçin.</Alert>
            : avail.data.slots.length === 0 ? <Alert kind="info">Bu gün seçilen süre için boş saat yok{avail.data.blocks.length === 0 ? " (hekim bu gün çalışmıyor)" : ""}. Başka gün veya hekim seçin.</Alert>
            : (
              <div className="slot-grid" role="radiogroup" aria-label="Uygun saatler">
                {avail.data.slots.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={f.startTime === t} className={`btn btn-sm ${f.startTime === t ? "btn-primary" : ""}`}
                    onClick={() => { setManualTime(false); setF({ ...f, startTime: t }); setErr(null); }}>{t}</button>))}
              </div>
            ))}
          {!pastDay && avail.data && !avail.data.workingHoursDefined && <p className="small muted">Hekimin çalışma saati tanımlı değil; 09:00–19:00 arası gösteriliyor.</p>}
          {err?.fieldErrors.startTime && !manualTime && <span className="err">{err.fieldErrors.startTime}</span>}
          <details>
            <summary className="small"><Clock size={13} aria-hidden style={{ verticalAlign: "-2px" }} /> Listede olmayan bir saat gir</summary>
            <TextField label="Saat" type="time" step={300} value={manualTime ? f.startTime : ""} onChange={(e) => { setManualTime(true); setF({ ...f, startTime: e.target.value }); setErr(null); }} hint="Çakışma ve çalışma saati kayıtta kontrol edilir."
              error={manualTime ? (err?.fieldErrors.startTime ?? (inPast && !pastDay ? PAST_TIME_ERROR : undefined)) : undefined} />
          </details>
        </section>

        <section className="card card-pad stack" aria-labelledby="ra-not">
          <h2 id="ra-not">4 · Açıklama</h2>
          <div className="form-grid">
            <TextField label="Açıklama" className="full" value={f.reason} onChange={set("reason")} placeholder="Boşsa işlem adı kullanılır" />
            <TextAreaField label="Not" className="full" value={f.note} onChange={set("note")} rows={2} hint="Klinik bilgi yazmayın; idari not içindir." />
          </div>
        </section>

        <section className="card card-pad stack" aria-labelledby="ra-odeme">
          <h2 id="ra-odeme">5 · Ödeme planı</h2>
          {patient && can("account.read") && (
            <div className="money-strip" aria-live="polite">
              <span><span className="muted small">İşlem fiyatı</span><strong>{effectivePrice ? formatTRY(effectivePrice) : "—"}</strong></span>
              {account.data && <>
                <span><span className="muted small">Mevcut açık borç</span><strong>{formatTRY(account.data.totals.openDebt)}</strong></span>
                <span><span className="muted small">Avans</span><strong>{formatTRY(account.data.totals.advance)}</strong></span>
                {effectivePrice && <span><span className="muted small">İşlem sonrası toplam borç</span><strong>{formatTRY(addMoney(account.data.totals.openDebt, effectivePrice))}</strong></span>}
              </>}
            </div>
          )}
          {!canPay ? <p className="small muted">Ödeme vezne/finans yetkisi olan kullanıcı tarafından hasta kartı → Finans'tan alınır.</p> : (
            <>
              <div className="row" role="radiogroup" aria-label="Ödeme" style={{ gap: 8, flexWrap: "wrap" }}>
                {([["none", "Ödeme alınmadı"], ["partial", "Kısmi ödeme"], ["full", "Tamamı"]] as [PayMode, string][]).map(([m, l]) => (
                  <button key={m} type="button" role="radio" aria-checked={pay.mode === m} className={`btn ${pay.mode === m ? "btn-primary" : ""}`} onClick={() => { setPay({ ...pay, mode: m }); setErr(null); }}>{l}</button>))}
              </div>
              {pay.mode !== "none" && (
                <div className="form-grid">
                  {pay.mode === "partial"
                    ? <TextField label="Alınan tutar (₺)" required inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder="ör. 500,00" error={err?.fieldErrors.payment} />
                    : <TextField label="Alınan tutar (₺)" value={effectivePrice ? formatTRY(effectivePrice) : "Fiyat tanımsız"} readOnly error={err?.fieldErrors.payment} />}
                  <SelectField label="Ödeme yöntemi" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as PaymentMethod })}>
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
                  </SelectField>
                  <SelectField label="Kasa / banka" value={pay.cashAccountId} onChange={(e) => setPay({ ...pay, cashAccountId: e.target.value })}>
                    {(cash.data?.items ?? []).filter((a) => a.active !== false && a.kind !== "provider").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </SelectField>
                  {pay.mode === "partial" && effectivePrice && payAmount && isMoney(payAmount) && toMinor(payAmount) > 0n && toMinor(payAmount) < toMinor(effectivePrice) && (
                    <p className="full small">Kalan: <strong>{formatTRY(fromMinor(toMinor(effectivePrice) - toMinor(payAmount)))}</strong> (işlem gerçekleşince borç olarak yazılır).</p>)}
                </div>
              )}
              <p className="small muted">Alınan ödeme hastanın avansına yazılır ve makbuz no alır; işlem gerçekleşince borçtan düşülür. Hasta kartı → Finans'ta toplam borç, toplam ödeme ve kalan ödeme görünür.</p>
            </>
          )}
        </section>

        <div className="row" style={{ gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => void cancel()}>Vazgeç</button>
          {outside
            ? <button className="btn btn-primary" disabled={busy} onClick={() => void save(true)}>Çalışma saati dışında yine de kaydet</button>
            : <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Kaydediliyor…" : created ? "Ödemeyi yeniden dene" : "Randevuyu kaydet"}</button>}
        </div>
      </div>
      {newPatient && <NewPatientDrawer initialName={q} onClose={() => setNewPatient(false)} onCreated={(p) => { setPatient(p); setNewPatient(false); }} />}
    </>
  );
}
