"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { DOCUMENT_CATEGORY_LABELS, TEMPLATE_FIELDS, type DocumentCategory } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { fmtDate } from "@/lib/format";
import { Alert, Drawer, ErrorState, Loading, SelectField, TextAreaField, TextField } from "@/components/ui";

type Notify = (k: "success" | "error", t: string) => void;
interface Version { id: string; version: number; status: "draft" | "approved" | "retired"; bodyHash: string; isDemo: boolean; changeNote: string | null; createdAt: string; approvedAt: string | null; body: string; documentCount: number }
interface Template { id: string; name: string; typeName: string; typeCode: string; versions: Version[] }
interface DocType { id: string; code: string; name: string; category: DocumentCategory; requiresAcceptance: boolean; issuerRole: string | null; active: boolean; reviewStatus: string }
const VSTATUS: Record<Version["status"], [string, string]> = { draft: ["Taslak", "neutral"], approved: ["Onaylı", "success"], retired: ["Kullanımdan kalktı", "neutral"] };

export function TemplatesPanel({ notify }: { notify: Notify }) {
  const tpls = useData<{ items: Template[] }>("/templates");
  const types = useData<{ items: DocType[] }>("/document-types");
  const [editor, setEditor] = useState<null | { mode: "new" } | { mode: "version"; tpl: Template } | { mode: "edit"; v: Version; tpl: Template }>(null);
  async function act(path: string, ok: string) {
    try { await api(path, { body: {} }); notify("success", ok); await tpls.reload(); await types.reload(); } catch (e) { notify("error", (e as ApiFailure).message); }
  }
  if ((tpls.loading && !tpls.data) || (types.loading && !types.data)) return <div className="card"><Loading /></div>;
  if (tpls.error || types.error) return <div className="card"><ErrorState error={(tpls.error ?? types.error)!} /></div>;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Alert kind="warning">Belge türü kataloğu PİA-DENT'in kendi sınıflandırmasıdır ve <strong>klinik/hukuk incelemesinden geçmemiştir (DEMO)</strong>. PİA-DENT bilgilendirme veya onam metni üretmez; şablon metnini kliniğin danışmanları sağlar. Kayıtlar elektronik imza değildir.</Alert>
      <section className="card">
        <div className="card-head">
          <div><h2>Şablonlar</h2><p className="muted small">Onaylanan sürüm donar (metin ve özeti değişmez). Değişiklik yeni sürümle yapılır; eski sürümle üretilmiş belgeler eski metni korur.</p></div>
          <button className="btn btn-sm btn-primary" onClick={() => setEditor({ mode: "new" })}><Plus size={15} aria-hidden />Yeni şablon</button>
        </div>
        {tpls.data!.items.map((t) => (
          <div key={t.id} className="plan-version" style={{ borderTop: "1px solid var(--border)", padding: "12px 20px" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span><strong>{t.name}</strong> <span className="muted small">· {t.typeName}</span></span>
              {!t.versions.some((v) => v.status === "draft") && <button className="btn btn-sm" onClick={() => setEditor({ mode: "version", tpl: t })}>Yeni sürüm</button>}
            </div>
            <ul className="list">{t.versions.map((v) => (
              <li key={v.id} className="row" style={{ padding: "8px 0", justifyContent: "space-between", gap: 8 }}>
                <span><span className={`badge badge-${VSTATUS[v.status][1]}`}>Sürüm {v.version} · {VSTATUS[v.status][0]}</span>
                  {v.isDemo && <span className="badge badge-warning" style={{ marginLeft: 6 }}>DEMO</span>}
                  <span className="small muted"> · {fmtDate(v.approvedAt ?? v.createdAt)} · özet <code>{v.bodyHash.slice(0, 10)}…</code> · {v.documentCount} belge{v.changeNote ? ` · ${v.changeNote}` : ""}</span></span>
                <span className="row" style={{ gap: 6 }}>
                  {v.status === "draft" && <button className="btn btn-sm btn-ghost" onClick={() => setEditor({ mode: "edit", v, tpl: t })}>Düzenle</button>}
                  {v.status === "draft" && <button className="btn btn-sm btn-primary" onClick={() => void act(`/template-versions/${v.id}/approve`, `Sürüm ${v.version} onaylandı.`)}>Onayla</button>}
                  {v.status === "approved" && <button className="btn btn-sm" onClick={() => void act(`/template-versions/${v.id}/retire`, `Sürüm ${v.version} kullanımdan kaldırıldı.`)}>Kullanımdan kaldır</button>}
                </span>
              </li>
            ))}</ul>
          </div>
        ))}
      </section>
      <section className="card">
        <div className="card-head"><div><h2>Belge türleri</h2><p className="muted small">Kabul gerektiren türlerde hastanın kararı yüz yüze kaydedilir; bilgilendirme türleri yalnız teslim edilir.</p></div></div>
        <div className="table-wrap" tabIndex={0}>
          <table className="table table-wide">
            <thead><tr><th>Tür</th><th>Kategori</th><th>Karar</th><th>Hazırlayabilen</th><th>İnceleme</th><th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>{types.data!.items.map((t) => (
              <tr key={t.id} style={!t.active ? { color: "var(--text-secondary)" } : undefined}>
                <td><strong>{t.name}</strong><div className="small muted">{t.code}</div></td>
                <td>{DOCUMENT_CATEGORY_LABELS[t.category]}</td>
                <td>{t.requiresAcceptance ? "Kabul/ret beklenir" : "Bilgilendirme"}</td>
                <td>{t.issuerRole === "dentist" ? "Yalnız hekim" : "Belge yetkisi olanlar"}</td>
                <td><span className="badge badge-warning">İncelenmedi (DEMO)</span></td>
                <td><button className="btn btn-sm btn-ghost" onClick={() => void api(`/document-types/${t.id}/active`, { body: { active: !t.active } }).then(() => types.reload(), (e) => notify("error", (e as ApiFailure).message))}>{t.active ? "Pasifleştir" : "Etkinleştir"}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <ReadinessRules notify={notify} types={types.data!.items} />
      {editor && <TemplateEditor editor={editor} types={types.data!.items} onClose={() => setEditor(null)} onSaved={(m) => { setEditor(null); notify("success", m); void tpls.reload(); }} />}
    </div>
  );
}

function TemplateEditor({ editor, types, onClose, onSaved }: { editor: { mode: "new" } | { mode: "version"; tpl: Template } | { mode: "edit"; v: Version; tpl: Template };
  types: DocType[]; onClose: () => void; onSaved: (m: string) => void }) {
  const latest = editor.mode !== "new" ? editor.tpl.versions[0] : undefined;
  const [f, setF] = useState({ documentTypeId: types[0]?.id ?? "", name: "", body: editor.mode === "edit" ? editor.v.body : latest?.body ?? "", changeNote: editor.mode === "edit" ? editor.v.changeNote ?? "" : "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function save() {
    try {
      if (editor.mode === "new") await api("/templates", { body: f });
      else if (editor.mode === "version") await api(`/templates/${editor.tpl.id}/versions`, { body: { body: f.body, changeNote: f.changeNote || undefined } });
      else await api(`/template-versions/${editor.v.id}`, { method: "PATCH", body: { body: f.body, changeNote: f.changeNote || undefined } });
      onSaved("Taslak kaydedildi. Onaylanana kadar belge üretiminde kullanılmaz.");
    } catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title={editor.mode === "new" ? "Yeni şablon" : editor.mode === "version" ? `Yeni sürüm · ${editor.tpl.name}` : `Taslağı düzenle · ${editor.tpl.name}`}
      subtitle="Metni kliniğin onaylı kaynağından yapıştırın. Alanlar {{…}} ile eklenir; tanımsız alan kabul edilmez." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Taslağı kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}{err.fieldErrors.body ? ` ${err.fieldErrors.body}` : ""}</Alert>}
        {editor.mode === "new" && <>
          <SelectField label="Belge türü" value={f.documentTypeId} onChange={(e) => setF({ ...f, documentTypeId: e.target.value })}>
            {types.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
          <TextField label="Şablon adı" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={err?.fieldErrors.name} />
        </>}
        <TextAreaField label="Metin" required rows={12} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <p className="small muted">Kullanılabilir alanlar: {Object.entries(TEMPLATE_FIELDS).map(([k, v]) => <span key={k}><code>{`{{${k}}}`}</code> {v}; </span>)}</p>
        <TextField label="Değişiklik notu" value={f.changeNote} onChange={(e) => setF({ ...f, changeNote: e.target.value })} />
      </div>
    </Drawer>
  );
}

function ReadinessRules({ notify, types }: { notify: Notify; types: DocType[] }) {
  const rules = useData<{ items: { id: string; kind: string; maxAgeDays: number | null; active: boolean; procedure: string | null; documentType: string | null }[] }>("/readiness-rules");
  const procs = useData<{ items: { id: string; code: string; name: string }[] }>("/procedures");
  const [f, setF] = useState({ kind: "document_for_procedure", procedureId: "", documentTypeId: "", maxAgeDays: "365" });
  async function add() {
    const body = f.kind === "document_for_procedure" ? { kind: f.kind, procedureId: f.procedureId, documentTypeId: f.documentTypeId } : { kind: f.kind, maxAgeDays: Number(f.maxAgeDays) };
    try { await api("/readiness-rules", { body }); notify("success", "Kural eklendi."); void rules.reload(); } catch (e) { notify("error", (e as ApiFailure).message); }
  }
  return (
    <section className="card">
      <div className="card-head"><div><h2>PİA Hazır kuralları</h2><p className="muted small">Yarınki randevular bu kurallara göre kontrol edilir; eksik varsa sekreteryaya görev düşer. Tıbbi uygunluk hakkında otomatik karar verilmez; hekim gerekçeli istisna kaydedebilir.</p></div></div>
      <ul className="list">{(rules.data?.items ?? []).map((r) => (
        <li key={r.id} className="row" style={{ padding: "10px 20px", justifyContent: "space-between" }}>
          <span>{r.kind === "anamnesis_reviewed" ? `Son ${r.maxAgeDays} gün içinde alınmış ve hekimce onaylı anamnez` : `${r.procedure} için “${r.documentType}” kabul edilmiş olmalı`}
            {!r.active && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>Pasif</span>}</span>
          <button className="btn btn-sm" onClick={() => void api(`/readiness-rules/${r.id}/active`, { body: { active: !r.active } }).then(() => rules.reload())}>{r.active ? "Pasifleştir" : "Etkinleştir"}</button>
        </li>
      ))}</ul>
      <div className="card-pad row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <SelectField label="Kural" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="document_for_procedure">İşlem için belge</option>
          <option value="anamnesis_reviewed">Güncel onaylı anamnez</option>
        </SelectField>
        {f.kind === "document_for_procedure" ? <>
          <SelectField label="İşlem" value={f.procedureId} onChange={(e) => setF({ ...f, procedureId: e.target.value })}>
            <option value="">Seçin</option>{procs.data?.items.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </SelectField>
          <SelectField label="Belge türü" value={f.documentTypeId} onChange={(e) => setF({ ...f, documentTypeId: e.target.value })}>
            <option value="">Seçin</option>{types.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
        </> : <TextField label="En fazla yaş (gün)" type="number" min={1} max={3650} value={f.maxAgeDays} onChange={(e) => setF({ ...f, maxAgeDays: e.target.value })} />}
        <button className="btn btn-primary" disabled={f.kind === "document_for_procedure" && (!f.procedureId || !f.documentTypeId)} onClick={() => void add()}>Kural ekle</button>
      </div>
    </section>
  );
}
