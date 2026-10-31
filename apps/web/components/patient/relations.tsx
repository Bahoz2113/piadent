"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus, ShieldCheck, Users } from "lucide-react";
import { formatPhone, RELATION_LABELS, RELATIONS } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate } from "@/lib/format";
import { Alert, Drawer, ErrorState, Loading, SelectField, TextField } from "@/components/ui";

interface Relation {
  id: string; direction: "direct" | "inverse"; relationLabel: string; personPatientId: string | null; personName: string; personFileNo: number | null;
  contactPhone: string | null; isLegalRepresentative: boolean; representationEvidence: string | null; representationVerifiedBy: string | null;
  representationVerifiedAt: string | null; canReceiveInfo: boolean; validUntil: string | null; note: string | null;
}

export function RelationsCard({ patientId, isMinor, onChanged }: { patientId: string; isMinor: boolean; onChanged: () => void }) {
  const { can } = useSession();
  const list = useData<{ items: Relation[] }>(`/patients/${patientId}/relations`);
  const [adding, setAdding] = useState(false);
  const items = list.data?.items ?? [];
  const hasRep = items.some((r) => r.direction === "direct" && r.isLegalRepresentative);

  async function end(r: Relation) {
    const reason = window.prompt("İlişki sonlandırılacak (kayıt silinmez). Neden?");
    if (!reason) return;
    try { await api(`/patients/${patientId}/relations/${r.id}/end`, { body: { reason } }); await list.reload(); onChanged(); }
    catch (e) { window.alert((e as ApiFailure).message); }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Yakınlar ve veli</h2>
        {can("patient.write") && <button className="btn btn-sm" onClick={() => setAdding(true)}><Plus size={15} aria-hidden />Yakın ekle</button>}
      </div>
      {isMinor && !hasRep && <div style={{ padding: "12px 20px 0" }}><Alert kind="warning">18 yaş altı hasta; doğrulanmış yasal temsilci kaydı yok.</Alert></div>}
      {list.loading && !list.data ? <Loading rows={2} /> : list.error ? <ErrorState error={list.error} /> : items.length === 0 ? (
        <p className="card-pad muted">Kayıtlı yakın yok. Ortak telefon kullanan aile bireylerini burada ilişkilendirebilirsiniz.</p>
      ) : (
        <ul className="list">
          {items.map((r) => (
            <li key={r.id} style={{ padding: "12px 20px" }} className="row">
              <Users size={18} aria-hidden color="var(--text-secondary)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  {r.personPatientId ? <Link href={`/hastalar/${r.personPatientId}`}><strong>{r.personName}</strong></Link> : <strong>{r.personName}</strong>}
                  <span className="muted small">{r.direction === "inverse" ? `bu hastanın kaydında “${r.relationLabel}” olarak tanımlı kişi` : r.relationLabel}</span>
                  {r.isLegalRepresentative && <span className="badge badge-primary"><ShieldCheck size={13} aria-hidden />Yasal temsilci</span>}
                  {r.canReceiveInfo && <span className="badge badge-neutral">Bilgi alabilir</span>}
                </div>
                <div className="muted small">
                  {r.contactPhone ? `${formatPhone(r.contactPhone)} · ` : ""}
                  {r.isLegalRepresentative && r.representationEvidence ? `Dayanak: ${r.representationEvidence} (${r.representationVerifiedBy}, ${fmtDate(r.representationVerifiedAt)})` : ""}
                  {r.validUntil ? ` · Geçerlilik: ${fmtDate(r.validUntil)}` : ""}
                </div>
              </div>
              {r.direction === "direct" && can("patient.write") && <button className="btn btn-sm btn-ghost" onClick={() => void end(r)}>Sonlandır</button>}
            </li>
          ))}
        </ul>
      )}
      {adding && <RelationDrawer patientId={patientId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void list.reload(); onChanged(); }} />}
    </section>
  );
}

function RelationDrawer({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<"patient" | "contact">("patient");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<{ id: string; fullName: string } | null>(null);
  const [f, setF] = useState({ relation: "mother", contactName: "", contactPhone: "", isLegalRepresentative: false, representationEvidence: "", canReceiveInfo: false, validUntil: "", note: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useData<{ items: { id: string; fullName: string; fileNo: number }[] }>(mode === "patient" && q.trim().length >= 2 ? `/patients?limit=8&q=${encodeURIComponent(q)}` : null);
  async function save() {
    setBusy(true); setErr(null);
    try {
      await api(`/patients/${patientId}/relations`, { body: {
        relation: f.relation, relatedPatientId: mode === "patient" ? picked?.id : undefined,
        contactName: mode === "contact" ? f.contactName : undefined, contactPhone: mode === "contact" ? f.contactPhone : undefined,
        isLegalRepresentative: f.isLegalRepresentative, representationEvidence: f.representationEvidence || undefined,
        canReceiveInfo: f.canReceiveInfo, validUntil: f.validUntil || undefined, note: f.note || undefined,
      } });
      onSaved();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Yakın ekle" subtitle="Yakınlık tek başına yetki değildir; yasal temsil ayrıca işaretlenir." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || (mode === "patient" && !picked)} onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <div className="row" role="group" aria-label="Yakın türü">
          <button className={`btn btn-sm ${mode === "patient" ? "btn-primary" : ""}`} aria-pressed={mode === "patient"} onClick={() => setMode("patient")}>Kayıtlı hasta</button>
          <button className={`btn btn-sm ${mode === "contact" ? "btn-primary" : ""}`} aria-pressed={mode === "contact"} onClick={() => setMode("contact")}>Kayıtlı olmayan kişi</button>
        </div>
        {mode === "patient" ? (picked ? (
          <div className="alert alert-success"><div style={{ flex: 1 }}><strong>{picked.fullName}</strong></div><button className="btn btn-sm" onClick={() => setPicked(null)}>Değiştir</button></div>
        ) : (
          <div className="field">
            <label htmlFor="rel-q">Hasta ara</label>
            <input id="rel-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, telefon veya dosya no" autoComplete="off" />
            {search.data && (
              <div className="picker-results" role="listbox" aria-label="Hasta sonuçları">
                {search.data.items.filter((p) => p.id !== patientId).map((p) => <button key={p.id} role="option" aria-selected={false} onClick={() => setPicked(p)}><strong>{p.fullName}</strong> <span className="muted small">· #{p.fileNo}</span></button>)}
                {search.data.items.length === 0 && <div className="card-pad muted small">Eşleşen hasta yok.</div>}
              </div>
            )}
          </div>
        )) : (
          <div className="form-grid">
            <TextField label="Ad soyad" required value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} error={err?.fieldErrors.contactName} />
            <TextField label="Telefon" type="tel" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} error={err?.fieldErrors.contactPhone} />
          </div>
        )}
        <SelectField label="Yakınlık" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })}>
          {RELATIONS.map((r) => <option key={r} value={r}>{RELATION_LABELS[r]}</option>)}
        </SelectField>
        <label className="row"><input type="checkbox" checked={f.canReceiveInfo} onChange={(e) => setF({ ...f, canReceiveInfo: e.target.checked })} /> Randevu ve idari bilgi alabilir</label>
        <label className="row"><input type="checkbox" checked={f.isLegalRepresentative} onChange={(e) => setF({ ...f, isLegalRepresentative: e.target.checked })} /> Yasal temsilci (veli/vasi)</label>
        {f.isLegalRepresentative && (
          <>
            <TextField label="Dayanak" required value={f.representationEvidence} onChange={(e) => setF({ ...f, representationEvidence: e.target.value })}
              error={err?.fieldErrors.representationEvidence} hint="Görülen belgeyi açıklayın (örn. nüfus kayıt örneği). Belge yükleme Görev 4'te." />
            <TextField label="Geçerlilik sonu" type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} hint="Örn. vesayet kararı süresi" />
            <p className="small muted">Kaydeden kullanıcı ve zaman doğrulayan olarak kayda geçer.</p>
          </>
        )}
      </div>
    </Drawer>
  );
}
