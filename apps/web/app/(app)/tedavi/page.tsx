"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { PLAN_STATUS_LABELS, addMoney, formatTRY } from "@viadent/contracts";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { EmptyState, ErrorState, Loading } from "@/components/ui";

interface Row {
  versionId: string; version: number; status: "proposed" | "accepted"; proposedAt: string | null; decidedAt: string | null; planId: string; title: string;
  patientId: string; patientName: string; fileNo: number; practitionerName: string; total: string; itemQty: number; doneQty: number; nextAppointmentAt: string | null;
}

const FILTERS = [
  { id: "all", label: "Tümü" },
  { id: "proposed", label: "Karar bekleyen teklifler" },
  { id: "accepted", label: "Devam eden kabul edilmiş planlar" },
  { id: "unscheduled", label: "Randevusu olmayan" },
] as const;

export default function TreatmentPage() {
  const { tz } = useSession();
  const data = useData<{ items: Row[] }>("/plans");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const rows = useMemo(() => (data.data?.items ?? []).filter((r) =>
    filter === "all" ? true : filter === "unscheduled" ? r.status === "accepted" && !r.nextAppointmentAt : r.status === filter), [data.data, filter]);
  const sum = (s: "proposed" | "accepted") => (data.data?.items ?? []).filter((r) => r.status === s).reduce((a, r) => addMoney(a, r.total), "0.00");
  const count = (s: "proposed" | "accepted") => (data.data?.items ?? []).filter((r) => r.status === s).length;

  return (
    <>
      <div className="page-head">
        <div><h1>Tedavi takibi</h1><p>Teklif ve kabul edilmiş planların ilerleyişi. Tutarlar plan bedelidir; tahsilat ve gelir Finans modülündedir.</p></div>
      </div>
      {data.data && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginBottom: 16 }}>
          <div className="card card-pad"><p className="muted small">Karar bekleyen teklif</p><p className="kpi">{count("proposed")}</p><p className="small muted money">{formatTRY(sum("proposed"))}</p></div>
          <div className="card card-pad"><p className="muted small">Devam eden kabul edilmiş plan</p><p className="kpi">{count("accepted")}</p><p className="small muted money">{formatTRY(sum("accepted"))}</p></div>
          <div className="card card-pad"><p className="muted small">Randevusu olmayan plan</p><p className="kpi">{(data.data.items).filter((r) => r.status === "accepted" && !r.nextAppointmentAt).length}</p><p className="small muted">PİA Akış görev üretir</p></div>
        </div>
      )}
      <div className="subtabs" role="tablist" aria-label="Filtre">
        {FILTERS.map((f) => <button key={f.id} role="tab" aria-selected={filter === f.id} className={`btn btn-sm ${filter === f.id ? "btn-primary" : ""}`} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>
      <div className="card">
        {data.loading && !data.data ? <Loading /> : data.error ? <ErrorState error={data.error} onRetry={() => void data.reload()} /> : rows.length === 0 ? (
          <EmptyState icon={<ClipboardList size={28} aria-hidden />} title="Bu filtrede plan yok" />
        ) : (
          <div className="table-wrap" tabIndex={0}>
            <table className="table table-wide">
              <thead><tr><th>Hasta</th><th>Plan</th><th>Durum</th><th>Hekim</th><th className="money">Bedel</th><th>İlerleme</th><th>Sonraki randevu</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.versionId}>
                    <td><Link href={`/hastalar/${r.patientId}?sekme=tedavi`}><strong>{r.patientName}</strong></Link><div className="small muted">Dosya {r.fileNo}</div></td>
                    <td>{r.title}<div className="small muted">Sürüm {r.version}</div></td>
                    <td><span className={`badge badge-${r.status === "accepted" ? "success" : "info"}`}>{PLAN_STATUS_LABELS[r.status]}</span>
                      <div className="small muted">{r.status === "accepted" ? `kabul ${fmtDate(r.decidedAt)}` : `teklif ${fmtDate(r.proposedAt)}`}</div></td>
                    <td>{r.practitionerName}</td>
                    <td className="money">{formatTRY(r.total)}</td>
                    <td>
                      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={r.itemQty} aria-valuenow={r.doneQty} aria-label={`${r.doneQty}/${r.itemQty} işlem`}>
                        <span style={{ width: `${r.itemQty ? Math.round((r.doneQty / r.itemQty) * 100) : 0}%` }} />
                      </div>
                      <div className="small muted">{r.doneQty}/{r.itemQty} işlem</div>
                    </td>
                    <td>{r.nextAppointmentAt ? fmtDateTime(r.nextAppointmentAt, tz) : <span className="badge badge-warning">Yok</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
