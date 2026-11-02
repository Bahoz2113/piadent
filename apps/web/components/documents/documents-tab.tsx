"use client";
import { useEffect, useRef, useState } from "react";
import { printHeaderHtml } from "@/components/brand";
import { Download, FilePlus2, FileText, Printer, RotateCcw, ShieldAlert, Trash2, Upload } from "lucide-react";
import {
  ACCEPTANCE_METHODS, ACCEPTANCE_METHOD_LABELS, DOCUMENT_CATEGORY_LABELS, DOCUMENT_STATUS_LABELS, EVIDENCE_LABELS, FILE_CATEGORIES, FILE_CATEGORY_LABELS,
  FILE_MAX_BYTES, FILE_SENSITIVITY, FILE_STATUS_LABELS, FILE_TYPES, PLAN_STATUS_LABELS, type DocumentCategory, type FileCategory,
} from "@viadent/contracts";
import { api, ApiFailure, getPageContext } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime } from "@/lib/format";
import { Alert, Drawer, EmptyState, ErrorState, Loading, SelectField, TextAreaField } from "@/components/ui";

interface DocRow { id: string; title: string; typeName: string; category: DocumentCategory; status: string; requestStatus: string | null; requiresAcceptance: boolean;
  contentHash: string; issuedAt: string; issuedBy: string; templateVersion: number; isDemo: boolean; expiresAt: string | null; revokeReason: string | null }
interface DocType { id: string; code: string; name: string; category: DocumentCategory; requiresAcceptance: boolean; issuerRole: string | null; active: boolean;
  approvedTemplates: { templateId: string; templateName: string; versionId: string; version: number; isDemo: boolean }[] }
interface FileRow { id: string; category: FileCategory; name: string; contentType: string; size: number; sha256: string | null; status: string; statusReason: string | null;
  scanEngine: string | null; createdAt: string; uploadFailures: number; uploadedBy: string }

const short = (h: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "—");
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const docState = (d: DocRow) => (d.status === "revoked" ? "revoked" : d.requestStatus ?? "issued");
const STATE_BADGE: Record<string, string> = { issued: "info", accepted: "success", declined: "error", expired: "neutral", revoked: "neutral", delivered: "info", viewed: "info" };
const FILE_BADGE: Record<string, string> = { initiated: "warning", uploaded: "info", available: "success", quarantined: "error", rejected: "error", deleted: "neutral" };

export function DocumentsTab({ patientId, patientName }: { patientId: string; patientName: string }) {
  const { can } = useSession();
  return (
    <div className="stack" style={{ gap: 16 }}>
      {can("document.read") ? <DocumentsCard patientId={patientId} patientName={patientName} /> : <Alert kind="info">Belgeler rolünüze kapalı.</Alert>}
      {can("file.read") && <FilesCard patientId={patientId} />}
    </div>
  );
}

// ------------------------------------------------------------------ belgeler
function DocumentsCard({ patientId, patientName }: { patientId: string; patientName: string }) {
  const { can } = useSession();
  const docs = useData<{ items: DocRow[] }>(`/patients/${patientId}/documents`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Belgeler</h2><p className="muted small">Belge onaylı şablon sürümünden üretilir; metin ve SHA-256 özeti o anki hâliyle saklanır. Şablon sonradan değişse de belge değişmez.</p></div>
        {can("document.issue") && <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}><FilePlus2 size={15} aria-hidden />Belge hazırla</button>}
      </div>
      {docs.loading && !docs.data ? <Loading /> : docs.error ? <ErrorState error={docs.error} /> : docs.data!.items.length === 0 ? <EmptyState icon={<FileText size={28} aria-hidden />} title="Belge yok" /> : (
        <div className="table-wrap" tabIndex={0}>
          <table className="table table-wide">
            <thead><tr><th>Belge</th><th>Tür</th><th>Hazırlayan</th><th>Şablon</th><th>Özet (SHA-256)</th><th>Durum</th><th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>{docs.data!.items.map((d) => (
              <tr key={d.id}>
                <td><strong>{d.title}</strong><div className="small muted">{fmtDateTime(d.issuedAt)}</div></td>
                <td>{DOCUMENT_CATEGORY_LABELS[d.category]}</td>
                <td>{d.issuedBy}</td>
                <td>Sürüm {d.templateVersion}{d.isDemo && <span className="badge badge-warning" style={{ marginLeft: 6 }}>DEMO</span>}</td>
                <td><code className="small">{short(d.contentHash)}</code></td>
                <td><span className={`badge badge-${STATE_BADGE[docState(d)]}`}>{d.requiresAcceptance || d.status === "revoked" ? DOCUMENT_STATUS_LABELS[docState(d)] : "Hazırlandı (bilgilendirme)"}</span></td>
                <td><button className="btn btn-sm btn-ghost" onClick={() => setOpen(d.id)}>Aç</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {creating && <IssueDrawer patientId={patientId} patientName={patientName} onClose={() => setCreating(false)} onIssued={(id) => { setCreating(false); void docs.reload(); setOpen(id); }} />}
      {open && <DocumentDrawer docId={open} patientId={patientId} onClose={() => setOpen(null)} onChanged={() => void docs.reload()} />}
    </section>
  );
}

function IssueDrawer({ patientId, patientName, onClose, onIssued }: { patientId: string; patientName: string; onClose: () => void; onIssued: (id: string) => void }) {
  const { session } = useSession();
  const types = useData<{ items: DocType[] }>("/document-types");
  const plans = useData<{ items: { id: string; title: string; versions: { id: string; version: number; status: string }[] }[] }>(`/patients/${patientId}/plans`);
  const [versionId, setVersionId] = useState("");
  const [planVersionId, setPlanVersionId] = useState("");
  const [freeText, setFreeText] = useState("");
  const [preview, setPreview] = useState<{ title: string; content: string; contentHash: string; isDemo: boolean; requiresAcceptance: boolean } | null>(null);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const role = session.activeMembership?.role;
  const usable = (types.data?.items ?? []).filter((t) => t.active);
  const planVersions = (plans.data?.items ?? []).flatMap((p) => p.versions.filter((v) => ["proposed", "accepted"].includes(v.status)).map((v) => ({ ...v, title: p.title })));
  useEffect(() => { setPreview(null); }, [versionId, planVersionId, freeText]);
  const selectedType = usable.find((t) => t.approvedTemplates[0]?.versionId === versionId);
  const clinical = selectedType?.category === "clinical_output";
  async function doPreview() {
    setBusy(true); setErr(null);
    try { setPreview(await api(`/template-versions/${versionId}/preview`, { body: { patientId, planVersionId: planVersionId || undefined, freeText: freeText || undefined } })); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  async function issue() {
    setBusy(true); setErr(null);
    try { const r = await api<{ id: string }>("/documents", { body: { patientId, templateVersionId: versionId, planVersionId: planVersionId || undefined, freeText: freeText || undefined } }); onIssued(r.id); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Belge hazırla" subtitle={patientName} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
        {!preview ? <button className="btn btn-primary" disabled={!versionId || busy} onClick={() => void doPreview()}>Önizle</button>
          : <button className="btn btn-primary" disabled={busy} onClick={() => void issue()}>Belgeyi üret</button>}</>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <SelectField label="Belge türü / şablon" required value={versionId} onChange={(e) => setVersionId(e.target.value)}>
          <option value="">Seçin</option>
          {usable.map((t) => {
            const tpl = t.approvedTemplates[0];
            const blocked = t.issuerRole && t.issuerRole !== role;
            return <option key={t.id} value={tpl?.versionId ?? ""} disabled={!tpl || !!blocked}>
              {t.name}{!tpl ? " — onaylı şablon yok" : blocked ? " — yalnız hekim" : ` — ${tpl.templateName} · sürüm ${tpl.version}`}
            </option>;
          })}
        </SelectField>
        {planVersions.length > 0 && (
          <SelectField label="Bağlı tedavi planı (isteğe bağlı)" value={planVersionId} onChange={(e) => setPlanVersionId(e.target.value)} hint="Şablonda {{plan.kalemler}} alanı varsa plan kalemleri metne yazılır.">
            <option value="">Bağlama</option>
            {planVersions.map((v) => <option key={v.id} value={v.id}>{v.title} · sürüm {v.version} ({PLAN_STATUS_LABELS[v.status]})</option>)}
          </SelectField>
        )}
        {clinical && (
          <>
            <Alert kind="info">Klinik çıktı: tanılar, gerçekleşen işlemler ve anamnez kritik işaretleri kayıtlardan otomatik yazılır; sağlık verisi içerdiğinden yalnız sağlık yetkili roller görür. Reçete yazısı <strong>e-reçete değildir</strong>.</Alert>
            <TextAreaField label="Serbest metin ({{serbest.metin}}: ilaç listesi, öneriler, hekim notu)" value={freeText} onChange={(e) => setFreeText(e.target.value)} rows={5} />
          </>
        )}
        {preview && (
          <>
            {preview.isDemo && <Alert kind="warning">Bu şablon <strong>SENTETİK DEMO</strong> içeriktir; gerçek bilgilendirme/onam metni değildir. Klinik ve hukuk onaylı metin yüklenmeden hastaya kullanılmamalıdır.</Alert>}
            <div className="doc-preview" aria-label="Belge önizlemesi">{preview.content}</div>
            <p className="small muted">Özet (SHA-256): <code>{preview.contentHash}</code>{preview.requiresAcceptance ? " · Üretilince hastanın kararı için 30 gün geçerli istek açılır." : " · Bilgilendirme belgesi; karar beklenmez."}</p>
          </>
        )}
      </div>
    </Drawer>
  );
}

interface DocDetail { id: string; title: string; typeName: string; content: string; contentHash: string; integrityOk: boolean; status: string; requestStatus: string | null;
  requiresAcceptance: boolean; templateVersion: number; templateStatus: string; isDemo: boolean; issuedAt: string; expiresAt: string | null; revokeReason: string | null;
  evidence: { kind: string; method: string | null; documentHash: string; fileId: string | null; note: string | null; at: string; actor: string | null }[] }

function DocumentDrawer({ docId, patientId, onClose, onChanged }: { docId: string; patientId: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const d = useData<DocDetail>(`/documents/${docId}`);
  const files = useData<{ items: FileRow[] }>(can("file.read") ? `/patients/${patientId}/files` : null);
  const [mode, setMode] = useState<null | "accept" | "decline" | "revoke">(null);
  const [method, setMethod] = useState<(typeof ACCEPTANCE_METHODS)[number]>("wet_signature_on_paper");
  const [attest, setAttest] = useState(false);
  const [fileId, setFileId] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const reload = () => { void d.reload(); onChanged(); setMode(null); setText(""); setAttest(false); };
  async function run(fn: () => Promise<unknown>) { setErr(null); try { await fn(); reload(); } catch (e) { setErr(e as ApiFailure); } }
  async function print() {
    if (!d.data) return;
    await run(() => api(`/documents/${docId}/print`, { body: {} }));
    const w = window.open("", "_blank");
    if (w) {
      w.document.title = d.data.title;
      w.document.body.insertAdjacentHTML("afterbegin", printHeaderHtml());
      const pre = w.document.createElement("pre");
      pre.style.cssText = "white-space:pre-wrap;font:14px/1.5 system-ui;margin:32px";
      pre.textContent = `${d.data.content}\nBelge özeti (SHA-256): ${d.data.contentHash}\nŞablon sürümü: ${d.data.templateVersion}`;
      w.document.body.appendChild(pre);
      w.print();
    }
  }
  const scans = (files.data?.items ?? []).filter((f) => f.status === "available" && f.category === "document_scan");
  const open = d.data && d.data.status === "issued" && d.data.requiresAcceptance && ["issued", "delivered", "viewed"].includes(d.data.requestStatus ?? "");
  return (
    <Drawer title={d.data?.title ?? "Belge"} subtitle={d.data ? `${d.data.typeName} · şablon sürümü ${d.data.templateVersion}${d.data.templateStatus === "retired" ? " (artık kullanılmıyor)" : ""}` : undefined} onClose={onClose}>
      {d.loading && !d.data ? <Loading /> : d.error ? <ErrorState error={d.error} /> : (
        <div className="stack">
          {err && <Alert kind="error">{err.message}</Alert>}
          {d.data!.isDemo && <Alert kind="warning">SENTETİK DEMO şablondan üretildi; gerçek hasta kullanımı için değildir.</Alert>}
          {!d.data!.integrityOk && <Alert kind="error">Belge metni kayıtlı özetle uyuşmuyor. Kullanmayın; destekle paylaşın.</Alert>}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className={`badge badge-${STATE_BADGE[d.data!.status === "revoked" ? "revoked" : d.data!.requestStatus ?? "issued"]}`}>
              {d.data!.status === "revoked" ? `İptal edildi: ${d.data!.revokeReason}` : d.data!.requiresAcceptance ? DOCUMENT_STATUS_LABELS[d.data!.requestStatus ?? "issued"] : "Bilgilendirme belgesi"}
            </span>
            {d.data!.status === "issued" && <button className="btn btn-sm" onClick={() => void print()}><Printer size={15} aria-hidden />Yazdır</button>}
          </div>
          <div className="doc-preview">{d.data!.content}</div>
          <p className="small muted">Özet (SHA-256): <code>{d.data!.contentHash}</code> {d.data!.integrityOk && "· bütünlük doğrulandı"}</p>

          <h3>Kanıt olayları</h3>
          <ol className="evidence">
            {d.data!.evidence.map((e, i) => (
              <li key={i}><strong>{EVIDENCE_LABELS[e.kind] ?? e.kind}</strong>{e.method ? ` · ${ACCEPTANCE_METHOD_LABELS[e.method as keyof typeof ACCEPTANCE_METHOD_LABELS]}` : ""}
                <div className="small muted">{fmtDateTime(e.at)} · {e.actor ?? "Sistem"} · özet {short(e.documentHash)}{e.note ? ` · ${e.note}` : ""}</div></li>
            ))}
          </ol>
          <p className="small muted">Kayıtlar yalnız eklenir. Bu bir elektronik imza değildir; kabul, personelin yüz yüze kaydettiği yöntemle kayda geçer ve hukuki uygunluğu kliniğin değerlendirmesine bağlıdır.</p>

          {open && can("document.decision") && !mode && (
            <div className="row">
              <button className="btn btn-primary btn-sm" onClick={() => setMode("accept")}>Kabul kaydet</button>
              <button className="btn btn-sm" onClick={() => setMode("decline")}>Reddetti</button>
            </div>
          )}
          {mode === "accept" && (
            <div className="stack" style={{ gap: 8 }}>
              <SelectField label="Kabul yöntemi" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {ACCEPTANCE_METHODS.map((m) => <option key={m} value={m}>{ACCEPTANCE_METHOD_LABELS[m]}</option>)}
              </SelectField>
              {scans.length > 0 && (
                <SelectField label="Taranmış imzalı nüsha (isteğe bağlı)" value={fileId} onChange={(e) => setFileId(e.target.value)}>
                  <option value="">Bağlama</option>
                  {scans.map((f) => <option key={f.id} value={f.id}>{f.name} · {fmtDateTime(f.createdAt)}</option>)}
                </SelectField>
              )}
              <TextAreaField label="Not" value={text} onChange={(e) => setText(e.target.value)} rows={2} />
              <label className="row small"><input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
                Hastanın (veya yasal temsilcisinin) bu belge sürümünü yüz yüze kabul ettiğini kendim gördüm ve kaydediyorum.</label>
              <div className="row"><button className="btn btn-primary btn-sm" disabled={!attest} onClick={() => void run(() => api(`/documents/${docId}/decision`, { body: { decision: "accepted", method, attestation: true, fileId: fileId || undefined, note: text || undefined } }))}>Kaydet</button>
                <button className="btn btn-sm" onClick={() => setMode(null)}>Vazgeç</button></div>
            </div>
          )}
          {mode === "decline" && (
            <div className="stack" style={{ gap: 8 }}>
              <TextAreaField label="Not" value={text} onChange={(e) => setText(e.target.value)} rows={2} />
              <div className="row"><button className="btn btn-primary btn-sm" onClick={() => void run(() => api(`/documents/${docId}/decision`, { body: { decision: "declined", note: text || undefined } }))}>Reddi kaydet</button>
                <button className="btn btn-sm" onClick={() => setMode(null)}>Vazgeç</button></div>
            </div>
          )}
          {d.data!.status === "issued" && can("document.revoke") && mode !== "revoke" && <button className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setMode("revoke")}>Belgeyi iptal et</button>}
          {mode === "revoke" && (
            <div className="stack" style={{ gap: 8 }}>
              <TextAreaField label="İptal gerekçesi" required value={text} onChange={(e) => setText(e.target.value)} rows={2} />
              <div className="row"><button className="btn btn-danger btn-sm" disabled={text.trim().length < 3} onClick={() => void run(() => api(`/documents/${docId}/revoke`, { body: { reason: text } }))}>İptali onayla</button>
                <button className="btn btn-sm" onClick={() => setMode(null)}>Vazgeç</button></div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------------ dosyalar
async function putContent(fileId: string, file: File): Promise<{ status: string; message?: string }> {
  const res = await fetch(`/api/v1/files/${fileId}/content`, {
    method: "PUT", credentials: "same-origin", body: file,
    headers: { "content-type": "application/octet-stream", "x-viadent-request": "1", ...(getPageContext() ? { "x-viadent-context": getPageContext() } : {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiFailure(res.status, data ?? { code: "HTTP_ERROR", message: "Yükleme tamamlanamadı." });
  return data;
}

function FilesCard({ patientId }: { patientId: string }) {
  const { can } = useSession();
  const files = useData<{ items: FileRow[] }>(`/patients/${patientId}/files`);
  const inputRef = useRef<HTMLInputElement>(null);
  const retryRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<FileCategory>("document_scan");
  const [retryId, setRetryId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [del, setDel] = useState<FileRow | null>(null);
  const pending = (files.data?.items ?? []).some((f) => f.status === "uploaded");
  // Tarama sürerken durumu kendiliğinden yenile (durum, sunucudaki gerçek sonuçtur).
  const reloadFiles = files.reload;
  useEffect(() => { if (!pending) return; const t = setInterval(() => void reloadFiles(), 2500); return () => clearInterval(t); }, [pending, reloadFiles]);
  const categories = FILE_CATEGORIES.filter((c) => FILE_SENSITIVITY[c] === "administrative" || can("patient.health.read"));

  async function upload(file: File, existingId?: string) {
    setMsg(null);
    if (!(FILE_TYPES as readonly string[]).includes(file.type)) { setMsg({ kind: "error", text: "Desteklenen türler: JPEG, PNG, WEBP, PDF." }); return; }
    if (file.size > FILE_MAX_BYTES) { setMsg({ kind: "error", text: "Dosya en fazla 20 MB olabilir." }); return; }
    let id = existingId;
    try {
      if (!id) id = (await api<{ id: string }>("/files", { body: { patientId, category, originalName: file.name, contentType: file.type, size: file.size } })).id;
      setMsg({ kind: "info", text: `“${file.name}” gönderiliyor…` });
      const r = await putContent(id, file);
      setMsg({ kind: "info", text: r.message ?? "Dosya alındı; taranıyor." });
    } catch (e) {
      const f = e as ApiFailure;
      setMsg({ kind: "error", text: f.status === 0 ? "Bağlantı koptu; dosya yüklenmedi. Listeden “Tekrar dene” ile aynı dosyayı yeniden seçin." : f.message });
    } finally { void files.reload(); }
  }
  async function downloadFile(f: FileRow) {
    const res = await fetch(`/api/v1/files/${f.id}/content`, { credentials: "same-origin", headers: getPageContext() ? { "x-viadent-context": getPageContext() } : {} });
    if (!res.ok) { const b = await res.json().catch(() => null); setMsg({ kind: "error", text: b?.message ?? "Dosya açılamadı." }); void files.reload(); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Dosyalar</h2><p className="muted small">Dosya özel depoda saklanır. Seçmek yüklemek değildir: içerik sunucuya tam ulaşıp zararlı içerik taramasından geçmeden açılamaz.</p></div>
        {can("file.write") && (
          <div className="row" style={{ alignItems: "flex-end" }}>
            <SelectField label="Kategori" value={category} onChange={(e) => setCategory(e.target.value as FileCategory)}>
              {categories.map((c) => <option key={c} value={c}>{FILE_CATEGORY_LABELS[c]}</option>)}
            </SelectField>
            <button className="btn btn-sm btn-primary" onClick={() => inputRef.current?.click()}><Upload size={15} aria-hidden />Dosya yükle</button>
            <input ref={inputRef} type="file" hidden accept={FILE_TYPES.join(",")} aria-label="Yüklenecek dosya" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
            <input ref={retryRef} type="file" hidden accept={FILE_TYPES.join(",")} aria-label="Yeniden yüklenecek dosya" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f && retryId) void upload(f, retryId); }} />
          </div>
        )}
      </div>
      {msg && <div className="card-pad" style={{ paddingBottom: 0 }}><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      {files.loading && !files.data ? <Loading /> : files.error ? <ErrorState error={files.error} /> : files.data!.items.length === 0 ? <EmptyState title="Dosya yok" /> : (
        <div className="table-wrap" tabIndex={0}>
          <table className="table table-wide">
            <thead><tr><th>Dosya</th><th>Kategori</th><th>Boyut</th><th>Durum</th><th>Tarama</th><th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>{files.data!.items.map((f) => (
              <tr key={f.id} style={f.status === "deleted" ? { color: "var(--text-secondary)" } : undefined}>
                <td><strong>{f.name}</strong><div className="small muted">{fmtDateTime(f.createdAt)} · {f.uploadedBy}</div></td>
                <td>{FILE_CATEGORY_LABELS[f.category]}</td>
                <td>{kb(f.size)}</td>
                <td><span className={`badge badge-${FILE_BADGE[f.status]}`}>{f.status === "quarantined" && <ShieldAlert size={13} aria-hidden />}{FILE_STATUS_LABELS[f.status]}</span>
                  {f.statusReason && <div className="small muted">{f.statusReason}</div>}</td>
                <td className="small">{f.scanEngine ?? (f.status === "uploaded" ? "Sırada" : "—")}{f.sha256 && <div className="muted"><code>{short(f.sha256)}</code></div>}</td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  {f.status === "available" && <button className="btn btn-sm btn-ghost" onClick={() => void downloadFile(f)}><Download size={14} aria-hidden />İndir</button>}
                  {f.status === "initiated" && can("file.write") && <button className="btn btn-sm btn-ghost" onClick={() => { setRetryId(f.id); retryRef.current?.click(); }}><RotateCcw size={14} aria-hidden />Tekrar dene</button>}
                  {["available", "quarantined", "rejected"].includes(f.status) && can("file.delete") && <button className="btn btn-sm btn-ghost icon-btn" aria-label={`${f.name} dosyasını sil`} onClick={() => setDel(f)}><Trash2 size={14} /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {del && <DeleteDrawer file={del} onClose={() => setDel(null)} onDone={() => { setDel(null); void files.reload(); }} />}
    </section>
  );
}

function DeleteDrawer({ file, onClose, onDone }: { file: FileRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  return (
    <Drawer title="Dosyayı sil" subtitle={`${file.name} — “silindi” olarak işaretlenir; erişim kapanır, kayıt ve iz korunur.`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-danger" disabled={reason.trim().length < 3}
        onClick={() => void api(`/files/${file.id}/delete`, { body: { reason } }).then(onDone, (e) => setErr(e as ApiFailure))}>Sil</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <TextAreaField label="Gerekçe" required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      </div>
    </Drawer>
  );
}
