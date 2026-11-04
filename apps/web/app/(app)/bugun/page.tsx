"use client";
import Link from "next/link";
import { useState } from "react";
import { CalendarClock, CheckCircle2, ClipboardCheck, PhoneCall, RefreshCw, UserRoundX, Clock3, ArrowRight, Ban, Stethoscope, BriefcaseMedical, Armchair, Banknote, Wallet, ChevronDown } from "lucide-react";
import { addDays, formatTRY, type AppointmentStatus } from "@viadent/contracts";
import { BarList, ColumnChart, LineChart, compact, type Point } from "@/components/charts";
import { isPastPending, PastPendingBadge } from "@/components/appointment-status";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime, fmtLongDay, fmtTime, todayIn } from "@/lib/format";
import type { Appt, Task } from "@/lib/types";
import { ContactBadge, EmptyState, ErrorState, Loading, StatusBadge, useToast } from "@/components/ui";


const KIND_ICON: Record<string, typeof Clock3> = { overdue_checkin: Clock3, contact_pending: PhoneCall, missing_contact: UserRoundX, closure_conflict: Ban, anamnesis_review: Stethoscope, plan_unscheduled: CalendarClock, plan_decision_pending: ClipboardCheck, follow_up: CalendarClock, readiness_missing: ClipboardCheck, file_quarantined: Ban };
const ROLE_LABEL: Record<string, string> = { secretary: "Sekreterya", dentist: "Hekim", assistant: "Asistan", finance: "Finans", clinic_admin: "Yönetici" };

interface Dashboard {
  date: string;
  today: { appointments: number; waiting: number; inTreatment: number; completed: number; noShow: number; pastPending: number; activePractitioners: number };
  money: null | { todayCollections: string; openReceivables: string; monthlyIncome: { month: string; amount: string }[] };
  charts: { appointmentDensity: { date: string; count: number }[]; newPatients: { month: string; count: number }[]; treatments: { category: string; count: number }[] | null; treatmentsWindowDays: number };
}
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString("tr-TR", { month: "short", timeZone: "UTC" })} ${String(y).slice(2)}`;
};
const dayLabel = (d: string) => `${Number(d.slice(8))}.${d.slice(5, 7)}`;
const DAY_LIST_LIMIT = 6;
const FLOW_LIMIT = 4;

export default function TodayPage() {
  const { session, tz, can } = useSession();
  const today = todayIn(tz);
  const tasks = useData<{ items: Task[] }>("/tasks");
  const dash = useData<Dashboard>("/dashboard");
  const [showOthers, setShowOthers] = useState(false);
  const [showAllDay, setShowAllDay] = useState(false);
  const [showAllMine, setShowAllMine] = useState(false);
  const day = useData<{ items: Appt[] }>(`/appointments?date=${today}`);
  // Teyit görevleri yarınki randevulara bağlıdır.
  const next = useData<{ items: Appt[] }>(`/appointments?date=${addDays(today, 1)}`);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const appts = day.data?.items ?? [];
  const byId = new Map([...appts, ...(next.data?.items ?? [])].map((a) => [a.id, a]));
  const d = dash.data;
  const dash0 = dash.loading && !d;
  const kpis: { label: string; value: string; sub?: string; href?: string; icon: typeof Clock3 }[] = [
    { label: "Bugünkü randevular", value: dash0 ? "–" : String(d?.today.appointments ?? 0), href: "/ajanda", icon: CalendarClock,
      sub: d ? `${d.today.completed} tamamlandı · ${d.today.noShow} gelmedi${d.today.pastPending ? ` · ${d.today.pastPending} sonuç bekliyor` : ""}` : undefined },
    { label: "Aktif hekim", value: dash0 ? "–" : String(d?.today.activePractitioners ?? 0), href: "/hekimler", icon: BriefcaseMedical },
    { label: "Bekleyen hasta", value: dash0 ? "–" : String(d?.today.waiting ?? 0), href: "/ajanda", icon: Armchair, sub: d ? `${d.today.inTreatment} tedavide` : undefined },
    ...(d?.money ? [
      { label: "Bugünkü tahsilat", value: formatTRY(d.money.todayCollections), href: "/finans", icon: Banknote, sub: "Tahsilat − iade" },
      { label: "Bekleyen tahsilat", value: formatTRY(d.money.openReceivables), href: "/finans?sekme=bakiyeler", icon: Wallet, sub: "Açık hasta borcu" },
    ] : []),
  ];
  const income: Point[] = (d?.money?.monthlyIncome ?? []).map((m) => ({ key: m.month, label: monthLabel(m.month), value: Number(m.amount), display: formatTRY(m.amount) }));
  const density: Point[] = (d?.charts.appointmentDensity ?? []).map((x) => ({ key: x.date, label: dayLabel(x.date), value: x.count, display: `${x.count} randevu` }));
  const newPatients: Point[] = (d?.charts.newPatients ?? []).map((x) => ({ key: x.month, label: monthLabel(x.month), value: x.count, display: `${x.count} hasta` }));
  const treatments: Point[] = (d?.charts.treatments ?? []).map((x) => ({ key: x.category, label: x.category, value: x.count, display: `${compact(x.count)} işlem` }));
  const upcomingToday = appts.filter((a) => a.status !== "cancelled");
  const dayShown = showAllDay ? upcomingToday : upcomingToday.slice(0, DAY_LIST_LIMIT);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      await api("/via-akis/refresh", { body: {} });
      toast.show("success", ok);
      await Promise.all([tasks.reload(), day.reload(), next.reload(), dash.reload()]);
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
          <h1>Panel</h1>
          <p>{fmtLongDay(today)} · {session.activeMembership?.tenantName}</p>
        </div>
        <button className="btn" onClick={() => void act("refresh", async () => undefined, "PİA Akış güncellendi")} disabled={busy === "refresh"}>
          <RefreshCw size={17} aria-hidden /> Listeyi yenile
        </button>
      </div>

      <section className="kpis" aria-label="Günün özeti">
        {kpis.map((k) => {
          const Icon = k.icon;
          const body = (<>
            <div className="kpi-top"><span className="kpi-label">{k.label}</span><span className="kpi-icon" aria-hidden><Icon size={18} /></span></div>
            <div className="kpi-value">{k.value}</div>
            {k.sub && <div className="kpi-sub">{k.sub}</div>}
          </>);
          return k.href ? <Link key={k.label} href={k.href} className="card kpi">{body}</Link> : <div key={k.label} className="card kpi">{body}</div>;
        })}
      </section>

      {dash.error ? <div className="card" style={{ marginBottom: 16 }}><ErrorState error={dash.error} onRetry={dash.reload} /></div> : (
        <div className="chart-grid">
          {d?.money && <LineChart title="Aylık gelir" subtitle="Son 12 ay · net tahsilat (tahsilat − iade); kâr değildir" data={income} empty="Son 12 ayda tahsilat yok." />}
          <ColumnChart title="Randevu yoğunluğu" subtitle="Son 30 gün · iptaller hariç" data={density} every={5} empty="Son 30 günde randevu yok." />
          {d?.charts.treatments && <BarList title="Tedavi dağılımı" subtitle={`Son ${d.charts.treatmentsWindowDays} gün · tamamlanan işlem adedi, kategoriye göre`} data={treatments} empty="Son 90 günde tamamlanan işlem yok." />}
          <ColumnChart title="Yeni hasta sayısı" subtitle="Son 12 ay · oluşturulan hasta kaydı" data={newPatients} every={2} empty="Son 12 ayda yeni hasta kaydı yok." />
        </div>
      )}

      <div className="panel-lower">
        <section className="card" aria-labelledby="akis-h">
          <div className="card-head">
            <div>
              <h2 id="akis-h">PİA Akış</h2>
              <p className="muted small">Neden, sorumlu ve sonraki adımı belli işler</p>
            </div>
            <span className="badge badge-accent">{items.length} açık iş</span>
          </div>
          {tasks.loading && !tasks.data ? <Loading rows={4} /> : tasks.error ? <ErrorState error={tasks.error} onRetry={tasks.reload} /> : items.length === 0 ? (
            <EmptyState icon={<ClipboardCheck size={32} aria-hidden />} title="Bekleyen iş yok">Yeni bir gecikme veya eksik bilgi oluştuğunda burada görünecek.</EmptyState>
          ) : (
            <>
              {mine.length > 0 && <TaskList title={`Rolünüze atanan (${mine.length})`} items={showAllMine ? mine : mine.slice(0, FLOW_LIMIT)} />}
              {mine.length > FLOW_LIMIT && !showAllMine && (
                <div className="card-pad" style={{ paddingBottom: 0 }}><button className="btn btn-sm btn-ghost" onClick={() => setShowAllMine(true)}><ChevronDown size={15} aria-hidden />Tümünü göster ({mine.length})</button></div>
              )}
              {mine.length === 0 && <p className="card-pad muted small" style={{ paddingBottom: 0 }}>Rolünüze atanmış açık iş yok.</p>}
              {others.length > 0 && (showOthers ? <TaskList title={`Diğer roller (${others.length})`} items={others} /> : (
                <div className="card-pad"><button className="btn btn-sm btn-ghost" onClick={() => setShowOthers(true)} aria-expanded={false}><ChevronDown size={15} aria-hidden />Diğer rollerin işleri ({others.length})</button></div>
              ))}
            </>
          )}
        </section>

        <section className="card" aria-labelledby="gun-h">
          <div className="card-head">
            <h2 id="gun-h">Günün randevuları</h2>
            <Link href="/ajanda" className="btn btn-sm btn-ghost">Randevular <ArrowRight size={15} aria-hidden /></Link>
          </div>
          {day.loading && !day.data ? <Loading rows={5} /> : day.error ? <ErrorState error={day.error} onRetry={day.reload} /> : appts.length === 0 ? (
            <EmptyState icon={<CalendarClock size={32} aria-hidden />} title="Bugün randevu yok" action={can("appointment.write") ? <Link className="btn btn-primary" href="/ajanda?yeni=1">Randevu ver</Link> : undefined} />
          ) : (
            <>
            <ul className="list">
              {dayShown.map((a) => (
                <li key={a.id} className="day-row">
                  <strong>{fmtTime(a.startsAt, tz)}</strong>
                  <div style={{ minWidth: 0 }}>
                    <Link href={`/hastalar/${a.patientId}`} style={{ fontWeight: 600, color: "var(--text)" }}>{a.patientName}</Link>
                    <div className="muted small">{a.practitionerName}{a.chairName ? ` · ${a.chairName}` : ""}{a.reason ? ` · ${a.reason}` : ""}</div>
                  </div>
                  {isPastPending(a) ? <PastPendingBadge /> : <StatusBadge status={a.status} />}
                </li>
              ))}
            </ul>
            {upcomingToday.length > DAY_LIST_LIMIT && !showAllDay && (
              <div className="card-pad"><button className="btn btn-sm btn-ghost" onClick={() => setShowAllDay(true)}><ChevronDown size={15} aria-hidden />Tümünü göster ({upcomingToday.length})</button></div>
            )}
            </>
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
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <strong>{t.title}</strong>
                    {t.escalated && <span className="badge badge-error" title={t.escalatedAt ? `Yükseltildi: ${fmtDateTime(t.escalatedAt)}` : undefined}>Yükseltildi · {t.escalatedToRole ? ROLE_LABEL[t.escalatedToRole] : "yönetici"}</span>}
                    {!t.escalated && t.overdue && <span className="badge badge-warning">Gecikti</span>}
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
                  {t.kind === "closure_conflict" && t.dueAt && <Link className="btn btn-sm" href={`/ajanda?tarih=${new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(t.dueAt))}`}>Randevularda aç</Link>}
                  {t.kind === "anamnesis_review" && t.patientId && <Link className="btn btn-sm btn-primary" href={`/hastalar/${t.patientId}?sekme=saglik`}>Gözden geçir</Link>}
                  {(t.kind === "plan_unscheduled" || t.kind === "plan_decision_pending") && t.patientId && <Link className="btn btn-sm btn-primary" href={`/hastalar/${t.patientId}?sekme=tedavi`}>Planı aç</Link>}
                  {t.kind === "follow_up" && t.patientId && <Link className="btn btn-sm btn-primary" href={`/hastalar/${t.patientId}?sekme=iletisim`}>İletişim tercihini gör</Link>}
                  {t.kind === "readiness_missing" && t.patientId && <Link className="btn btn-sm btn-primary" href={`/hastalar/${t.patientId}?sekme=belgeler`}>Belgeleri aç</Link>}
                  {(t.kind === "integration_dead" || t.kind === "integration_approval") && can("integration.read") && <Link className="btn btn-sm btn-primary" href="/yonetim?sekme=kopru">{t.kind === "integration_approval" ? "Onay ekranını aç" : "PİA Köprü'de incele"}</Link>}
                  {(t.kind === "lab_overdue" || t.kind === "lab_review" || t.kind === "lab_not_ready") && t.sourceId && can("lab.read") && <Link className="btn btn-sm btn-primary" href={`/operasyon?is=${t.sourceId}`}>İş emrini aç</Link>}
                  {(t.kind === "stock_low" || t.kind === "lot_expiring" || t.kind === "stock_shortage") && can("stock.read") && <Link className="btn btn-sm btn-primary" href="/operasyon?sekme=stok">Stoğa git</Link>}
                  {t.kind === "file_quarantined" && t.patientId && <Link className="btn btn-sm" href={`/hastalar/${t.patientId}?sekme=belgeler`}>Dosyalara git</Link>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
}
