import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Res } from "@nestjs/common";
import type { Response } from "express";
import type pg from "pg";
import { InvoiceCancel, InvoiceCreate, InvoiceLinesReplace, addMoney, mulMoney, vatOf } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";
import { idempotent, requireKey } from "./ledger.js";
import { createJob } from "../bridge/bridge.controller.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
const replayHeader = (res: Response, r: { replayed: boolean }) => { if (r.replayed) res.setHeader("Idempotent-Replayed", "true"); };
type Line = { description: string; quantity: number; unitPrice: string; vatRate: number; receivableId?: string };

/** Satır tutarları bigint ile: satır toplamı = birim × adet; KDV satır bazında yarım-yukarı. */
export function computeLines(lines: Line[]) {
  const rows = lines.map((l, i) => {
    const lineTotal = mulMoney(l.unitPrice, l.quantity);
    return { lineNo: i + 1, ...l, lineTotal, vatAmount: vatOf(lineTotal, l.vatRate) };
  });
  const subtotal = addMoney("0", ...rows.map((r) => r.lineTotal));
  const vatTotal = addMoney("0", ...rows.map((r) => r.vatAmount));
  return { rows, subtotal, vatTotal, grandTotal: addMoney(subtotal, vatTotal) };
}

/**
 * Fatura taslağı (Faz 2.2, ADR-083). Numara üretilmez; "gönder" yalnız etkin e-belge sağlayıcısı bağlıysa işler, yoksa 409.
 * Taslak → iptal; taslak satırları değiştirilebilir; düzenlenmiş/iptal kayıt kilitli (DB tetikleyicisi).
 */
@Controller()
export class InvoicesController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("patients/:patientId/invoices")
  @Require("account.read")
  list(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const r = await c.query(
        `select i.id, i.doc_type, i.status, i.buyer_type, i.buyer_name, i.grand_total::text, i.subtotal::text, i.vat_total::text, i.invoice_no, i.issued_at, i.created_at, i.cancel_reason,
                (select count(*) from invoice_lines l where l.invoice_id = i.id)::int as line_count
           from invoices i where i.patient_id = $1 order by i.created_at desc`, [patientId]);
      return { items: r.rows.map((i) => ({ id: i.id, docType: i.doc_type, status: i.status, buyerType: i.buyer_type, buyerName: i.buyer_name, subtotal: i.subtotal, vatTotal: i.vat_total,
        grandTotal: i.grand_total, invoiceNo: i.invoice_no, issuedAt: i.issued_at, createdAt: i.created_at, cancelReason: i.cancel_reason, lineCount: i.line_count })),
        providerConnected: await this.providerConnected(c), providerMock: await this.providerMock(c) };
    });
  }

  @Get("invoices/:id")
  @Require("account.read")
  get(@Ctx() ctx: RequestContext, @Param("id", id) invoiceId: string) {
    return this.db.tx(ctx, async (c) => {
      const base = await this.load(c, invoiceId);
      const conn = base.providerConnectionId ? (await c.query("select provider, mode from integration_connections where id = $1", [base.providerConnectionId])).rows[0] : null;
      return { ...base, providerConnected: await this.providerConnected(c), providerMock: conn ? conn.mode === "mock" : null, providerLabel: conn ? `${conn.provider} (${conn.mode})` : null, clinic: { name: ctx.tenantName } };
    });
  }

  @Post("invoices")
  @Require("invoice.write")
  create(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(InvoiceCreate, body);
    const k = requireKey(key);
    const calc = computeLines(i.lines);
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "invoice.create", k, i, async () => {
        if (!(await c.query("select 1 from patients where id = $1", [i.patientId])).rowCount) throw Errors.notFound("Hasta");
        await this.checkReceivables(c, i.patientId, calc.rows.map((l) => l.receivableId).filter((x): x is string => !!x));
        const ins = await c.query(
          `insert into invoices(tenant_id, patient_id, doc_type, buyer_type, buyer_name, buyer_tax_no, buyer_tax_office, buyer_address, buyer_email, note, subtotal, vat_total, grand_total, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
          [ctx.tenantId, i.patientId, i.docType, i.buyerType, i.buyerName, i.buyerTaxNo ?? null, i.buyerTaxOffice ?? null, i.buyerAddress ?? null, i.buyerEmail ?? null, i.note ?? null,
           calc.subtotal, calc.vatTotal, calc.grandTotal, ctx.userId]);
        const invId = ins.rows[0].id as string;
        await this.insertLines(c, ctx, invId, calc.rows);
        await audit(c, ctx, { action: "invoice.create", entityType: "invoice", entityId: invId, patientId: i.patientId,
          changes: { doc_type: { from: null, to: i.docType }, buyer_name: { from: null, to: i.buyerName }, grand_total: { from: null, to: calc.grandTotal }, line_count: { from: null, to: calc.rows.length } } });
        return { id: invId, status: "draft", subtotal: calc.subtotal, vatTotal: calc.vatTotal, grandTotal: calc.grandTotal };
      });
      replayHeader(res, r);
      return r.body;
    });
  }

  @Put("invoices/:id/lines")
  @Require("invoice.write")
  @HttpCode(200)
  replaceLines(@Ctx() ctx: RequestContext, @Param("id", id) invoiceId: string, @Body() body: unknown) {
    const i = parse(InvoiceLinesReplace, body);
    const calc = computeLines(i.lines);
    return this.db.tx(ctx, async (c) => {
      const inv = (await c.query("select patient_id, status, grand_total::text from invoices where id = $1 for update", [invoiceId])).rows[0];
      if (!inv) throw Errors.notFound("Fatura taslağı");
      if (inv.status !== "draft") throw new AppError(409, "INVOICE_NOT_DRAFT", "Yalnız taslak faturanın satırları değiştirilebilir.");
      await this.checkReceivables(c, inv.patient_id, calc.rows.map((l) => l.receivableId).filter((x): x is string => !!x));
      await c.query("delete from invoice_lines where invoice_id = $1", [invoiceId]);
      await this.insertLines(c, ctx, invoiceId, calc.rows);
      await c.query("update invoices set subtotal = $2, vat_total = $3, grand_total = $4 where id = $1", [invoiceId, calc.subtotal, calc.vatTotal, calc.grandTotal]);
      await audit(c, ctx, { action: "invoice.update_lines", entityType: "invoice", entityId: invoiceId, patientId: inv.patient_id,
        changes: { grand_total: { from: inv.grand_total, to: calc.grandTotal }, line_count: { from: null, to: calc.rows.length } } });
      return { id: invoiceId, subtotal: calc.subtotal, vatTotal: calc.vatTotal, grandTotal: calc.grandTotal };
    });
  }

  @Post("invoices/:id/cancel")
  @Require("invoice.write")
  @HttpCode(200)
  cancel(@Ctx() ctx: RequestContext, @Param("id", id) invoiceId: string, @Body() body: unknown) {
    const i = parse(InvoiceCancel, body);
    return this.db.tx(ctx, async (c) => {
      const inv = (await c.query("select patient_id, status from invoices where id = $1 for update", [invoiceId])).rows[0];
      if (!inv) throw Errors.notFound("Fatura taslağı");
      if (inv.status === "cancelled") throw new AppError(409, "INVOICE_ALREADY_CANCELLED", "Bu kayıt zaten iptal edilmiş.");
      if (inv.status === "issued") {
        const conn = (await c.query("select id from integration_connections where kind = 'e_invoice' and status = 'active' limit 1")).rows[0];
        if (!conn) throw new AppError(409, "INVOICE_ISSUED_CANCEL_VIA_PROVIDER", "Düzenlenmiş fatura yalnız e-belge sağlayıcısı üzerinden iptal edilir (sağlayıcı bağlı değil).");
        const jobId = await createJob(c, ctx, { connectionId: conn.id, operation: "einvoice.cancel", sourceType: "invoice", sourceId: invoiceId,
          key: `einvoice.cancel:${invoiceId}`, payload: { invoiceId, reason: i.reason }, requiresApproval: false });
        await c.query("update invoices set cancel_reason = $2 where id = $1", [invoiceId, i.reason]); // durum sağlayıcı onayıyla değişir
        await audit(c, ctx, { action: "invoice.cancel_requested", entityType: "invoice", entityId: invoiceId, patientId: inv.patient_id, changes: { reason: { from: null, to: i.reason } } });
        return { id: invoiceId, status: "issued", cancelRequested: true, jobId };
      }
      if (inv.status === "pending_provider") throw new AppError(409, "INVOICE_PENDING", "Sağlayıcı yanıtı beklenirken iptal edilemez.");
      await c.query("update invoices set status = 'cancelled', cancel_reason = $2, cancelled_at = now(), cancelled_by = $3 where id = $1", [invoiceId, i.reason, ctx.userId]);
      await audit(c, ctx, { action: "invoice.cancel", entityType: "invoice", entityId: invoiceId, patientId: inv.patient_id,
        changes: { status: { from: inv.status, to: "cancelled" }, reason: { from: null, to: i.reason } } });
      return { id: invoiceId, status: "cancelled" };
    });
  }

  /**
   * Sağlayıcıya gönderim (ADR-083/086): etkin e-belge bağlantısı yoksa 409 — sahte "gönderildi" yok. Bağlantı varsa iş kuyruğa
   * alınır (PİA Köprü), fatura "sağlayıcıda bekliyor" olur; numara yalnız sağlayıcı yanıtıyla (worker) yazılır. MOCK bağlantıda numara "MOCK…" ile başlar.
   */
  @Post("invoices/:id/submit")
  @Require("invoice.write")
  @HttpCode(200)
  async submit(@Ctx() ctx: RequestContext, @Param("id", id) invoiceId: string) {
    const out = await this.db.tx(ctx, async (c) => {
      const inv = (await c.query("select patient_id, status, grand_total::text, doc_type from invoices where id = $1 for update", [invoiceId])).rows[0];
      if (!inv) throw Errors.notFound("Fatura taslağı");
      if (inv.status !== "draft") throw new AppError(409, "INVOICE_NOT_DRAFT", "Yalnız taslak gönderilebilir.");
      const conn = (await c.query("select id, provider, mode from integration_connections where kind = 'e_invoice' and status = 'active' limit 1")).rows[0];
      if (!conn) {
        await audit(c, ctx, { action: "invoice.submit_blocked", entityType: "invoice", entityId: invoiceId, patientId: inv.patient_id, changes: { reason: { from: null, to: "e-belge sağlayıcısı bağlı değil" } } });
        return { kind: "no_provider" as const };
      }
      // Yük: kimlik verisi yok; sağlayıcı adaptörü gerektiğinde kaydı kendisi okur (veri en aza indirme).
      const jobId = await createJob(c, ctx, { connectionId: conn.id, operation: "einvoice.submit", sourceType: "invoice", sourceId: invoiceId,
        key: `einvoice.submit:${invoiceId}`, payload: { invoiceId, docType: inv.doc_type, grandTotal: inv.grand_total }, requiresApproval: false });
      await c.query("update invoices set status = 'pending_provider', provider_connection_id = $2 where id = $1", [invoiceId, conn.id]);
      await audit(c, ctx, { action: "invoice.submit", entityType: "invoice", entityId: invoiceId, patientId: inv.patient_id,
        changes: { status: { from: "draft", to: "pending_provider" }, provider: { from: null, to: `${conn.provider} (${conn.mode})` } } });
      return { kind: "queued" as const, jobId, mock: conn.mode === "mock" };
    });
    if (out.kind === "no_provider") throw new AppError(409, "E_INVOICE_PROVIDER_UNAVAILABLE", "e-Belge sağlayıcısı bağlı değil: fatura düzenlenemez. Taslak saklandı; sağlayıcı sözleşmesi ve test ortamı tamamlanınca gönderilebilir.");
    return { id: invoiceId, status: "pending_provider", jobId: out.jobId, mock: out.mock };
  }

  private async providerMock(c: pg.PoolClient) {
    const r = (await c.query("select mode from integration_connections where kind = 'e_invoice' and status = 'active' limit 1")).rows[0];
    return r ? r.mode === "mock" : null;
  }
  private async providerConnected(c: pg.PoolClient) {
    return !!(await c.query("select 1 from integration_connections where kind = 'e_invoice' and status = 'active' limit 1")).rowCount;
  }
  private async checkReceivables(c: pg.PoolClient, patientId: string, ids: string[]) {
    if (!ids.length) return;
    const r = await c.query("select id, patient_id from receivables where id = any($1::uuid[])", [ids]);
    for (const rid of ids) {
      const row = r.rows.find((x) => x.id === rid);
      if (!row || row.patient_id !== patientId) throw Errors.validation({ lines: "Seçilen alacak bu hastaya ait değil." });
    }
  }
  private async insertLines(c: pg.PoolClient, ctx: RequestContext, invoiceId: string, rows: ReturnType<typeof computeLines>["rows"]) {
    for (const l of rows) {
      await c.query(
        `insert into invoice_lines(tenant_id, invoice_id, line_no, description, quantity, unit_price, vat_rate, line_total, vat_amount, receivable_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [ctx.tenantId, invoiceId, l.lineNo, l.description, l.quantity, l.unitPrice, l.vatRate, l.lineTotal, l.vatAmount, l.receivableId ?? null]);
    }
  }
  private async load(c: pg.PoolClient, invoiceId: string) {
    const i = (await c.query(
      `select i.*, i.subtotal::text as subtotal_t, i.vat_total::text as vat_total_t, i.grand_total::text as grand_total_t, u.full_name as created_by_name,
              p.first_name, p.last_name, p.file_no
         from invoices i join users u on u.id = i.created_by join patients p on p.id = i.patient_id where i.id = $1`, [invoiceId])).rows[0];
    if (!i) throw Errors.notFound("Fatura taslağı");
    const lines = (await c.query("select line_no, description, quantity, unit_price::text, vat_rate, line_total::text, vat_amount::text, receivable_id from invoice_lines where invoice_id = $1 order by line_no", [invoiceId])).rows;
    return {
      id: i.id, patientId: i.patient_id, patient: { fullName: `${i.first_name} ${i.last_name}`, fileNo: i.file_no }, docType: i.doc_type, status: i.status,
      buyer: { type: i.buyer_type, name: i.buyer_name, taxNo: i.buyer_tax_no, taxOffice: i.buyer_tax_office, address: i.buyer_address, email: i.buyer_email },
      note: i.note, subtotal: i.subtotal_t, vatTotal: i.vat_total_t, grandTotal: i.grand_total_t, invoiceNo: i.invoice_no, issuedAt: i.issued_at, providerRef: i.provider_ref,
      rejectedReason: i.rejected_reason, cancelReason: i.cancel_reason, cancelledAt: i.cancelled_at, createdAt: i.created_at, createdBy: i.created_by_name, providerConnectionId: i.provider_connection_id as string | null,
      lines: lines.map((l) => ({ lineNo: l.line_no, description: l.description, quantity: l.quantity, unitPrice: l.unit_price, vatRate: l.vat_rate, lineTotal: l.line_total, vatAmount: l.vat_amount, receivableId: l.receivable_id })),
      notice: "TASLAK — resmî belge değildir. Fatura numarası yalnız yetkili e-belge sağlayıcısı tarafından verilir.",
    };
  }
}
