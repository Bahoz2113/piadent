/**
 * Ürün ve fiyat listesi + randevu malzeme gideri — ürün sahibi geri bildirimi 04.11.2026 madde 9 (ADR-097).
 *  - GET /stock/catalog: kurumun hastada kullanabileceği ürünler (stok kalemleri), bakiye, tedarikçi fiyatları ve tahmini birim maliyet.
 *  - POST /supplier-prices: tedarikçi fiyat listesi satırı (sürümlü; yalnız ileriye; aynı gün ikinci satır 409).
 *  - GET/POST /appointments/:id/materials: randevuda kullanılan ek malzeme (kullanım hareketi, birim maliyet snapshot'ı) ve
 *    randevunun malzeme gideri (ek malzeme + işlemin sarf reçetesi). İşlem bedeli ve katkı yalnız finance.read ile döner.
 */
import { Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { AppointmentMaterials, STANDARD_PRODUCTS, SupplierPriceCreate, addMoney, fromMinor, localDate, toMinor } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import { has, type RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";
import { idempotent, requireKey } from "../finance/ledger.js";
import { activeSupplier } from "./cari.js";
import { estimateUnitCost } from "./stock-cost.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
/** Ek malzeme girilebilen randevu durumları: hasta geldikten sonra (tamamlandı dahil). */
const MATERIAL_STATUSES = ["checked_in", "in_progress", "completed"];
/** Miktar × birim fiyat, kuruşa yuvarlanmış (tam sayı aritmetiği; miktar en çok 3 ondalık). */
function lineCost(qty: string, unit: string | null): string | null {
  if (!unit) return null;
  const [w, f = ""] = qty.replace("-", "").split(".");
  const q = BigInt(w! + f.padEnd(3, "0").slice(0, 3)); // ×1000
  const v = q * toMinor(unit); // kuruş × 1000
  return fromMinor((v + 500n) / 1000n);
}

@Controller()
export class MaterialsController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("stock/catalog")
  @Require("stock.read")
  catalog(@Ctx() ctx: RequestContext) {
    const today = localDate(new Date(), ctx.timezone);
    return this.db.tx(ctx, async (c) => {
      const items = (await c.query(
        `select i.id, i.code, i.name, i.unit, i.category, i.track_lots, i.active, i.min_level::text,
                coalesce((select sum(m.quantity) from stock_movements m where m.item_id = i.id), 0)::numeric(12,3)::text as balance,
                (select m.unit_cost::text from stock_movements m where m.item_id = i.id and m.kind = 'receipt' and m.reverses_id is null and m.unit_cost is not null
                   and not exists (select 1 from stock_movements z where z.reverses_id = m.id) order by m.occurred_at desc limit 1) as last_cost
           from stock_items i order by i.active desc, i.category nulls last, i.name`)).rows;
      const prices = (await c.query(
        `select sp.id, sp.stock_item_id, sp.supplier_id, s.name as supplier, sp.unit_price::text, sp.valid_from::text, sp.supplier_code, sp.note, sp.created_at
           from supplier_prices sp join suppliers s on s.id = sp.supplier_id order by sp.valid_from desc, sp.created_at desc`)).rows;
      const out = [];
      for (const i of items) {
        const mine = prices.filter((p) => p.stock_item_id === i.id);
        // Tedarikçi başına geçerli satır = en yeni valid_from ≤ bugün; daha yenisi "planlı", eskisi "önceki".
        const currentIds = new Set<string>();
        const seen = new Set<string>();
        for (const p of mine) if (p.valid_from <= today && !seen.has(p.supplier_id)) { seen.add(p.supplier_id); currentIds.add(p.id); }
        const est = await estimateUnitCost(c, i.id, today);
        out.push({
          id: i.id, code: i.code, name: i.name, unit: i.unit, category: i.category, trackLots: i.track_lots, active: i.active, minLevel: i.min_level, balance: i.balance,
          lastCost: i.last_cost, unitCost: est.unitCost, costSource: est.source,
          prices: mine.map((p) => ({ id: p.id, supplierId: p.supplier_id, supplier: p.supplier, unitPrice: p.unit_price, validFrom: p.valid_from, supplierCode: p.supplier_code,
            note: p.note, state: p.valid_from > today ? "scheduled" : currentIds.has(p.id) ? "current" : "superseded" })),
        });
      }
      return { today, items: out };
    });
  }

  @Post("supplier-prices")
  @Require("stock.manage")
  createPrice(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(SupplierPriceCreate, body);
    const today = localDate(new Date(), ctx.timezone);
    if (i.validFrom < today) throw Errors.validation({ validFrom: "Fiyat geriye dönük başlatılamaz; bugün veya sonrası seçin." });
    return this.db.tx(ctx, async (c) => {
      await activeSupplier(c, i.supplierId);
      if (!(await c.query("select 1 from stock_items where id = $1", [i.stockItemId])).rowCount) throw Errors.validation({ stockItemId: "Ürün bulunamadı." });
      if ((await c.query("select 1 from supplier_prices where supplier_id = $1 and stock_item_id = $2 and valid_from = $3", [i.supplierId, i.stockItemId, i.validFrom])).rowCount)
        throw new AppError(409, "PRICE_EXISTS", "Bu tedarikçi ve ürün için aynı tarihte başlayan bir fiyat zaten var; başka bir tarih seçin.");
      const r = await c.query(
        `insert into supplier_prices(tenant_id, supplier_id, stock_item_id, unit_price, valid_from, supplier_code, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [ctx.tenantId, i.supplierId, i.stockItemId, i.unitPrice, i.validFrom, i.supplierCode ?? null, i.note ?? null, ctx.userId]);
      await audit(c, ctx, { action: "supplier_price.create", entityType: "supplier_price", entityId: r.rows[0].id,
        changes: { unit_price: { from: null, to: i.unitPrice }, valid_from: { from: null, to: i.validFrom }, supplier_id: { from: null, to: i.supplierId }, item_id: { from: null, to: i.stockItemId } } });
      return { id: r.rows[0].id };
    });
  }

  /** Standart ürün listesi: yalnız eksik kodlar, fiyatsız eklenir; ikinci çağrı hiçbir şey eklemez. */
  @Post("stock/items/standard-import")
  @Require("stock.manage")
  standardImport(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const have = new Set((await c.query("select lower(code) as code from stock_items")).rows.map((r) => r.code as string));
      const added: string[] = [];
      for (const p of STANDARD_PRODUCTS) {
        if (have.has(p.code.toLowerCase())) continue;
        await c.query("insert into stock_items(tenant_id, code, name, unit, category, track_lots, min_level, created_by) values ($1,$2,$3,$4,$5,$6,0,$7)",
          [ctx.tenantId, p.code, p.name, p.unit, p.category, p.trackLots, ctx.userId]);
        added.push(p.code);
      }
      if (added.length) await audit(c, ctx, { action: "stock_item.standard_import", entityType: "stock_item", changes: { added: { from: null, to: added } } });
      return { added: added.length, skipped: STANDARD_PRODUCTS.length - added.length, codes: added };
    });
  }

  @Get("appointments/:id/materials")
  @Require("stock.read")
  materials(@Ctx() ctx: RequestContext, @Param("id", id) aid: string) {
    return this.db.tx(ctx, async (c) => {
      const a = (await c.query("select id, status, patient_id from appointments where id = $1", [aid])).rows[0];
      if (!a) throw Errors.notFound("Randevu");
      const rows = (await c.query(
        `select m.id, m.item_id, i.code, i.name, i.unit, (-m.quantity)::text as quantity, m.unit_cost::text, m.occurred_at, m.reverses_id, m.reason,
                l.lot_no, u.full_name as by, case when m.appointment_id is not null then 'manual' else 'recipe' end as source,
                pp.procedure_code || ' · ' || pp.procedure_name as procedure,
                exists (select 1 from stock_movements z where z.reverses_id = m.id) as reversed
           from stock_movements m join stock_items i on i.id = m.item_id left join stock_lots l on l.id = m.lot_id join users u on u.id = m.created_by
           left join performed_procedures pp on pp.id = m.performed_procedure_id
          where m.kind = 'usage' and (m.appointment_id = $1 or m.performed_procedure_id in (select id from performed_procedures where appointment_id = $1))
          order by m.occurred_at, m.created_at`, [aid])).rows;
      let total = "0.00"; let unknown = 0;
      const items = rows.map((r) => {
        const cost = lineCost(r.quantity, r.unit_cost);
        // Ters kayıt satırının miktarı eksidir: maliyeti de eksi sayılır, böylece toplam net kalır.
        const signed = cost && r.reverses_id ? fromMinor(-toMinor(cost)) : cost;
        if (signed) total = addMoney(total, signed); else unknown++;
        return { id: r.id, itemId: r.item_id, code: r.code, name: r.name, unit: r.unit, quantity: r.reverses_id ? `-${r.quantity.replace("-", "")}` : r.quantity,
          unitCost: r.unit_cost, lineCost: signed, lotNo: r.lot_no, source: r.source, procedure: r.procedure, at: r.occurred_at, by: r.by,
          reversal: !!r.reverses_id, reversed: r.reversed, reason: r.reason };
      });
      let revenue: string | null = null;
      if (has(ctx, "finance.read")) {
        revenue = (await c.query("select coalesce(sum(amount), 0)::numeric(14,2)::text as v from performed_procedures where appointment_id = $1 and status = 'completed'", [aid])).rows[0].v;
      }
      return {
        appointmentId: aid, status: a.status, editable: MATERIAL_STATUSES.includes(a.status) && has(ctx, "stock.write"),
        items, totals: { materialCost: total, unknownCostLines: unknown },
        revenue, contribution: revenue === null ? null : fromMinor(toMinor(revenue) - toMinor(total)),
      };
    });
  }

  @Post("appointments/:id/materials")
  @Require("stock.write")
  addMaterials(@Ctx() ctx: RequestContext, @Param("id", id) aid: string, @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(AppointmentMaterials, body);
    const k = requireKey(key);
    const today = localDate(new Date(), ctx.timezone);
    return this.db.tx(ctx, async (c) => {
      const out = await idempotent(c, ctx, "appointment.materials", k, { aid, ...i }, async () => {
        const a = (await c.query("select id, status, patient_id from appointments where id = $1", [aid])).rows[0];
        if (!a) throw Errors.notFound("Randevu");
        if (!MATERIAL_STATUSES.includes(a.status)) {
          throw new AppError(409, "APPOINTMENT_NOT_STARTED", "Malzeme yalnız hasta geldikten sonra (Geldi, Tedavide, Tamamlandı) girilebilir.");
        }
        const ids: string[] = [];
        for (const [n, it] of i.items.entries()) {
          const item = (await c.query("select id, name, track_lots, active from stock_items where id = $1", [it.itemId])).rows[0];
          if (!item) throw Errors.validation({ [`items.${n}.itemId`]: "Ürün bulunamadı." });
          if (!item.active) throw Errors.validation({ [`items.${n}.itemId`]: `${item.name} pasif.` });
          let lotId = it.lotId ?? null;
          if (lotId) {
            const l = (await c.query("select expiry_date::text as expiry from stock_lots where id = $1", [lotId])).rows[0];
            if (!l) throw Errors.validation({ [`items.${n}.lotId`]: "Lot bulunamadı." });
            if (l.expiry && l.expiry < today) throw new AppError(409, "LOT_EXPIRED", `${item.name}: seçilen lotun son kullanma tarihi geçmiş; hastada kullanılamaz.`);
          } else if (item.track_lots) {
            lotId = (await c.query(
              `select l.id from stock_lots l where l.item_id = $1 and (l.expiry_date is null or l.expiry_date >= $3::date)
                  and coalesce((select sum(m.quantity) from stock_movements m where m.lot_id = l.id), 0) >= $2::numeric order by l.expiry_date nulls last limit 1`,
              [it.itemId, it.quantity, today])).rows[0]?.id ?? null;
            if (!lotId) throw new AppError(409, "STOCK_INSUFFICIENT", `${item.name}: yeterli miktarda, süresi geçmemiş lot yok.`);
          }
          const cost = await estimateUnitCost(c, it.itemId, today);
          const m = await c.query(
            `insert into stock_movements(tenant_id, item_id, lot_id, kind, quantity, unit_cost, patient_id, appointment_id, reason, occurred_at, created_by)
             values ($1,$2,$3,'usage',-$4::numeric,$5,$6,$7,$8,now(),$9) returning id, quantity::text`,
            [ctx.tenantId, it.itemId, lotId, it.quantity, cost.unitCost, a.patient_id, aid, (i.note ? `Randevuda ek malzeme · ${i.note}` : "Randevuda ek malzeme").slice(0, 300), ctx.userId]);
          await audit(c, ctx, { action: "stock.usage", entityType: "stock_movement", entityId: m.rows[0].id, patientId: a.patient_id,
            changes: { item_id: { from: null, to: it.itemId }, quantity: { from: null, to: m.rows[0].quantity }, appointment_id: { from: null, to: aid },
              ...(cost.unitCost ? { unit_cost: { from: null, to: cost.unitCost } } : {}) } });
          ids.push(m.rows[0].id);
        }
        await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "stock.movement" });
        return { ids };
      });
      if (out.replayed) res.setHeader("Idempotent-Replayed", "true");
      return out.body;
    });
  }
}
