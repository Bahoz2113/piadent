/**
 * Malzeme siparişi (ADR-108, 08.11.2026): tedarikçiye sipariş ve takibi — taslak → gönderildi → kısmen teslim → teslim alındı; iptal.
 *  - Teslim alma, stok girişiyle aynı çekirdeği kullanır (lot / son kullanma kuralları, giriş hareketi); bakiye yine yalnız hareketlerden.
 *  - Teslim miktarı sipariş miktarını aşamaz (DB kısıtı) ve yalnız artar (tetikleyici). Satırlar silinmez.
 *  - Sipariş fiyatı bilgi amaçlıdır; cari borç yalnız teslimde ve istenirse doğar (teslim × sipariş birim fiyatı, kuruş kesin).
 *  - Finans komutu kuralları: idempotency anahtarı + tek transaction + denetim; sürüm kontrolü (row_version).
 */
import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { PurchaseOrderCreate, PurchaseOrderTransition, PurchaseReceive, localDate } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";
import { idempotent, requireKey } from "../finance/ledger.js";
import { activeSupplier, createBill } from "./cari.js";
import { receiveStock } from "./stock.controller.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
type C = import("pg").PoolClient;
const OPEN = ["draft", "sent", "partial"];

@Controller()
export class PurchaseController {
  constructor(@Inject(Db) private readonly db: Db) {}

  private listSelect = `
    select po.id, po.order_no, po.supplier_id, s.name as supplier, po.status, po.expected_date::text as expected_date, po.note, po.sent_at, po.received_at,
           po.cancelled_at, po.cancel_reason, po.row_version, po.created_at, u.full_name as created_by_name,
           (select count(*)::int from purchase_order_lines l where l.order_id = po.id) as line_count,
           (select count(*)::int from purchase_order_lines l where l.order_id = po.id and l.received_qty >= l.quantity) as done_lines,
           (select case when bool_and(l.unit_price is not null) then sum(round(l.quantity * l.unit_price, 2))::text end
              from purchase_order_lines l where l.order_id = po.id) as total
      from purchase_orders po join suppliers s on s.id = po.supplier_id join users u on u.id = po.created_by`;

  private map(o: Record<string, any>, today: string) {
    return {
      id: o.id, orderNo: o.order_no, supplierId: o.supplier_id, supplier: o.supplier, status: o.status, expectedDate: o.expected_date, note: o.note,
      sentAt: o.sent_at, receivedAt: o.received_at, cancelledAt: o.cancelled_at, cancelReason: o.cancel_reason, version: o.row_version,
      createdAt: o.created_at, createdBy: o.created_by_name, lineCount: o.line_count, doneLines: o.done_lines, total: o.total ?? null,
      /** Takip: gönderilmiş/kısmi sipariş beklenen tarihi geçtiyse gecikmiş. */
      overdue: ["sent", "partial"].includes(o.status) && !!o.expected_date && o.expected_date < today,
    };
  }

  @Get("purchase-orders")
  @Require("stock.read")
  list(@Ctx() ctx: RequestContext, @Query("status") status?: string, @Query("supplierId") supplierId?: string) {
    const today = localDate(new Date(), ctx.timezone);
    const where = status === "open" ? "po.status in ('draft','sent','partial')"
      : status === "overdue" ? "po.status in ('sent','partial') and po.expected_date < $1::date"
      : status === "draft" ? "po.status = 'draft'"
      : status === "closed" ? "po.status in ('received','cancelled')" : "true";
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(`${this.listSelect} where $1::date is not null and ${where} and ($2::uuid is null or po.supplier_id = $2)
        order by case po.status when 'partial' then 0 when 'sent' then 1 when 'draft' then 2 else 3 end, po.expected_date nulls last, po.order_no desc limit 300`,
        [today, supplierId && /^[0-9a-f-]{36}$/.test(supplierId) ? supplierId : null]);
      return { items: r.rows.map((o) => this.map(o, today)) };
    });
  }

  @Get("purchase-orders-summary")
  @Require("stock.read")
  summary(@Ctx() ctx: RequestContext) {
    const today = localDate(new Date(), ctx.timezone);
    return this.db.tx(ctx, async (c) => {
      const r = (await c.query(
        `select count(*) filter (where status in ('sent','partial'))::int as waiting,
                count(*) filter (where status in ('sent','partial') and expected_date < $1::date)::int as overdue,
                count(*) filter (where status = 'partial')::int as partial,
                count(*) filter (where status = 'draft')::int as drafts
           from purchase_orders`, [today])).rows[0];
      return { waiting: r.waiting, overdue: r.overdue, partial: r.partial, drafts: r.drafts };
    });
  }

  @Get("purchase-orders/:id")
  @Require("stock.read")
  detail(@Ctx() ctx: RequestContext, @Param("id", id) oid: string) {
    const today = localDate(new Date(), ctx.timezone);
    return this.db.tx(ctx, async (c) => {
      const o = (await c.query(`${this.listSelect} where po.id = $1`, [oid])).rows[0];
      if (!o) throw Errors.notFound("Sipariş");
      const lines = await c.query(
        `select l.id, l.position, l.stock_item_id, i.name as item, i.unit, i.track_lots, l.quantity::text, l.unit_price::text, l.received_qty::text,
                (l.quantity - l.received_qty)::text as remaining
           from purchase_order_lines l join stock_items i on i.id = l.stock_item_id where l.order_id = $1 order by l.position`, [oid]);
      const rec = await c.query(
        `select r.id, r.line_id, r.quantity::text, r.bill_id, r.created_at, u.full_name as by, sl.lot_no
           from purchase_receipts r join purchase_order_lines l on l.id = r.line_id join users u on u.id = r.created_by
           join stock_movements m on m.id = r.movement_id left join stock_lots sl on sl.id = m.lot_id
          where l.order_id = $1 order by r.created_at`, [oid]);
      return {
        ...this.map(o, today),
        lines: lines.rows.map((l) => ({ id: l.id, position: l.position, itemId: l.stock_item_id, item: l.item, unit: l.unit, trackLots: l.track_lots,
          quantity: l.quantity, unitPrice: l.unit_price, receivedQty: l.received_qty, remaining: l.remaining })),
        receipts: rec.rows.map((r) => ({ id: r.id, lineId: r.line_id, quantity: r.quantity, billId: r.bill_id, lotNo: r.lot_no, at: r.created_at, by: r.by })),
      };
    });
  }

  @Post("purchase-orders")
  @Require("stock.write")
  create(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(PurchaseOrderCreate, body);
    const k = requireKey(key);
    if (i.expectedDate && i.expectedDate < localDate(new Date(), ctx.timezone)) throw Errors.validation({ expectedDate: "Beklenen teslim geçmiş bir tarih olamaz." });
    return this.db.tx(ctx, async (c) => {
      const out = await idempotent(c, ctx, "purchase.create", k, i, async () => {
        await activeSupplier(c, i.supplierId);
        const items = await c.query("select id, name, active from stock_items where id = any($1::uuid[])", [i.lines.map((l) => l.itemId)]);
        const byId = new Map(items.rows.map((r) => [r.id as string, r]));
        i.lines.forEach((l, n) => {
          const it = byId.get(l.itemId);
          if (!it) throw Errors.validation({ [`lines.${n}.itemId`]: "Stok kalemi bulunamadı." });
          if (!it.active) throw Errors.validation({ [`lines.${n}.itemId`]: `${it.name} pasif.` });
        });
        const no = (await c.query(
          `insert into tenant_counters(tenant_id, name, value) values ($1,'purchase_order_no',1)
           on conflict (tenant_id, name) do update set value = tenant_counters.value + 1 returning value::int`, [ctx.tenantId])).rows[0].value as number;
        const po = (await c.query(
          `insert into purchase_orders(tenant_id, order_no, supplier_id, expected_date, note, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
          [ctx.tenantId, no, i.supplierId, i.expectedDate ?? null, i.note ?? null, ctx.userId])).rows[0].id as string;
        const today = localDate(new Date(), ctx.timezone);
        for (const [n, l] of i.lines.entries()) {
          // Fiyat verilmezse tedarikçinin bu kalem için geçerli liste fiyatı (ADR-097) önerilir; yoksa boş kalır.
          const price = l.unitPrice ?? (await c.query(
            `select unit_price::text as p from supplier_prices where supplier_id = $1 and stock_item_id = $2 and valid_from <= $3::date
              order by valid_from desc limit 1`, [i.supplierId, l.itemId, today])).rows[0]?.p ?? null;
          await c.query("insert into purchase_order_lines(tenant_id, order_id, position, stock_item_id, quantity, unit_price) values ($1,$2,$3,$4,$5,$6)",
            [ctx.tenantId, po, n + 1, l.itemId, l.quantity, price]);
        }
        await audit(c, ctx, { action: "purchase_order.create", entityType: "purchase_order", entityId: po,
          changes: { order_no: { from: null, to: no }, supplier_id: { from: null, to: i.supplierId }, line_count: { from: null, to: i.lines.length },
            ...(i.expectedDate ? { expected_date: { from: null, to: i.expectedDate } } : {}) } });
        return { id: po, orderNo: no };
      });
      if (out.replayed) res.setHeader("Idempotent-Replayed", "true");
      return out.body;
    });
  }

  @Post("purchase-orders/:id/transition")
  @HttpCode(200)
  @Require("stock.write")
  transition(@Ctx() ctx: RequestContext, @Param("id", id) oid: string, @Body() body: unknown) {
    const i = parse(PurchaseOrderTransition, body);
    return this.db.tx(ctx, async (c) => {
      const o = (await c.query("select *, expected_date::text as expected_date from purchase_orders where id = $1 for update", [oid])).rows[0];
      if (!o) throw Errors.notFound("Sipariş");
      if (o.row_version !== i.expectedVersion) throw Errors.versionConflict();
      if (i.action === "send") {
        if (o.status !== "draft") throw new AppError(409, "PURCHASE_STATE", "Yalnız taslak sipariş gönderilir.");
        await activeSupplier(c, o.supplier_id);
        const exp = i.expectedDate ?? o.expected_date;
        if (i.expectedDate && i.expectedDate < localDate(new Date(), ctx.timezone)) throw Errors.validation({ expectedDate: "Beklenen teslim geçmiş bir tarih olamaz." });
        await c.query("update purchase_orders set status = 'sent', sent_at = now(), expected_date = $2, row_version = row_version + 1, updated_at = now() where id = $1", [oid, exp]);
        await audit(c, ctx, { action: "purchase_order.send", entityType: "purchase_order", entityId: oid,
          changes: { status: { from: "draft", to: "sent" }, ...(exp !== o.expected_date ? { expected_date: { from: o.expected_date, to: exp } } : {}) } });
      } else {
        if (!["draft", "sent"].includes(o.status)) throw new AppError(409, "PURCHASE_STATE", "Teslim alınmaya başlanmış ya da kapanmış sipariş iptal edilemez.");
        await c.query("update purchase_orders set status = 'cancelled', cancelled_at = now(), cancel_reason = $2, row_version = row_version + 1, updated_at = now() where id = $1",
          [oid, i.reason]);
        await audit(c, ctx, { action: "purchase_order.cancel", entityType: "purchase_order", entityId: oid,
          changes: { status: { from: o.status, to: "cancelled" }, cancel_reason: { from: null, to: i.reason } } });
      }
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: `purchase_order.${i.action}` });
      return { ok: true, version: o.row_version + 1 };
    });
  }

  @Post("purchase-orders/:id/receive")
  @Require("stock.write")
  receive(@Ctx() ctx: RequestContext, @Param("id", id) oid: string, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response) {
    const i = parse(PurchaseReceive, body);
    const k = requireKey(key);
    if (i.createBill && !ctx.permissions.has("supplier.ledger")) throw Errors.forbidden();
    return this.db.tx(ctx, async (c) => {
      const out = await idempotent(c, ctx, `purchase.receive:${oid}`, k, i, async () => {
        const o = (await c.query("select * from purchase_orders where id = $1 for update", [oid])).rows[0];
        if (!o) throw Errors.notFound("Sipariş");
        if (o.row_version !== i.expectedVersion) throw Errors.versionConflict();
        if (!["sent", "partial"].includes(o.status)) throw new AppError(409, "PURCHASE_STATE", "Yalnız tedarikçiye gönderilmiş sipariş teslim alınır.");
        const at = new Date();
        const lines = await c.query(
          `select l.id, l.stock_item_id, l.quantity, l.received_qty, l.unit_price::text as unit_price, i.name from purchase_order_lines l join stock_items i on i.id = l.stock_item_id
            where l.order_id = $1 for update of l`, [oid]);
        const byId = new Map(lines.rows.map((l) => [l.id as string, l]));
        // 1) doğrula ve tutarları hesapla (yazımdan önce)
        const plan: { line: Record<string, any>; r: (typeof i.lines)[number]; receiptId: string; amount: string | null }[] = [];
        for (const [n, r] of i.lines.entries()) {
          const l = byId.get(r.lineId);
          if (!l) throw Errors.validation({ [`lines.${n}.lineId`]: "Satır bu siparişe ait değil." });
          const rem = (await c.query("select ($1::numeric - $2::numeric) >= $3::numeric as ok, ($1::numeric - $2::numeric)::text as rem", [l.quantity, l.received_qty, r.quantity])).rows[0];
          if (!rem.ok) throw Errors.validation({ [`lines.${n}.quantity`]: `${l.name}: kalan ${rem.rem}; fazlası teslim alınamaz.` });
          if (i.createBill && !l.unit_price) throw Errors.validation({ [`lines.${n}.lineId`]: `${l.name}: sipariş birim fiyatı yok; cari borç için fiyat gerekli.` });
          const amount = i.createBill ? (await c.query("select round($1::numeric * $2::numeric, 2)::text as v", [r.quantity, l.unit_price])).rows[0].v as string : null;
          plan.push({ line: l, r, receiptId: randomUUID(), amount });
        }
        // 2) istenirse tek cari fatura (kaynak = ilk teslim kaydı)
        let billId: string | null = null;
        if (i.createBill) {
          const amount = (await c.query("select sum(v::numeric)::numeric(14,2)::text as t from unnest($1::text[]) v", [plan.map((p) => p.amount)])).rows[0].t as string;
          billId = await createBill(c, ctx, { supplierId: o.supplier_id, amount, description: `Malzeme siparişi ${o.order_no} teslimi`.slice(0, 200),
            documentNo: i.documentNo, source: "purchase_receipt", sourceId: plan[0]!.receiptId, at });
        }
        // 3) stok girişi + teslim kaydı + teslim miktarı
        for (const p of plan) {
          const { movementId } = await receiveStock(c, ctx, { itemId: p.line.stock_item_id, quantity: p.r.quantity, lotNo: p.r.lotNo, expiryDate: p.r.expiryDate,
            unitCost: p.line.unit_price ?? null, supplierId: o.supplier_id, at, reason: `Sipariş ${o.order_no}` });
          await c.query("update purchase_order_lines set received_qty = received_qty + $2::numeric where id = $1", [p.line.id, p.r.quantity]);
          await c.query("insert into purchase_receipts(id, tenant_id, line_id, movement_id, quantity, bill_id, created_by) values ($1,$2,$3,$4,$5,$6,$7)",
            [p.receiptId, ctx.tenantId, p.line.id, movementId, p.r.quantity, billId, ctx.userId]);
        }
        const st = (await c.query(
          `select bool_and(received_qty >= quantity) as all_done from purchase_order_lines where order_id = $1`, [oid])).rows[0].all_done ? "received" : "partial";
        await c.query(`update purchase_orders set status = $2, received_at = case when $2 = 'received' then now() else received_at end,
                         row_version = row_version + 1, updated_at = now() where id = $1`, [oid, st]);
        await audit(c, ctx, { action: "purchase_order.receive", entityType: "purchase_order", entityId: oid,
          changes: { status: { from: o.status, to: st }, received_lines: { from: null, to: i.lines.length }, ...(billId ? { bill_id: { from: null, to: billId } } : {}) } });
        await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "purchase_order.receive" });
        return { status: st, billId, receipts: plan.length, version: o.row_version + 1 };
      });
      if (out.replayed) res.setHeader("Idempotent-Replayed", "true");
      return out.body;
    });
  }
}
