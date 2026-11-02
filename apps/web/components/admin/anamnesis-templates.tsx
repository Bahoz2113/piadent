"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { ANAMNESIS_TEMPLATE_STATUS_LABELS, type AnamnesisQuestion } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { useSession } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";
import { Alert, ErrorState, Loading, TextAreaField, TextField } from "@/components/ui";

type Notify = (k: "success" | "error", t: string) => void;
interface Tpl { id: string; version: number; status: "draft" | "published" | "retired"; title: string; note: string | null; questions: AnamnesisQuestion[]; createdAt: string; createdBy: string; publishedAt: string | null; publishedBy: string | null; retiredAt: string | null; usageCount: number }
interface Data { items: Tpl[]; active: { templateId: string | null; version: string; title: string; demo: boolean; questions: AnamnesisQuestion[] }; builtin: { version: string; questions: AnamnesisQuestion[] } }

/**
 * Anamnez şablonu (ADR-084): yönetici/hekim taslak hazırlar, HEKİM yayınlar. Yayınlanan sürüm değişmez; eski hasta kayıtları kendi
 * sürümüne bağlı kalır. Soru metinleri kliniğin kendi klinik içeriğidir.
 */
export function AnamnesisTemplatesPanel({ notify }: { notify: Notify }) {
  const { can } = useSession();
  const d = useData<Data>("/anamnesis-templates");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const draft = d.data?.items.find((t) => t.status === "draft") ?? null;
  const [title, setTitle] = useState(""); const [note, setNote] = useState(""); const [qs, setQs] = useState<AnamnesisQuestion[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (draft) { setTitle(draft.title); setNote(draft.note ?? ""); setQs(draft.questions); } }, [draft?.id, draft?.questions, draft?.title, draft?.note]);
  async function run(fn: () => Promise<unknown>, ok: string) { setBusy(true); setErr(null); try { await fn(); notify("success", ok); await d.reload(); } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); } }
  if (d.loading && !d.data) return <Loading />;
  if (d.error || !d.data) return <ErrorState error={d.error!} />;
  const data = d.data;
  const slug = (s: string) => {
    const base = s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/[çğöşü]/g, (c) => ({ ç: "c", ğ: "g", ö: "o", ş: "s", ü: "u" })[c]!).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]/, "q$&");
    if (base.length <= 40) return base;
    let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; // uzun etiketlerde kısaltma çakışmasın
    return `${base.slice(0, 32).replace(/_+$/, "")}_${h.toString(36).slice(0, 6)}`;
  };
  const setQ = (i: number, patch: Partial<AnamnesisQuestion>) => setQs((xs) => xs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, dir: -1 | 1) => setQs((xs) => { const y = [...xs]; const j = i + dir; if (j < 0 || j >= y.length) return y; [y[i], y[j]] = [y[j]!, y[i]!]; return y; });
  const save = () => run(() => api(`/anamnesis-templates/${draft!.id}`, { method: "PATCH", body: { title, note: note || undefined, questions: qs.map((q) => ({ key: q.key || slug(q.label), label: q.label, critical: q.critical, detailHint: q.detailHint || undefined })) } }), "Taslak kaydedildi.");
  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div><h2>Anamnez soru şablonu</h2>
            <p className="muted small">Yürürlükte: <strong>{data.active.title}</strong> ({data.active.version}, {data.active.questions.length} soru){data.active.demo && <> · <span className="badge badge-warning">yerleşik DEMO</span></>}. Yayınlanan sürüm değişmez; değişiklik yeni sürümle yayınlanır. Yayın yetkisi hekimdedir.</p></div>
          {!draft && can("anamnesis.template") && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run(() => api("/anamnesis-templates", { body: {} }), "Yürürlükteki setin kopyasıyla taslak açıldı.")}><Plus size={15} aria-hidden />Yeni sürüm taslağı</button>}
        </div>
        {err && <div style={{ padding: "0 20px 12px" }}><Alert kind="error">{err.message}{err.fieldErrors.questions && <div className="small">{err.fieldErrors.questions}</div>}</Alert></div>}
        {draft && (
          <div className="card-pad stack">
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <strong>Taslak · sürüm {draft.version}</strong>
              <span className="small muted">{draft.createdBy} · {fmtDateTime(draft.createdAt)}</span>
            </div>
            <TextField label="Form başlığı" required value={title} onChange={(e) => setTitle(e.target.value)} error={err?.fieldErrors.title} />
            <TextAreaField label="Not (hekim için; hastaya gösterilmez)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="field"><span className="label">Sorular ({qs.length})</span>
              <ol className="stack" style={{ margin: 0, padding: 0, listStyle: "none", gap: 8 }}>
                {qs.map((q, i) => (
                  <li key={i} className="row" style={{ gap: 6, alignItems: "flex-end", flexWrap: "wrap", padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                    <span className="small muted" style={{ width: 22 }}>{i + 1}.</span>
                    <TextField label="Soru" value={q.label} onChange={(e) => setQ(i, { label: e.target.value, key: q.key || slug(e.target.value) })} style={{ minWidth: 260, flex: 1 }} />
                    <TextField label="Ayrıntı ipucu" value={q.detailHint ?? ""} onChange={(e) => setQ(i, { detailHint: e.target.value })} style={{ width: 180 }} />
                    <label className="row small" style={{ gap: 6, minHeight: 38, alignItems: "center" }}><input type="checkbox" checked={q.critical} onChange={(e) => setQ(i, { critical: e.target.checked })} /> Kritik</label>
                    <span className="row" style={{ gap: 2 }}>
                      <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={`Soru ${i + 1} yukarı`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                      <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={`Soru ${i + 1} aşağı`} disabled={i === qs.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                      <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={`Soru ${i + 1} sil`} disabled={qs.length === 1} onClick={() => setQs((xs) => xs.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                    </span>
                    <span className="small muted" style={{ width: "100%" }}>anahtar: <code>{q.key || slug(q.label) || "—"}</code>{q.critical && " · kritik: Evet yanıtı hasta başlığında uyarı rozeti olur"}</span>
                  </li>))}
              </ol>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setQs((xs) => [...xs, { key: "", label: "", critical: false }])}><Plus size={14} aria-hidden />Soru ekle</button>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Taslağı kaydet</button>
              {can("anamnesis.review") ? <button className="btn" disabled={busy} onClick={() => void run(async () => { await save(); await api(`/anamnesis-templates/${draft.id}/publish`, { body: {} }); }, "Şablon yayınlandı; yeni anamnezler bu formla alınır.")}><CheckCircle2 size={15} aria-hidden />Hekim olarak yayınla</button>
                : <span className="small muted">Yayını yalnız hekim yapabilir (klinik içerik onayı).</span>}
              {can("anamnesis.review") && <button className="btn btn-ghost" disabled={busy} onClick={() => void run(() => api(`/anamnesis-templates/${draft.id}/retire`, { body: {} }), "Taslak kapatıldı.")}>Taslağı kapat</button>}
            </div>
          </div>
        )}
      </section>
      <section className="card">
        <div className="card-head"><h2>Sürümler</h2></div>
        {data.items.length === 0 ? <p className="card-pad muted small">Henüz klinik şablonu yok; yerleşik DEMO set ({data.builtin.version}, {data.builtin.questions.length} soru) kullanılıyor.</p> : (
          <div className="table-wrap" tabIndex={0}><table className="table">
            <thead><tr><th>Sürüm</th><th>Başlık</th><th>Soru</th><th>Durum</th><th>Yayın</th><th>Kullanım</th><th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>{data.items.map((t) => (
              <tr key={t.id}><td>v{t.version}</td><td>{t.title}</td><td>{t.questions.length}</td>
                <td><span className={`badge badge-${t.status === "published" ? "success" : t.status === "draft" ? "warning" : "neutral"}`}>{ANAMNESIS_TEMPLATE_STATUS_LABELS[t.status]}</span></td>
                <td className="small">{t.publishedAt ? `${t.publishedBy} · ${fmtDateTime(t.publishedAt)}` : "—"}{t.retiredAt && <div className="muted">emekli {fmtDateTime(t.retiredAt)}</div>}</td>
                <td>{t.usageCount} kayıt</td>
                <td>{t.status === "published" && can("anamnesis.review") && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { if (window.confirm("Yayındaki form emekli edilecek; yeni anamnezler yerleşik DEMO setle alınır. Eski kayıtlar etkilenmez. Devam?")) void run(() => api(`/anamnesis-templates/${t.id}/retire`, { body: {} }), "Şablon emekli edildi; yerleşik set yürürlükte."); }}>Emekli et</button>}</td></tr>))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
