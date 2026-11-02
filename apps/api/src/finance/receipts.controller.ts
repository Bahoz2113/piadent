import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { Errors } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });

/**
 * Makbuz (Faz 2.1, ADR-081): tahsilat (TM) ve iade (IM) makbuzları DB tetikleyicisiyle, kaydın işlemiyle aynı transaction'da
 * kiracı+seri+yıl bazında boşluksuz numaralanır. Bu uç yalnız okur ve yazdırmayı denetim kaydına işler; makbuz değiştirilemez.
 * Bu bir mali belge (fatura/e-arşiv) değildir; arayüz ve çıktı bunu açıkça belirtir.
 */
@Controller()
export class ReceiptsController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("receipts/:id")
  @Require("account.read")
  get(@Ctx() ctx: RequestContext, @Param("id", id) receiptId: string) {
    return this.db.tx(ctx, (c) => this.load(c, ctx, receiptId));
  }

  @Post("receipts/:id/print")
  @Require("account.read")
  @HttpCode(200)
  print(@Ctx() ctx: RequestContext, @Param("id", id) receiptId: string) {
    return this.db.tx(ctx, async (c) => {
      const r = await this.load(c, ctx, receiptId);
      await audit(c, ctx, { action: "receipt.print", entityType: "receipt", entityId: receiptId, patientId: r.patient.id,
        changes: { receipt_no: { from: null, to: r.receiptNo } } });
      return r;
    });
  }

  private async load(c: import("pg").PoolClient, ctx: RequestContext, receiptId: string) {
    const r = (await c.query(
      `select rc.id, rc.kind, rc.receipt_no, rc.series, rc.year, rc.seq, rc.amount::text, rc.currency, rc.issued_at, rc.payment_id, rc.refund_id,
              u.full_name as issued_by, pt.id as patient_id, pt.first_name, pt.last_name, pt.file_no,
              p.method as payment_method, p.paid_at, p.note as payment_note, ca.name as payment_account,
              f.method as refund_method, f.reason as refund_reason, f.refunded_at, fca.name as refund_account,
              (select receipt_no from receipts x where x.kind = 'payment' and x.payment_id = rc.payment_id) as payment_receipt_no
         from receipts rc
         join users u on u.id = rc.issued_by
         join patients pt on pt.id = rc.patient_id
         join payments p on p.id = rc.payment_id
         join cash_accounts ca on ca.id = p.cash_account_id
         left join refunds f on f.id = rc.refund_id
         left join cash_accounts fca on fca.id = f.cash_account_id
        where rc.id = $1`, [receiptId])).rows[0];
    if (!r) throw Errors.notFound("Makbuz");
    // Tahsilat makbuzunda dağıtım satırları (hangi alacağa / işleme sayıldığı); iadede ters kayıtlar.
    const lines = r.kind === "payment"
      ? (await c.query(
          `select a.amount::text, rv.description from allocations a join receivables rv on rv.id = a.receivable_id
            where a.payment_id = $1 and a.reverses_id is null order by a.created_at, a.id`, [r.payment_id])).rows
          .map((x) => ({ description: x.description as string, amount: x.amount as string }))
      : [];
    return {
      id: r.id as string, kind: r.kind as "payment" | "refund", receiptNo: r.receipt_no as string, series: r.series as string, year: r.year as number, seq: r.seq as number,
      amount: r.amount as string, currency: r.currency as string, issuedAt: r.issued_at as string, issuedBy: r.issued_by as string,
      clinic: { name: ctx.tenantName, timezone: ctx.timezone },
      patient: { id: r.patient_id as string, fullName: `${r.first_name} ${r.last_name}`, fileNo: r.file_no as number },
      payment: { id: r.payment_id as string, method: r.payment_method as string, paidAt: r.paid_at as string, account: r.payment_account as string,
        note: (r.payment_note as string | null) ?? null, receiptNo: r.payment_receipt_no as string | null },
      refund: r.kind === "refund" ? { id: r.refund_id as string, method: r.refund_method as string, refundedAt: r.refunded_at as string,
        account: r.refund_account as string, reason: r.refund_reason as string } : null,
      lines,
      notice: "Bu belge tahsilat/iade makbuzudur; fatura veya e-Arşiv belgesi yerine geçmez.",
    };
  }
}
