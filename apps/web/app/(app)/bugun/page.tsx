"use client";
import Link from "next/link";
import { useState } from "react";
import { CalendarClock, CheckCircle2, ClipboardCheck, PhoneCall, RefreshCw, UserRoundX, Clock3, ArrowRight, Ban, Stethoscope } from "lucide-react";
import { addDays, type AppointmentStatus } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtLongDay, fmtTime, todayIn } from "@/lib/format";
import type { Appt, Task } from "@/lib/types";
import { ContactBadge, EmptyState, ErrorState, Loading, StatusBadge, useToast } from "@/components/ui";


const KIND_ICON: Record<string, typeof Clock3> = { overdue_checkin: Clock3, contact_pending: PhoneCall, missing_contact: UserRoundX, closure_conflict: Ban, anamnesis_review: Stethoscope, plan_unscheduled: CalendarClock, plan_decision_pending: ClipboardCheck };
const ROLE_LABEL: Record<string, string> = { secretary: "Sekreterya", dentist: "Hekim", assistant: "Asistan", finance: "Finans", clinic_admin: "Yönetici" };

export default function TodayPage() {
  const { session, tz, can } = useSession();
  const today = todayIn(tz);
  const tasks = useData<{ items: Task[] }>("/tasks");
  const day = useData<{ items: Appt[] }>(`/appointments?date=${today}`);
  // Teyit görevleri yarınki randevulara bağlıdır.
  const next = useData<{ items: Appt[] }>(`/appointments?date=${addDays(today, 1)}`);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const appts = day.data?.items ?? [];
  const byId = new Map([...appts, ...(next.data?.items ?? [])].map((a) => [a.id, a]));
  const live = appts.filter((a) => a.status !== "cancelled");
  const stats = [
    { label: "Bugünkü randevu", value: live.length, href: "/ajanda" },
    { label: "Geldi / tedavide", value: live.filter((a) => ["checked_in", "in_progress"].includes(a.status)).length, href: "/ajanda" },
    { label: "Tamamlandı", value: live.filter((a) => a.status === "completed").length, href: "/ajanda" },
    { label: "Gelmedi", value: live.filter((a) => a.status === "no_show").length, href: "/ajanda" },
  ];

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      await api("/via-akis/refresh", { body: {} });
      toast.show("success", ok);
      await Promise.all([tasks.reload(), day.reload(), next.reload()]);
    } catch (e) {
      toast.show("error", (e as ApiFailure).message);
      await Promise.all([day.reload(), next.reload()]);
    } finally {
      setBusy(null);
    }
  }

  const setStatus = (a: Appt, status: AppointmentStatus, label: string) =>
    act(`${a.id}:${status}`, () => api(`/appointments/${a.id}/status`, { body: { version: a.version, status } }), `${a.patientName}: ${label}`);
  const setContact = (a: Appt, outcome: "informed" | "unreachable", label: string) =>
    act(`${a.id}:${outcome}`, () => api(`/appointments/${a.id}/contact`, { body: { version: a.version, contactOutcome: outcome } }), `${a.patientName}: ${label}`);

  const items = tasks.data?.items ?? [];
  const mine = items.filter((t) => t.mine);
  const others = items.filter((t) => !t.mine);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bugün</h1>
          <p>{fmtLongDay(today)} · {session.activeMembership?.tenantName}</p>
        </div>
        <button className="btn" onClick={() => void act("refresh", async () => undefined, "VİA Akış güncellendi")} disabled={busy === "refresh"}>
          <RefreshCw size={17} aria-hidden /> Listeyi yenile
        </button>
      </div>

      <section className="stats" aria-label="Günün özeti">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card stat">
            <div className="label">{s.label}</div>
            <div className="value">{day.loading && !day.data ? "–" : s.value}</div>
          </Link>
        ))}
      </section>

      <div className="grid grid-2">
        <section className="card" aria-labelledby="akis-h">
          <div className="card-head">
            <div>
              <h2 id="akis-h">VİA Akış</h2>
              <p className="muted small">Neden, sorumlu ve sonraki adımı belli işler</p>
            </div>
            <span className="badge badge-accent">{items.length} açık iş</span>
          </div>
          {tasks.loading && !tasks.data ? <Loading rows={4} /> : tasks.error ? <ErrorState error={tasks.error} onRetry={tasks.reload} /> : items.length === 0 ? (
            <EmptyState icon={<ClipboardCheck size={32} aria-hidden />} title="Bekleyen iş yok">Yeni bir gecikme veya eksik bilgi oluştuğunda burada görünecek.</EmptyState>
          ) : (
            <>
              {mine.length > 0 && <TaskList title={`Rolünüze atanan (${mine.length})`} items={mine} />}
              {others.length > 0 && <TaskList title={`Diğer roller (${others.length})`} items={others} />}
            </>
          )}
        </section>

        <section className="card" aria-labelledby="gun-h">
          <div className="card-head">
            <h2 id="gun-h">Günün randevuları</h2>
            <Link href="/ajanda" className="btn btn-sm btn-ghost">Ajanda <ArrowRight size={15} aria-hidden /></Link>
          </div>
          {day.loading && !day.data ? <Loading rows={5} /> : day.error ? <ErrorState error={day.error} onRetry={day.reload} /> : appts.length === 0 ? (
            <EmptyState icon={<CalendarClock size={32} aria-hidden />} title="Bugün randevu yok" action={can("appointment.write") ? <Link className="btn btn-primary" href="/ajanda?yeni=1">Randevu ver</Link> : undefined} />
          ) : (
            <ul className="list">
              {appts.map((a) => (
                <li key={a.id} className="day-row">
                  <strong>{fmtTime(a.startsAt, tz)}</strong>
                  <div style={{ minWidth: 0 }}>
                    <Link href={`/hastalar/${a.patientId}`} style={{ fontWeight: 600, color: "var(--text)" }}>{a.patientName}</Link>
                    <div className="muted small">{a.practitionerName}{a.chairName ? ` · ${a.chairName}` : ""}{a.reason ? ` · ${a.reason}` : ""}</div>
                  </div>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {toast.node}
    </>
  );

  function TaskList({ title, items }: { title: string; items: Task[] }) {
    return (
      <div>
        <h3 className="small muted" style={{ padding: "12px 20px 0", fontWeight: 600 }}>{title}</h3>
        <ul className="list">
          {items.map((t) => {
            const Icon = KIND_ICON[t.kind] ?? CheckCircle2;
            const a = t.sourceType === "appointment" && t.sourceId ? byId.get(t.sourceId) : undefined;
            return (
              <li key={t.id} className="flow-item">
                <span className={`flow-icon k-${t.kind}`} aria-hidden><Icon size={18} /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong>{t.title}</strong>
                    {t.patientId && <Link href={`/hastalar/${t.patientId}`} className="small">{t.patientName}{t.patientFileNo ? ` · #${t.patientFileNo}` : ""}</Link>}
                  </div>
                  <p className="flow-why"><span className="sr-only">Neden: </span>{t.reason}</p>
                  <p className="flow-next"><strong>Sonraki adım:</strong> <span>{t.nextStep}</span></p>
                  <p className="small muted" style={{ marginTop: 4 }}>Sorumlu: {t.assigneeRole ? ROLE_LABEL[t.assigneeRole] : "Atanmadı"}{a ? <> · <ContactBadge outcome={a.contactOutcome} /></> : null}</p>
                </div>
                <div className="flow-actions">
                  {t.kind === "overdue_checkin" && a && can("appointment.write") && (
                    <>
                      <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => void setStatus(a, "checked_in", "geliş kaydedildi")}>Geldi</button>
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => void setStatus(a, "no_show", "gelmedi olarak işaretlendi")}>Gelmedi</button>
                    </>
                  )}
                  {t.kind === "contact_pending" && a && can("appointment.write") && (
                    <>
                      <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => void setContact(a, "informed", "bilgi verildi")}>Bilgi verildi</button>
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => void setContact(a, "unreachable", "ulaşılamadı")}>Ulaşılamadı</button>
                    </>
                  )}
                  {t.kind === "missing_contact" && t.patientId && <Link className="btn btn-sm" href={`/hastalar/${t.patientId}?duzenle=1`}>Bilgi ekle</Link>}
                  {t.kind === "closure_conflict" && t.dueAt && <Link className="btn btn-sm" href={`/ajanda?tarih=${new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(t.dueAt))}`}>Ajandada aç</Link>}
                  {t.kind === "anamnesis_review" && t.patientId && <Link className="btn btn-sm btn-primary" href={`/hastalar/${t.patientId}?sekme=saglik`}>Gözden geçir</Link>}
                  {(t.kind === "plan_unscheduled" || t.kind === "plan_decision_pending") && t.patientId && <Link className="btn btn-sm btn-primary" href={`/hastalar/${t.patientId}?sekme=tedavi`}>Planı aç</Link>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
}
