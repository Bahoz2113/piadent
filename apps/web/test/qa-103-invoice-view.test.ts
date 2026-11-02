/**
 * QA-103 (S3): fatura ayrıntısındaki üst uyarı, yazdırma düğmesi ve yazdırma çıktısı durumu yansıtır.
 * Yalnız draft/rejected → "TASLAK" + "Taslağı yazdır" + TASLAK filigranı; pending_provider/issued/cancelled → sağlayıcı durumu
 * (MOCK ise "MOCK — resmî değil"); "e-Belge sağlayıcısı bağlı değil" yalnız taslakta ve gerçekten bağlı değilken.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { InvoiceStatus } from "@viadent/contracts";
import { invoicePrintHtml, invoiceView, type InvoicePrintInput } from "../lib/invoice-view";

const NOTICE = "TASLAK — resmî belge değildir. Fatura numarası yalnız yetkili e-belge sağlayıcısı tarafından verilir.";
const base = (o: Partial<InvoicePrintInput> & { status: InvoiceStatus }): InvoicePrintInput => ({
  docType: "e_arsiv", invoiceNo: null, notice: NOTICE, providerConnected: false, providerMock: null, providerLabel: null, providerRef: null, cancelReason: null,
  buyer: { name: "Şükrü Çağlayan İğdır", taxNo: null, taxOffice: null, address: null }, patient: { fullName: "Sentetik Hasta", fileNo: 7 },
  lines: [{ description: "Satır", quantity: 1, unitPrice: "0.05", vatRate: 10, lineTotal: "0.05" }],
  subtotal: "0.05", vatTotal: "0.01", grandTotal: "0.06", createdBy: "Ece Bal", createdAt: "2026-11-02T09:13:00Z", ...o,
});
const MOCK_ISSUED = { invoiceNo: "MOCK202697C69990F", providerMock: true, providerLabel: "mock (mock)", providerRef: "mock_einvoice_submit_x" };

describe("QA-103 taslak durumları (draft / rejected): TASLAK kalır", () => {
  it("draft + sağlayıcı bağlı değil: TASLAK uyarısı + 'bağlı değil' + 'Taslağı yazdır' + TASLAK filigranı", () => {
    const x = base({ status: "draft" });
    const v = invoiceView(x);
    expect(v.notice).toContain("TASLAK — resmî belge değildir");
    expect(v.notice).toContain("e-Belge sağlayıcısı bağlı değil");
    expect(v.printLabel).toBe("Taslağı yazdır");
    expect(v.watermark).toBe("TASLAK");
    const html = invoicePrintHtml(x);
    expect(html).toContain(">TASLAK</div>");
    expect(html).toContain("— TASLAK</h2>");
    expect(html).toContain("resmî belge değildir");
    expect(html).toContain("Fatura no: <strong>yok</strong>");
  });
  it("draft + sağlayıcı bağlı: 'bağlı değil' yazmaz, TASLAK kalır", () => {
    const v = invoiceView(base({ status: "draft", providerConnected: true, providerMock: true }));
    expect(v.notice).not.toContain("bağlı değil");
    expect(v.notice).toContain("TASLAK");
    expect(v.printLabel).toBe("Taslağı yazdır");
  });
  it("rejected: taslak gibi davranır", () => {
    const v = invoiceView(base({ status: "rejected", providerConnected: true }));
    expect(v.isDraft).toBe(true);
    expect(v.watermark).toBe("TASLAK");
    expect(v.printLabel).toBe("Taslağı yazdır");
  });
});

describe("QA-103 sağlayıcı durumları: TASLAK yok, sağlayıcı durumu görünür", () => {
  const cases: [string, InvoicePrintInput][] = [
    ["issued (MOCK) — bağlantı sonradan pasif (kanıttaki durum)", base({ status: "issued", ...MOCK_ISSUED, providerConnected: false })],
    ["issued (MOCK) — bağlı", base({ status: "issued", ...MOCK_ISSUED, providerConnected: true })],
    ["cancelled (MOCK düzenlenmiş, sonra iptal) — kanıttaki fatura", base({ status: "cancelled", ...MOCK_ISSUED, cancelReason: "Sınama sağlayıcı iptali" })],
    ["pending_provider (MOCK)", base({ status: "pending_provider", providerMock: true, providerConnected: true })],
    ["issued (gerçek sağlayıcı)", base({ status: "issued", invoiceNo: "ABC2026000000001", providerMock: false, providerLabel: "ornek (live)", providerConnected: true })],
    ["cancelled (gerçek sağlayıcı)", base({ status: "cancelled", invoiceNo: "ABC2026000000001", providerMock: false, providerConnected: false, cancelReason: "Hatalı alıcı" })],
    ["cancelled (taslakken iptal, numara yok)", base({ status: "cancelled", cancelReason: "Vazgeçildi" })],
  ];
  for (const [name, x] of cases) {
    it(name, () => {
      const v = invoiceView(x);
      const html = invoicePrintHtml(x);
      expect(v.isDraft).toBe(false);
      expect(v.notice).not.toContain("TASLAK");
      expect(v.notice).not.toContain("bağlı değil");
      expect(v.printLabel).toBe("Yazdır");
      expect(v.watermark).not.toBe("TASLAK");
      expect(html).not.toContain("TASLAK");
      expect(html).not.toContain("bağlı değil");
      if (x.invoiceNo) expect(html).toContain(x.invoiceNo);
      if (x.invoiceNo?.startsWith("MOCK") || x.providerMock) {
        expect(v.notice).toContain("MOCK — resmî değil");
        expect(html).toContain("MOCK — resmî değil");
      } else {
        expect(v.notice).not.toContain("MOCK");
      }
      if (x.status === "cancelled") expect(v.watermark).toBe("İPTAL");
    });
  }
  it("gerçek sağlayıcıda düzenlenen fatura: 'Sağlayıcı belgesi: <no>' ve filigran yok", () => {
    const v = invoiceView(base({ status: "issued", invoiceNo: "ABC2026000000001", providerMock: false, providerLabel: "ornek (live)", providerConnected: true }));
    expect(v.notice).toContain("Sağlayıcı belgesi: ABC2026000000001");
    expect(v.watermark).toBeNull();
  });
});

describe("QA-103 bileşen yardımcıyı kullanır (sabit TASLAK metni/filigranı kalmadı)", () => {
  const src = readFileSync(new URL("../components/finance/invoices.tsx", import.meta.url), "utf8");
  it("fatura ayrıntısı uyarı/düğme/çıktıyı invoiceView/invoicePrintHtml ile üretir", () => {
    expect(src).toContain("invoiceView(");
    expect(src).toContain("invoicePrintHtml(");
    expect(src).not.toMatch(/>TASLAK<\/div>/);
    expect(src).not.toContain("/>Taslağı yazdır</button>");
    expect(src).not.toContain('{!x.providerConnected && " e-Belge sağlayıcısı bağlı değil');
  });
});
