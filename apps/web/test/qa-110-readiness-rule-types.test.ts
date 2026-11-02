/**
 * QA-110 (ADR-092): PİA Hazır kural formu klinik çıktı belge türlerini (epikriz, hasta bilgi föyü, reçete yazısı) listelemez;
 * onam/bilgilendirme türleri ve pasif türlerin dışlanması bugünkü gibi. Kural ekranı bu süzgeci kullanır.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readinessRuleDocTypes } from "../lib/readiness-rules";

const T = (code: string, category: string, active = true) => ({ id: code, code, name: code, category, active });
const TYPES = [
  T("GENEL-ONAM", "consent"), T("ENDO-ONAM", "consent"), T("KVKK-AYD", "privacy"), T("BILGI", "information"),
  T("EPIKRIZ", "clinical_output"), T("HASTA-FOYU", "clinical_output"), T("RECETE", "clinical_output"), T("ESKI-ONAM", "consent", false),
];

describe("QA-110 hazırlık kuralı belge türü seçenekleri", () => {
  it("klinik çıktı türleri ve pasif türler listelenmez; onam türleri kalır", () => {
    expect(readinessRuleDocTypes(TYPES).map((t) => t.code)).toEqual(["GENEL-ONAM", "ENDO-ONAM", "KVKK-AYD", "BILGI"]);
  });

  it("PİA Hazır kural formu bu süzgeci kullanır", () => {
    const src = readFileSync(join(__dirname, "../components/admin/templates.tsx"), "utf8");
    const block = src.slice(src.indexOf("function ReadinessRules"));
    expect(block).toContain("readinessRuleDocTypes(types)");
    expect(block).not.toMatch(/types\.filter\(\(t\) => t\.active\)\.map/);
  });
});
