"use client";
import Link from "next/link";
import { useState } from "react";
import { CalendarClock, RefreshCw, Clock3, BriefcaseMedical, Armchair, Banknote, Wallet } from "lucide-react";
import { formatTRY } from "@viadent/contracts";
import { BarList, ColumnChart, LineChart, compact, type Point } from "@/components/charts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtLongDay, fmtTime, todayIn } from "@/lib/format";
import type { Appt } from "@/lib/types";
import { EmptyState, ErrorState, Loading, StatusBadge, useToast } from "@/components/ui";
import { isPastPending, PastPendingBadge } from "@/components/appointment-status";


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

export default function TodayPage() {
  const { session, tz } = useSession();
  const today = todayIn(tz);
  const dash = useData<Dashboard>("/dashboard");
  const day = useData<{ items: Appt[] }>(`/appointments?date=${today}`);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const appts = day.data?.items ?? [];
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

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.show("success", ok);
      await Promise.all([day.reload(), dash.reload()]);
    } catch (e) {
      toast.show("error", (e as ApiFailure).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {/* 08.11.2026 geri bildirimi: başlıkta "Panel" yazmaz; kliniğin adı ve bugünün tarihi, hemen altında günün randevuları. */}
      <div className="page-head">
        <div>
          <h1>{session.activeMembership?.tenantName ?? "Klinik"}</h1>
          <p>{fmtLongDay(today)}</p>
        </div>
        <button className="btn" onClick={() => void act("refresh", async () => undefined, "Panel güncellendi")} disabled={busy === "refresh"}>
          <RefreshCw size={17} aria-hidden /> Listeyi yenile
        </button>
      </div>

      <section className="card today-appts" aria-labelledby="bugun-randevu-h" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div><h2 id="bugun-randevu-h">Bugünün randevuları</h2><p className="muted small">{fmtLongDay(today)} · saat sırasıyla</p></div>
          <Link className="btn btn-sm" href={`/ajanda?tarih=${today}`}>Randevularda aç</Link>
        </div>
        {day.loading && !day.data ? <Loading rows={3} /> : day.error ? <ErrorState error={day.error} onRetry={day.reload} /> : appts.length === 0 ? (
          <EmptyState icon={<CalendarClock size={32} aria-hidden />} title="Bugün randevu yok">Yeni randevu Randevular sayfasından verilir.</EmptyState>
        ) : (
          <ul className="list today-list">
            {[...appts].sort((x, y) => x.startsAt.localeCompare(y.startsAt)).map((a) => (
              <li key={a.id} className={`today-row ${a.status === "cancelled" ? "is-cancelled" : ""}`}>
                <span className="today-time"><strong>{fmtTime(a.startsAt, tz)}</strong><span className="muted small">–{fmtTime(a.endsAt, tz)}</span></span>
                <span className="today-main">
                  <Link href={`/hastalar/${a.patientId}`} className="today-patient">{a.patientName}</Link>
                  <span className="muted small">{a.practitionerName}{a.chairName ? ` · ${a.chairName}` : ""}{a.reason ? ` · ${a.reason}` : ""}</span>
                </span>
                <span className="today-status">{isPastPending(a) ? <PastPendingBadge /> : <StatusBadge status={a.status} />}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

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

      <p className="small muted">İş akışları ve uyarılar (PİA Akış) menüde <Link href="/is-akisi">İş akışı</Link> sekmesindedir.</p>
      {toast.node}
    </>
  );
}
