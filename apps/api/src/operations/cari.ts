/**
 * Tedarikçi carisi (T18): borç = fatura/maliyet (bill), ödeme = kasadan çıkış (payment). Hareket silinmez, ters kayıtla düzeltilir.
 * Bakiye her zaman hareketlerden hesaplanır (Plan §06: “bakiye hareketlerden üretilir”).
 */
import type pg from "pg";
import { fromMinor, toMinor } from "@viadent/contracts";
import type { RequestContext } from "../infra/context.js";
import { AppError, Errors } from "../infra/errors.js";
import { audit } from "../audit/audit.js";
import { cashMovement } from "../finance/ledger.js";

type C = pg.PoolClient;

export async function activeSupplier(c: C, supplierId: string, kind?: "lab") {
  const s = (await c.query("select id, kind, active, name from suppliers where id = $1", [supplierId])).rows[0];
  if (!s) throw Errors.validation({ supplierId: "Tedarikçi bulunamadı." });
  if (!s.active) throw Errors.validation({ supplierId: "Tedarikçi pasif." });
  if (kind && s.kind !== kind) throw Errors.validation({ supplierId: "Seçilen kayıt laboratuvar değil." });
  return s as { id: string; kind: string; name: string };
}

export async function createBill(c: C, ctx: RequestContext, b: { supplierId: string; amount: string; description: string; documentNo?: string | null;
  source: "manual" | "lab_cost" | "stock_receipt" | "purchase_receipt"; sourceId?: string | null; at: Date }) {
  const r = await c.query(
    `insert into supplier_entries(tenant_id, supplier_id, kind, amount, description, document_no, source, source_id, occurred_at, created_by)
     values ($1,$2,'bill',$3,$4,$5,$6,$7,$8,$9) returning id`,
    [ctx.tenantId, b.supplierId, b.amount, b.description, b.documentNo ?? null, b.source, b.sourceId ?? null, b.at, ctx.userId]);
  await audit(c, ctx, { action: "supplier_bill.create", entityType: "supplier_entry", entityId: r.rows[0].id,
    changes: { supplier_id: { from: null, to: b.supplierId }, amount: { from: null, to: b.amount }, source: { from: null, to: b.source } } });
  return r.rows[0].id as string;
}

export async function createSupplierPayment(c: C, ctx: RequestContext, p: { supplierId: string; amount: string; cashAccountId: string; description: string;
  documentNo?: string | null; at: Date }) {
  const r = await c.query(
    `insert into supplier_entries(tenant_id, supplier_id, kind, amount, description, document_no, cash_account_id, occurred_at, created_by)
     values ($1,$2,'payment',$3,$4,$5,$6,$7,$8) returning id`,
    [ctx.tenantId, p.supplierId, p.amount, p.description, p.documentNo ?? null, p.cashAccountId, p.at, ctx.userId]);
  await cashMovement(c, ctx, { accountId: p.cashAccountId, amount: `-${p.amount}`, source: "supplier_payment", sourceId: r.rows[0].id, at: p.at });
  await audit(c, ctx, { action: "supplier_payment.create", entityType: "supplier_entry", entityId: r.rows[0].id,
    changes: { supplier_id: { from: null, to: p.supplierId }, amount: { from: null, to: p.amount } } });
  return r.rows[0].id as string;
}

/** Tam ters kayıt. Kaynaklı (laboratuvar maliyeti / stok girişi) borç yalnız kaynağından ters çevrilir (allowSourced). */
export async function reverseEntry(c: C, ctx: RequestContext, entryId: string, reason: string, allowSourced = false) {
  const e = (await c.query("select * from supplier_entries where id = $1", [entryId])).rows[0];
  if (!e) throw Errors.notFound("Cari hareket");
  if (e.reverses_id) throw new AppError(409, "REVERSAL_INVALID", "Ters kayıt yeniden ters çevrilemez.");
  if (e.source !== "manual" && !allowSourced) {
    throw new AppError(409, "USE_SOURCE_REVERSAL", e.source === "lab_cost" ? "Bu borç bir laboratuvar maliyetinden geliyor; iş emrindeki maliyeti ters kayda alın."
      : "Bu borç bir stok girişinden geliyor; stok hareketini ters kayda alın.");
  }
  if ((await c.query("select 1 from supplier_entries where reverses_id = $1", [entryId])).rowCount) throw new AppError(409, "ALREADY_REVERSED", "Bu hareket zaten ters kayda alınmış.");
  const neg = fromMinor(-toMinor(e.amount));
  const r = await c.query(
    `insert into supplier_entries(tenant_id, supplier_id, kind, amount, description, document_no, source, source_id, cash_account_id, occurred_at, reverses_id, reason, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,$11,$12) returning id`,
    [ctx.tenantId, e.supplier_id, e.kind, neg, `Ters kayıt: ${e.description}`.slice(0, 200), e.document_no, e.source, e.source_id, e.cash_account_id, entryId, reason, ctx.userId]);
  if (e.kind === "payment") {
    await cashMovement(c, ctx, { accountId: e.cash_account_id, amount: e.amount, source: "supplier_payment", sourceId: r.rows[0].id, at: new Date() });
  }
  await audit(c, ctx, { action: "supplier_entry.reverse", entityType: "supplier_entry", entityId: r.rows[0].id,
    changes: { amount: { from: null, to: neg }, reverses_id: { from: null, to: entryId }, reason: { from: null, to: reason } } });
  return r.rows[0].id as string;
}
