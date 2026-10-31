/**
 * PİA Net hesap çekirdeği. Tüm finans komutları aynı transaction içinde:
 *   hasta hesabı kilidi → domain kaydı → kasa hareketi → prim tahakkuku → audit (+ outbox).
 * Tutar sınırlarının asıl güvencesi DB tetikleyicileridir (0004); buradaki kontroller okunur hata mesajı içindir.
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import { IDEMPOTENCY_KEY_RE, commissionAmount, fromMinor, localDate, toMinor } from "@viadent/contracts";
import type { RequestContext } from "../infra/context.js";
import { AppError } from "../infra/errors.js";
import { audit } from "../audit/audit.js";

type C = pg.PoolClient;

/** Aynı hastanın hesabındaki tüm finans komutlarını sıraya sokar (kilitlenme sırası sorunlarını önler). */
export async function lockAccount(c: C, patientId: string) {
  await c.query("select pg_advisory_xact_lock(hashtextextended('viadent:account:' || $1, 0))", [patientId]);
}

// ------------------------------------------------------------------ idempotency
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function requireKey(key: string | undefined): string {
  if (!key) throw new AppError(428, "IDEMPOTENCY_KEY_REQUIRED", "Bu finans işlemi için Idempotency-Key başlığı gerekli.");
  if (!IDEMPOTENCY_KEY_RE.test(key)) throw new AppError(422, "IDEMPOTENCY_KEY_INVALID", "Idempotency-Key 8–100 karakter olmalı (harf, rakam, - _).");
  return key;
}

/**
 * Aynı anahtar + işlem türü + tenant: ilk istek işlenir ve yanıtı saklanır; tekrarında aynı yanıt döner (yeni kayıt yok).
 * Aynı anahtarla farklı içerik → 409. Eşzamanlı aynı istek: ikinci INSERT birincinin commit'ini bekler, sonra saklı yanıtı okur.
 */
export async function idempotent<T extends object>(c: C, ctx: RequestContext, operation: string, key: string, payload: unknown,
  fn: () => Promise<T>): Promise<{ replayed: boolean; body: T }> {
  const hash = createHash("sha256").update(canonical(payload)).digest("hex");
  const ins = await c.query(
    `insert into idempotency_keys(tenant_id, operation, key, request_hash, created_by) values ($1,$2,$3,$4,$5)
     on conflict do nothing returning key`,
    [ctx.tenantId, operation, key, hash, ctx.userId],
  );
  if (!ins.rowCount) {
    const prev = await c.query("select request_hash, response from idempotency_keys where operation = $1 and key = $2", [operation, key]);
    const row = prev.rows[0];
    if (!row || row.request_hash !== hash) {
      throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "Bu Idempotency-Key farklı içerikli bir istekte kullanılmış. Yeni işlem için yeni anahtar kullanın.");
    }
    return { replayed: true, body: row.response as T };
  }
  const body = await fn();
  await c.query("update idempotency_keys set status_code = 201, response = $3 where operation = $1 and key = $2", [operation, key, JSON.stringify(body)]);
  return { replayed: false, body };
}

// ------------------------------------------------------------------ alacak
export async function createReceivable(c: C, ctx: RequestContext, r: {
  patientId: string; source: "performed_procedure" | "manual"; performedProcedureId?: string | null; description: string; amount: string;
  practitionerId?: string | null; dueDate?: string | null;
}): Promise<string> {
  const due = r.dueDate ?? localDate(new Date(), ctx.timezone);
  const ins = await c.query(
    `insert into receivables(tenant_id, patient_id, source, performed_procedure_id, description, amount, practitioner_id, due_date, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [ctx.tenantId, r.patientId, r.source, r.performedProcedureId ?? null, r.description, r.amount, r.practitionerId ?? null, due, ctx.userId],
  );
  const id = ins.rows[0].id as string;
  await audit(c, ctx, { action: "receivable.create", entityType: "receivable", entityId: id, patientId: r.patientId,
    changes: { amount: { from: null, to: r.amount }, source: { from: null, to: r.source } } });
  return id;
}

/** Alacak iptali: önce bu alacağa yapılmış dağıtımlar ters kayıtla geri alınır (para avansa döner), sonra alacak iptal edilir. */
export async function cancelReceivable(c: C, ctx: RequestContext, receivableId: string, reason: string) {
  const r = (await c.query("select id, patient_id, status from receivables where id = $1 for update", [receivableId])).rows[0];
  if (!r) return;
  if (r.status !== "active") throw new AppError(409, "RECEIVABLE_NOT_ACTIVE", "Alacak zaten iptal edilmiş.");
  const allocs = await c.query(
    `select a.id, (a.amount + coalesce((select sum(x.amount) from allocations x where x.reverses_id = a.id), 0))::text as remaining
       from allocations a where a.receivable_id = $1 and a.amount > 0 order by a.created_at desc, a.id`,
    [receivableId],
  );
  for (const a of allocs.rows) if (Number(a.remaining) > 0) await reverseAllocation(c, ctx, a.id, a.remaining, `Alacak iptali: ${reason}`);
  await c.query("update receivables set status = 'cancelled', cancel_reason = $2, cancelled_at = now(), cancelled_by = $3 where id = $1",
    [receivableId, reason, ctx.userId]);
  await audit(c, ctx, { action: "receivable.cancel", entityType: "receivable", entityId: receivableId, patientId: r.patient_id,
    changes: { status: { from: "active", to: "cancelled" }, reason: { from: null, to: reason } } });
}

// ------------------------------------------------------------------ dağıtım + prim
/**
 * Hekimin o klinik gününde etkin prim kuralı (hekime özel olan genel kurala üstündür; aynı gün tek kural).
 * Kuralın temeli (tahsilat/tedavi) hangi olayın prim doğuracağını belirler → aynı iş için çift prim oluşmaz (ADR-042).
 */
export async function effectiveCommissionRule(c: C, practitionerId: string, onDate: string) {
  const r = await c.query(
    `select id, rate::text as rate, basis from commission_rule_versions
      where valid_from <= $2 and (practitioner_id = $1 or practitioner_id is null)
      order by (practitioner_id is not null) desc, valid_from desc, created_at desc limit 1`,
    [practitionerId, onDate],
  );
  return r.rows[0] as { id: string; rate: string; basis: "collection" | "treatment" } | undefined;
}

/** Tedavi bazlı prim: gerçekleşen işlemin snapshot bedeli üzerinden, işlem gününde etkin kuralla (AT-10). */
export async function accrueTreatmentCommission(c: C, ctx: RequestContext, performedId: string, practitionerId: string, amount: string) {
  const rule = await effectiveCommissionRule(c, practitionerId, localDate(new Date(), ctx.timezone));
  if (!rule || rule.basis !== "treatment" || toMinor(amount) === 0n) return;
  await c.query(
    `insert into commission_accruals(tenant_id, practitioner_id, performed_procedure_id, basis, rule_version_id, base_amount, rate, amount)
     values ($1,$2,$3,'treatment',$4,$5,$6,$7)`,
    [ctx.tenantId, practitionerId, performedId, rule.id, amount, rule.rate, commissionAmount(amount, rule.rate)],
  );
}

/** İşlem iptal/düzeltmesinde tedavi primi orijinal oranla tamamen ters kayda alınır (silinmez). */
export async function reverseTreatmentCommission(c: C, ctx: RequestContext, performedId: string) {
  const acc = (await c.query(
    `select id, practitioner_id, rule_version_id, rate::text as rate, base_amount::text as base from commission_accruals
      where performed_procedure_id = $1 and basis = 'treatment' and reverses_id is null
        and not exists (select 1 from commission_accruals r where r.reverses_id = commission_accruals.id)`, [performedId])).rows[0];
  if (!acc) return;
  const neg = fromMinor(-toMinor(acc.base));
  await c.query(
    `insert into commission_accruals(tenant_id, practitioner_id, performed_procedure_id, basis, rule_version_id, base_amount, rate, amount, reverses_id)
     values ($1,$2,$3,'treatment',$4,$5,$6,$7,$8)`,
    [ctx.tenantId, acc.practitioner_id, performedId, acc.rule_version_id, neg, acc.rate, commissionAmount(neg, acc.rate), acc.id],
  );
}

export async function allocate(c: C, ctx: RequestContext, paymentId: string, receivableId: string, amount: string): Promise<string> {
  const ins = await c.query(
    "insert into allocations(tenant_id, payment_id, receivable_id, amount, created_by) values ($1,$2,$3,$4,$5) returning id",
    [ctx.tenantId, paymentId, receivableId, amount, ctx.userId],
  );
  const id = ins.rows[0].id as string;
  const rec = (await c.query("select practitioner_id, patient_id from receivables where id = $1", [receivableId])).rows[0];
  if (rec.practitioner_id) {
    // Kural, dağıtımın yapıldığı klinik gününde geçerli olan sürümdür; oran snapshot'lanır (AT-10).
    const rule = await effectiveCommissionRule(c, rec.practitioner_id, localDate(new Date(), ctx.timezone));
    if (rule && rule.basis === "collection") {
      await c.query(
        `insert into commission_accruals(tenant_id, practitioner_id, allocation_id, rule_version_id, base_amount, rate, amount)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [ctx.tenantId, rec.practitioner_id, id, rule.id, amount, rule.rate, commissionAmount(amount, rule.rate)],
      );
    }
  }
  await audit(c, ctx, { action: "allocation.create", entityType: "allocation", entityId: id, patientId: rec.patient_id,
    changes: { amount: { from: null, to: amount }, payment_id: { from: null, to: paymentId }, receivable_id: { from: null, to: receivableId } } });
  return id;
}

/** Dağıtım ters kaydı (negatif satır); bağlı prim de orijinal oranla ters kayda alınır. */
export async function reverseAllocation(c: C, ctx: RequestContext, allocationId: string, amount: string, reason: string): Promise<string> {
  const a = (await c.query("select id, payment_id, receivable_id from allocations where id = $1", [allocationId])).rows[0];
  const neg = `-${amount}`;
  const ins = await c.query(
    "insert into allocations(tenant_id, payment_id, receivable_id, amount, reverses_id, reason, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [ctx.tenantId, a.payment_id, a.receivable_id, neg, allocationId, reason, ctx.userId],
  );
  const id = ins.rows[0].id as string;
  const acc = (await c.query("select id, practitioner_id, rule_version_id, rate::text as rate from commission_accruals where allocation_id = $1 and basis = 'collection'", [allocationId])).rows[0];
  if (acc) {
    await c.query(
      `insert into commission_accruals(tenant_id, practitioner_id, allocation_id, rule_version_id, base_amount, rate, amount, reverses_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ctx.tenantId, acc.practitioner_id, id, acc.rule_version_id, neg, acc.rate, commissionAmount(neg, acc.rate), acc.id],
    );
  }
  const pid = (await c.query("select patient_id from payments where id = $1", [a.payment_id])).rows[0].patient_id;
  await audit(c, ctx, { action: "allocation.reverse", entityType: "allocation", entityId: id, patientId: pid,
    changes: { amount: { from: null, to: neg }, reverses_id: { from: null, to: allocationId }, reason: { from: null, to: reason } } });
  return id;
}

/** Ödemenin kalan (ters kaydı düşülmüş) dağıtımları, en yeniden eskiye. */
export async function liveAllocations(c: C, paymentId: string) {
  const r = await c.query(
    `select a.id, a.receivable_id, (a.amount + coalesce((select sum(x.amount) from allocations x where x.reverses_id = a.id), 0))::text as remaining
       from allocations a where a.payment_id = $1 and a.amount > 0 order by a.created_at desc, a.id desc`,
    [paymentId],
  );
  return r.rows.filter((x) => Number(x.remaining) > 0) as { id: string; receivable_id: string; remaining: string }[];
}

export async function cashMovement(c: C, ctx: RequestContext, m: { accountId: string; amount: string; source: "payment" | "refund" | "expense" | "supplier_payment" | "commission_payout"; sourceId: string; at: string | Date }) {
  await c.query(
    "insert into cash_movements(tenant_id, cash_account_id, amount, source, source_id, occurred_at) values ($1,$2,$3,$4,$5,$6)",
    [ctx.tenantId, m.accountId, m.amount, m.source, m.sourceId, m.at],
  );
}

export async function activeAccount(c: C, accountId: string) {
  const a = await c.query("select id, active from cash_accounts where id = $1", [accountId]);
  if (!a.rowCount || !a.rows[0].active) throw new AppError(422, "VALIDATION_FAILED", "Kasa/banka hesabı bulunamadı veya pasif.", { cashAccountId: "Etkin bir kasa/banka seçin." });
}

/** Ödeme/iade/gider zamanı: gelecekte olamaz; en fazla 30 gün geriye kayıt (geç girilen kasa işlemi), aksi hâlde 422. */
export function checkEventTime(iso: string | undefined, field: string): Date {
  const now = Date.now();
  const at = iso ? new Date(iso) : new Date(now);
  if (at.getTime() > now + 5 * 60_000) throw new AppError(422, "VALIDATION_FAILED", "İşlem tarihi gelecekte olamaz.", { [field]: "Gelecek tarih olamaz." });
  if (at.getTime() < now - 30 * 86_400_000) throw new AppError(422, "VALIDATION_FAILED", "30 günden eski işlem bu ekrandan girilemez.", { [field]: "En fazla 30 gün geriye." });
  return at;
}

/**
 * İade (AT-07 algoritması, manuel ve sağlayıcı iadesi ortak): önce ödemenin dağıtılmamış kısmı; yetmezse en yeni dağıtımdan
 * başlayarak ters kayıt. Çağıran hesabı kilitlemiş olmalıdır. Tutar sınırı DB tetikleyicisinde de denetlenir.
 */
export async function refundPayment(c: C, ctx: RequestContext, paymentId: string,
  r: { amount: string; method: string; cashAccountId: string; reason: string; providerRef?: string | null; source?: string }) {
  const s = (await c.query(
    `select p.patient_id, p.amount::text as amount, coalesce((select sum(a.amount) from allocations a where a.payment_id = p.id), 0)::text as allocated,
            coalesce((select sum(f.amount) from refunds f where f.payment_id = p.id), 0)::text as refunded
       from payments p where p.id = $1`, [paymentId])).rows[0];
  const refundable = toMinor(s.amount) - toMinor(s.refunded);
  const want = toMinor(r.amount);
  if (want > refundable) throw new AppError(409, "REFUND_EXCEEDS_PAYMENT", `Bu ödemeden en çok ${fromMinor(refundable)} TRY iade edilebilir.`, { amount: `En çok ${fromMinor(refundable)}` });
  let need = want - (refundable - toMinor(s.allocated));
  const reversed: { allocationId: string; amount: string }[] = [];
  for (const a of await liveAllocations(c, paymentId)) {
    if (need <= 0n) break;
    const take = toMinor(a.remaining) < need ? toMinor(a.remaining) : need;
    reversed.push({ allocationId: await reverseAllocation(c, ctx, a.id, fromMinor(take), `İade: ${r.reason}`), amount: fromMinor(take) });
    need -= take;
  }
  const at = new Date();
  const f = await c.query(
    `insert into refunds(tenant_id, payment_id, amount, method, cash_account_id, reason, refunded_at, created_by, provider_ref)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [ctx.tenantId, paymentId, r.amount, r.method, r.cashAccountId, r.reason, at, ctx.userId, r.providerRef ?? null]);
  const fid = f.rows[0].id as string;
  await cashMovement(c, ctx, { accountId: r.cashAccountId, amount: `-${r.amount}`, source: "refund", sourceId: fid, at });
  await audit(c, ctx, { action: "payment.refund", entityType: "refund", entityId: fid, patientId: s.patient_id,
    changes: { amount: { from: null, to: r.amount }, payment_id: { from: null, to: paymentId }, reason: { from: null, to: r.reason },
      ...(r.source ? { source: { from: null, to: r.source } } : {}) } });
  return { id: fid, patientId: s.patient_id as string, reversedAllocations: reversed };
}
