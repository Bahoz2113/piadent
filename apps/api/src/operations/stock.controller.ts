/**
 * Stok (V08, temel): kalem → lot (son kullanma) → hareket. Bakiye yalnız hareketlerden hesaplanır; miktar alanı yoktur,
 * dolayısıyla “ezilemez”. Sayım farkı düzeltme hareketi olarak yazılır. Eksi stok DB tetikleyicisiyle engellenir.
 * Hastaya kullanılan lot kaydı geriye dönük izlenebilirlik içindir (resmî ürün takip sistemine bildirim yapılmaz; ADR-043).
 */
import { Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { ReverseInput, StockCount, StockItemUpsert, StockReceipt, StockUsage, StockWaste, addDays, localDate } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";
import { checkEventTime, idempotent, requireKey } from "../finance/ledger.js";
import { activeSupplier, createBill, reverseEntry } from "./cari.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
type C = import("pg").PoolClient;

@Controller()
export class StockController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("stock/items")
  @Require("stock.read")
  items(@Ctx() ctx: RequestContext) {
    const today = localDate(new Date(), ctx.timezone);
    const soon = addDays(today, 60);
    return this.db.tx(ctx, async (c) => {
      const it = await c.query(
        `select i.id, i.code, i.name, i.unit, i.category, i.track_lots, i.min_level::text, i.active,
                coalesce((select sum(m.quantity) from stock_movements m where m.item_id = i.id), 0)::numeric(12,3)::text as balance
           from stock_items i order by i.active desc, i.name`);
      const lots = await c.query(
        `select l.id, l.item_id, l.lot_no, l.expiry_date::text as expiry, coalesce(sum(m.quantity), 0)::numeric(12,3)::text as balance
           from stock_lots l left join stock_movements m on m.lot_id = l.id group by l.id order by l.expiry_date nulls last, l.lot_no`);
      return {
        today,
        items: it.rows.map((i) => {
          const ls = lots.rows.filter((l) => l.item_id === i.id).map((l) => ({ id: l.id, lotNo: l.lot_no, expiry: l.expiry, balance: l.balance,
            expired: !!l.expiry && l.expiry < today, expiringSoon: !!l.expiry && l.expiry >= today && l.expiry <= soon }));
          return { id: i.id, code: i.code, name: i.name, unit: i.unit, category: i.category, trackLots: i.track_lots, minLevel: i.min_level, active: i.active,
            balance: i.balance, low: Number(i.min_level) > 0 && Number(i.balance) <= Number(i.min_level), lots: ls };
        }),
      };
    });
  }

  @Post("stock/items")
  @Require("stock.manage")
  createItem(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(StockItemUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `insert into stock_items(tenant_id, code, name, unit, category, track_lots, min_level, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [ctx.tenantId, i.code, i.name, i.unit, i.category ?? null, i.trackLots, i.minLevel, ctx.userId]);
      await audit(c, ctx, { action: "stock_item.create", entityType: "stock_item", entityId: r.rows[0].id, changes: { code: { from: null, to: i.code }, name: { from: null, to: i.name } } });
      return { id: r.rows[0].id };
    });
  }

  @Patch("stock/items/:id")
  @Require("stock.manage")
  updateItem(@Ctx() ctx: RequestContext, @Param("id", id) iid: string, @Body() body: unknown) {
    const i = parse(StockItemUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const old = (await c.query("select code, name, unit, category, track_lots, min_level::text, active from stock_items where id = $1", [iid])).rows[0];
      if (!old) throw Errors.notFound("Stok kalemi");
      const moved = (await c.query("select 1 from stock_movements where item_id = $1 limit 1", [iid])).rowCount;
      if (moved && (old.unit !== i.unit || old.track_lots !== i.trackLots || old.code.toLowerCase() !== i.code.toLowerCase())) {
        throw new AppError(409, "IMMUTABLE_FIELD", "Hareketi olan kalemin kodu, birimi ve lot takibi değiştirilemez; yeni kalem açın.");
      }
      await c.query("update stock_items set code = $2, name = $3, unit = $4, category = $5, track_lots = $6, min_level = $7, active = $8 where id = $1",
        [iid, i.code, i.name, i.unit, i.category ?? null, i.trackLots, i.minLevel, i.active ?? old.active]);
      await audit(c, ctx, { action: "stock_item.update", entityType: "stock_item", entityId: iid,
        changes: { name: { from: old.name, to: i.name }, min_level: { from: old.min_level, to: i.minLevel }, active: { from: old.active, to: i.active ?? old.active } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "stock_item.update" });
      return { ok: true };
    });
  }

  @Get("stock/items/:id/movements")
  @Require("stock.read")
  movements(@Ctx() ctx: RequestContext, @Param("id", id) iid: string, @Query("limit") limit?: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from stock_items where id = $1", [iid])).rowCount) throw Errors.notFound("Stok kalemi");
      const r = await c.query(
        `select m.id, m.kind, m.quantity::text, m.unit_cost::text, m.reason, m.occurred_at, m.reverses_id, l.lot_no, l.expiry_date::text as expiry, s.name as supplier,
                case when m.patient_id is null then null else p.first_name || ' ' || p.last_name end as patient, m.patient_id, u.full_name as by,
                exists (select 1 from stock_movements z where z.reverses_id = m.id) as reversed,
                sum(m.quantity) over (order by m.occurred_at, m.created_at)::text as balance_after
           from stock_movements m left join stock_lots l on l.id = m.lot_id left join suppliers s on s.id = m.supplier_id
           left join patients p on p.id = m.patient_id join users u on u.id = m.created_by
          where m.item_id = $1 order by m.occurred_at desc, m.created_at desc limit $2`, [iid, Math.min(Number(limit) || 200, 1000)]);
      return { items: r.rows.map((m) => ({ id: m.id, kind: m.kind, quantity: m.quantity, unitCost: m.unit_cost, reason: m.reason, at: m.occurred_at, lotNo: m.lot_no,
        expiry: m.expiry, supplier: m.supplier, patient: m.patient, patientId: m.patient_id, by: m.by, reversal: !!m.reverses_id, reversed: m.reversed, balanceAfter: m.balance_after })) };
    });
  }

  @Get("patients/:patientId/stock-usage")
  @Require("stock.read")
  patientUsage(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const r = await c.query(
        `select m.id, m.quantity::text, m.occurred_at, i.code, i.name, i.unit, l.lot_no, l.expiry_date::text as expiry, m.reverses_id,
                pp.procedure_code || ' · ' || pp.procedure_name as procedure,
                exists (select 1 from stock_movements z where z.reverses_id = m.id) as reversed
           from stock_movements m join stock_items i on i.id = m.item_id left join stock_lots l on l.id = m.lot_id
           left join performed_procedures pp on pp.id = m.performed_procedure_id
          where m.patient_id = $1 and m.kind = 'usage' order by m.occurred_at desc`, [patientId]);
      return { items: r.rows.map((m) => ({ id: m.id, quantity: m.quantity, at: m.occurred_at, code: m.code, name: m.name, unit: m.unit, lotNo: m.lot_no,
        expiry: m.expiry, procedure: m.procedure, reversal: !!m.reverses_id, reversed: m.reversed })) };
    });
  }

  private async item(c: C, itemId: string) {
    const it = (await c.query("select id, name, track_lots, active from stock_items where id = $1", [itemId])).rows[0];
    if (!it) throw Errors.validation({ itemId: "Stok kalemi bulunamadı." });
    return it as { id: string; name: string; track_lots: boolean; active: boolean };
  }

  private async insertMovement(c: C, ctx: RequestContext, m: { itemId: string; lotId?: string | null; kind: string; quantity: string; unitCost?: string | null;
    supplierId?: string | null; patientId?: string | null; performedProcedureId?: string | null; reason?: string | null; at: Date; reversesId?: string | null }) {
    const r = await c.query(
      `insert into stock_movements(tenant_id, item_id, lot_id, kind, quantity, unit_cost, supplier_id, patient_id, performed_procedure_id, reason, occurred_at, reverses_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id, quantity::text`,
      [ctx.tenantId, m.itemId, m.lotId ?? null, m.kind, m.quantity, m.unitCost ?? null, m.supplierId ?? null, m.patientId ?? null, m.performedProcedureId ?? null,
       m.reason ?? null, m.at, m.reversesId ?? null, ctx.userId]);
    await audit(c, ctx, { action: `stock.${m.reversesId ? "reverse" : m.kind}`, entityType: "stock_movement", entityId: r.rows[0].id, patientId: m.patientId ?? null,
      changes: { item_id: { from: null, to: m.itemId }, quantity: { from: null, to: r.rows[0].quantity }, ...(m.lotId ? { lot_id: { from: null, to: m.lotId } } : {}) } });
    await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "stock.movement" });
    return r.rows[0].id as string;
  }

  @Post("stock/receipts")
  @Require("stock.write")
  receipt(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(StockReceipt, body);
    const k = requireKey(key);
    const at = checkEventTime(i.occurredAt, "occurredAt");
    if (i.createBill && !ctx.permissions.has("supplier.ledger")) throw Errors.forbidden();
    if (i.createBill && (!i.supplierId || !i.unitCost)) throw Errors.validation({ unitCost: "Cari borç için tedarikçi ve birim maliyet gerekli." });
    return this.db.tx(ctx, async (c) => {
      const out = await idempotent(c, ctx, "stock.receipt", k, i, async () => {
        const it = await this.item(c, i.itemId);
        if (!it.active) throw Errors.validation({ itemId: "Kalem pasif." });
        if (i.supplierId) await activeSupplier(c, i.supplierId);
        let lotId: string | null = null;
        if (it.track_lots) {
          if (!i.lotNo) throw Errors.validation({ lotNo: "Bu kalem lot takiplidir; lot numarası girin." });
          const ex = (await c.query("select id, expiry_date::text as expiry from stock_lots where item_id = $1 and lot_no = $2", [i.itemId, i.lotNo])).rows[0];
          if (ex) {
            if (i.expiryDate && ex.expiry && ex.expiry !== i.expiryDate) throw new AppError(409, "LOT_EXPIRY_MISMATCH", `Bu lot daha önce ${ex.expiry} son kullanma tarihiyle kaydedilmiş.`);
            if (i.expiryDate && !ex.expiry) await c.query("update stock_lots set expiry_date = $2 where id = $1", [ex.id, i.expiryDate]);
            lotId = ex.id;
          } else {
            lotId = (await c.query("insert into stock_lots(tenant_id, item_id, lot_no, expiry_date) values ($1,$2,$3,$4) returning id",
              [ctx.tenantId, i.itemId, i.lotNo, i.expiryDate ?? null])).rows[0].id;
          }
        } else if (i.lotNo) throw Errors.validation({ lotNo: "Bu kalem lot takipli değil." });
        const mid = await this.insertMovement(c, ctx, { itemId: i.itemId, lotId, kind: "receipt", quantity: i.quantity, unitCost: i.unitCost ?? null,
          supplierId: i.supplierId ?? null, at });
        let billId: string | null = null;
        if (i.createBill) {
          const amount = (await c.query("select round($1::numeric * $2::numeric, 2)::text as v", [i.quantity, i.unitCost])).rows[0].v;
          billId = await createBill(c, ctx, { supplierId: i.supplierId!, amount, description: `Stok girişi · ${it.name} × ${i.quantity}`.slice(0, 200),
            documentNo: i.documentNo, source: "stock_receipt", sourceId: mid, at });
        }
        return { id: mid, lotId, billId };
      });
      if (out.replayed) res.setHeader("Idempotent-Replayed", "true");
      return out.body;
    });
  }

  @Post("stock/usages")
  @Require("stock.write")
  usage(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(StockUsage, body);
    const k = requireKey(key);
    return this.db.tx(ctx, async (c) => {
      const out = await idempotent(c, ctx, "stock.usage", k, i, async () => {
        await this.item(c, i.itemId);
        await this.checkLot(c, ctx, i.lotId, true);
        if (i.performedProcedureId && !i.patientId) throw Errors.validation({ patientId: "İşleme bağlı kullanımda hasta gerekli." });
        if (i.patientId && !(await c.query("select 1 from patients where id = $1", [i.patientId])).rowCount) throw Errors.validation({ patientId: "Hasta bulunamadı." });
        if (i.performedProcedureId && !(await c.query("select 1 from performed_procedures where id = $1 and patient_id = $2", [i.performedProcedureId, i.patientId])).rowCount) {
          throw Errors.validation({ performedProcedureId: "İşlem bu hastaya ait değil." });
        }
        return { id: await this.insertMovement(c, ctx, { itemId: i.itemId, lotId: i.lotId ?? null, kind: "usage", quantity: `-${i.quantity}`,
          patientId: i.patientId ?? null, performedProcedureId: i.performedProcedureId ?? null, reason: i.reason ?? null, at: new Date() }) };
      });
      if (out.replayed) res.setHeader("Idempotent-Replayed", "true");
      return out.body;
    });
  }

  /** Son kullanma tarihi geçmiş lot hastada kullanılamaz (imha/iade edilebilir). */
  private async checkLot(c: C, ctx: RequestContext, lotId: string | undefined, forUsage: boolean) {
    if (!lotId) return;
    const l = (await c.query("select expiry_date::text as expiry from stock_lots where id = $1", [lotId])).rows[0];
    if (!l) throw Errors.validation({ lotId: "Lot bulunamadı." });
    if (forUsage && l.expiry && l.expiry < localDate(new Date(), ctx.timezone)) {
      throw new AppError(409, "LOT_EXPIRED", "Bu lotun son kullanma tarihi geçmiş; hastada kullanılamaz. Fire/imha olarak kaydedin.");
    }
  }

  @Post("stock/waste")
  @Require("stock.write")
  waste(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(StockWaste, body);
    return this.db.tx(ctx, async (c) => {
      await this.item(c, i.itemId);
      await this.checkLot(c, ctx, i.lotId, false);
      return { id: await this.insertMovement(c, ctx, { itemId: i.itemId, lotId: i.lotId ?? null, kind: i.kind, quantity: `-${i.quantity}`, reason: i.reason, at: new Date() }) };
    });
  }

  @Post("stock/counts")
  @Require("stock.write")
  count(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(StockCount, body);
    return this.db.tx(ctx, async (c) => {
      const it = await this.item(c, i.itemId);
      if (it.track_lots && !i.lotId) throw Errors.validation({ lotId: "Lot takipli kalemde sayım lot bazında yapılır." });
      await this.checkLot(c, ctx, i.lotId, false);
      // Sistem bakiyesini okurken aynı kalemdeki eşzamanlı hareketler beklesin.
      await c.query("select pg_advisory_xact_lock(hashtext('stock:' || $1::text))", [i.itemId]);
      const sys = (await c.query(
        `select coalesce(sum(quantity), 0)::numeric(12,3)::text as v from stock_movements where item_id = $1 and ($2::uuid is null or lot_id = $2)`, [i.itemId, i.lotId ?? null])).rows[0].v;
      const diff = (await c.query("select ($1::numeric - $2::numeric)::numeric(12,3)::text as v", [i.countedQuantity, sys])).rows[0].v;
      if (Number(diff) === 0) {
        await audit(c, ctx, { action: "stock.count", entityType: "stock_item", entityId: i.itemId, changes: { counted: { from: sys, to: i.countedQuantity } } });
        return { difference: "0", movementId: null, system: sys };
      }
      const mid = await this.insertMovement(c, ctx, { itemId: i.itemId, lotId: i.lotId ?? null, kind: "adjustment", quantity: diff,
        reason: `Sayım: sistem ${Number(sys)}, sayılan ${Number(i.countedQuantity)} · ${i.reason}`.slice(0, 300), at: new Date() });
      return { difference: diff, movementId: mid, system: sys };
    });
  }

  @Post("stock/movements/:id/reverse")
  @Require("stock.write")
  reverse(@Ctx() ctx: RequestContext, @Param("id", id) mid: string, @Body() body: unknown) {
    const i = parse(ReverseInput, body);
    return this.db.tx(ctx, async (c) => {
      const m = (await c.query("select *, quantity::text as q from stock_movements where id = $1", [mid])).rows[0];
      if (!m) throw Errors.notFound("Stok hareketi");
      if (m.reverses_id) throw new AppError(409, "REVERSAL_INVALID", "Ters kayıt yeniden ters çevrilemez.");
      if ((await c.query("select 1 from stock_movements where reverses_id = $1", [mid])).rowCount) throw new AppError(409, "ALREADY_REVERSED", "Bu hareket zaten ters kayda alınmış.");
      const bill = (await c.query("select id from supplier_entries where source = 'stock_receipt' and source_id = $1 and reverses_id is null", [mid])).rows[0];
      if (bill && !ctx.permissions.has("supplier.ledger")) throw new AppError(403, "FORBIDDEN", "Bu giriş cari borç doğurmuş; ters kaydı finans yetkisi gerektirir.");
      const neg = (await c.query("select (-$1::numeric)::text as v", [m.q])).rows[0].v;
      const rid = await this.insertMovement(c, ctx, { itemId: m.item_id, lotId: m.lot_id, kind: m.kind, quantity: neg, unitCost: m.unit_cost, supplierId: m.supplier_id,
        patientId: m.patient_id, performedProcedureId: m.performed_procedure_id, reason: `Ters kayıt: ${i.reason}`.slice(0, 300), at: new Date(), reversesId: mid });
      if (bill) await reverseEntry(c, ctx, bill.id, i.reason, true);
      return { id: rid };
    });
  }
}
