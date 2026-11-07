/**
 * Odontogram veri modeli (ADR-103) — React'siz, birim testli. Klinik haritadan (bulgu, tanı, plan, gerçekleşen işlem) diş başına:
 *  - sayaçlar (planlı / gerçekleşen / tanı),
 *  - görsel durum (çekildi, dolgu yüzeyleri, kron, kanal, implant …) — kronolojik sırayla uygulanır,
 *  - ayrıntı listesi (üstüne gelince / tıklayınca gösterilen işlem geçmişi).
 * Gerçekleşen işlemin dişe yansıması kod/ad eşlemesiyle (contracts `procedureToothEffects`); kayıt değişmez, yalnız çizim türetilir.
 */
import { FINDING_LABELS, procedureToothEffects, TOOTH_EFFECT_LABELS, type FindingType, type ToothEffect } from "@viadent/contracts";

export interface ToothVisual {
  missing: boolean;     // eksik (bulgu) ya da çekildi
  extracted: boolean;   // bu klinikte çekim kaydı var
  implant: boolean; crown: boolean; rootCanal: boolean; post: boolean; veneer: boolean; sealant: boolean; inlay: boolean;
  pontic: boolean; fracture: boolean;
  filled: string[]; fillWhole: boolean;   // dolgu yüzeyleri (yüzeysiz dolgu = tüm taç)
  caries: string[]; cariesWhole: boolean;
}

export interface ToothRecord {
  kind: "done" | "planned" | "finding" | "diagnosis";
  code?: string; label: string; surfaces: string[]; at?: string; by?: string; effects: ToothEffect[];
}

export interface ToothState {
  findings: { type: FindingType; surfaces: string[] }[];
  planned: number;     // planlanan (tamamlanmamış) kalem sayısı
  done: number;        // gerçekleşen işlem sayısı
  diagnoses: number;   // aktif tanı
  visual: ToothVisual;
  records: ToothRecord[];
}

type Loc = { tooth?: string | null; surfaces?: string[] | null };
export interface ChartLike {
  findings: { tooth: string; surfaces: string[]; type: FindingType; status: string; at?: string; by?: string }[];
  diagnoses: { location: Loc; status: string; description?: string; code?: string | null; at?: string; by?: string }[];
  planned: { location: Loc; quantity: number; performedQty: number; code?: string; name?: string }[];
  performed: { location: Loc; status: string; code?: string; name?: string; at?: string; practitioner?: string }[];
}

export const emptyVisual = (): ToothVisual => ({
  missing: false, extracted: false, implant: false, crown: false, rootCanal: false, post: false, veneer: false, sealant: false, inlay: false,
  pontic: false, fracture: false, filled: [], fillWhole: false, caries: [], cariesWhole: false,
});

const uniq = (a: string[]) => [...new Set(a)];

function applyEffect(v: ToothVisual, e: ToothEffect, surfaces: string[]) {
  switch (e) {
    case "extraction": Object.assign(v, emptyVisual(), { missing: true, extracted: true }); break;
    case "implant": Object.assign(v, { missing: false, extracted: false, implant: true, rootCanal: false, post: false, caries: [], cariesWhole: false }); break;
    case "crown": Object.assign(v, { crown: true, caries: [], cariesWhole: false }); break;
    case "root_canal": v.rootCanal = true; break;
    case "post": v.post = true; break;
    case "veneer": v.veneer = true; break;
    case "sealant": v.sealant = true; break;
    case "inlay": v.inlay = true; break;
    case "filling":
      if (surfaces.length) { v.filled = uniq([...v.filled, ...surfaces]); v.caries = v.caries.filter((s) => !surfaces.includes(s)); }
      else { v.fillWhole = true; v.caries = []; v.cariesWhole = false; }
      break;
  }
}

function applyFinding(v: ToothVisual, type: FindingType, surfaces: string[]) {
  switch (type) {
    case "missing": v.missing = true; break;
    case "implant": applyEffect(v, "implant", []); break;
    case "crown": v.crown = true; break;
    case "root_canal": v.rootCanal = true; break;
    case "bridge_pontic": v.pontic = true; v.missing = false; break;
    case "fracture": v.fracture = true; break;
    case "filling": applyEffect(v, "filling", surfaces); break;
    case "caries": if (surfaces.length) v.caries = uniq([...v.caries, ...surfaces]); else v.cariesWhole = true; break;
    default: break;
  }
}

const time = (at?: string) => (at ? Date.parse(at) || 0 : 0);

/** Klinik haritadan diş başına durum. Özet kartı, Tedavi sekmesi ve randevu kaydı ortak kullanır. */
export function toothStates(chart: ChartLike | null | undefined): Record<string, ToothState> {
  const out: Record<string, ToothState> = {};
  const get = (t: string) => (out[t] ??= { findings: [], planned: 0, done: 0, diagnoses: 0, visual: emptyVisual(), records: [] });
  type Ev = { tooth: string; at: number; order: number; run: (v: ToothVisual) => void };
  const events: Ev[] = [];
  let order = 0;

  for (const f of chart?.findings ?? []) {
    if (f.status !== "current") continue;
    const s = get(f.tooth);
    s.findings.push({ type: f.type, surfaces: f.surfaces });
    s.records.push({ kind: "finding", label: FINDING_LABELS[f.type], surfaces: f.surfaces, at: f.at, by: f.by, effects: [] });
    events.push({ tooth: f.tooth, at: time(f.at), order: order++, run: (v) => applyFinding(v, f.type, f.surfaces) });
  }
  for (const d of chart?.diagnoses ?? []) {
    if (d.status !== "active" || !d.location.tooth) continue;
    const s = get(d.location.tooth);
    s.diagnoses++;
    s.records.push({ kind: "diagnosis", code: d.code ?? undefined, label: d.description ?? "Tanı", surfaces: d.location.surfaces ?? [], at: d.at, by: d.by, effects: [] });
  }
  for (const p of chart?.planned ?? []) {
    if (!p.location.tooth || p.performedQty >= p.quantity) continue;
    const s = get(p.location.tooth);
    s.planned++;
    s.records.push({ kind: "planned", code: p.code, label: p.name ?? "Planlı işlem", surfaces: p.location.surfaces ?? [], effects: procedureToothEffects(p.code, p.name) });
  }
  for (const p of chart?.performed ?? []) {
    if (p.status !== "completed" || !p.location.tooth) continue;
    const tooth = p.location.tooth;
    const s = get(tooth);
    s.done++;
    const effects = procedureToothEffects(p.code, p.name);
    const surfaces = p.location.surfaces ?? [];
    s.records.push({ kind: "done", code: p.code, label: p.name ?? "İşlem", surfaces, at: p.at, by: p.practitioner, effects });
    events.push({ tooth, at: time(p.at), order: order++, run: (v) => effects.forEach((e) => applyEffect(v, e, surfaces)) });
  }
  // Kronolojik uygula: aynı anda kaydedilenlerde bulgu önce, işlem sonra (işlem daha güncel bilgidir).
  events.sort((a, b) => a.at - b.at || a.order - b.order);
  for (const e of events) e.run(get(e.tooth).visual);
  const rank = { done: 0, planned: 1, finding: 2, diagnosis: 3 } as const;
  for (const s of Object.values(out)) s.records.sort((a, b) => rank[a.kind] - rank[b.kind] || time(b.at) - time(a.at));
  return out;
}

/** Diş görsel durumunun okunur özeti (erişilebilir ad, ipucu başlığı, test). Renge ek olarak metin. */
export function visualLabels(v: ToothVisual): string[] {
  const out: string[] = [];
  if (v.extracted) out.push(TOOTH_EFFECT_LABELS.extraction);
  else if (v.missing) out.push(FINDING_LABELS.missing);
  if (v.implant) out.push(TOOTH_EFFECT_LABELS.implant);
  if (v.pontic) out.push(FINDING_LABELS.bridge_pontic);
  if (v.crown) out.push(TOOTH_EFFECT_LABELS.crown);
  if (v.rootCanal) out.push(TOOTH_EFFECT_LABELS.root_canal);
  if (v.post) out.push(TOOTH_EFFECT_LABELS.post);
  if (v.veneer) out.push(TOOTH_EFFECT_LABELS.veneer);
  if (v.inlay) out.push(TOOTH_EFFECT_LABELS.inlay);
  if (v.sealant) out.push(TOOTH_EFFECT_LABELS.sealant);
  if (v.fillWhole) out.push("Dolgu");
  else if (v.filled.length) out.push(`Dolgu (${v.filled.join("")})`);
  if (v.cariesWhole) out.push("Çürük");
  else if (v.caries.length) out.push(`Çürük (${v.caries.join("")})`);
  if (v.fracture) out.push(FINDING_LABELS.fracture);
  return out;
}
