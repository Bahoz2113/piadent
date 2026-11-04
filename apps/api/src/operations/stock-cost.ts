/**
 * Malzeme birim maliyeti tahmini (ADR-097) — kullanım hareketine SNAPSHOT olarak yazılır.
 * Öncelik: (1) son alışın yapıldığı tedarikçinin geçerli liste fiyatı, (2) geçerli en düşük tedarikçi fiyatı, (3) son alış birim maliyeti.
 * Hiçbiri yoksa null: gider "fiyat tanımsız" olarak işaretlenir (sıfır sayılmaz, uydurulmaz).
 */
import type { PoolClient } from "pg";

export type CostSource = "supplier_price" | "last_receipt";

export async function estimateUnitCost(c: PoolClient, itemId: string, onDate: string): Promise<{ unitCost: string | null; source: CostSource | null }> {
  const r = (await c.query(
    `with cur as (
       select distinct on (sp.supplier_id) sp.supplier_id, sp.unit_price
         from supplier_prices sp where sp.stock_item_id = $1 and sp.valid_from <= $2
        order by sp.supplier_id, sp.valid_from desc, sp.created_at desc),
     last as (
       select m.supplier_id, m.unit_cost from stock_movements m
        where m.item_id = $1 and m.kind = 'receipt' and m.reverses_id is null
          and not exists (select 1 from stock_movements z where z.reverses_id = m.id)
        order by m.occurred_at desc, m.created_at desc limit 1)
     select coalesce((select cur.unit_price from cur join last on last.supplier_id = cur.supplier_id), (select min(unit_price) from cur))::text as price,
            (select unit_cost::text from last) as last_cost`, [itemId, onDate])).rows[0];
  if (r.price) return { unitCost: r.price, source: "supplier_price" };
  if (r.last_cost) return { unitCost: r.last_cost, source: "last_receipt" };
  return { unitCost: null, source: null };
}
