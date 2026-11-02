import { PAYMENT_METHOD_LABELS, formatTRY } from "@viadent/contracts";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { printHeaderHtml } from "@/components/brand";

export interface Receipt {
  id: string; kind: "payment" | "refund"; receiptNo: string; amount: string; issuedAt: string; issuedBy: string;
  clinic: { name: string; timezone: string };
  patient: { id: string; fullName: string; fileNo: number };
  payment: { id: string; method: string; paidAt: string; account: string; note: string | null; receiptNo: string | null };
  refund: { id: string; method: string; refundedAt: string; account: string; reason: string } | null;
  lines: { description: string; amount: string }[];
  notice: string;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const method = (m: string) => (PAYMENT_METHOD_LABELS as Record<string, string>)[m] ?? (m === "online" ? "Online (sağlayıcı)" : m);

/** Makbuz yazdırma: yazdırma olayı API'de denetim kaydına işlenir (receipt.print); içerik API verisinden kurulur, istemci hesaplamaz. */
export async function printReceipt(receiptId: string) {
  const r = (await api(`/receipts/${receiptId}/print`, { body: {} })) as Receipt;
  const w = window.open("", "_blank");
  if (!w) return r;
  const title = r.kind === "payment" ? "Tahsilat makbuzu" : "İade makbuzu";
  const when = r.kind === "payment" ? r.payment.paidAt : r.refund!.refundedAt;
  const row = (k: string, v: string) => `<tr><th style="text-align:left;padding:6px 12px 6px 0;color:#4f625d;font-weight:500;white-space:nowrap">${esc(k)}</th><td style="padding:6px 0">${v}</td></tr>`;
  const lines = r.lines.length
    ? `<h3 style="margin:24px 0 8px;font-size:14px">Sayıldığı alacaklar</h3><table style="border-collapse:collapse;width:100%">${r.lines.map((l) => `<tr><td style="padding:4px 0;border-bottom:1px solid #eef2f0">${esc(l.description)}</td><td style="padding:4px 0;border-bottom:1px solid #eef2f0;text-align:right;font-variant-numeric:tabular-nums">${esc(formatTRY(l.amount))}</td></tr>`).join("")}</table>`
    : "";
  w.document.title = `${title} ${r.receiptNo}`;
  w.document.body.insertAdjacentHTML("afterbegin", printHeaderHtml(r.clinic.name));
  w.document.body.insertAdjacentHTML("beforeend", `
    <main style="margin:24px 32px;font:14px/1.5 system-ui;color:#172b27;max-width:720px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap">
        <h2 style="margin:0;font-size:20px">${esc(title)}</h2>
        <strong style="font-size:18px;letter-spacing:.04em;font-variant-numeric:tabular-nums">${esc(r.receiptNo)}</strong>
      </div>
      <table style="margin-top:16px;border-collapse:collapse">
        ${row("Hasta", `${esc(r.patient.fullName)} <span style="color:#4f625d">· dosya no ${esc(r.patient.fileNo)}</span>`)}
        ${row(r.kind === "payment" ? "Tahsilat tarihi" : "İade tarihi", esc(fmtDateTime(when)))}
        ${row("Tutar", `<strong style="font-size:16px">${r.kind === "refund" ? "−" : ""}${esc(formatTRY(r.amount))}</strong>`)}
        ${row("Yöntem", esc(method(r.kind === "payment" ? r.payment.method : r.refund!.method)))}
        ${row("Kasa / banka", esc(r.kind === "payment" ? r.payment.account : r.refund!.account))}
        ${r.kind === "refund" ? row("İade edilen tahsilat", esc(r.payment.receiptNo ?? "—")) + row("Gerekçe", esc(r.refund!.reason)) : ""}
        ${r.kind === "payment" && r.payment.note ? row("Not", esc(r.payment.note)) : ""}
        ${row("Düzenleyen", esc(r.issuedBy))}
      </table>
      ${lines}
      <p style="margin-top:32px;padding-top:12px;border-top:1px dashed #d9e2dd;color:#4f625d;font-size:12px">${esc(r.notice)}<br/>Düzenlenme: ${esc(fmtDateTime(r.issuedAt))} · ${esc(r.clinic.name)}</p>
    </main>`);
  w.print();
  return r;
}
