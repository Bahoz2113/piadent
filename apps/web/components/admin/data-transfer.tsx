"use client";
/**
 * Yönetim → Veri aktarımı (VD-014). Akış: dosya seç → ön kontrol (dry-run, hiçbir şey yazılmaz) → satırları ve
 * mutabakatı incele → hatalı satırları CSV olarak indir, düzelt, yeniden yükle → onayla → gerekirse gerekçeyle geri al.
 * Dışa aktarım: klinik verisinin tamamı açık JSON biçiminde (gerekçeli, denetlenir).
 */
import { useState } from "react";
import { Download, FileUp, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { IMPORT_FIELDS, IMPORT_KIND_LABELS, IMPORT_MAX_BYTES, IMPORT_ROW_STATUS_LABELS, formatTRY, type ImportKind } from "@viadent/contracts";
import { api, ApiFailure, download } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { fmtDateTime } from "@/lib/format";
import { Alert, EmptyState, ErrorState, Loading, SelectField, TextAreaField, TextField } from "@/components/ui";

type Notify = (k: "success" | "error", t: string) => void;
interface Summary {
  rows: number; valid: number; errors: number; duplicates: number; alreadyImported: number; withWarnings: number; imported?: number; skippedAtCommit?: number;
  amountSource?: string; amountValid?: string; amountError?: string; amountDuplicate?: string; amountAlreadyImported?: string; amountImported?: string; unparsedAmountRows?: number;
  unmapped?: string[];
}
interface Batch {
  id: string; kind: ImportKind; format: string; fileName: string; status: "dry_run" | "committed" | "rolled_back"; mapping: Record<string, string>; summary: Summary;
  createdAt: string; by: string; committedAt: string | null; committedBy: string | null; rolledBackAt: string | null; rollbackReason: string | null; rowsPurgedAt?: string | null; reused?: boolean;
}
interface Row { rowNo: number; status: string; errors: { field: string; message: string }[]; warnings: { field: string; message: string }[]; data: Record<string, unknown>; amount: string | null }

const STATUS_BADGE: Record<string, string> = { valid: "badge-success", imported: "badge-success", error: "badge-danger", duplicate: "badge-warning",
  already_imported: "badge-neutral", skipped: "badge-neutral", rolled_back: "badge-neutral" };
const BATCH_LABEL: Record<Batch["status"], [string, string]> = { dry_run: ["Ön kontrol", "badge-info"], committed: ["Aktarıldı", "badge-success"], rolled_back: ["Geri alındı", "badge-neutral"] };

export function ImportPanel({ notify }: { notify: Notify }) {
  const history = useData<{ items: Batch[] }>("/imports");
  const [kind, setKind] = useState<ImportKind>("patients");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function check() {
    if (!file || busy) return;
    if (file.size > IMPORT_MAX_BYTES) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Dosya en çok 5 MB olabilir; parçalara bölün." })); return; }
    setBusy(true); setErr(null);
    try {
      const content = await file.text();
      const format = /\.json$/i.test(file.name) ? "json" : "csv";
      const b = await api<Batch>("/imports", { body: { kind, format, fileName: file.name, content } });
      notify("success", b.reused ? "Bu dosya daha önce yüklenmiş; mevcut aktarım açıldı (yeni kayıt oluşmaz)." : "Ön kontrol tamam. Hiçbir kayıt henüz yazılmadı.");
      setOpenId(b.id);
      await history.reload();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <section className="card card-pad stack">
        <div>
          <h2>Önceki sistemden veri aktarımı</h2>
          <p className="muted small">Önce ön kontrol yapılır: dosya okunur, sütunlar eşlenir, her satır doğrulanır ve mükerrer adaylar aranır — <b>hiçbir kayıt yazılmaz</b>.
            Sonuçları inceleyip onayladığınızda yalnız geçerli satırlar aktarılır. Aynı dosyayı tekrar yüklemek yeni kayıt oluşturmaz.</p>
        </div>
        {err && (
          <Alert kind="error" title={err.code === "IMPORT_MAPPING_INCOMPLETE" ? "Zorunlu sütunlar bulunamadı" : undefined}>
            {err.message}
            {err.code === "IMPORT_MAPPING_INCOMPLETE" && (err.body.details as { headers?: string[] } | undefined)?.headers && (
              <div className="small" style={{ marginTop: 6 }}>Dosyadaki başlıklar: {(err.body.details as { headers: string[] }).headers.join(", ")}</div>
            )}
          </Alert>
        )}
        <div className="form-grid">
          <SelectField label="Aktarım türü" value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>
            {(Object.keys(IMPORT_KIND_LABELS) as ImportKind[]).map((k) => <option key={k} value={k}>{IMPORT_KIND_LABELS[k]}</option>)}
          </SelectField>
          <div className="field">
            <label htmlFor="import-file">Dosya (CSV veya JSON, en çok 5 MB)</label>
            <input id="import-file" className="input" type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(null); }} />
          </div>
        </div>
        <details>
          <summary className="small">Beklenen sütunlar</summary>
          <table className="table" style={{ marginTop: 8 }}>
            <thead><tr><th>Alan</th><th>Zorunlu</th><th>Tanınan başlıklar</th><th>Not</th></tr></thead>
            <tbody>{IMPORT_FIELDS[kind].map((f) => (
              <tr key={f.key}><td>{f.label}</td><td>{f.required ? "Evet" : "—"}</td><td className="small muted">{f.aliases.slice(0, 5).join(", ")}</td><td className="small">{f.hint ?? ""}</td></tr>
            ))}</tbody>
          </table>
          <p className="small muted">Ayırıcı “;” veya “,” olabilir; Excel'in UTF-8 CSV çıktısı uygundur. Tarih gg.aa.yyyy, tutar 1.250,50 biçiminde yazılabilir.
            {kind === "opening_balances" && " Açılış bakiyesi için önce hasta kartlarını aktarın."}</p>
        </details>
        <div><button className="btn btn-primary" disabled={!file || busy} onClick={() => void check()}><FileUp size={17} aria-hidden />{busy ? "Kontrol ediliyor…" : "Ön kontrol yap"}</button></div>
      </section>

      {openId && <BatchDetail id={openId} notify={notify} onChange={() => void history.reload()} onClose={() => setOpenId(null)} />}

      <section className="card">
        <div className="card-head"><h2>Aktarım geçmişi</h2></div>
        {history.loading && !history.data ? <Loading /> : history.error ? <ErrorState error={history.error} onRetry={history.reload} /> :
          (history.data!.items.length === 0 ? <EmptyState title="Henüz aktarım yok" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Dosya</th><th>Tür</th><th>Durum</th><th className="num">Satır</th><th className="num">Geçerli</th><th className="num">Aktarılan</th><th className="desktop-only">Yükleyen</th><th><span className="sr-only">İşlem</span></th></tr></thead>
                <tbody>{history.data!.items.map((b) => (
                  <tr key={b.id}>
                    <td><strong>{b.fileName}</strong><div className="muted small">{fmtDateTime(b.createdAt)}</div></td>
                    <td>{IMPORT_KIND_LABELS[b.kind]}</td>
                    <td><span className={`badge ${BATCH_LABEL[b.status][1]}`}>{BATCH_LABEL[b.status][0]}</span></td>
                    <td className="num">{b.summary.rows}</td><td className="num">{b.summary.valid}</td><td className="num">{b.summary.imported ?? "—"}</td>
                    <td className="desktop-only">{b.by}</td>
                    <td style={{ textAlign: "right" }}><button className="btn btn-sm" onClick={() => setOpenId(b.id)}>Aç</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ))}
      </section>
    </div>
  );
}

function BatchDetail({ id, notify, onChange, onClose }: { id: string; notify: Notify; onChange: () => void; onClose: () => void }) {
  const [filter, setFilter] = useState<string>("");
  const d = useData<Batch & { rows: Row[] }>(`/imports/${id}${filter ? `?status=${filter}` : ""}`);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  if (d.loading && !d.data) return <section className="card"><Loading rows={4} /></section>;
  if (d.error) return <section className="card"><ErrorState error={d.error} onRetry={d.reload} /></section>;
  const b = d.data!;
  const s = b.summary;
  const money = b.kind === "opening_balances";
  async function commit() {
    if (busy) return;
    if (!window.confirm(`${s.valid} geçerli satır aktarılacak. Hatalı ve mükerrer satırlar atlanır. Devam edilsin mi?`)) return;
    setBusy(true); setErr(null);
    try { const r = await api<Batch>(`/imports/${id}/commit`, { body: {} }); notify("success", `${r.summary.imported ?? 0} kayıt aktarıldı.`); await d.reload(); onChange(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  async function rollback() {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await api(`/imports/${id}/rollback`, { body: { reason } }); notify("success", "Aktarım geri alındı; kayıtlar arşivlendi/iptal edildi (silinmedi)."); setReason(""); await d.reload(); onChange(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  const keys = Object.values(b.mapping);
  return (
    <section className="card" aria-label="Aktarım ayrıntısı">
      <div className="card-head">
        <div><h2>{b.fileName}</h2><p className="muted small">{IMPORT_KIND_LABELS[b.kind]} · {BATCH_LABEL[b.status][0]} · {fmtDateTime(b.createdAt)} · {b.by}
          {b.committedAt && ` · Onay: ${fmtDateTime(b.committedAt)} (${b.committedBy})`}</p></div>
        <button className="btn btn-sm" onClick={onClose}>Kapat</button>
      </div>
      <div className="card-pad stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        {b.status === "rolled_back" && <Alert kind="info" title="Geri alındı">{fmtDateTime(b.rolledBackAt)} · {b.rollbackReason}</Alert>}
        {b.rowsPurgedAt && <Alert kind="info" title="Satır verisi temizlendi">Saklama süresi dolduğu için {fmtDateTime(b.rowsPurgedAt)} tarihinde satırların içeriği silindi. Sayımlar ve mutabakat özeti korunur.</Alert>}
        <div className="totals" aria-label="Mutabakat">
          <div className="stat card"><div className="label">Kaynak satır</div><div className="value">{s.rows}</div></div>
          <div className="stat card"><div className="label">Aktarılabilir</div><div className="value">{s.valid}</div></div>
          <div className="stat card"><div className="label">Hatalı</div><div className="value">{s.errors}</div></div>
          <div className="stat card"><div className="label">Mükerrer / aday</div><div className="value">{s.duplicates}</div></div>
          <div className="stat card"><div className="label">Daha önce aktarılmış</div><div className="value">{s.alreadyImported}</div></div>
          {s.imported !== undefined && <div className="stat card"><div className="label">Aktarılan</div><div className="value">{s.imported}{s.skippedAtCommit ? ` (+${s.skippedAtCommit} atlandı)` : ""}</div></div>}
        </div>
        {money && (
          <div className="totals" aria-label="Tutar mutabakatı">
            <div className="stat card"><div className="label">Kaynak toplam</div><div className="value">{formatTRY(s.amountSource)}</div></div>
            <div className="stat card"><div className="label">Aktarılabilir</div><div className="value">{formatTRY(s.amountValid)}</div></div>
            <div className="stat card"><div className="label">Hatalı</div><div className="value">{formatTRY(s.amountError)}</div></div>
            <div className="stat card"><div className="label">Mükerrer</div><div className="value">{formatTRY(s.amountDuplicate)}</div></div>
            <div className="stat card"><div className="label">Daha önce aktarılmış</div><div className="value">{formatTRY(s.amountAlreadyImported)}</div></div>
            {s.amountImported !== undefined && <div className="stat card"><div className="label">Aktarılan</div><div className="value">{formatTRY(s.amountImported)}</div></div>}
          </div>
        )}
        {money && !!s.unparsedAmountRows && <p className="small muted">{s.unparsedAmountRows} satırın tutarı okunamadı; kaynak toplama dahil değildir (hatalı satırlarda listelenir).</p>}
        {!!s.unmapped?.length && <p className="small muted">Eşlenmeyen (yok sayılan) sütunlar: {s.unmapped.join(", ")}</p>}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {b.status === "dry_run" && <button className="btn btn-primary" disabled={busy || s.valid === 0} onClick={() => void commit()}><Upload size={17} aria-hidden />{busy ? "Aktarılıyor…" : `${s.valid} satırı aktar`}</button>}
          {(s.errors > 0 || s.duplicates > 0) && (
            <button className="btn" onClick={() => void download(`/imports/${id}/errors.csv`, { fallbackName: "aktarim-hatalari.csv" }).catch((e) => setErr(e as ApiFailure))}>
              <Download size={16} aria-hidden />Hatalı satırları indir (CSV)
            </button>
          )}
        </div>
        {b.status === "committed" && (
          <details>
            <summary className="small">Aktarımı geri al</summary>
            <div className="stack" style={{ marginTop: 8, maxWidth: 520 }}>
              <p className="small muted">Yalnız aktarımdan sonra hiç işlem görmemiş kayıtlar geri alınabilir. Hasta kartları arşivlenir, açılış alacakları iptal edilir; hiçbir kayıt silinmez.</p>
              <TextAreaField label="Gerekçe" required value={reason} onChange={(e) => setReason(e.target.value)} error={err?.fieldErrors.reason} />
              <div><button className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => void rollback()}><RotateCcw size={16} aria-hidden />Geri al</button></div>
            </div>
          </details>
        )}
      </div>
      <div className="card-head" style={{ borderTop: "1px solid var(--border)" }}>
        <h3>Satırlar</h3>
        <select className="select" style={{ width: 210, minHeight: 36 }} aria-label="Satır durumu süzgeci" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Tümü</option>
          {Object.entries(IMPORT_ROW_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th className="num">Satır</th><th>Durum</th>{keys.slice(0, 4).map((k) => <th key={k}>{IMPORT_FIELDS[b.kind].find((f) => f.key === k)?.label ?? k}</th>)}<th>Hata / uyarı</th></tr></thead>
          <tbody>
            {b.rows.length === 0 && <tr><td colSpan={7} className="muted">Bu süzgeçte satır yok.</td></tr>}
            {b.rows.map((r) => (
              <tr key={r.rowNo}>
                <td className="num">{r.rowNo}</td>
                <td><span className={`badge ${STATUS_BADGE[r.status] ?? "badge-neutral"}`}>{IMPORT_ROW_STATUS_LABELS[r.status] ?? r.status}</span></td>
                {keys.slice(0, 4).map((k) => <td key={k} className="small">{k === "amount" && r.amount ? formatTRY(r.amount) : String(r.data[k] ?? r.data[k === "patient_ref" ? "file_no" : k] ?? "")}</td>)}
                <td className="small">
                  {r.errors.map((e, i) => <div key={`e${i}`} style={{ color: "var(--error)" }}>{e.message}</div>)}
                  {r.warnings.map((w, i) => <div key={`w${i}`} className="muted">{w.message}</div>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {b.rows.length === 200 && <p className="card-pad small muted">İlk 200 satır gösteriliyor; süzgeçle daraltın veya hatalı satırları CSV olarak indirin.</p>}
    </section>
  );
}

export function ExportPanel({ notify }: { notify: Notify }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function go() {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await download("/exports/clinic", { body: { reason }, fallbackName: "viadent-klinik-disa-aktarim.json" }); notify("success", "Dışa aktarım indirildi ve denetim kaydına yazıldı."); setReason(""); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <section className="card card-pad stack" style={{ maxWidth: 760 }}>
      <div>
        <h2>Klinik verisini dışa aktar</h2>
        <p className="muted small">Kliniğinizin tüm kayıtları belgelenmiş, açık bir JSON biçiminde (UTF-8) indirilir: her tablo için satırlar, satır sayısı ve SHA-256 özeti.
          Verinizi başka bir sisteme taşıyabilirsiniz; kilitlenme yoktur. Parola, oturum, iki adımlı doğrulama ve entegrasyon sırları dışa aktarılmaz;
          dosya içerikleri (röntgen, belge) ayrı yedekten SHA-256 ile eşlenir.</p>
      </div>
      <Alert kind="warning" title="Kişisel ve sağlık verisi içerir">İndirilen dosyayı şifreli bir ortamda saklayın ve yalnız yetkili kişilerle paylaşın. İşlem gerekçesiyle birlikte denetim kaydına yazılır.</Alert>
      {err && <Alert kind="error">{err.message}</Alert>}
      <TextField label="Gerekçe" required placeholder="ör. Yıllık arşiv kopyası, sistem değişikliği" value={reason} onChange={(e) => setReason(e.target.value)} error={err?.fieldErrors.reason} />
      <div><button className="btn btn-primary" disabled={busy || reason.trim().length < 5} onClick={() => void go()}><ShieldCheck size={17} aria-hidden />{busy ? "Hazırlanıyor…" : "Dışa aktar (JSON)"}</button></div>
    </section>
  );
}
