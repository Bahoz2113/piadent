"use client";
/**
 * Hasta kartı → Görüntülemeler (ADR-105). Röntgen (periapikal, panoramik, bitewing…), tomografi (CBCT/BT), MR ve fotoğraflar.
 * Mevcut dosya altyapısı: özel depo, yükleme → zararlı içerik taraması → kullanılabilir; her açılış erişim izine yazılır.
 * Dosyalar klinik (kiracı) düzeyindedir: bir şubede yüklenen film diğer şubede aynı kartta görünür. Sağlık verisi: yalnız sağlık yetkili roller.
 * Önizleme JPEG/PNG/WEBP (görsel) ve PDF; DICOM saklanır ve indirilir (tarayıcıda önizlenmez).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileImage, FileText, ImagePlus, Lock, Maximize2, Minus, Plus, ScanLine, Trash2 } from "lucide-react";
import {
  ALL_TEETH, FILE_MAX_BYTES, FILE_STATUS_LABELS, FILE_TYPES, IMAGING_KIND_LABELS, IMAGING_KINDS, imagingCategory, type ImagingKind,
} from "@viadent/contracts";
import { api, ApiFailure, getPageContext } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime, todayIn } from "@/lib/format";
import { Alert, Drawer, EmptyState, ErrorState, Loading, SelectField, TextAreaField, TextField } from "@/components/ui";
import { DateField } from "@/components/date-field";
import { DeleteDrawer, putContent } from "@/components/documents/documents-tab";

interface FileRow {
  id: string; category: string; name: string; contentType: string; size: number; status: string; statusReason: string | null; createdAt: string;
  uploadedBy: string; imagingKind: ImagingKind | null; takenOn: string | null; teeth: string[]; imagingNote: string | null;
}
const isImage = (t: string) => t.startsWith("image/");
const kindOf = (f: FileRow): ImagingKind => f.imagingKind ?? (f.category === "clinical_photo" ? "intraoral_photo" : "other");
const dateOf = (f: FileRow) => f.takenOn ?? f.createdAt.slice(0, 10);
const ctxHeaders = (): Record<string, string> => (getPageContext() ? { "x-viadent-context": getPageContext()! } : {});

/** İçeriği oturumla getirip nesne adresine çevirir (indirme izi sunucuda tutulur). */
async function fetchBlob(id: string): Promise<Blob> {
  const res = await fetch(`/api/v1/files/${id}/content`, { credentials: "same-origin", headers: ctxHeaders() });
  if (!res.ok) { const b = await res.json().catch(() => null); throw new ApiFailure(res.status, b ?? { code: "HTTP_ERROR", message: "Görüntü açılamadı." }); }
  return res.blob();
}
function useObjectUrl(id: string | null, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !enabled) return;
    let alive = true; let u: string | null = null;
    fetchBlob(id).then((b) => { if (!alive) return; u = URL.createObjectURL(b); setUrl(u); }, (e) => alive && setErr((e as ApiFailure).message));
    return () => { alive = false; if (u) URL.revokeObjectURL(u); setUrl(null); setErr(null); };
  }, [id, enabled]);
  return { url, err };
}

export function ImagingTab({ patientId, patientName }: { patientId: string; patientName: string }) {
  const { can } = useSession();
  const allowed = can("patient.health.read") && can("file.read");
  const files = useData<{ items: FileRow[] }>(allowed ? `/patients/${patientId}/files` : null);
  const [filter, setFilter] = useState<"all" | "xray" | "tomo" | "photo">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [del, setDel] = useState<FileRow | null>(null);
  const items = useMemo(() => (files.data?.items ?? [])
    .filter((f) => (f.category === "radiograph" || f.category === "clinical_photo") && f.status !== "deleted")
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || b.createdAt.localeCompare(a.createdAt)), [files.data]);
  const group = (k: ImagingKind) => (["cbct", "ct", "mr", "ultrasound"].includes(k) ? "tomo" : k.endsWith("_photo") ? "photo" : "xray");
  const shown = items.filter((f) => filter === "all" || group(kindOf(f)) === filter);
  const pending = items.some((f) => f.status === "uploaded");
  const reload = files.reload;
  useEffect(() => { if (!pending) return; const t = setInterval(() => void reload(), 2500); return () => clearInterval(t); }, [pending, reload]);

  if (!allowed) return <div className="card"><EmptyState icon={<Lock size={28} aria-hidden />} title="Görüntülemeler rolünüze kapalı">Röntgen, tomografi ve fotoğraflar sağlık verisidir; yalnız hekim, asistan ve yöneticiye görünür.</EmptyState></div>;
  const viewable = shown.filter((f) => f.status === "available");
  const idx = open ? viewable.findIndex((f) => f.id === open) : -1;

  return (
    <section className="card" aria-label="Görüntülemeler">
      <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2>Görüntülemeler</h2>
          <p className="muted small">Röntgen, tomografi, MR ve fotoğraflar. Klinik genelinde saklanır: diğer şubelerde de bu kartta görünür. Her açılış erişim kaydına yazılır.</p>
        </div>
        {can("file.write") && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><ImagePlus size={16} aria-hidden />Yeni görüntüleme ekle</button>}
      </div>
      <div className="card-pad stack" style={{ gap: 12 }}>
        <div className="row" role="group" aria-label="Görüntüleme süzgeci">
          {([["all", "Tümü"], ["xray", "Röntgen"], ["tomo", "Tomografi / MR"], ["photo", "Fotoğraf"]] as const).map(([k, l]) => (
            <button key={k} className={`btn btn-sm ${filter === k ? "btn-primary" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {l} <span className="muted">({k === "all" ? items.length : items.filter((f) => group(kindOf(f)) === k).length})</span>
            </button>
          ))}
        </div>
        {files.loading && !files.data ? <Loading /> : files.error ? <ErrorState error={files.error} /> : shown.length === 0 ? (
          <EmptyState icon={<ScanLine size={28} aria-hidden />} title="Görüntüleme yok"
            action={can("file.write") ? <button className="btn btn-primary" onClick={() => setAdding(true)}>İlk görüntülemeyi ekle</button> : undefined}>
            Eklenen röntgen ve fotoğraflar çekim tarihine göre burada listelenir.
          </EmptyState>
        ) : (
          <ul className="imaging-grid" aria-label="Görüntüleme listesi">
            {shown.map((f) => (
              <li key={f.id}>
                <button type="button" className="imaging-card" disabled={f.status !== "available"} onClick={() => setOpen(f.id)}
                  aria-label={`${IMAGING_KIND_LABELS[kindOf(f)]}, ${fmtDate(dateOf(f))}${f.teeth.length ? `, diş ${f.teeth.join(", ")}` : ""}${f.status !== "available" ? `, ${FILE_STATUS_LABELS[f.status]}` : ""}`}>
                  <Thumb f={f} />
                  <span className="imaging-meta">
                    <strong>{IMAGING_KIND_LABELS[kindOf(f)]}</strong>
                    <span className="small muted">{fmtDate(dateOf(f))}{f.teeth.length ? ` · Diş ${f.teeth.join(", ")}` : ""}</span>
                    {f.status !== "available" && <span className={`badge badge-${f.status === "uploaded" || f.status === "initiated" ? "info" : "error"}`}>{f.status === "uploaded" ? "Taranıyor…" : FILE_STATUS_LABELS[f.status]}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && idx >= 0 && (
        <Viewer file={viewable[idx]!} patientName={patientName} index={idx} total={viewable.length}
          onPrev={() => setOpen(viewable[(idx - 1 + viewable.length) % viewable.length]!.id)} onNext={() => setOpen(viewable[(idx + 1) % viewable.length]!.id)}
          onClose={() => setOpen(null)} onDelete={can("file.delete") ? () => { setDel(viewable[idx]!); setOpen(null); } : undefined} />
      )}
      {adding && <AddImagingDrawer patientId={patientId} patientName={patientName} onClose={() => setAdding(false)} onDone={() => { setAdding(false); void files.reload(); }} />}
      {del && <DeleteDrawer file={del} onClose={() => setDel(null)} onDone={() => { setDel(null); void files.reload(); }} />}
    </section>
  );
}

function Thumb({ f }: { f: FileRow }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el); return () => io.disconnect();
  }, []);
  const img = isImage(f.contentType) && f.status === "available";
  const { url } = useObjectUrl(f.id, img && visible);
  return (
    <span className="imaging-thumb" ref={ref} aria-hidden>
      {img && url ? <img src={url} alt="" /> : f.contentType === "application/pdf" ? <FileText size={30} /> : f.contentType === "application/dicom" ? <span className="imaging-dicom">DICOM</span> : <FileImage size={30} />}
    </span>
  );
}

function Viewer({ file, patientName, index, total, onPrev, onNext, onClose, onDelete }: {
  file: FileRow; patientName: string; index: number; total: number; onPrev: () => void; onNext: () => void; onClose: () => void; onDelete?: () => void;
}) {
  const previewable = isImage(file.contentType) || file.contentType === "application/pdf";
  const { url, err } = useObjectUrl(file.id, previewable);
  const [zoom, setZoom] = useState(1);
  useEffect(() => setZoom(1), [file.id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "ArrowLeft") onPrev(); if (e.key === "ArrowRight") onNext(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onPrev, onNext]);
  async function download() {
    const b = await fetchBlob(file.id); const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
  }
  return (
    <Drawer title={IMAGING_KIND_LABELS[kindOf(file)]} subtitle={`${patientName} · ${fmtDate(dateOf(file))} · ${index + 1}/${total}`} onClose={onClose} wide
      footer={<>
        {total > 1 && <><button className="btn" onClick={onPrev} aria-label="Önceki görüntü"><ChevronLeft size={16} aria-hidden /></button><button className="btn" onClick={onNext} aria-label="Sonraki görüntü"><ChevronRight size={16} aria-hidden /></button></>}
        {onDelete && <button className="btn btn-ghost" onClick={onDelete}><Trash2 size={15} aria-hidden />Sil</button>}
        <button className="btn btn-primary" onClick={() => void download()}><Download size={15} aria-hidden />İndir</button>
      </>}>
      <div className="stack">
        {isImage(file.contentType) && (
          <div className="row" role="group" aria-label="Yakınlaştırma">
            <button className="btn btn-sm" aria-label="Uzaklaştır" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><Minus size={14} aria-hidden /></button>
            <span className="small" aria-live="polite">%{Math.round(zoom * 100)}</span>
            <button className="btn btn-sm" aria-label="Yakınlaştır" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}><Plus size={14} aria-hidden /></button>
            <button className="btn btn-sm btn-ghost" onClick={() => setZoom(1)}><Maximize2 size={14} aria-hidden />Sığdır</button>
          </div>
        )}
        <div className="imaging-stage">
          {err ? <Alert kind="error">{err}</Alert>
            : !previewable ? <Alert kind="info">DICOM dosyası tarayıcıda önizlenemez. “İndir” ile kliniğinizin DICOM görüntüleyicisinde açın.</Alert>
            : !url ? <Loading />
            : isImage(file.contentType) ? <img src={url} alt={`${IMAGING_KIND_LABELS[kindOf(file)]} — ${fmtDate(dateOf(file))}`} style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? "100%" : "none" }} />
            : <iframe src={url} title={file.name} sandbox="" className="imaging-pdf" />}
        </div>
        <dl className="kv">
          <dt>Çekim tarihi</dt><dd>{file.takenOn ? fmtDate(file.takenOn) : "Belirtilmedi"}</dd>
          <dt>İlgili diş</dt><dd>{file.teeth.length ? file.teeth.join(", ") : "Belirtilmedi"}</dd>
          <dt>Not</dt><dd>{file.imagingNote ?? "—"}</dd>
          <dt>Dosya</dt><dd>{file.name} · {(file.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB</dd>
          <dt>Ekleyen</dt><dd>{file.uploadedBy} · {fmtDateTime(file.createdAt)}</dd>
        </dl>
      </div>
    </Drawer>
  );
}

const parseTeeth = (s: string): { teeth: string[]; bad: string[] } => {
  const parts = s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  return { teeth: [...new Set(parts.filter((x) => ALL_TEETH.has(x)))], bad: parts.filter((x) => !ALL_TEETH.has(x)) };
};

function AddImagingDrawer({ patientId, patientName, onClose, onDone }: { patientId: string; patientName: string; onClose: () => void; onDone: () => void }) {
  const { tz } = useSession();
  const today = todayIn(tz);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<ImagingKind | "">("");
  const [takenOn, setTakenOn] = useState(today);
  const [teethText, setTeethText] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const { teeth, bad } = parseTeeth(teethText);
  const type = file ? (file.type || (/\.dcm$/i.test(file.name) ? "application/dicom" : "")) : "";
  const typeOk = !file || (FILE_TYPES as readonly string[]).includes(type);
  const dicomOk = type !== "application/dicom" || (kind !== "" && imagingCategory(kind) === "radiograph");
  const sizeOk = !file || file.size <= FILE_MAX_BYTES;
  const ready = !!file && !!kind && typeOk && sizeOk && dicomOk && bad.length === 0 && !busy;

  async function save() {
    if (!ready || !file || !kind) return;
    setBusy(true); setErr(null);
    try {
      setProgress("Kayıt açılıyor…");
      const r = await api<{ id: string }>("/files", { body: {
        patientId, category: imagingCategory(kind), originalName: file.name, contentType: type, size: file.size,
        imagingKind: kind, takenOn: takenOn || undefined, teeth, imagingNote: note.trim() || undefined } });
      setProgress(`“${file.name}” gönderiliyor…`);
      await putContent(r.id, file);
      onDone();
    } catch (e) { setErr(e as ApiFailure); setProgress(null); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Yeni görüntüleme ekle" subtitle={patientName} onClose={onClose}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Vazgeç</button><button className="btn btn-primary" disabled={!ready} onClick={() => void save()}>{busy ? "Yükleniyor…" : "Görüntülemeyi ekle"}</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        {progress && <Alert kind="info">{progress}</Alert>}
        <div className="field">
          <span className="label">Dosya<span className="req" aria-hidden>*</span></span>
          <div className="row">
            <button type="button" className="btn" onClick={() => inputRef.current?.click()}><ImagePlus size={16} aria-hidden />{file ? "Başka dosya seç" : "Dosya seç"}</button>
            <span className="small">{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : <span className="muted">JPEG, PNG, WEBP, PDF veya DICOM (.dcm) · en fazla 20 MB</span>}</span>
          </div>
          <input ref={inputRef} type="file" hidden aria-label="Görüntüleme dosyası" accept="image/jpeg,image/png,image/webp,application/pdf,application/dicom,.dcm"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; setErr(null); }} />
          {!typeOk && <span className="err">Desteklenen türler: JPEG, PNG, WEBP, PDF, DICOM.</span>}
          {!sizeOk && <span className="err">Dosya en fazla 20 MB olabilir.</span>}
          {!dicomOk && <span className="err">DICOM yalnız röntgen / tomografi / MR türüyle eklenir.</span>}
        </div>
        <SelectField label="Görüntüleme türü" required value={kind} onChange={(e) => setKind(e.target.value as ImagingKind)}>
          <option value="">Seçin</option>
          {IMAGING_KINDS.map((k) => <option key={k} value={k}>{IMAGING_KIND_LABELS[k]}</option>)}
        </SelectField>
        <DateField label="Çekim tarihi" value={takenOn} onChange={(e) => setTakenOn(e.target.value)} max={today} today={today} hint="Görüntünün çekildiği gün (bugünden ileri olamaz)." />
        <TextField label="İlgili diş(ler)" value={teethText} onChange={(e) => setTeethText(e.target.value)} placeholder="ör. 16, 26" inputMode="numeric"
          hint="İsteğe bağlı. FDI numarası, virgülle." error={bad.length ? `Geçersiz diş numarası: ${bad.join(", ")}` : undefined} />
        <TextAreaField label="Not" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} hint="İsteğe bağlı (ör. dış merkez adı, kontrol amaçlı)." />
        <p className="small muted">Yüklenen dosya zararlı içerik taramasından geçince açılır. Görüntülemeler klinik genelinde saklanır; diğer şubeler de görür.</p>
      </div>
    </Drawer>
  );
}

