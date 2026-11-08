"use client";
/**
 * 08.11.2026 geri bildirimi: PİA Akış (iş akışları ve uyarılar) Panel'den ayrı menü sekmesine taşındı. İçerik ve eylemler aynı:
 * rolüne atanan işler önce, diğer rollerin işleri katlanır; randevu kaynaklı işlerde Geldi / Gelmedi, Bilgi verildi / Ulaşılamadı.
 */
import Link from "next/link";
import { useState } from "react";
import { CalendarClock, CheckCircle2, ClipboardCheck, PhoneCall, RefreshCw, UserRoundX, Clock3, Ban, Stethoscope, ChevronDown } from "lucide-react";
import { addDays, type AppointmentStatus } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime, fmtLongDay, todayIn } from "@/lib/format";
import type { Appt, Task } from "@/lib/types";
import { ContactBadge, EmptyState, ErrorState, Loading, useToast } from "@/components/ui";

const KIND_ICON: Record<string, typeof Clock3> = { overdue_checkin: Clock3, contact_pending: PhoneCall, missing_contact: UserRoundX, closure_conflict: Ban, anamnesis_review: Stethoscope, plan_unscheduled: CalendarClock, plan_decision_pending: ClipboardCheck, follow_up: CalendarClock, readiness_missing: ClipboardCheck, file_quarantined: Ban };
const ROLE_LABEL: Record<string, string> = { secretary: "Sekreterya", dentist: "Hekim", assistant: "Asistan", finance: "Finans", clinic_admin: "Yönetici" };

const FLOW_LIMIT = 8;

export default function WorkflowPage() {
  const { tz, can } = useSession();
  const today = todayIn(tz);
  const tasks = useData<{ items: Task[] }>("/tasks");
  const [showOthers, setShowOthers] = useState(false);
  const [showAllMine, setShowAllMine] = useState(false);
  // Randevu kaynaklı işler (geç kalan geliş, teyit) bugünkü ve yarınki randevulara bağlıdır.
  const day = useData<{ items: Appt[] }>(`/appointments?date=${today}`);
  const next = useData<{ items: Appt[] }>(`/appointments?date=${addDays(today, 1)}`);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const byId = new Map([...(day.data?.items ?? []), ...(next.data?.items ?? [])].map((a) => [a.id, a]));

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
          <h1>İş akışı</h1>
          <p>PİA Akış · iş akışları ve uyarılar · {fmtLongDay(today)}</p>
        </div>
        <button className="btn" onClick={() => void act("refresh", async () => undefined, "PİA Akış güncellendi")} disabled={busy === "refresh"}>
          <RefreshCw size={17} aria-hidden /> Listeyi yenile
        </button>
      </div>
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
