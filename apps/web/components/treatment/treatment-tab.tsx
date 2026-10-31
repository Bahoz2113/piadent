"use client";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, FilePlus2, History, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import {
  ALL_TEETH, DECISION_LABELS, FINDING_LABELS, FINDING_TYPES, PLAN_STATUS_LABELS, TOOTH_SCOPE_LABELS,
  formatTRY, locationLabel, validSurfaces, type DentalLocation, type FindingType, type Surface, type ToothScope,
} from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Alert, Drawer, EmptyState, ErrorState, Loading, SelectField, TextAreaField, TextField } from "@/components/ui";
import { Odontogram, type ToothState } from "./odontogram";

interface Loc { kind: string; tooth: string | null; surfaces: string[]; quadrant: number | null; arch: string | null }
interface Item { id: string; procedureId: string; code: string; name: string; location: Loc; quantity: number; unitPrice: string; priceSource: string; priceNote: string | null;
  discount: string; discountReason: string | null; lineTotal: string; sessionNo: number; performedQty: number }
interface Version { id: string; version: number; status: string; proposedAt: string | null; decidedAt: string | null; statusReason: string | null; createdAt: string;
  practitionerId: string; practitionerName: string; tariffName: string | null; total: string; discountTotal: string; items: Item[];
  decisions: { decision: string; note: string | null; at: string; by: string }[] }
interface Plan { id: string; title: string; createdAt: string; createdBy: string; versions: Version[] }
interface Chart {
  findings: { id: string; tooth: string; surfaces: string[]; type: FindingType; note: string | null; status: string; at: string; by: string }[];
  diagnoses: { id: string; location: Loc; code: string | null; description: string; status: string; at: string; by: string }[];
  planned: { id: string; code: string; name: string; location: Loc; quantity: number; performedQty: number; versionStatus: string }[];
  performed: { id: string; code: string; name: string; location: Loc; quantity: number; amount: string; status: string; statusReason: string | null; at: string; planItemId: string | null;
    correctsId: string | null; note: string | null; practitioner: string; visitAt: string; imported?: boolean }[];
}
interface Procedure { id: string; code: string; name: string; category: string | null; toothScope: ToothScope }

const STATUS_BADGE: Record<string, string> = { draft: "neutral", proposed: "info", accepted: "success", rejected: "error", superseded: "neutral", cancelled: "neutral" };
const TEETH = [...ALL_TEETH].sort();

export function TreatmentTab({ patientId, onChanged }: { patientId: string; onChanged: () => void }) {
  const { can } = useSession();
  const health = can("patient.health.read");
  const chart = useData<Chart>(health ? `/patients/${patientId}/chart` : null);
  const plans = useData<{ items: Plan[] }>(`/patients/${patientId}/plans`);
  const procs = useData<{ items: Procedure[] }>("/procedures");
  const [dentition, setDentition] = useState<"permanent" | "primary" | "mixed">("permanent");
  const [tooth, setTooth] = useState<string | null>(null);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [drawer, setDrawer] = useState<null | { kind: "finding" | "diagnosis" | "plan" } | { kind: "item"; versionId: string; practitionerId: string }>(null);
  const reload = () => { void chart.reload(); void plans.reload(); onChanged(); };

  const states = useMemo(() => {
    const out: Record<string, ToothState> = {};
    const get = (t: string) => (out[t] ??= { findings: [], planned: 0, done: 0, diagnoses: 0 });
    for (const f of chart.data?.findings ?? []) if (f.status === "current") get(f.tooth).findings.push({ type: f.type, surfaces: f.surfaces });
    for (const d of chart.data?.diagnoses ?? []) if (d.status === "active" && d.location.tooth) get(d.location.tooth).diagnoses++;
    for (const p of chart.data?.planned ?? []) if (p.location.tooth && p.performedQty < p.quantity) get(p.location.tooth).planned++;
    for (const p of chart.data?.performed ?? []) if (p.status === "completed" && p.location.tooth) get(p.location.tooth).done++;
    return out;
  }, [chart.data]);

  const draftVersion = plans.data?.items.flatMap((p) => p.versions).find((v) => v.status === "draft");

  return (
    <div className="stack" style={{ gap: 16 }}>
      {health ? (
        <section className="card">
          <div className="card-head">
            <div><h2>Odontogram</h2><p className="muted small">Bulgu, tanı, plan ve gerçekleşen işlem ayrı katmanlardır. Dişe tıklayın; seçili dişte yüzeye tıklayarak yüzey seçin.</p></div>
            <div className="row" role="group" aria-label="Diş dizisi">
              {(["permanent", "primary", "mixed"] as const).map((d) => (
                <button key={d} className={`btn btn-sm ${dentition === d ? "btn-primary" : ""}`} aria-pressed={dentition === d} onClick={() => setDentition(d)}>
                  {{ permanent: "Daimi", primary: "Süt", mixed: "Karma" }[d]}
                </button>
              ))}
            </div>
          </div>
          {chart.loading && !chart.data ? <Loading /> : chart.error ? <ErrorState error={chart.error} /> : (
            <div className="card-pad">
              <Odontogram dentition={dentition} states={states} selected={tooth} selectedSurfaces={surfaces}
                onSelect={(t) => { setTooth(t === tooth ? null : t); setSurfaces([]); }}
                onSurface={(t, s) => setSurfaces((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))} />
              {tooth && <ToothPanel tooth={tooth} surfaces={surfaces} chart={chart.data!} canWrite={can("diagnosis.write")} canPlan={!!draftVersion && can("treatment.write")}
                onAdd={(k) => setDrawer(k === "item" && draftVersion ? { kind: "item", versionId: draftVersion.id, practitionerId: draftVersion.practitionerId } : { kind: k as "finding" | "diagnosis" })} />}
            </div>
          )}
        </section>
      ) : (
        <Alert kind="info">Klinik harita (odontogram, tanı) rolünüze kapalı. Tedavi planlarını ve teklif durumunu aşağıda görebilirsiniz.</Alert>
      )}

      <section className="card">
        <div className="card-head">
          <div><h2>Tedavi planları</h2><p className="muted small">Kabul edilen sürüm değişmez; değişiklik yeni sürümle yapılır. Planlanan bedel gerçekleşen gelir değildir.</p></div>
          {can("treatment.write") && <button className="btn btn-primary btn-sm" onClick={() => setDrawer({ kind: "plan" })}><FilePlus2 size={16} aria-hidden />Yeni plan</button>}
        </div>
        {plans.loading && !plans.data ? <Loading /> : plans.error ? <ErrorState error={plans.error} /> : plans.data!.items.length === 0 ? (
          <EmptyState icon={<ClipboardList size={28} aria-hidden />} title="Tedavi planı yok" />
        ) : plans.data!.items.map((p) => (
          <PlanCard key={p.id} plan={p} patientId={patientId} onChanged={reload}
            onAddItem={(v) => setDrawer({ kind: "item", versionId: v.id, practitionerId: v.practitionerId })} />
        ))}
      </section>

      {health && chart.data && chart.data.performed.length > 0 && <PerformedCard chart={chart.data} canWrite={can("procedure.complete")} onChanged={reload} />}

      {drawer?.kind === "plan" && <NewPlanDrawer patientId={patientId} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); reload(); }} />}
      {drawer?.kind === "item" && procs.data && (
        <ItemDrawer versionId={drawer.versionId} practitionerId={drawer.practitionerId} procedures={procs.data.items}
          prefill={tooth ? { kind: "tooth", tooth, surfaces } : undefined} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); reload(); }} />
      )}
      {drawer?.kind === "finding" && tooth && <FindingDrawer patientId={patientId} tooth={tooth} surfaces={surfaces} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); setSurfaces([]); reload(); }} />}
      {drawer?.kind === "diagnosis" && <DiagnosisDrawer patientId={patientId} tooth={tooth} surfaces={surfaces} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); reload(); }} />}
    </div>
  );
}

function ToothPanel({ tooth, surfaces, chart, canWrite, canPlan, onAdd }: { tooth: string; surfaces: Surface[]; chart: Chart; canWrite: boolean; canPlan: boolean; onAdd: (k: "finding" | "diagnosis" | "item") => void }) {
  const f = chart.findings.filter((x) => x.tooth === tooth);
  const d = chart.diagnoses.filter((x) => x.location.tooth === tooth);
  const p = chart.planned.filter((x) => x.location.tooth === tooth);
  const done = chart.performed.filter((x) => x.location.tooth === tooth);
  return (
    <div className="card" style={{ marginTop: 12, boxShadow: "none" }}>
      <div className="card-head">
        <h3>Diş {tooth}{surfaces.length ? ` · seçili yüzey: ${surfaces.join("")}` : ""}</h3>
        <div className="row">
          {canWrite && <button className="btn btn-sm" onClick={() => onAdd("finding")}>Bulgu ekle</button>}
          {canWrite && <button className="btn btn-sm" onClick={() => onAdd("diagnosis")}>Tanı ekle</button>}
          {canPlan && <button className="btn btn-sm btn-primary" onClick={() => onAdd("item")}>Taslak plana ekle</button>}
        </div>
      </div>
      <div className="card-pad grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div><h4 className="small muted">Mevcut durum</h4>{f.length ? f.map((x) => <p key={x.id} className="small">{FINDING_LABELS[x.type]}{x.surfaces.length ? ` (${x.surfaces.join("")})` : ""}{x.status === "historic" ? " · geçmiş" : ""}{x.note ? ` — ${x.note}` : ""}</p>) : <p className="small muted">Kayıt yok</p>}</div>
        <div><h4 className="small muted">Tanılar</h4>{d.length ? d.map((x) => <p key={x.id} className="small">{x.description}{x.status === "resolved" ? " · çözüldü" : ""}</p>) : <p className="small muted">Kayıt yok</p>}</div>
        <div><h4 className="small muted">Planlı</h4>{p.length ? p.map((x) => <p key={x.id} className="small">{x.code} {x.name} · {x.performedQty}/{x.quantity}{x.versionStatus === "proposed" ? " · teklif" : ""}</p>) : <p className="small muted">Kayıt yok</p>}</div>
        <div><h4 className="small muted">Gerçekleşen</h4>{done.length ? done.map((x) => <p key={x.id} className="small">{x.code} · {fmtDate(x.at)}{x.status !== "completed" ? ` · ${x.status === "cancelled" ? "iptal" : "düzeltildi"}` : ""}</p>) : <p className="small muted">Kayıt yok</p>}</div>
      </div>
    </div>
  );
}

function PlanCard({ plan, patientId, onChanged, onAddItem }: { plan: Plan; patientId: string; onChanged: () => void; onAddItem: (v: Version) => void }) {
  const order = ["draft", "proposed", "accepted"];
  const primary = [...plan.versions].sort((a, b) => (order.indexOf(a.status) + 1 || 9) - (order.indexOf(b.status) + 1 || 9) || b.version - a.version)[0]!;
  const others = plan.versions.filter((v) => v.id !== primary.id);
  return (
    <div className="plan-version" style={{ borderTop: "1px solid var(--border)" }}>
      <div style={{ padding: "14px 20px 0" }}>
        <strong>{plan.title}</strong> <span className="muted small">· {plan.createdBy} · {fmtDate(plan.createdAt)}</span>
      </div>
      <VersionView v={primary} plan={plan} patientId={patientId} onChanged={onChanged} onAddItem={onAddItem} />
      {others.length > 0 && (
        <details className="plan-version">
          <summary className="small"><History size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Sürüm geçmişi ({others.length})</summary>
          {others.map((v) => <VersionView key={v.id} v={v} plan={plan} patientId={patientId} onChanged={onChanged} onAddItem={onAddItem} readOnly />)}
        </details>
      )}
    </div>
  );
}

function VersionView({ v, plan, patientId, onChanged, onAddItem, readOnly }: { v: Version; plan: Plan; patientId: string; onChanged: () => void; onAddItem: (v: Version) => void; readOnly?: boolean }) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [decision, setDecision] = useState(false);
  const [perform, setPerform] = useState<Item | null>(null);
  const hasDraft = plan.versions.some((x) => x.status === "draft");
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); onChanged(); } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  const editable = v.status === "draft" && can("treatment.write") && !readOnly;
  return (
    <div style={{ padding: "8px 20px 16px" }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className={`badge badge-${STATUS_BADGE[v.status]}`}>Sürüm {v.version} · {PLAN_STATUS_LABELS[v.status]}</span>
          <span className="muted small">{v.practitionerName}{v.tariffName ? ` · ${v.tariffName}` : ""}{v.proposedAt ? ` · teklif ${fmtDate(v.proposedAt)}` : ""}{v.decidedAt ? ` · karar ${fmtDate(v.decidedAt)}` : ""}</span>
        </div>
        {!readOnly && (
          <div className="row">
            {editable && <button className="btn btn-sm" onClick={() => onAddItem(v)}><Plus size={15} aria-hidden />Kalem ekle</button>}
            {editable && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void run(() => api(`/plan-versions/${v.id}/reprice`, { body: {} }))} title="Tarife kaynaklı fiyatları güncel tarifeden yenile"><RefreshCw size={15} aria-hidden />Fiyatları yenile</button>}
            {editable && <button className="btn btn-sm btn-primary" disabled={busy || v.items.length === 0} onClick={() => void run(() => api(`/plan-versions/${v.id}/propose`, { body: {} }))}><Send size={15} aria-hidden />Teklif olarak sun</button>}
            {v.status === "proposed" && can("treatment.decision") && <button className="btn btn-sm btn-primary" onClick={() => setDecision(true)}>Hasta kararını kaydet</button>}
            {["proposed", "accepted", "rejected"].includes(v.status) && !hasDraft && can("treatment.write") && (
              <button className="btn btn-sm" disabled={busy} onClick={() => void run(() => api(`/plans/${plan.id}/versions`, { body: {} }))}>Yeni sürüm</button>
            )}
          </div>
        )}
      </div>
      {err && <Alert kind="error">{err.message}</Alert>}
      {v.statusReason && <p className="small muted">Not: {v.statusReason}</p>}
      {v.items.length === 0 ? <p className="muted small">Kalem yok.</p> : (
        <div className="table-wrap" tabIndex={0}>
          <table className="table table-wide">
            <thead><tr><th>Seans</th><th>İşlem</th><th>Konum</th><th className="money">Adet</th><th className="money">Birim</th><th className="money">İndirim</th><th className="money">Tutar</th><th>Durum</th><th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>
              {v.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.sessionNo}</td>
                  <td><strong>{i.code}</strong> {i.name}{i.priceSource === "manual" && <div className="small muted">Elle fiyat: {i.priceNote}</div>}</td>
                  <td>{locationLabel(i.location)}</td>
                  <td className="money">{i.quantity}</td>
                  <td className="money">{formatTRY(i.unitPrice)}</td>
                  <td className="money">{i.discount !== "0.00" ? <span title={i.discountReason ?? ""}>−{formatTRY(i.discount)}</span> : "—"}</td>
                  <td className="money">{formatTRY(i.lineTotal)}</td>
                  <td>{i.performedQty >= i.quantity ? <span className="badge badge-success"><CheckCircle2 size={13} aria-hidden />Tamam</span> : i.performedQty > 0 ? <span className="badge badge-info">{i.performedQty}/{i.quantity}</span> : <span className="muted small">Bekliyor</span>}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {editable && <button className="btn btn-sm btn-ghost icon-btn" aria-label={`${i.code} kalemini sil`} disabled={busy} onClick={() => void run(() => api(`/plan-items/${i.id}`, { method: "DELETE" }))}><Trash2 size={15} /></button>}
                    {v.status === "accepted" && !readOnly && can("procedure.complete") && i.performedQty < i.quantity && <button className="btn btn-sm" onClick={() => setPerform(i)}>Gerçekleştir</button>}
                  </td>
                </tr>
              ))}
              <tr className="total-row"><td colSpan={5}>Toplam{v.discountTotal !== "0.00" ? ` (indirim −${formatTRY(v.discountTotal)})` : ""}</td><td /><td className="money">{formatTRY(v.total)}</td><td colSpan={2} /></tr>
            </tbody>
          </table>
        </div>
      )}
      {v.decisions.length > 0 && <p className="small muted" style={{ marginTop: 6 }}>Kararlar: {v.decisions.map((d) => `${DECISION_LABELS[d.decision]} (${d.by}, ${fmtDateTime(d.at)}${d.note ? ` — ${d.note}` : ""})`).join(" · ")}</p>}
      {decision && <DecisionDrawer versionId={v.id} onClose={() => setDecision(false)} onSaved={() => { setDecision(false); onChanged(); }} />}
      {perform && <PerformDrawer item={perform} patientId={patientId} onClose={() => setPerform(null)} onSaved={() => { setPerform(null); onChanged(); }} />}
    </div>
  );
}

function PerformedCard({ chart, canWrite, onChanged }: { chart: Chart; canWrite: boolean; onChanged: () => void }) {
  const { tz } = useSession();
  async function cancel(id: string) {
    const reason = window.prompt("Kayıt silinmez; 'iptal' olarak işaretlenir. Gerekçe:");
    if (!reason) return;
    try { await api(`/performed/${id}/cancel`, { body: { reason } }); onChanged(); } catch (e) { window.alert((e as ApiFailure).message); }
  }
  return (
    <section className="card">
      <div className="card-head"><div><h2>Gerçekleşen işlemler</h2><p className="muted small">Her kayıt bir ziyarete bağlıdır. Bedel, işlem anındaki snapshot'tır; hasta hesabına aktarımı Finans modülünde (Görev 3).</p></div></div>
      <div className="table-wrap" tabIndex={0}>
        <table className="table table-wide">
          <thead><tr><th>Tarih</th><th>İşlem</th><th>Konum</th><th className="money">Adet</th><th className="money">Bedel</th><th>Hekim</th><th>Durum</th><th><span className="sr-only">İşlem</span></th></tr></thead>
          <tbody>
            {chart.performed.map((p) => (
              <tr key={p.id} style={p.status !== "completed" ? { color: "var(--text-secondary)" } : undefined}>
                <td>{fmtDateTime(p.at, tz)}</td>
                <td><strong>{p.code}</strong> {p.name}{p.correctsId && <div className="small muted">Düzeltme kaydı</div>}{p.imported && <div className="small muted">Önceki sistemden aktarıldı · bedel bilgi amaçlı, alacak yok</div>}</td>
                <td>{locationLabel(p.location)}</td>
                <td className="money">{p.quantity}</td>
                <td className="money">{formatTRY(p.amount)}</td>
                <td>{p.practitioner}</td>
                <td>{p.status === "completed" ? <span className="badge badge-success">Tamamlandı</span> : <span className="badge badge-neutral" title={p.statusReason ?? ""}>{p.status === "cancelled" ? "İptal" : "Düzeltildi"}</span>}</td>
                <td>{canWrite && p.status === "completed" && <button className="btn btn-sm btn-ghost" onClick={() => void cancel(p.id)}>İptal et</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------ çekmeceler
function NewPlanDrawer({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: () => void }) {
  const res = useData<{ practitioners: { id: string; name: string }[] }>("/resources");
  const [title, setTitle] = useState("Tedavi planı");
  const [prac, setPrac] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  useEffect(() => { if (!prac && res.data?.practitioners[0]) setPrac(res.data.practitioners[0].id); }, [res.data, prac]);
  async function save() {
    try { await api(`/patients/${patientId}/plans`, { body: { title, practitionerId: prac } }); onSaved(); } catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title="Yeni tedavi planı" subtitle="Taslak sürüm 1 oluşturulur; fiyatlar hekimin geçerli tarifesinden gelir." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Oluştur</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <TextField label="Plan adı" required value={title} onChange={(e) => setTitle(e.target.value)} error={err?.fieldErrors.title} />
        <SelectField label="Sorumlu hekim" required value={prac} onChange={(e) => setPrac(e.target.value)}>
          {res.data?.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
      </div>
    </Drawer>
  );
}

function LocationEditor({ scope, loc, onChange }: { scope: ToothScope; loc: DentalLocation; onChange: (l: DentalLocation) => void }) {
  if (scope === "mouth") return <p className="small muted">Konum: tüm ağız</p>;
  if (scope === "arch") return (
    <SelectField label="Çene" value={loc.arch ?? "upper"} onChange={(e) => onChange({ kind: "arch", arch: e.target.value as "upper" | "lower" })}>
      <option value="upper">Üst çene</option><option value="lower">Alt çene</option>
    </SelectField>
  );
  if (scope === "quadrant") return (
    <SelectField label="Çeyrek" value={String(loc.quadrant ?? 1)} onChange={(e) => onChange({ kind: "quadrant", quadrant: Number(e.target.value) })}>
      {[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q}. çeyrek</option>)}
    </SelectField>
  );
  const tooth = loc.tooth ?? "";
  const valid = tooth ? validSurfaces(tooth) : [];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <SelectField label="Diş (FDI)" required value={tooth} onChange={(e) => onChange({ kind: "tooth", tooth: e.target.value, surfaces: [] })}>
        <option value="">Seçin</option>
        {TEETH.map((t) => <option key={t} value={t}>{t}</option>)}
      </SelectField>
      {scope === "surface" && tooth && (
        <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Yüzeyler</legend>
          {valid.map((s) => (
            <label key={s} className="row small" style={{ gap: 4, marginRight: 10 }}>
              <input type="checkbox" checked={(loc.surfaces ?? []).includes(s)} onChange={(e) => onChange({ kind: "tooth", tooth, surfaces: e.target.checked ? [...(loc.surfaces ?? []), s] : (loc.surfaces ?? []).filter((x) => x !== s) })} />{s}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

function defaultLoc(scope: ToothScope, prefill?: DentalLocation): DentalLocation {
  if (scope === "tooth" || scope === "surface") return { kind: "tooth", tooth: prefill?.tooth, surfaces: scope === "surface" ? prefill?.surfaces?.filter((s) => prefill.tooth && validSurfaces(prefill.tooth).includes(s)) ?? [] : [] };
  if (scope === "quadrant") return { kind: "quadrant", quadrant: 1 };
  if (scope === "arch") return { kind: "arch", arch: "upper" };
  return { kind: "mouth" };
}

function ItemDrawer({ versionId, practitionerId, procedures, prefill, onClose, onSaved }: {
  versionId: string; practitionerId: string; procedures: Procedure[]; prefill?: DentalLocation; onClose: () => void; onSaved: () => void;
}) {
  const [procId, setProcId] = useState("");
  const proc = procedures.find((p) => p.id === procId);
  const [loc, setLoc] = useState<DentalLocation>({ kind: "mouth" });
  const [f, setF] = useState({ quantity: "1", sessionNo: "1", discount: "", discountReason: "", manualPrice: "", priceNote: "" });
  const price = useData<{ price: string | null }>(procId ? `/price?procedureId=${procId}&practitionerId=${practitionerId}` : null);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (proc) setLoc(defaultLoc(proc.toothScope, prefill)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [procId]);
  const needManual = !!procId && price.data && price.data.price === null;
  async function save() {
    setBusy(true); setErr(null);
    try {
      await api(`/plan-versions/${versionId}/items`, { body: {
        procedureId: procId, location: loc, quantity: Number(f.quantity), sessionNo: Number(f.sessionNo),
        discount: f.discount || undefined, discountReason: f.discountReason || undefined,
        manualPrice: f.manualPrice || undefined, priceNote: f.priceNote || undefined,
      } });
      onSaved();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  const groups = [...new Set(procedures.map((p) => p.category ?? "Diğer"))];
  return (
    <Drawer title="Plana kalem ekle" subtitle="Fiyat, tarifeden snapshot olarak alınır; teklif sunulduktan sonra değişmez." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !procId} onClick={() => void save()}>Ekle</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <SelectField label="İşlem" required value={procId} onChange={(e) => setProcId(e.target.value)} error={err?.fieldErrors.procedureId}>
          <option value="">Seçin</option>
          {groups.map((g) => <optgroup key={g} label={g}>{procedures.filter((p) => (p.category ?? "Diğer") === g).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</optgroup>)}
        </SelectField>
        {proc && <p className="small muted">Kapsam: {TOOTH_SCOPE_LABELS[proc.toothScope]} · Tarife fiyatı: {price.loading ? "…" : price.data?.price ? formatTRY(price.data.price) : "tarifede yok"}</p>}
        {proc && <LocationEditor scope={proc.toothScope} loc={loc} onChange={setLoc} />}
        {(err?.fieldErrors.location || err?.fieldErrors["location.tooth"]) && <Alert kind="error">{err.fieldErrors.location ?? err.fieldErrors["location.tooth"]}</Alert>}
        <div className="form-grid">
          <TextField label="Adet" type="number" min={1} max={50} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
          <TextField label="Seans no" type="number" min={1} max={50} value={f.sessionNo} onChange={(e) => setF({ ...f, sessionNo: e.target.value })} />
          <TextField label="İndirim (₺)" inputMode="decimal" placeholder="0.00" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value.replace(",", ".") })} error={err?.fieldErrors.discount} />
          <TextField label="İndirim gerekçesi" value={f.discountReason} onChange={(e) => setF({ ...f, discountReason: e.target.value })} error={err?.fieldErrors.discountReason} />
        </div>
        {(needManual || f.manualPrice) && (
          <div className="form-grid">
            <TextField label="Elle birim fiyat (₺)" inputMode="decimal" required={!!needManual} value={f.manualPrice} onChange={(e) => setF({ ...f, manualPrice: e.target.value.replace(",", ".") })} error={err?.fieldErrors.manualPrice} />
            <TextField label="Fiyat açıklaması" required value={f.priceNote} onChange={(e) => setF({ ...f, priceNote: e.target.value })} error={err?.fieldErrors.priceNote} />
          </div>
        )}
      </div>
    </Drawer>
  );
}

function DecisionDrawer({ versionId, onClose, onSaved }: { versionId: string; onClose: () => void; onSaved: () => void }) {
  const [decision, setDecision] = useState<"accepted" | "rejected" | "undecided">("accepted");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function save() {
    try { await api(`/plan-versions/${versionId}/decision`, { body: { decision, note: note || undefined } }); onSaved(); } catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title="Hasta kararını kaydet" subtitle="Bu kayıt hastanın beyanıdır; imzalı onam belgesi değildir (Görev 4)." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack">
          <legend className="small" style={{ fontWeight: 600 }}>Karar</legend>
          {(["accepted", "rejected", "undecided"] as const).map((d) => (
            <label key={d} className="row"><input type="radio" name="decision" checked={decision === d} onChange={() => setDecision(d)} /> {DECISION_LABELS[d]}{d === "undecided" ? " (teklif açık kalır)" : ""}</label>
          ))}
        </fieldset>
        <TextAreaField label="Not" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </div>
    </Drawer>
  );
}

function PerformDrawer({ item, patientId, onClose, onSaved }: { item: Item; patientId: string; onClose: () => void; onSaved: () => void }) {
  const { tz } = useSession();
  const visits = useData<{ items: { id: string; startsAt: string; status: string; practitionerName: string }[] }>(`/patients/${patientId}/visits`);
  const remaining = item.quantity - item.performedQty;
  const [visit, setVisit] = useState("");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  useEffect(() => { if (!visit && visits.data?.items[0]) setVisit(visits.data.items[0].id); }, [visits.data, visit]);
  async function save() {
    try { await api(`/patients/${patientId}/performed`, { body: { appointmentId: visit, planItemId: item.id, quantity: Number(qty), note: note || undefined } }); onSaved(); }
    catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title="İşlemi gerçekleştir" subtitle={`${item.code} · ${item.name} · ${locationLabel(item.location)}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={!visit} onClick={() => void save()}>Tamamlandı olarak kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        {visits.data && visits.data.items.length === 0 ? (
          <Alert kind="warning">Bu hastanın geliş kaydı yapılmış ziyareti yok. Önce ajandada randevuyu “Geldi” olarak işaretleyin.</Alert>
        ) : (
          <SelectField label="Ziyaret" required value={visit} onChange={(e) => setVisit(e.target.value)} error={err?.fieldErrors.appointmentId}>
            {visits.data?.items.map((v) => <option key={v.id} value={v.id}>{fmtDateTime(v.startsAt, tz)} · {v.practitionerName}</option>)}
          </SelectField>
        )}
        <TextField label={`Adet (kalan ${remaining})`} type="number" min={1} max={remaining} value={qty} onChange={(e) => setQty(e.target.value)} error={err?.fieldErrors.quantity} />
        <TextAreaField label="Not" value={note} onChange={(e) => setNote(e.target.value)} rows={2} hint="Klinik ayrıntı için Sağlık sekmesindeki klinik notu kullanın." />
      </div>
    </Drawer>
  );
}

function FindingDrawer({ patientId, tooth, surfaces, onClose, onSaved }: { patientId: string; tooth: string; surfaces: Surface[]; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<FindingType>("caries");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function save() {
    try { await api(`/patients/${patientId}/findings`, { body: { tooth, surfaces, findingType: type, note: note || undefined } }); onSaved(); } catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title={`Bulgu ekle · Diş ${tooth}`} subtitle={surfaces.length ? `Yüzey: ${surfaces.join("")}` : "Tüm diş (yüzey seçilmedi)"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}{err.fieldErrors.surfaces ? ` ${err.fieldErrors.surfaces}` : ""}</Alert>}
        <Alert kind="info">Bulgu türleri DEMO listesidir; klinik terminoloji pilot hekimle doğrulanacak.</Alert>
        <SelectField label="Bulgu" value={type} onChange={(e) => setType(e.target.value as FindingType)}>
          {FINDING_TYPES.map((t) => <option key={t} value={t}>{FINDING_LABELS[t]}</option>)}
        </SelectField>
        <TextField label="Not" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Drawer>
  );
}

function DiagnosisDrawer({ patientId, tooth, surfaces, onClose, onSaved }: { patientId: string; tooth: string | null; surfaces: Surface[]; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"tooth" | "mouth">(tooth ? "tooth" : "mouth");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function save() {
    const location = kind === "tooth" && tooth ? { kind: "tooth", tooth, surfaces } : { kind: "mouth" };
    try { await api(`/patients/${patientId}/diagnoses`, { body: { location, description, code: code || undefined } }); onSaved(); } catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title="Tanı ekle" onClose={onClose} dirty={!!description}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <SelectField label="Konum" value={kind} onChange={(e) => setKind(e.target.value as "tooth" | "mouth")}>
          {tooth && <option value="tooth">Diş {tooth}{surfaces.length ? ` (${surfaces.join("")})` : ""}</option>}
          <option value="mouth">Tüm ağız / genel</option>
        </SelectField>
        <TextAreaField label="Tanı açıklaması" required value={description} onChange={(e) => setDescription(e.target.value)} error={err?.fieldErrors.description} rows={3} />
        <TextField label="Kod (isteğe bağlı)" value={code} onChange={(e) => setCode(e.target.value)} hint="Kod sistemi henüz seçilmedi; kliniğin kendi kısaltması girilebilir." />
      </div>
    </Drawer>
  );
}
