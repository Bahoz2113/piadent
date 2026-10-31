"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Plus, Search, UserRoundSearch } from "lucide-react";
import { formatPhone } from "@viadent/contracts";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { EmptyState, ErrorState, Loading } from "@/components/ui";
import { NewPatientDrawer } from "@/components/patient-form";

interface PatientRow {
  id: string; fileNo: number; fullName: string; birthDate: string | null; age: number | null; phone: string | null;
  primaryPractitionerName: string | null; nextAppointmentAt: string | null; lastVisitAt: string | null;
}

function PatientsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { can, tz } = useSession();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setQ(params.get("q") ?? ""); }, [params]);
  const list = useData<{ items: PatientRow[] }>(`/patients?limit=50${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`);
  const items = list.data?.items ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hastalar</h1>
          <p>Ad, telefon, dosya no veya kimlik no ile arayın. Türkçe karakter gerekmez.</p>
        </div>
        {can("patient.write") && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={18} aria-hidden />Yeni hasta</button>}
      </div>
      <section className="card">
        <div className="card-head">
          <div className="search" style={{ maxWidth: 520 }}>
            <Search size={17} aria-hidden />
            <label htmlFor="pq" className="sr-only">Hasta ara</label>
            <input id="pq" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Örn. ayse yilmaz, 0555, 1024" autoFocus />
          </div>
          <span className="muted small" aria-live="polite">{list.loading ? "Aranıyor…" : `${items.length} sonuç`}</span>
        </div>
        {list.loading && !list.data ? <Loading rows={6} /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : items.length === 0 ? (
          <EmptyState icon={<UserRoundSearch size={32} aria-hidden />} title={debounced ? `“${debounced}” için kayıt bulunamadı` : "Henüz hasta kaydı yok"}
            action={can("patient.write") ? <button className="btn btn-primary" onClick={() => setCreating(true)}>Yeni hasta oluştur</button> : undefined}>
            {debounced ? "Yazımı kontrol edin veya telefon / dosya no ile deneyin." : undefined}
          </EmptyState>
        ) : (
          <div className="table-wrap" tabIndex={0}>
            <table className="table">
              <thead>
                <tr><th>Dosya</th><th>Hasta</th><th className="desktop-only">Doğum tarihi</th><th>Telefon</th><th className="desktop-only">Sorumlu hekim</th><th className="desktop-only">Sıradaki randevu</th></tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td className="muted">#{p.fileNo}</td>
                    <td><Link className="rowlink" href={`/hastalar/${p.id}`}>{p.fullName}</Link>{p.age !== null && <span className="muted small"> · {p.age} yaş</span>}</td>
                    <td className="desktop-only">{fmtDate(p.birthDate)}</td>
                    <td>{formatPhone(p.phone) ?? <span className="muted">Belirtilmedi</span>}</td>
                    <td className="desktop-only">{p.primaryPractitionerName ?? <span className="muted">Belirtilmedi</span>}</td>
                    <td className="desktop-only">{p.nextAppointmentAt ? fmtDateTime(p.nextAppointmentAt, tz) : <span className="muted">Yok</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {creating && <NewPatientDrawer initialName={/\d/.test(q) ? "" : q} onClose={() => setCreating(false)} onCreated={(p) => router.push(`/hastalar/${p.id}?yeni=1`)} />}
    </>
  );
}

export default function PatientsPage() {
  return <Suspense fallback={<Loading />}><PatientsInner /></Suspense>;
}
