/**
 * ADR-103 (07.11.2026 geri bildirimi): anatomik odontogram — gerçekleşen işlem dişe kendiliğinden yansır,
 * çekilen diş eksik görünür, ipucu/ayrıntıda işlem geçmişi; randevudan dişe işlem kaydı.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toothStates, visualLabels } from "../components/treatment/tooth-model";
import { buccalShape, OCCLUSAL, occlusalRegions } from "../components/treatment/tooth-shapes";
import { toothKind } from "@viadent/contracts";

const loc = (tooth: string, surfaces: string[] = []) => ({ tooth, surfaces });
const done = (tooth: string, code: string, name: string, at: string, surfaces: string[] = []) =>
  ({ location: loc(tooth, surfaces), status: "completed", code, name, at, practitioner: "Dt. Sentetik" });

describe("diş durumu türetme", () => {
  it("dolgu yüzeyde, çekim dişi eksik yapar; ipucu kayıtları tarih ve hekimle", () => {
    const s = toothStates({
      findings: [], diagnoses: [], planned: [],
      performed: [
        done("16", "DOL-02", "Kompozit dolgu (iki yüz)", "2026-11-01T09:00:00Z", ["M", "O"]),
        done("36", "CEK-01", "Diş çekimi (basit)", "2026-11-02T09:00:00Z"),
      ],
    });
    expect(s["16"]!.visual.filled.sort()).toEqual(["M", "O"]);
    expect(s["16"]!.visual.missing).toBe(false);
    expect(visualLabels(s["16"]!.visual)).toEqual(["Dolgu (MO)"]);
    expect(s["36"]!.visual).toMatchObject({ missing: true, extracted: true });
    expect(visualLabels(s["36"]!.visual)).toEqual(["Çekildi"]);
    expect(s["16"]!.records[0]).toMatchObject({ kind: "done", code: "DOL-02", surfaces: ["M", "O"], by: "Dt. Sentetik" });
    expect(s["16"]!.done).toBe(1);
  });

  it("kronolojik: çekimden sonra implant + kron dişi geri getirir; kanal + kron birlikte", () => {
    const s = toothStates({
      findings: [], diagnoses: [], planned: [],
      performed: [
        done("46", "IMP-02", "İmplant üstü kron", "2026-11-05T09:00:00Z"),
        done("46", "CEK-02", "Diş çekimi (cerrahi)", "2026-10-01T09:00:00Z"),
        done("26", "KAN-03", "Kanal tedavisi (üç kanal)", "2026-10-01T09:00:00Z"),
        done("26", "KRN-01", "Zirkonyum kron", "2026-10-15T09:00:00Z"),
      ],
    });
    expect(s["46"]!.visual).toMatchObject({ missing: false, extracted: false, implant: true, crown: true });
    expect(s["26"]!.visual).toMatchObject({ rootCanal: true, crown: true, missing: false });
    expect(s["46"]!.records.map((r) => r.code)).toEqual(["IMP-02", "CEK-02"]); // yeniden eskiye
  });

  it("bulgu: çürük sonradan yapılan dolguyla kapanır; eksik bulgusu; düzeltilen / geri alınan işlem çizilmez", () => {
    const s = toothStates({
      findings: [
        { tooth: "17", surfaces: ["O", "D"], type: "caries", status: "current", at: "2026-10-01T09:00:00Z" },
        { tooth: "18", surfaces: [], type: "missing", status: "current", at: "2026-10-01T09:00:00Z" },
        { tooth: "15", surfaces: ["O"], type: "caries", status: "resolved", at: "2026-10-01T09:00:00Z" },
      ],
      diagnoses: [{ location: loc("17"), status: "active", description: "Dentin çürüğü", code: "K02.1" }],
      planned: [{ location: loc("17"), quantity: 1, performedQty: 0, code: "KAN-01", name: "Kanal tedavisi (tek kanal)" }],
      performed: [
        done("17", "DOL-01", "Kompozit dolgu (tek yüz)", "2026-10-10T09:00:00Z", ["O"]),
        { ...done("14", "CEK-01", "Diş çekimi (basit)", "2026-10-10T09:00:00Z"), status: "corrected" },
      ],
    });
    expect(s["17"]!.visual.caries).toEqual(["D"]);
    expect(s["17"]!.visual.filled).toEqual(["O"]);
    expect(visualLabels(s["17"]!.visual)).toEqual(["Çürük (D)", "Dolgu (O)"]);
    expect(s["17"]!.records.map((r) => r.kind)).toEqual(["done", "planned", "finding", "diagnosis"]);
    expect(s["17"]!).toMatchObject({ planned: 1, diagnoses: 1 });
    expect(s["18"]!.visual).toMatchObject({ missing: true, extracted: false });
    expect(visualLabels(s["18"]!.visual)).toEqual(["Eksik diş"]);
    expect(s["15"]).toBeUndefined();
    expect(s["14"]).toBeUndefined();
  });
});

describe("anatomik çizim", () => {
  it("her diş türünün taç ve kökü var; üst 1. küçük azı iki, üst büyük azı üç, alt büyük azı iki köklü", () => {
    for (const t of ["11", "12", "13", "15", "36", "51", "55"]) {
      const sh = buccalShape(t, toothKind(t));
      expect(sh.crown).toMatch(/^M/);
      expect(sh.roots.length).toBeGreaterThan(0);
      expect(sh.canals.length).toBe(sh.roots.length);
    }
    expect(buccalShape("14", "premolar").roots).toHaveLength(2);
    expect(buccalShape("44", "premolar").roots).toHaveLength(1);
    expect(buccalShape("16", "molar").roots).toHaveLength(3);
    expect(buccalShape("46", "molar").roots).toHaveLength(2);
  });
  it("çiğneme yüzü 5 yüzey bölgesi", () => {
    for (const k of Object.values(OCCLUSAL)) expect(occlusalRegions(k.box).map((r) => r.r)).toEqual(["top", "right", "bottom", "left", "center"]);
  });
});

describe("kaynak bağlantıları", () => {
  const odo = readFileSync(new URL("../components/treatment/odontogram.tsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("../components/treatment/tooth-summary.tsx", import.meta.url), "utf8");
  const ajanda = readFileSync(new URL("../app/(app)/ajanda/page.tsx", import.meta.url), "utf8");
  const perform = readFileSync(new URL("../components/appointment/perform-on-tooth.tsx", import.meta.url), "utf8");
  it("ipucu üstüne gelince ve odakta açılır; erişilebilir ad durum metnini içerir", () => {
    expect(odo).toMatch(/onMouseEnter=/);
    expect(odo).toMatch(/onFocus=/);
    expect(odo).toMatch(/role="tooltip"/);
    expect(odo).toMatch(/aria-describedby=/);
    expect(odo).toMatch(/visualLabels\(s\.visual\)/);
  });
  it("hasta kartı özetinde şema ve seçili diş ayrıntısı; randevuda dişe işlem kaydı aynı uca gider", () => {
    expect(card).toMatch(/<ToothRecords state=\{sel\}/);
    expect(ajanda).toMatch(/<PerformOnTooth /);
    expect(perform).toMatch(/\/patients\/\$\{patientId\}\/performed/);
    expect(perform).toMatch(/can\("procedure\.complete"\) && can\("patient\.health\.read"\)/);
  });
});
