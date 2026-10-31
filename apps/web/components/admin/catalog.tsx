"use client";
import { useEffect, useState } from "react";
import { Copy, Plus } from "lucide-react";
import { TOOTH_SCOPES, TOOTH_SCOPE_LABELS, formatTRY, isMoney, type ToothScope } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, todayIn } from "@/lib/format";
import { Alert, Drawer, ErrorState, Loading, SelectField, TextField, DateField } from "@/components/ui";

type Notify = (k: "success" | "error", t: string) => void;
interface Procedure { id: string; code: string; name: string; category: string | null; toothScope: ToothScope; defaultMinutes: number | null; active: boolean }
interface Tariff { id: string; name: string; validFrom: string; status: "draft" | "published" | "retired"; practitionerId: string | null; practitionerName: string | null; publishedAt: string | null; itemCount: number }
const TARIFF_STATUS: Record<Tariff["status"], [string, string]> = { draft: ["Taslak", "neutral"], published: ["Yayında", "success"], retired: ["Yürürlükten kalktı", "neutral"] };

export function CatalogPanel({ notify }: { notify: Notify }) {
  const procs = useData<{ items: Procedure[] }>("/procedures?all=1");
  const [editing, setEditing] = useState<Procedure | "new" | null>(null);
  if (procs.loading && !procs.data) return <div className="card"><Loading /></div>;
  if (procs.error) return <div className="card"><ErrorState error={procs.error} /></div>;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <div className="card-head">
          <div><h2>İşlem kataloğu</h2><p className="muted small">Kod ve konum kapsamı oluşturulduktan sonra değişmez (geçmiş planlar bu tanıma dayanır). Katalog DEMO içeriktir; resmî kod listesi iddiası yoktur.</p></div>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><Plus size={16} aria-hidden />Yeni işlem</button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Kod</th><th>Ad</th><th>Kategori</th><th>Konum kapsamı</th><th>Süre</th><th>Durum</th><th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>
              {procs.data!.items.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.code}</strong></td><td>{p.name}</td><td>{p.category ?? "—"}</td><td>{TOOTH_SCOPE_LABELS[p.toothScope]}</td>
                  <td>{p.defaultMinutes ? `${p.defaultMinutes} dk` : "—"}</td>
                  <td>{p.active ? <span className="badge badge-success">Etkin</span> : <span className="badge badge-neutral">Pasif</span>}</td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => setEditing(p)}>Düzenle</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <TariffsCard procedures={procs.data!.items} notify={notify} />
      {editing && <ProcedureDrawer p={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify("success", "İşlem kaydedildi."); void procs.reload(); }} />}
    </div>
  );
}

function ProcedureDrawer({ p, onClose, onSaved }: { p: Procedure | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: p?.code ?? "", name: p?.name ?? "", category: p?.category ?? "", toothScope: p?.toothScope ?? ("tooth" as ToothScope), defaultMinutes: String(p?.defaultMinutes ?? 30), active: p?.active ?? true });
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function save() {
    const body = { code: f.code, name: f.name, category: f.category || undefined, toothScope: f.toothScope, defaultMinutes: Number(f.defaultMinutes) || undefined, active: f.active };
    try { await (p ? api(`/procedures/${p.id}`, { method: "PATCH", body }) : api("/procedures", { body })); onSaved(); } catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title={p ? `İşlem: ${p.code}` : "Yeni işlem"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <TextField label="Kod" required value={f.code} disabled={!!p} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} error={err?.fieldErrors.code} hint={p ? "Kod değiştirilemez." : "Örn. DOL-03"} />
        <TextField label="Ad" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={err?.fieldErrors.name} />
        <TextField label="Kategori" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <SelectField label="Konum kapsamı" value={f.toothScope} disabled={!!p} onChange={(e) => setF({ ...f, toothScope: e.target.value as ToothScope })} hint={p ? "Kapsam değiştirilemez; gerekirse yeni işlem açın." : undefined}>
          {TOOTH_SCOPES.map((s) => <option key={s} value={s}>{TOOTH_SCOPE_LABELS[s]}</option>)}
        </SelectField>
        <TextField label="Varsayılan süre (dk)" type="number" min={5} max={720} value={f.defaultMinutes} onChange={(e) => setF({ ...f, defaultMinutes: e.target.value })} />
        <label className="row"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Etkin (plana eklenebilir)</label>
      </div>
    </Drawer>
  );
}

function TariffsCard({ procedures, notify }: { procedures: Procedure[]; notify: Notify }) {
  const tariffs = useData<{ items: Tariff[] }>("/tariffs");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ copyFrom?: Tariff } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function act(tid: string, path: string, ok: string) {
    setBusy(tid);
    try { await api(path, { body: {} }); notify("success", ok); await tariffs.reload(); } catch (e) { notify("error", (e as ApiFailure).message); } finally { setBusy(null); }
  }
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Tarifeler</h2><p className="muted small">Yayınlanan tarife değişmez; fiyat değişikliği için kopyalayıp yeni tarihli sürüm yayınlayın. Teklif edilmiş planlar eski fiyatı korur.</p></div>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating({})}><Plus size={16} aria-hidden />Yeni tarife</button>
      </div>
      {tariffs.loading && !tariffs.data ? <Loading /> : tariffs.error ? <ErrorState error={tariffs.error} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ad</th><th>Geçerlilik</th><th>Kapsam</th><th>Kalem</th><th>Durum</th><th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>
              {tariffs.data!.items.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong></td>
                  <td>{fmtDate(t.validFrom)} itibarıyla</td>
                  <td>{t.practitionerName ?? "Tüm hekimler"}</td>
                  <td>{t.itemCount}</td>
                  <td><span className={`badge badge-${TARIFF_STATUS[t.status][1]}`}>{TARIFF_STATUS[t.status][0]}</span></td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setOpen(t.id)}>{t.status === "draft" ? "Fiyatları düzenle" : "Fiyatları gör"}</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setCreating({ copyFrom: t })}><Copy size={14} aria-hidden />Kopyala</button>
                    {t.status === "draft" && <button className="btn btn-sm btn-primary" disabled={busy === t.id || t.itemCount === 0} onClick={() => void act(t.id, `/tariffs/${t.id}/publish`, "Tarife yayınlandı.")}>Yayınla</button>}
                    {t.status === "published" && <button className="btn btn-sm" disabled={busy === t.id} onClick={() => void act(t.id, `/tariffs/${t.id}/retire`, "Tarife yürürlükten kaldırıldı.")}>Kaldır</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewTariffDrawer copyFrom={creating.copyFrom} onClose={() => setCreating(null)} onSaved={(id) => { setCreating(null); notify("success", "Taslak tarife oluşturuldu."); void tariffs.reload(); setOpen(id); }} />}
      {open && <TariffItemsDrawer tariffId={open} procedures={procedures} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); notify("success", "Fiyatlar kaydedildi."); void tariffs.reload(); }} />}
    </section>
  );
}

function NewTariffDrawer({ copyFrom, onClose, onSaved }: { copyFrom?: Tariff; onClose: () => void; onSaved: (id: string) => void }) {
  const { tz } = useSession();
  const res = useData<{ practitioners: { id: string; name: string }[] }>("/resources");
  const [f, setF] = useState({ name: copyFrom ? `${copyFrom.name} (yeni sürüm)` : "", validFrom: todayIn(tz), practitionerId: copyFrom?.practitionerId ?? "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function save() {
    try {
      const r = await api<{ id: string }>("/tariffs", { body: { name: f.name, validFrom: f.validFrom, practitionerId: f.practitionerId || undefined, copyFromId: copyFrom?.id } });
      onSaved(r.id);
    } catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title={copyFrom ? "Tarifeyi kopyala" : "Yeni tarife"} subtitle={copyFrom ? `Fiyatlar “${copyFrom.name}” tarifesinden kopyalanır; taslak olarak açılır.` : "Taslak olarak açılır; fiyatları girip yayınlayın."} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Oluştur</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <TextField label="Ad" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={err?.fieldErrors.name} />
        <DateField label="Geçerlilik başlangıcı" required value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} error={err?.fieldErrors.validFrom} />
        <SelectField label="Kapsam" value={f.practitionerId} onChange={(e) => setF({ ...f, practitionerId: e.target.value })} hint="Hekime özel tarife, aynı tarihteki genel tarifeye göre önceliklidir.">
          <option value="">Tüm hekimler</option>
          {res.data?.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
      </div>
    </Drawer>
  );
}

function TariffItemsDrawer({ tariffId, procedures, onClose, onSaved }: { tariffId: string; procedures: Procedure[]; onClose: () => void; onSaved: () => void }) {
  const t = useData<{ id: string; name: string; status: string; items: { procedureId: string; code: string; name: string; active: boolean; price: string | null }[] }>(`/tariffs/${tariffId}`);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [err, setErr] = useState<ApiFailure | null>(null);
  useEffect(() => { if (t.data) setPrices(Object.fromEntries(t.data.items.map((i) => [i.procedureId, i.price ?? ""]))); }, [t.data]);
  const draft = t.data?.status === "draft";
  const invalid = Object.values(prices).some((v) => v !== "" && !isMoney(v));
  async function save() {
    try {
      await api(`/tariffs/${tariffId}/items`, { method: "PUT", body: { items: Object.entries(prices).filter(([, v]) => v !== "").map(([procedureId, price]) => ({ procedureId, price })) } });
      onSaved();
    } catch (e) { setErr(e as ApiFailure); }
  }
  void procedures;
  return (
    <Drawer title={t.data?.name ?? "Tarife"} subtitle={draft ? "Boş bırakılan işlem bu tarifede fiyatsızdır (plana eklerken elle fiyat ve açıklama istenir)." : "Yayınlanmış/kaldırılmış tarife salt okunurdur."} onClose={onClose}
      footer={draft ? <><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={invalid} onClick={() => void save()}>Kaydet</button></> : <button className="btn" onClick={onClose}>Kapat</button>}>
      {t.loading && !t.data ? <Loading /> : t.error ? <ErrorState error={t.error} /> : (
        <div className="stack">
          {err && <Alert kind="error">{err.message}</Alert>}
          {invalid && <Alert kind="warning">Tutarlar 1250.00 biçiminde olmalı (en fazla 2 ondalık).</Alert>}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>İşlem</th><th className="money">Fiyat (₺)</th></tr></thead>
              <tbody>
                {t.data!.items.map((i) => (
                  <tr key={i.procedureId}>
                    <td><strong>{i.code}</strong> {i.name}{!i.active && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>Pasif</span>}</td>
                    <td className="money">{draft ? (
                      <input className="input" style={{ width: 120, textAlign: "right" }} inputMode="decimal" aria-label={`${i.code} fiyatı`} value={prices[i.procedureId] ?? ""}
                        onChange={(e) => setPrices({ ...prices, [i.procedureId]: e.target.value.replace(",", ".") })} />
                    ) : i.price ? formatTRY(i.price) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  );
}
