"use client";
import { useEffect, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { ACCENTS, ACCENT_DEFS, DEFAULT_APPEARANCE, SCHEMES, SCHEME_LABELS, type Appearance } from "@viadent/contracts";
import { api } from "@/lib/api";
import { applyAppearance, readLocalAppearance, saveLocalAppearance } from "@/lib/appearance";
import { Drawer } from "@/components/ui";

/**
 * Görünüm (ADR-082): vurgu rengi, şema, ölçek. Seçim anında uygulanır (önizleme = gerçek), yerelde saklanır ve sunucuya yazılır
 * (başka cihazda oturum açınca gelir). Marka işareti değişmez; her palet açık/koyu şemada kontrast testinden geçer.
 */
export function AppearanceDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Drawer title="Görünüm" subtitle="Yalnız sizin için; kliniğin diğer kullanıcılarını etkilemez." onClose={onClose}>
      <AppearancePanel />
    </Drawer>
  );
}

export function AppearancePanel() {
  const [a, setA] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [saved, setSaved] = useState<"idle" | "saving" | "ok" | "err">("idle");
  useEffect(() => { setA(readLocalAppearance()); }, []);

  function update(patch: Partial<Appearance>) {
    const next = { ...a, ...patch };
    setA(next); applyAppearance(next); saveLocalAppearance(next);
    setSaved("saving");
    api("/me/appearance", { method: "PUT", body: next }).then(() => setSaved("ok")).catch(() => setSaved("err"));
  }
  const reset = () => update(DEFAULT_APPEARANCE);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Vurgu rengi</legend>
        <div className="swatches" role="radiogroup" aria-label="Vurgu rengi">
          {ACCENTS.map((k) => {
            const d = ACCENT_DEFS[k]; const on = a.accent === k;
            return (
              <button key={k} type="button" role="radio" aria-checked={on} aria-label={d.label} title={d.label} className={`swatch ${on ? "on" : ""}`}
                style={{ ["--sw" as string]: d.light.primary, ["--sw-dark" as string]: d.dark.primary, ["--sw-accent" as string]: d.light.accent }} onClick={() => update({ accent: k })}>
                {on && <Check size={16} aria-hidden />}
              </button>
            );
          })}
        </div>
        <p className="small muted">{ACCENT_DEFS[a.accent].label} · logo ve marka işareti değişmez.</p>
      </fieldset>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Renk şeması</legend>
        <div className="seg" role="radiogroup" aria-label="Renk şeması">
          {SCHEMES.map((s) => <button key={s} type="button" role="radio" aria-checked={a.scheme === s} className={`seg-btn ${a.scheme === s ? "on" : ""}`} onClick={() => update({ scheme: s })}>{SCHEME_LABELS[s]}</button>)}
        </div>
        <p className="small muted">Loş: koyu yüzeyler, yumuşak kontrast. Koyu: en düşük parlaklık. Cihaz ayarı sistemi izler.</p>
      </fieldset>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Yazı ölçeği</legend>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label="Küçült" disabled={a.scale <= 1} onClick={() => update({ scale: (a.scale - 1) as Appearance["scale"] })}><Minus size={16} /></button>
          <div className="scale-dots" role="slider" aria-label="Yazı ölçeği" aria-valuemin={1} aria-valuemax={5} aria-valuenow={a.scale} aria-valuetext={`${a.scale} / 5`} tabIndex={0}
            onKeyDown={(e) => { if (e.key === "ArrowLeft" && a.scale > 1) update({ scale: (a.scale - 1) as Appearance["scale"] }); if (e.key === "ArrowRight" && a.scale < 5) update({ scale: (a.scale + 1) as Appearance["scale"] }); }}>
            {[1, 2, 3, 4, 5].map((n) => <span key={n} className={`dot ${n === a.scale ? "on" : ""}`} onClick={() => update({ scale: n as Appearance["scale"] })} />)}
          </div>
          <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label="Büyüt" disabled={a.scale >= 5} onClick={() => update({ scale: (a.scale + 1) as Appearance["scale"] })}><Plus size={16} /></button>
          <span className="small muted">Aa · {["87,5", "93,75", "100", "106,25", "112,5"][a.scale - 1]}%</span>
        </div>
      </fieldset>

      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={reset}>Varsayılana dön</button>
        <span className="small muted" aria-live="polite">{saved === "saving" ? "Kaydediliyor…" : saved === "ok" ? "Kaydedildi (tüm cihazlarınızda)" : saved === "err" ? "Bu cihazda uygulandı; sunucuya kaydedilemedi" : ""}</span>
      </div>
    </div>
  );
}
