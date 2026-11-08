import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import type pg from "pg";
import {
  POS_DEVICE_TIMEOUT_SECONDS, PosIntentCancel, PosIntentCreate, PosIntentResolve, PosIntentSimulate, PosSettlementCreate, PosTerminalUpsert,
  addDays, addMoney, dayRangeUtc, localDate, toMinor, type PosDriver,
} from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";
import { activeAccount, idempotent, lockAccount, recordPayment, requireKey } from "./ledger.js";
import { posDriver } from "./pos-drivers.js";

type C = pg.PoolClient;
const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const replayHeader = (res: Response, r: { replayed: boolean }) => { if (r.replayed) res.setHeader("Idempotent-Replayed", "true"); };

const INTENT_SELECT = `
  select i.id, i.intent_no, i.terminal_id, t.name as terminal_name, t.driver, i.patient_id, p.first_name || ' ' || p.last_name as patient_name,
         i.appointment_id, i.amount::text, i.installments, i.mode, i.status, i.auth_code, i.card_last4, i.provider_ref, i.failure_reason,
         i.payment_id, rc.id as receipt_id, rc.receipt_no, i.created_at, i.sent_at, i.completed_at, u.full_name as created_by_name
    from pos_intents i join pos_terminals t on t.id = i.terminal_id join patients p on p.id = i.patient_id join users u on u.id = i.created_by
    left join receipts rc on rc.kind = 'payment' and rc.payment_id = i.payment_id`;

function present(r: Record<string, any>) {
  return {
    id: r.id as string, intentNo: r.intent_no as number, terminalId: r.terminal_id as string, terminalName: r.terminal_name as string, driver: r.driver as PosDriver,
    patientId: r.patient_id as string, patientName: r.patient_name as string, appointmentId: (r.appointment_id ?? null) as string | null,
    amount: r.amount as string, installments: r.installments as number, mode: r.mode as string, status: r.status as string,
    authCode: (r.auth_code ?? null) as string | null, cardMasked: r.card_last4 ? `•••• ${r.card_last4}` : null,
    providerRef: (r.provider_ref ?? null) as string | null, failureReason: (r.failure_reason ?? null) as string | null,
    paymentId: (r.payment_id ?? null) as string | null, receiptId: (r.receipt_id ?? null) as string | null, receiptNo: (r.receipt_no ?? null) as string | null,
    createdAt: r.created_at, sentAt: r.sent_at ?? null, completedAt: r.completed_at ?? null, createdBy: r.created_by_name as string,
    expiresAt: r.status === "awaiting_card" && r.sent_at ? new Date(new Date(r.sent_at).getTime() + POS_DEVICE_TIMEOUT_SECONDS * 1000).toISOString() : null,
  };
}

async function lockTerminal(c: C, terminalId: string) {
  await c.query("select pg_advisory_xact_lock(hashtextextended('viadent:pos:' || $1, 0))", [terminalId]);
}

/** Gün sonu alınmış terminal-gününe yeni çekim yazılmaz (mutabakat bozulmasın). */
async function assertDayOpen(c: C, ctx: RequestContext, terminalId: string) {
  const today = localDate(new Date(), ctx.timezone);
  if ((await c.query("select 1 from pos_settlements where terminal_id = $1 and business_date = $2", [terminalId, today])).rowCount) {
    throw new AppError(409, "POS_DAY_CLOSED", "Bu terminalin bugünkü gün sonu alındı; yeni çekim kaydedilemez. Başka terminal seçin veya yarın deneyin.");
  }
}

/** Süresi dolan "kart bekleniyor" niyeti "sonuç bilinmiyor" olur: kart çekilmiş olabilir, fişe bakılarak elle çözülür. */
async function expireIfStale(c: C, ctx: RequestContext, intentId: string) {
  const r = await c.query(
    `update pos_intents set status = 'unknown', failure_reason = 'Cihazdan ${POS_DEVICE_TIMEOUT_SECONDS} sn içinde yanıt gelmedi.'
      where id = $1 and status = 'awaiting_card' and sent_at < now() - make_interval(secs => $2) returning id, patient_id`,
    [intentId, POS_DEVICE_TIMEOUT_SECONDS]);
  if (r.rowCount) {
    await audit(c, ctx, { action: "pos_intent.unknown", entityType: "pos_intent", entityId: intentId, patientId: r.rows[0].patient_id,
      changes: { status: { from: "awaiting_card", to: "unknown" } } });
  }
}

@Controller()
export class PosController {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ------------------------------------------------------------ terminaller
  @Get("pos/terminals")
  @Require("account.read")
  terminals(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select t.id, t.name, t.driver, t.cash_account_id, ca.name as cash_account_name, t.branch_id, b.name as branch_name, t.bank_name, t.terminal_ref, t.active,
                (select i.id from pos_intents i where i.terminal_id = t.id and i.status in ('created','awaiting_card','unknown') limit 1) as open_intent_id,
                exists (select 1 from pos_settlements s where s.terminal_id = t.id and s.business_date = $1) as day_closed
           from pos_terminals t join cash_accounts ca on ca.id = t.cash_account_id left join branches b on b.id = t.branch_id
          order by t.active desc, t.name`, [localDate(new Date(), ctx.timezone)]);
      return { items: r.rows.map((t) => ({ id: t.id, name: t.name, driver: t.driver, sendsAmount: posDriver(t.driver).sendsAmount, cashAccountId: t.cash_account_id,
        cashAccountName: t.cash_account_name, branchId: t.branch_id, branchName: t.branch_name, bankName: t.bank_name, terminalRef: t.terminal_ref, active: t.active,
        openIntentId: t.open_intent_id ?? null, dayClosed: t.day_closed })) };
    });
  }

  private async checkTerminalRefs(c: C, i: { cashAccountId: string; branchId?: string }) {
    const a = (await c.query("select kind, active from cash_accounts where id = $1", [i.cashAccountId])).rows[0];
    if (!a) throw Errors.validation({ cashAccountId: "Kasa hesabı bulunamadı." });
    if (a.kind !== "pos_manual") throw Errors.validation({ cashAccountId: "POS terminali yalnız POS türündeki kasa hesabına bağlanır." });
    if (i.branchId && !(await c.query("select 1 from branches where id = $1", [i.branchId])).rowCount) throw Errors.validation({ branchId: "Şube bulunamadı." });
  }

  @Post("pos/terminals")
  @Require("finance.settings")
  createTerminal(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(PosTerminalUpsert, body);
    return this.db.tx(ctx, async (c) => {
      await this.checkTerminalRefs(c, i);
      if ((await c.query("select 1 from pos_terminals where lower(name) = lower($1)", [i.name])).rowCount) throw Errors.validation({ name: "Bu adla bir terminal var." });
      const r = await c.query(
        `insert into pos_terminals(tenant_id, name, driver, cash_account_id, branch_id, bank_name, terminal_ref, active) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [ctx.tenantId, i.name, i.driver, i.cashAccountId, i.branchId ?? null, i.bankName ?? null, i.terminalRef ?? null, i.active ?? true]);
      await audit(c, ctx, { action: "pos_terminal.create", entityType: "pos_terminal", entityId: r.rows[0].id,
        changes: { name: { from: null, to: i.name }, driver: { from: null, to: i.driver } } });
      return { id: r.rows[0].id as string };
    });
  }

  @Patch("pos/terminals/:id")
  @Require("finance.settings")
  updateTerminal(@Ctx() ctx: RequestContext, @Param("id", id) tid: string, @Body() body: unknown) {
    const i = parse(PosTerminalUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const old = (await c.query("select name, driver, cash_account_id, branch_id, bank_name, terminal_ref, active from pos_terminals where id = $1", [tid])).rows[0];
      if (!old) throw Errors.notFound("POS terminali");
      if (old.driver !== i.driver || old.cash_account_id !== i.cashAccountId) {
        throw new AppError(409, "IMMUTABLE_FIELD", "Terminalin sürücüsü ve kasa hesabı değiştirilemez; gerekiyorsa yeni terminal tanımlayıp bunu pasifleştirin.");
      }
      await this.checkTerminalRefs(c, i);
      if ((await c.query("select 1 from pos_terminals where lower(name) = lower($1) and id <> $2", [i.name, tid])).rowCount) throw Errors.validation({ name: "Bu adla bir terminal var." });
      const active = i.active ?? old.active;
      if (!active && (await c.query("select 1 from pos_intents where terminal_id = $1 and status in ('created','awaiting_card','unknown')", [tid])).rowCount) {
        throw new AppError(409, "POS_TERMINAL_BUSY", "Açık işlemi olan terminal pasifleştirilemez; önce işlemi sonuçlandırın.");
      }
      await c.query("update pos_terminals set name = $2, branch_id = $3, bank_name = $4, terminal_ref = $5, active = $6 where id = $1",
        [tid, i.name, i.branchId ?? null, i.bankName ?? null, i.terminalRef ?? null, active]);
      await audit(c, ctx, { action: "pos_terminal.update", entityType: "pos_terminal", entityId: tid,
        changes: { name: { from: old.name, to: i.name }, active: { from: old.active, to: active }, terminal_ref: { from: old.terminal_ref, to: i.terminalRef ?? null } } });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ ödeme niyeti
  @Post("pos/intents")
  @Require("payment.write")
  createIntent(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(PosIntentCreate, body);
    const k = requireKey(key);
    const allocSum = i.allocations.reduce((s, a) => s + toMinor(a.amount), 0n);
    if (allocSum > toMinor(i.amount)) throw Errors.validation({ allocations: "Dağıtım toplamı ödeme tutarını aşamaz." });
    if (new Set(i.allocations.map((a) => a.receivableId)).size !== i.allocations.length) throw Errors.validation({ allocations: "Aynı alacak iki kez seçilmiş." });
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "pos_intent.create", k, i, async () => {
        if (!(await c.query("select 1 from patients where id = $1", [i.patientId])).rowCount) throw Errors.notFound("Hasta");
        const t = (await c.query("select id, driver, active, cash_account_id from pos_terminals where id = $1", [i.terminalId])).rows[0];
        if (!t) throw Errors.validation({ terminalId: "POS terminali bulunamadı." });
        if (!t.active) throw Errors.validation({ terminalId: "Bu terminal pasif." });
        const drv = posDriver(t.driver);
        if (i.mode === "device" && !drv.sendsAmount) {
          throw new AppError(422, "POS_DRIVER_NO_DEVICE", "Bu terminal banka POS'udur; tutar yazılımdan cihaza gönderilemez. Çekimi POS'ta yapıp onay kodunu girin.");
        }
        await lockAccount(c, i.patientId);
        await lockTerminal(c, i.terminalId);
        await activeAccount(c, t.cash_account_id);
        await assertDayOpen(c, ctx, i.terminalId);
        const open = (await c.query("select id, intent_no, status from pos_intents where terminal_id = $1 and status in ('created','awaiting_card','unknown')", [i.terminalId])).rows[0];
        if (open) {
          throw new AppError(409, "POS_TERMINAL_BUSY", `Bu terminalde sonuçlanmamış işlem var (POS işlem ${open.intent_no}). Çift çekimi önlemek için önce onu sonuçlandırın.`,
            undefined, { intentId: open.id });
        }
        if (i.appointmentId && !(await c.query("select 1 from appointments where id = $1 and patient_id = $2", [i.appointmentId, i.patientId])).rowCount) {
          throw Errors.validation({ appointmentId: "Randevu bu hastaya ait değil." });
        }
        const no = (await c.query(
          `insert into tenant_counters(tenant_id, name, value) values ($1,'pos_intent_no',1)
           on conflict (tenant_id, name) do update set value = tenant_counters.value + 1 returning value::int`, [ctx.tenantId])).rows[0].value as number;
        const ins = await c.query(
          `insert into pos_intents(tenant_id, intent_no, terminal_id, patient_id, appointment_id, amount, installments, mode, status, allocations, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,'created',$9,$10,$11) returning id`,
          [ctx.tenantId, no, i.terminalId, i.patientId, i.appointmentId ?? null, i.amount, i.installments, i.mode, JSON.stringify(i.allocations), i.note ?? null, ctx.userId]);
        const iid = ins.rows[0].id as string;
        await audit(c, ctx, { action: "pos_intent.create", entityType: "pos_intent", entityId: iid, patientId: i.patientId,
          changes: { amount: { from: null, to: i.amount }, installments: { from: null, to: i.installments }, mode: { from: null, to: i.mode }, intent_no: { from: null, to: no } } });
        if (i.mode === "manual") {
          await this.approve(c, ctx, iid, { authCode: i.authCode!, cardLast4: i.cardLast4!, installments: i.installments });
        } else {
          const sent = await drv.send({ intentNo: no, amount: i.amount, installments: i.installments });
          await c.query("update pos_intents set status = 'awaiting_card', provider_ref = $2, sent_at = now() where id = $1", [iid, sent.providerRef]);
          await audit(c, ctx, { action: "pos_intent.send", entityType: "pos_intent", entityId: iid, patientId: i.patientId,
            changes: { status: { from: "created", to: "awaiting_card" } } });
        }
        return present((await c.query(`${INTENT_SELECT} where i.id = $1`, [iid])).rows[0]);
      });
      replayHeader(res, r);
      return r.body;
    });
  }

  @Get("pos/intents/:id")
  @Require("account.read")
  intent(@Ctx() ctx: RequestContext, @Param("id", id) iid: string) {
    return this.db.tx(ctx, async (c) => {
      await expireIfStale(c, ctx, iid);
      const r = (await c.query(`${INTENT_SELECT} where i.id = $1`, [iid])).rows[0];
      if (!r) throw Errors.notFound("POS işlemi");
      return present(r);
    });
  }

  /** DENEME cihazı: kart okutma sonucunun benzetimi. Gerçek sürücülerde sonuç cihazdan/sağlayıcıdan gelir. */
  @Post("pos/intents/:id/simulate")
  @HttpCode(200)
  @Require("payment.write")
  simulate(@Ctx() ctx: RequestContext, @Param("id", id) iid: string, @Body() body: unknown) {
    const i = parse(PosIntentSimulate, body);
    return this.db.tx(ctx, async (c) => {
      const it = await this.loadForUpdate(c, iid);
      if (!posDriver(it.driver).simulates) throw new AppError(409, "POS_NOT_SIMULATED", "Benzetim yalnız DENEME cihazında kullanılabilir.");
      await expireIfStale(c, ctx, iid);
      const now = (await c.query("select status from pos_intents where id = $1", [iid])).rows[0].status;
      if (now !== "awaiting_card") throw new AppError(409, "POS_INTENT_STATE", "Bu işlem artık cihazda beklemiyor.");
      if (i.outcome === "approved") {
        const last4 = String(1000 + (it.intent_no * 7919) % 9000); // DENEME: sentetik son 4 hane
        await this.approve(c, ctx, iid, { authCode: `DN${String(it.intent_no).padStart(4, "0")}`, cardLast4: last4, installments: it.installments });
      } else if (i.outcome === "declined") {
        await c.query("update pos_intents set status = 'declined', failure_reason = 'DENEME: kart reddedildi (yetersiz bakiye benzetimi).', completed_at = now() where id = $1", [iid]);
        await audit(c, ctx, { action: "pos_intent.decline", entityType: "pos_intent", entityId: iid, patientId: it.patient_id, changes: { status: { from: "awaiting_card", to: "declined" } } });
      } else {
        await c.query("update pos_intents set status = 'unknown', failure_reason = 'DENEME: cihazdan yanıt gelmedi (bağlantı kopması benzetimi).' where id = $1", [iid]);
        await audit(c, ctx, { action: "pos_intent.unknown", entityType: "pos_intent", entityId: iid, patientId: it.patient_id, changes: { status: { from: "awaiting_card", to: "unknown" } } });
      }
      return present((await c.query(`${INTENT_SELECT} where i.id = $1`, [iid])).rows[0]);
    });
  }

  /** İptal yalnız sonucu belli olmayan ama çekimin başlamadığı durumda: oluşturuldu / kart bekleniyor. "Sonuç bilinmiyor" iptal edilemez, çözülür. */
  @Post("pos/intents/:id/cancel")
  @HttpCode(200)
  @Require("payment.write")
  cancel(@Ctx() ctx: RequestContext, @Param("id", id) iid: string, @Body() body: unknown) {
    const i = parse(PosIntentCancel, body);
    return this.db.tx(ctx, async (c) => {
      const it = await this.loadForUpdate(c, iid);
      await expireIfStale(c, ctx, iid);
      const st = (await c.query("select status from pos_intents where id = $1", [iid])).rows[0].status;
      if (st === "unknown") throw new AppError(409, "POS_INTENT_UNKNOWN", "Cihazın sonucu bilinmiyor; kart çekilmiş olabilir. İptal yerine POS fişine bakarak sonucu girin.");
      if (st !== "created" && st !== "awaiting_card") throw new AppError(409, "POS_INTENT_STATE", "Sonuçlanmış işlem iptal edilemez; gerekiyorsa tahsilattan iade yapın.");
      await posDriver(it.driver).cancel({ providerRef: it.provider_ref });
      await c.query("update pos_intents set status = 'cancelled', failure_reason = $2, completed_at = now(), resolved_by = $3 where id = $1", [iid, i.reason, ctx.userId]);
      await audit(c, ctx, { action: "pos_intent.cancel", entityType: "pos_intent", entityId: iid, patientId: it.patient_id,
        changes: { status: { from: st, to: "cancelled" }, failure_reason: { from: null, to: i.reason } } });
      return present((await c.query(`${INTENT_SELECT} where i.id = $1`, [iid])).rows[0]);
    });
  }

  /** Sonucu bilinmeyen işlemin elle çözümü (POS fişi / banka gün sonu esas alınır). */
  @Post("pos/intents/:id/resolve")
  @Require("payment.write")
  resolve(@Ctx() ctx: RequestContext, @Param("id", id) iid: string, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(PosIntentResolve, body);
    const k = requireKey(key);
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "pos_intent.resolve", k, { iid, ...i }, async () => {
        const it = await this.loadForUpdate(c, iid);
        await expireIfStale(c, ctx, iid);
        const st = (await c.query("select status from pos_intents where id = $1", [iid])).rows[0].status;
        if (st !== "unknown") throw new AppError(409, "POS_INTENT_STATE", "Yalnız sonucu bilinmeyen işlem elle çözülür.");
        if (i.outcome === "approved") {
          await this.approve(c, ctx, iid, { authCode: i.authCode, cardLast4: i.cardLast4, installments: i.installments ?? it.installments });
        } else {
          await c.query("update pos_intents set status = 'declined', failure_reason = $2, completed_at = now(), resolved_by = $3 where id = $1", [iid, i.reason, ctx.userId]);
          await audit(c, ctx, { action: "pos_intent.decline", entityType: "pos_intent", entityId: iid, patientId: it.patient_id,
            changes: { status: { from: "unknown", to: "declined" }, failure_reason: { from: null, to: i.reason } } });
        }
        await audit(c, ctx, { action: "pos_intent.resolve", entityType: "pos_intent", entityId: iid, patientId: it.patient_id,
          changes: { status: { from: "unknown", to: i.outcome } } });
        return present((await c.query(`${INTENT_SELECT} where i.id = $1`, [iid])).rows[0]);
      });
      replayHeader(res, r);
      return r.body;
    });
  }

  private async loadForUpdate(c: C, iid: string) {
    const it = (await c.query(
      `select i.id, i.terminal_id, i.patient_id, i.intent_no, i.installments, i.provider_ref, t.driver from pos_intents i join pos_terminals t on t.id = i.terminal_id where i.id = $1`, [iid])).rows[0];
    if (!it) throw Errors.notFound("POS işlemi");
    await lockAccount(c, it.patient_id); // kilit sırası her yerde: hasta hesabı → terminal
    await lockTerminal(c, it.terminal_id);
    return it as { id: string; terminal_id: string; patient_id: string; intent_no: number; installments: number; provider_ref: string | null; driver: PosDriver };
  }

  /** Onay: aynı transaction'da tahsilat (kart · POS), kasa hareketi, dağıtımlar, makbuz ve audit. Çağıran hasta hesabını kilitlemiş olmalı. */
  private async approve(c: C, ctx: RequestContext, iid: string, m0: { authCode: string; cardLast4: string; installments: number }) {
    const m = { ...m0, authCode: m0.authCode.toUpperCase() };
    const it = (await c.query(
      `select i.*, i.amount::text as amount_text, t.cash_account_id, t.name as terminal_name from pos_intents i join pos_terminals t on t.id = i.terminal_id where i.id = $1`, [iid])).rows[0];
    await activeAccount(c, it.cash_account_id);
    await assertDayOpen(c, ctx, it.terminal_id);
    const pay = await recordPayment(c, ctx, {
      patientId: it.patient_id, amount: it.amount_text, method: "card_manual", cashAccountId: it.cash_account_id, at: new Date(),
      note: [`POS ${it.intent_no} · ${it.terminal_name} · onay ${m.authCode} · •••• ${m.cardLast4}${m.installments > 1 ? ` · ${m.installments} taksit` : ""}`, it.note].filter(Boolean).join(" — ").slice(0, 300),
      appointmentId: it.appointment_id, allocations: it.allocations ?? [], posIntentId: iid,
      auditExtra: { terminal: { from: null, to: it.terminal_name }, installments: { from: null, to: m.installments } },
    });
    await c.query(
      `update pos_intents set status = 'approved', auth_code = $2, card_last4 = $3, payment_id = $4, completed_at = now(), resolved_by = $5, failure_reason = null where id = $1`,
      [iid, m.authCode, m.cardLast4, pay.id, ctx.userId]);
    if (m.installments !== it.installments) {
      // Taksit fişe göre düzeltildiyse kayıt ödeme notunda ve audit'te durur (niyet satırı tutar/taksit kilitli değil, yalnız taksit bilgi amaçlı).
      await audit(c, ctx, { action: "pos_intent.resolve", entityType: "pos_intent", entityId: iid, patientId: it.patient_id,
        changes: { installments: { from: it.installments, to: m.installments } } });
    }
    await audit(c, ctx, { action: "pos_intent.approve", entityType: "pos_intent", entityId: iid, patientId: it.patient_id,
      changes: { status: { from: it.status, to: "approved" }, auth_code: { from: null, to: m.authCode }, card_last4: { from: null, to: m.cardLast4 } } });
    return pay;
  }

  // ------------------------------------------------------------ gün sonu mutabakatı
  @Get("pos/day")
  @Require("payment.write")
  day(@Ctx() ctx: RequestContext, @Query("date") date?: string) {
    const today = localDate(new Date(), ctx.timezone);
    const d = date ?? today;
    if (!DATE.test(d) || d > today || d < addDays(today, -92)) throw Errors.validation({ date: "Bugün veya son 92 gün içinde bir gün seçin." });
    const { from, to } = dayRangeUtc(d, ctx.timezone);
    return this.db.tx(ctx, async (c) => {
      const terms = (await c.query(
        `select t.id, t.name, t.driver, t.active, t.bank_name, t.terminal_ref from pos_terminals t
          where t.active or exists (select 1 from pos_intents i where i.terminal_id = t.id and i.created_at >= $1 and i.created_at < $2) order by t.name`, [from, to])).rows;
      const intents = (await c.query(`${INTENT_SELECT} where (i.created_at >= $1 and i.created_at < $2) or (i.completed_at >= $1 and i.completed_at < $2)
                                       or (i.status in ('created','awaiting_card','unknown')) order by i.created_at`, [from, to])).rows;
      const settlements = (await c.query(
        `select s.terminal_id, s.system_count, s.system_total::text, s.slip_count, s.slip_total::text, s.note, s.closed_at, u.full_name as closed_by
           from pos_settlements s join users u on u.id = s.closed_by where s.business_date = $1`, [d])).rows;
      const items = terms.map((t) => {
        const mine = intents.filter((x) => x.terminal_id === t.id);
        const approved = mine.filter((x) => x.status === "approved" && x.completed_at && new Date(x.completed_at) >= from && new Date(x.completed_at) < to);
        const s = settlements.find((x) => x.terminal_id === t.id);
        return {
          terminalId: t.id, terminalName: t.name, driver: t.driver, active: t.active, bankName: t.bank_name, terminalRef: t.terminal_ref,
          approvedCount: approved.length, approvedTotal: addMoney("0", ...approved.map((x) => x.amount)),
          openCount: mine.filter((x) => ["created", "awaiting_card", "unknown"].includes(x.status)).length,
          intents: mine.map(present),
          settlement: s ? { systemCount: s.system_count, systemTotal: s.system_total, slipCount: s.slip_count, slipTotal: s.slip_total, note: s.note,
            closedAt: s.closed_at, closedBy: s.closed_by, matched: s.system_count === s.slip_count && s.system_total === s.slip_total } : null,
        };
      });
      return { date: d, today, timezone: ctx.timezone, items };
    });
  }

  @Post("pos/settlements")
  @Require("payment.write")
  settle(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(PosSettlementCreate, body);
    const k = requireKey(key);
    const today = localDate(new Date(), ctx.timezone);
    if (i.date > today) throw Errors.validation({ date: "İleri tarihli gün sonu alınamaz." });
    if (i.date < addDays(today, -31)) throw Errors.validation({ date: "Gün sonu en çok 31 gün geriye alınabilir." });
    const { from, to } = dayRangeUtc(i.date, ctx.timezone);
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "pos_settlement.close", k, i, async () => {
        const t = (await c.query("select id, name from pos_terminals where id = $1", [i.terminalId])).rows[0];
        if (!t) throw Errors.validation({ terminalId: "POS terminali bulunamadı." });
        await lockTerminal(c, i.terminalId);
        if ((await c.query("select 1 from pos_settlements where terminal_id = $1 and business_date = $2", [i.terminalId, i.date])).rowCount) {
          throw new AppError(409, "POS_DAY_CLOSED", "Bu terminalin bu günkü gün sonu zaten alınmış.");
        }
        const open = await c.query(
          `select intent_no from pos_intents where terminal_id = $1 and status in ('created','awaiting_card','unknown') and created_at < $2`, [i.terminalId, to]);
        if (open.rowCount) {
          throw new AppError(409, "POS_OPEN_INTENTS", `Sonuçlanmamış POS işlemi var (${open.rows.map((x) => x.intent_no).join(", ")}). Gün sonundan önce sonuçlandırın.`);
        }
        const sys = (await c.query(
          `select count(*)::int as n, coalesce(sum(amount), 0)::text as total from pos_intents
            where terminal_id = $1 and status = 'approved' and completed_at >= $2 and completed_at < $3`, [i.terminalId, from, to])).rows[0];
        const matched = sys.n === i.slipCount && toMinor(sys.total) === toMinor(i.slipTotal);
        if (!matched && !i.note) throw Errors.validation({ note: "Sistem ile POS fişi tutmuyor; farkın açıklamasını yazın." });
        const s = await c.query(
          `insert into pos_settlements(tenant_id, terminal_id, business_date, system_count, system_total, slip_count, slip_total, note, closed_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
          [ctx.tenantId, i.terminalId, i.date, sys.n, sys.total, i.slipCount, i.slipTotal, i.note ?? null, ctx.userId]);
        await audit(c, ctx, { action: "pos_settlement.close", entityType: "pos_settlement", entityId: s.rows[0].id,
          changes: { terminal: { from: null, to: t.name }, business_date: { from: null, to: i.date }, system_count: { from: null, to: sys.n }, system_total: { from: null, to: sys.total },
            slip_count: { from: null, to: i.slipCount }, slip_total: { from: null, to: i.slipTotal } } });
        return { id: s.rows[0].id as string, matched, systemCount: sys.n as number, systemTotal: sys.total as string };
      });
      replayHeader(res, r);
      return r.body;
    });
  }
}
