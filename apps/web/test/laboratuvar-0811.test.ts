/**
 * ADR-108 (08.11.2026): Laboratuvar menüsü — hasta işleri (ölçü, istenen malzeme), malzeme siparişleri, tedarikçiler; Operasyon'da Stok kalır.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LAB_IMPRESSION_LABELS, LAB_MATERIAL_LABELS, LabOrderCreate, PurchaseOrderCreate, PurchaseReceive } from "@viadent/contracts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";

describe("menü ve sayfa", () => {
  it("menüde Laboratuvar; üç sekme; Operasyon'da yalnız Stok ve eski bağlantı yönlendirmesi", () => {
    expect(read("components/shell.tsx")).toMatch(/\{ href: "\/laboratuvar", label: "Laboratuvar", icon: FlaskConical \}/);
    const lab = read("app/(app)/laboratuvar/page.tsx");
    for (const t of ["Hasta işleri", "Malzeme siparişleri", "Tedarikçiler"]) expect(lab).toContain(`label: "${t}"`);
    expect(lab).toMatch(/<NewLabOrderDrawer onClose=/);
    const op = read("app/(app)/operasyon/page.tsx");
    expect(op).toMatch(/<StockPanel/);
    expect(op).not.toMatch(/LabBoard|SuppliersPanel/);
    expect(op).toMatch(/router\.replace\(`\/laboratuvar\?is=/);
    expect(read("app/(app)/is-akisi/page.tsx")).toMatch(/href=\{`\/laboratuvar\?is=\$\{t\.sourceId\}`\}/);
  });
  it("yeni iş emri hasta kartı dışından hasta seçerek açılır; ölçü ve malzeme alanları", () => {
    const l = read("components/operations/lab.tsx");
    expect(l).toMatch(/patientId: fixedPatientId/);
    expect(l).toMatch(/aria-label="Hasta sonuçları"/);
    expect(l).toMatch(/label="Ölçü türü"/);
    expect(l).toMatch(/label="Ölçü tarihi" max=\{todayIn\(tz\)\}/);
    expect(l).toMatch(/label="İstenen malzeme"/);
  });
});

describe("sözleşmeler", () => {
  it("ölçü ve malzeme etiketleri Türkçe ve eksiksiz", () => {
    expect(Object.values(LAB_IMPRESSION_LABELS).every((x) => x.length > 2)).toBe(true);
    expect(LAB_MATERIAL_LABELS.zirconia).toBe("Zirkonyum");
  });
  it("ölçü tarihi ölçü türü olmadan geçersiz", () => {
    const base = { patientId: U, supplierId: V, workType: "Kron" };
    expect(LabOrderCreate.safeParse({ ...base, impressionTakenOn: "2026-11-01" }).success).toBe(false);
    expect(LabOrderCreate.safeParse({ ...base, impressionType: "silicone", impressionTakenOn: "2026-11-01", material: "emax" }).success).toBe(true);
  });
  it("sipariş: en az bir kalem, tekrar yok, miktar > 0, en çok 3 ondalık; teslimde aynı satır iki kez yok", () => {
    expect(PurchaseOrderCreate.safeParse({ supplierId: U, lines: [] }).success).toBe(false);
    expect(PurchaseOrderCreate.safeParse({ supplierId: U, lines: [{ itemId: V, quantity: "1" }, { itemId: V, quantity: "2" }] }).success).toBe(false);
    expect(PurchaseOrderCreate.safeParse({ supplierId: U, lines: [{ itemId: V, quantity: "1.2345" }] }).success).toBe(false);
    expect(PurchaseOrderCreate.safeParse({ supplierId: U, lines: [{ itemId: V, quantity: "2.5", unitPrice: "12.35" }] }).success).toBe(true);
    expect(PurchaseReceive.safeParse({ expectedVersion: 1, lines: [{ lineId: U, quantity: "1" }, { lineId: U, quantity: "1" }] }).success).toBe(false);
  });
});
