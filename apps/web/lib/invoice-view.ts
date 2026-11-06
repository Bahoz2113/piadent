import { INVOICE_DOC_TYPE_LABELS, INVOICE_STATUS_LABELS, formatTRY, type InvoiceDocType, type InvoiceStatus } from "@viadent/contracts";
import { fmtDateTime } from "./format";

/**
 * QA-103: fatura ayrıntısındaki uyarı, yazdırma düğmesi ve yazdırma çıktısı faturanın durumunu yansıtır (ADR-083/086).
 * - Yalnız `draft` ve `rejected` "TASLAK"tır: taslak uyarısı, "Taslağı yazdır", TASLAK filigranı.
 * - `pending_provider` / `issued` / `cancelled`: sağlayıcı durumu gösterilir; MOCK ise açıkça "MOCK — resmî değil".
 * - "e-Belge sağlayıcısı bağlı değil" cümlesi yalnız gönderilebilir durumdaki (taslak) faturada ve gerçekten bağlı değilken.
 */
export interface InvoiceViewInput {
  docType: InvoiceDocType; status: InvoiceStatus; invoiceNo: string | null; notice: string;
  providerConnected: boolean; providerMock: boolean | null; providerLabel: string | null; providerRef: string | null;
  cancelReason: string | null;
}
export interface InvoicePrintInput extends InvoiceViewInput {
  buyer: { name: string; taxNo: string | null; taxOffice: string | null; address: string | null };
  patient: { fullName: string; fileNo: number };
  lines: { description: string; quantity: number; unitPrice: string; vatRate: number; lineTotal: string }[];
  subtotal: string; vatTotal: string; grandTotal: string; createdBy: string; createdAt: string;
}

export const MOCK_NOT_OFFICIAL = "DENEME — resmî değil";
export const PROVIDER_NOT_CONNECTED = "e-Belge sağlayıcısı bağlı değil; gönderim denemesi reddedilir ve kaydedilir.";

export function invoiceView(x: InvoiceViewInput) {
  const isDraft = x.status === "draft" || x.status === "rejected";
  const mock = x.providerMock === true || !!x.invoiceNo?.startsWith("MOCK");
  const tag = mock ? ` ${MOCK_NOT_OFFICIAL}.` : "";
  let notice: string;
  let kind: "warning" | "info";
  if (isDraft) {
    notice = `${x.notice}${!x.providerConnected ? ` ${PROVIDER_NOT_CONNECTED}` : ""}`;
    kind = "warning";
  } else if (x.status === "pending_provider") {
    notice = `${mock ? "Deneme sağlayıcıya" : "e-Belge sağlayıcısına"} iletildi; fatura numarası yalnız sağlayıcı yanıtıyla oluşur.${tag}`;
    kind = mock ? "warning" : "info";
  } else if (x.status === "issued") {
    notice = mock ? `Deneme sağlayıcı tarafından düzenlendi (${x.invoiceNo ?? "numara yok"}). ${MOCK_NOT_OFFICIAL}; gerçek e-belge değildir.`
      : `Sağlayıcı belgesi: ${x.invoiceNo ?? "—"}${x.providerLabel ? ` · ${x.providerLabel}` : ""}.`;
    kind = mock ? "warning" : "info";
  } else {
    // cancelled: numara varsa sağlayıcıda düzenlenip iptal edilmiştir; yoksa taslak aşamasında iptal edilmiştir.
    notice = x.invoiceNo
      ? (mock ? `Deneme sağlayıcıda düzenlenen fatura iptal edildi (${x.invoiceNo}). ${MOCK_NOT_OFFICIAL}.` : `Sağlayıcı belgesi iptal edildi: ${x.invoiceNo}.`)
      : "Taslak, sağlayıcıya gönderilmeden iptal edildi; resmî belge düzenlenmedi.";
    kind = mock ? "warning" : "info";
  }
  const watermark = isDraft ? "TASLAK" : x.status === "cancelled" ? "İPTAL" : mock ? "DENEME" : null;
  const heading = `${INVOICE_DOC_TYPE_LABELS[x.docType]} — ${isDraft ? "TASLAK" : INVOICE_STATUS_LABELS[x.status]}`;
  const numberLine = isDraft || !x.invoiceNo
    ? "Fatura no: <strong>yok</strong> (sağlayıcı düzenlemedi)"
    : `Fatura no: <strong>${esc(x.invoiceNo)}</strong>${mock ? ` (${MOCK_NOT_OFFICIAL})` : ""}${x.providerRef ? ` · ref ${esc(x.providerRef)}` : ""}`;
  return { isDraft, mock, notice, kind, printLabel: isDraft ? "Taslağı yazdır" : "Yazdır", printTitle: isDraft ? "Fatura taslağı" : "Fatura", watermark, heading, numberLine };
}

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Yazdırma penceresinin <main> içeriği; filigran ve başlık `invoiceView` ile durumdan türetilir. */
export function invoicePrintHtml(x: InvoicePrintInput): string {
  const v = invoiceView(x);
  return `<main style="margin:24px 32px;font:14px/1.5 system-ui;color:#172b27;max-width:760px;position:relative">
      ${v.watermark ? `<div data-watermark style="position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;opacity:.08;font:800 72px system-ui;transform:rotate(-20deg)">${esc(v.watermark)}</div>` : ""}
      <h2 style="margin:0 0 4px;font-size:20px">${esc(v.heading)}</h2>
      <p style="margin:0 0 16px;color:${v.kind === "warning" ? "#b42318" : "#4f625d"};font-weight:600">${esc(v.notice)}</p>
      <p><strong>Alıcı:</strong> ${esc(x.buyer.name)}${x.buyer.taxNo ? ` · VKN ${esc(x.buyer.taxNo)}` : ""}${x.buyer.taxOffice ? ` · ${esc(x.buyer.taxOffice)}` : ""}<br/>${esc(x.buyer.address ?? "")}</p>
      <p><strong>Hasta:</strong> ${esc(x.patient.fullName)} · dosya no ${esc(x.patient.fileNo)}</p>
      <table style="border-collapse:collapse;width:100%;margin-top:12px"><thead><tr style="text-align:left;color:#4f625d"><th style="padding:6px 0">Açıklama</th><th>Adet</th><th>Birim</th><th>KDV</th><th style="text-align:right">Tutar</th></tr></thead>
      <tbody>${x.lines.map((l) => `<tr><td style="padding:6px 0;border-top:1px solid #eef2f0">${esc(l.description)}</td><td style="border-top:1px solid #eef2f0">${l.quantity}</td><td style="border-top:1px solid #eef2f0">${esc(formatTRY(l.unitPrice))}</td><td style="border-top:1px solid #eef2f0">%${l.vatRate}</td><td style="border-top:1px solid #eef2f0;text-align:right">${esc(formatTRY(l.lineTotal))}</td></tr>`).join("")}</tbody></table>
      <p style="text-align:right;margin-top:12px">KDV hariç <strong>${esc(formatTRY(x.subtotal))}</strong> · KDV <strong>${esc(formatTRY(x.vatTotal))}</strong> · Genel toplam <strong style="font-size:16px">${esc(formatTRY(x.grandTotal))}</strong></p>
      ${x.cancelReason ? `<p><strong>İptal gerekçesi:</strong> ${esc(x.cancelReason)}</p>` : ""}
      <p style="margin-top:24px;color:#4f625d;font-size:12px">${v.numberLine} · Hazırlayan: ${esc(x.createdBy)} · ${esc(fmtDateTime(x.createdAt))}</p></main>`;
}
