import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  AllocateInput, PaymentCreate, ReceivableCancel, ReceivableCreate, RefundCreate, ReverseAllocationInput, addMoney, toMinor, fromMinor,
} from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";
import {
  activeAccount, allocate, cancelReceivable, cashMovement, checkEventTime, createReceivable, idempotent, liveAllocations, lockAccount,
  refundPayment, requireKey, reverseAllocation,
} from "./ledger.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
const replayHeader = (res: Response, r: { replayed: boolean }) => { if (r.replayed) res.setHeader("Idempotent-Replayed", "true"); };

/**
 * Hasta hesabı (PİA Net, hasta bazlı). Alacak, ödeme, dağıtım, iade ayrı kayıtlardır; bakiye hareketlerden hesaplanır.
 * Açık borç = etkin alacaklar − dağıtımlar (ters kayıtlar dahil). Avans = ödemeler − iadeler − dağıtımlar. İkisi ayrı gösterilir.
 */
@Controller()
export class AccountController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("patients/:patientId/account")
  @Require("account.read")
  account(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const rec = await c.query(
        `select r.id, r.source, r.performed_procedure_id, r.description, r.amount::text, r.status, r.cancel_reason, r.cancelled_at, r.due_date, r.created_at,
                pr.display_name as practitioner_name, coalesce((select sum(a.amount) from allocations a where a.receivable_id = r.id), 0)::text as allocated
           from receivables r left join practitioners pr on pr.id = r.practitioner_id
          where r.patient_id = $1 order by r.created_at, r.id`,
        [patientId],
      );
      const pay = await c.query(
        `select p.id, p.amount::text, p.method, p.paid_at, p.note, ca.name as account_name, u.full_name as received_by,
                coalesce((select sum(a.amount) from allocations a where a.payment_id = p.id), 0)::text as allocated,
                coalesce((select sum(f.amount) from refunds f where f.payment_id = p.id), 0)::text as refunded,
                rc.id as receipt_id, rc.receipt_no
           from payments p join cash_accounts ca on ca.id = p.cash_account_id join users u on u.id = p.received_by
           left join receipts rc on rc.kind = 'payment' and rc.payment_id = p.id
          where p.patient_id = $1 order by p.paid_at, p.id`,
        [patientId],
      );
      const alloc = await c.query(
        `select a.id, a.payment_id, a.receivable_id, a.amount::text, a.reverses_id, a.reason, a.created_at, u.full_name as by, r.description
           from allocations a join payments p on p.id = a.payment_id join receivables r on r.id = a.receivable_id join users u on u.id = a.created_by
          where p.patient_id = $1 order by a.created_at, a.id`,
        [patientId],
      );
      const ref = await c.query(
        `select f.id, f.payment_id, f.amount::text, f.method, f.reason, f.refunded_at, u.full_name as by, rc.id as receipt_id, rc.receipt_no
           from refunds f join payments p on p.id = f.payment_id join users u on u.id = f.created_by
           left join receipts rc on rc.kind = 'refund' and rc.refund_id = f.id
          where p.patient_id = $1 order by f.refunded_at, f.id`,
        [patientId],
      );

      const receivables = rec.rows.map((r) => ({
        id: r.id, source: r.source, performedProcedureId: r.performed_procedure_id, description: r.description, amount: r.amount, status: r.status,
        cancelReason: r.cancel_reason, dueDate: r.due_date, createdAt: r.created_at, practitionerName: r.practitioner_name, allocated: r.allocated,
        open: r.status === "active" ? fromMinor(toMinor(r.amount) - toMinor(r.allocated)) : "0.00",
      }));
      const payments = pay.rows.map((p) => ({
        id: p.id, amount: p.amount, method: p.method, paidAt: p.paid_at, note: p.note, accountName: p.account_name, receivedBy: p.received_by,
        allocated: p.allocated, refunded: p.refunded, available: fromMinor(toMinor(p.amount) - toMinor(p.refunded) - toMinor(p.allocated)),
        receiptId: p.receipt_id ?? null, receiptNo: p.receipt_no ?? null,
      }));
      const active = receivables.filter((r) => r.status === "active");
      const totals = {
        receivable: addMoney("0", ...active.map((r) => r.amount)),
        allocated: addMoney("0", ...active.map((r) => r.allocated)),
        openDebt: addMoney("0", ...active.map((r) => r.open)),
        paid: addMoney("0", ...payments.map((p) => p.amount)),
        refunded: addMoney("0", ...payments.map((p) => p.refunded)),
        advance: addMoney("0", ...payments.map((p) => p.available)),
        cancelledReceivable: addMoney("0", ...receivables.filter((r) => r.status === "cancelled").map((r) => r.amount)),
      };

      // Hareket defteri: her satır borç (+) veya alacak tarafını ve iki ayrı bakiyeyi (açık borç / avans) yürütür.
      type Ev = { at: string; kind: string; ref: string; description: string; amount: string; debtDelta: bigint; advDelta: bigint };
      const ev: Ev[] = [];
      for (const r of rec.rows) ev.push({ at: r.created_at, kind: "receivable", ref: r.id, description: r.description, amount: r.amount, debtDelta: toMinor(r.amount), advDelta: 0n });
      for (const r of rec.rows) if (r.status === "cancelled") {
        // İptal anı: dağıtımlar önce ters kayda alındığı için iptal edilen tutarın tamamı borçtan düşer.
        ev.push({ at: r.cancelled_at ?? r.created_at, kind: "receivable_cancel", ref: r.id, description: `${r.description} · iptal: ${r.cancel_reason}`, amount: `-${r.amount}`, debtDelta: -toMinor(r.amount), advDelta: 0n });
      }
      for (const p of pay.rows) ev.push({ at: p.paid_at, kind: "payment", ref: p.id, description: `Tahsilat · ${p.account_name}`, amount: p.amount, debtDelta: 0n, advDelta: toMinor(p.amount) });
      for (const a of alloc.rows) ev.push({ at: a.created_at, kind: a.reverses_id ? "allocation_reverse" : "allocation", ref: a.id,
        description: a.reverses_id ? `Dağıtım ters kaydı · ${a.description} · ${a.reason}` : `Dağıtım · ${a.description}`, amount: a.amount,
        debtDelta: -toMinor(a.amount), advDelta: -toMinor(a.amount) });
      for (const f of ref.rows) ev.push({ at: f.refunded_at, kind: "refund", ref: f.id, description: `İade · ${f.reason}`, amount: `-${f.amount}`, debtDelta: 0n, advDelta: -toMinor(f.amount) });
      const order: Record<string, number> = { receivable: 0, payment: 1, allocation: 2, allocation_reverse: 3, refund: 4, receivable_cancel: 5 };
      ev.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || order[a.kind]! - order[b.kind]!);
      let debt = 0n; let adv = 0n;
      const ledger = ev.map((e) => {
        debt += e.debtDelta; adv += e.advDelta;
        return { at: e.at, kind: e.kind, ref: e.ref, description: e.description, amount: e.amount, openDebtAfter: fromMinor(debt), advanceAfter: fromMinor(adv) };
      });
      // PİA Net mutabakatı: alt kayıtlardan yürüyen bakiye = toplamlar.
      const reconciled = fromMinor(debt) === totals.openDebt && fromMinor(adv) === totals.advance;
      return {
        currency: "TRY", totals, reconciled, receivables, payments,
        allocations: alloc.rows.map((a) => ({ id: a.id, paymentId: a.payment_id, receivableId: a.receivable_id, amount: a.amount, reversesId: a.reverses_id, reason: a.reason, at: a.created_at, by: a.by })),
        refunds: ref.rows.map((f) => ({ id: f.id, paymentId: f.payment_id, amount: f.amount, method: f.method, reason: f.reason, at: f.refunded_at, by: f.by,
          receiptId: f.receipt_id ?? null, receiptNo: f.receipt_no ?? null })),
        ledger,
      };
    });
  }

  @Post("receivables")
  @Require("receivable.write")
  createReceivable(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(ReceivableCreate, body);
    const k = requireKey(key);
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "receivable.create", k, i, async () => {
        if (!(await c.query("select 1 from patients where id = $1", [i.patientId])).rowCount) throw Errors.notFound("Hasta");
        await lockAccount(c, i.patientId);
        const rid = await createReceivable(c, ctx, { patientId: i.patientId, source: "manual", description: i.description, amount: i.amount,
          practitionerId: i.practitionerId, dueDate: i.dueDate });
        return { id: rid };
      });
      replayHeader(res, r);
      return r.body;
    });
  }

  @Post("receivables/:id/cancel")
  @HttpCode(200)
  @Require("receivable.write")
  cancelReceivable(@Ctx() ctx: RequestContext, @Param("id", id) rid: string, @Body() body: unknown) {
    const i = parse(ReceivableCancel, body);
    return this.db.tx(ctx, async (c) => {
      const r = (await c.query("select patient_id, source from receivables where id = $1", [rid])).rows[0];
      if (!r) throw Errors.notFound("Alacak");
      if (r.source === "performed_procedure") {
        throw new AppError(409, "RECEIVABLE_FROM_PROCEDURE", "Bu alacak gerçekleşen işlemden doğdu; işlem kaydı iptal/düzeltme ile değişir (Tedavi sekmesi).");
      }
      await lockAccount(c, r.patient_id);
      await cancelReceivable(c, ctx, rid, i.reason);
      await enqueue(c, ctx.tenantId, "via_net.changed", { patientId: r.patient_id });
      return { ok: true };
    });
  }

  @Post("payments")
  @Require("payment.write")
  createPayment(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(PaymentCreate, body);
    const k = requireKey(key);
    const at = checkEventTime(i.paidAt, "paidAt");
    const allocSum = i.allocations.reduce((s, a) => s + toMinor(a.amount), 0n);
    if (allocSum > toMinor(i.amount)) throw Errors.validation({ allocations: "Dağıtım toplamı ödeme tutarını aşamaz." });
    if (new Set(i.allocations.map((a) => a.receivableId)).size !== i.allocations.length) throw Errors.validation({ allocations: "Aynı alacak iki kez seçilmiş." });
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "payment.create", k, i, async () => {
        if (!(await c.query("select 1 from patients where id = $1", [i.patientId])).rowCount) throw Errors.notFound("Hasta");
        await activeAccount(c, i.cashAccountId);
        await lockAccount(c, i.patientId);
        const p = await c.query(
          `insert into payments(tenant_id, patient_id, amount, method, cash_account_id, paid_at, note, received_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [ctx.tenantId, i.patientId, i.amount, i.method, i.cashAccountId, at, i.note ?? null, ctx.userId],
        );
        const pid = p.rows[0].id as string;
        await cashMovement(c, ctx, { accountId: i.cashAccountId, amount: i.amount, source: "payment", sourceId: pid, at });
        await audit(c, ctx, { action: "payment.create", entityType: "payment", entityId: pid, patientId: i.patientId,
          changes: { amount: { from: null, to: i.amount }, method: { from: null, to: i.method } } });
        await this.checkReceivables(c, i.patientId, i.allocations.map((a) => a.receivableId));
        const allocationIds: string[] = [];
        for (const a of [...i.allocations].sort((x, y) => x.receivableId.localeCompare(y.receivableId))) {
          allocationIds.push(await allocate(c, ctx, pid, a.receivableId, a.amount));
        }
        await enqueue(c, ctx.tenantId, "via_net.changed", { patientId: i.patientId });
        const rc = (await c.query("select id, receipt_no from receipts where kind = 'payment' and payment_id = $1", [pid])).rows[0];
        return { id: pid, allocationIds, advance: fromMinor(toMinor(i.amount) - allocSum), receiptId: rc?.id ?? null, receiptNo: rc?.receipt_no ?? null };
      });
      replayHeader(res, r);
      return r.body;
    });
  }

  /** Avansın (dağıtılmamış ödeme) alacaklara sonradan dağıtımı — AT-08 / AT-09. */
  @Post("payments/:id/allocations")
  @Require("payment.write")
  allocatePayment(@Ctx() ctx: RequestContext, @Param("id", id) paymentId: string, @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(AllocateInput, body);
    const k = requireKey(key);
    if (new Set(i.allocations.map((a) => a.receivableId)).size !== i.allocations.length) throw Errors.validation({ allocations: "Aynı alacak iki kez seçilmiş." });
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "payment.allocate", k, { paymentId, ...i }, async () => {
        const p = (await c.query("select patient_id from payments where id = $1", [paymentId])).rows[0];
        if (!p) throw Errors.notFound("Ödeme");
        await lockAccount(c, p.patient_id);
        await this.checkReceivables(c, p.patient_id, i.allocations.map((a) => a.receivableId));
        const ids: string[] = [];
        for (const a of [...i.allocations].sort((x, y) => x.receivableId.localeCompare(y.receivableId))) ids.push(await allocate(c, ctx, paymentId, a.receivableId, a.amount));
        await enqueue(c, ctx.tenantId, "via_net.changed", { patientId: p.patient_id });
        return { allocationIds: ids };
      });
      replayHeader(res, r);
      return r.body;
    });
  }

  @Post("allocations/:id/reverse")
  @Require("payment.write")
  reverse(@Ctx() ctx: RequestContext, @Param("id", id) allocationId: string, @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(ReverseAllocationInput, body);
    const k = requireKey(key);
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "allocation.reverse", k, { allocationId, ...i }, async () => {
        const a = (await c.query("select a.amount, a.payment_id, p.patient_id from allocations a join payments p on p.id = a.payment_id where a.id = $1", [allocationId])).rows[0];
        if (!a) throw Errors.notFound("Dağıtım");
        if (Number(a.amount) < 0) throw new AppError(409, "ALLOCATION_IS_REVERSAL", "Ters kayıt yeniden ters çevrilemez; gerekiyorsa yeni dağıtım yapın.");
        await lockAccount(c, a.patient_id);
        const live = (await liveAllocations(c, a.payment_id)).find((x) => x.id === allocationId);
        if (!live) throw new AppError(409, "ALLOCATION_ALREADY_REVERSED", "Bu dağıtım zaten tamamen geri alınmış.");
        const rid = await reverseAllocation(c, ctx, allocationId, live.remaining, i.reason);
        await enqueue(c, ctx.tenantId, "via_net.changed", { patientId: a.patient_id });
        return { id: rid, amount: live.remaining };
      });
      replayHeader(res, r);
      return r.body;
    });
  }

  /**
   * İade (AT-07): önce ödemenin dağıtılmamış kısmı kullanılır; yetmezse en yeni dağıtımdan başlayarak ters kayıt yapılır
   * (alacak yeniden açık borca döner). İade ≠ ticari indirim: alacak tutarı değişmez.
   */
  @Post("payments/:id/refunds")
  @Require("payment.refund")
  refund(@Ctx() ctx: RequestContext, @Param("id", id) paymentId: string, @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(RefundCreate, body);
    const k = requireKey(key);
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "payment.refund", k, { paymentId, ...i }, async () => {
        const p = (await c.query("select patient_id from payments where id = $1", [paymentId])).rows[0];
        if (!p) throw Errors.notFound("Ödeme");
        await activeAccount(c, i.cashAccountId);
        await lockAccount(c, p.patient_id);
        const out = await refundPayment(c, ctx, paymentId, { amount: i.amount, method: i.method, cashAccountId: i.cashAccountId, reason: i.reason });
        await enqueue(c, ctx.tenantId, "via_net.changed", { patientId: p.patient_id });
        const rc = (await c.query("select id, receipt_no from receipts where kind = 'refund' and refund_id = $1", [out.id])).rows[0];
        return { id: out.id, reversedAllocations: out.reversedAllocations, receiptId: rc?.id ?? null, receiptNo: rc?.receipt_no ?? null };
      });
      replayHeader(res, r);
      return r.body;
    });
  }

  private async checkReceivables(c: import("pg").PoolClient, patientId: string, ids: string[]) {
    if (!ids.length) return;
    const r = await c.query("select id, patient_id, status from receivables where id = any($1::uuid[])", [ids]);
    for (const rid of ids) {
      const row = r.rows.find((x) => x.id === rid);
      if (!row || row.patient_id !== patientId) throw Errors.validation({ allocations: "Seçilen alacak bu hastaya ait değil." });
      if (row.status !== "active") throw new AppError(409, "RECEIVABLE_NOT_ACTIVE", "İptal edilmiş alacağa dağıtım yapılamaz.");
    }
  }
}
