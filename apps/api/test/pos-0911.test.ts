/**
 * ADR-109 (09.11.2026): POS entegrasyonu — Faz 0.
 *  - Terminal: yalnız POS türündeki kasaya bağlanır; finance.settings ile tanımlanır; sürücü/kasa değişmez; sekreter listeler, hekim göremez.
 *  - Elle eşleştirme (banka POS'u): onay kodu + son 4 hane + taksit → aynı transaction'da tahsilat (kart), kasa hareketi, makbuz, dağıtım.
 *    Tam kart no / CVV kabul edilmez ve hiçbir tabloda saklanmaz. Banka POS'una "cihaza gönder" 422.
 *  - DENEME cihazı: tutar gönderilir → kart bekleniyor; terminal başına tek açık işlem (çift çekim koruması, 409);
 *    onay → tahsilat; ret → tahsilat yok; yanıt yok / süre aşımı → "sonuç bilinmiyor" — iptal edilemez, fişe bakılarak elle çözülür.
 *  - Gün sonu: sistem toplamı ↔ fiş; açık işlem varken kapanmaz; fark varsa açıklama zorunlu; kapalı güne yeni çekim yok; idempotent.
 *  - Veritabanı: FORCE RLS, sonuçlanmış işlem değişmez, uygulama rolü tutar/terminal güncelleyemez, B kiracısı göremez.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, adminQuery, login, ownerQuery, startApp, tomorrowIstanbul, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, sec: Client, dentist: Client, fin: Client, bAdmin: Client;
let tenantA: string, posAcct: string, cashAcct: string, patientId: string;
const key = () => `t-${randomUUID()}`;
const tag = randomUUID().slice(0, 4).toUpperCase();
const PAN = "4242424242424242";

async function terminal(driver: "manual" | "mock", name = `${driver} ${randomUUID().slice(0, 6)}`) {
  return (await admin.post("/pos/terminals", { name: `POS ${tag} ${name}`, driver, cashAccountId: posAcct, terminalRef: "T-77" }).expect(201)).body.id as string;
}
async function deviceIntent(terminalId: string, amount = "250.00", extra: Record<string, unknown> = {}) {
  return (await sec.post("/pos/intents", { terminalId, patientId, amount, mode: "device", ...extra }).set("idempotency-key", key()).expect(201)).body;
}

beforeAll(async () => {
  app = await startApp();
  [admin, sec, dentist, fin, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aSecretary), login(app, EMAILS.aDentist),
    login(app, EMAILS.aFinance), login(app, EMAILS.bAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  const accts = (await admin.get("/cash-accounts").expect(200)).body.items as { id: string; kind: string }[];
  posAcct = accts.find((a) => a.kind === "pos_manual")!.id;
  cashAcct = accts.find((a) => a.kind === "cash")!.id;
  patientId = (await sec.post("/patients", { firstName: "Pos", lastName: `Hasta${tag}`, birthDate: "1981-03-04", acknowledgeDuplicates: true }).expect(201)).body.patient.id;
});
afterAll(async () => { await app.close(); });

describe("terminal tanımı", () => {
  it("yalnız POS kasasına bağlanır; yetki; sürücü değişmez; seed terminalleri listede", async () => {
    const bad = await admin.post("/pos/terminals", { name: `POS ${tag} nakit`, driver: "manual", cashAccountId: cashAcct });
    expect(bad.status).toBe(422);
    expect(bad.body.field_errors.cashAccountId).toBeTruthy();
    expect((await sec.post("/pos/terminals", { name: `POS ${tag} sek`, driver: "manual", cashAccountId: posAcct })).status).toBe(403);
    const t = await terminal("manual", "ön büro");
    const dup = await admin.post("/pos/terminals", { name: `POS ${tag} ön büro`, driver: "manual", cashAccountId: posAcct });
    expect(dup.status).toBe(422);
    const ch = await admin.patch(`/pos/terminals/${t}`, { name: `POS ${tag} ön büro`, driver: "mock", cashAccountId: posAcct });
    expect(ch.status).toBe(409);
    expect((await admin.patch(`/pos/terminals/${t}`, { name: `POS ${tag} ön büro 2`, driver: "manual", cashAccountId: posAcct, bankName: "Sentetik Banka" })).status).toBe(200);
    const list = (await sec.get("/pos/terminals").expect(200)).body.items as { id: string; name: string; driver: string; sendsAmount: boolean }[];
    expect(list.find((x) => x.id === t)).toMatchObject({ name: `POS ${tag} ön büro 2`, driver: "manual", sendsAmount: false });
    expect(list.some((x) => x.driver === "mock" && x.sendsAmount)).toBe(true);
    expect((await dentist.get("/pos/terminals")).status).toBe(403);
    expect((await ownerQuery(tenantA, "select count(*)::int as n from audit_events where entity_type = 'pos_terminal' and entity_id = $1", [t]))[0].n).toBe(2);
  });
});

describe("elle eşleştirme (bağımsız banka POS'u)", () => {
  let t: string;
  beforeAll(async () => { t = await terminal("manual"); });

  it("onay kodu + son 4 hane + taksit → tahsilat, kasa hareketi, makbuz, dağıtım; idempotent", async () => {
    const rcv = (await fin.post("/receivables", { patientId, description: `POS alacak ${tag}`, amount: "900.00" }).set("idempotency-key", key()).expect(201)).body.id;
    const k = key();
    const body = { terminalId: t, patientId, amount: "1200.00", installments: 3, mode: "manual", authCode: "a1b2c3", cardLast4: "4242",
      allocations: [{ receivableId: rcv, amount: "900.00" }] };
    const r = (await sec.post("/pos/intents", body).set("idempotency-key", k).expect(201)).body;
    expect(r).toMatchObject({ status: "approved", mode: "manual", amount: "1200.00", installments: 3, authCode: "A1B2C3", cardMasked: "•••• 4242" });
    expect(r.paymentId).toBeTruthy();
    expect(r.receiptNo).toBeTruthy();
    const again = await sec.post("/pos/intents", body).set("idempotency-key", k).expect(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body.id).toBe(r.id);
    const pay = await ownerQuery(tenantA, "select method, cash_account_id, amount::text, note, pos_intent_id from payments where id = $1", [r.paymentId]);
    expect(pay[0]).toMatchObject({ method: "card_manual", cash_account_id: posAcct, amount: "1200.00", pos_intent_id: r.id });
    expect(pay[0].note).toContain("onay A1B2C3");
    expect(pay[0].note).toContain("3 taksit");
    const mv = await ownerQuery(tenantA, "select amount::text from cash_movements where source = 'payment' and source_id = $1", [r.paymentId]);
    expect(mv[0].amount).toBe("1200.00");
    const acc = (await sec.get(`/patients/${patientId}/account`).expect(200)).body;
    expect(acc.receivables.find((x: { id: string }) => x.id === rcv).open).toBe("0.00");
    expect(acc.payments.find((x: { id: string }) => x.id === r.paymentId).available).toBe("300.00");
    expect(acc.reconciled).toBe(true);
    const au = await ownerQuery(tenantA, "select action from audit_events where entity_id = $1 order by created_at", [r.id]);
    expect(au.map((x) => x.action)).toEqual(expect.arrayContaining(["pos_intent.create", "pos_intent.approve"]));
  });

  it("eksik onay kodu / son 4 hane 422; tam kart no ve CVV kabul edilmez, hiçbir yerde saklanmaz", async () => {
    const miss = await sec.post("/pos/intents", { terminalId: t, patientId, amount: "10.00", mode: "manual" }).set("idempotency-key", key());
    expect(miss.status).toBe(422);
    expect(Object.keys(miss.body.field_errors)).toEqual(expect.arrayContaining(["authCode", "cardLast4"]));
    const pan = await sec.post("/pos/intents", { terminalId: t, patientId, amount: "10.00", mode: "manual", authCode: "123456", cardLast4: PAN }).set("idempotency-key", key());
    expect(pan.status).toBe(422);
    expect(pan.body.field_errors.cardLast4).toBeTruthy();
    expect((await sec.post("/pos/intents", { terminalId: t, patientId, amount: "10.00", mode: "manual", authCode: "123456", cardLast4: "12a4" }).set("idempotency-key", key())).status).toBe(422);
    const hits = await adminQuery(
      `select (select count(*) from pos_intents where auth_code like '%' || $1 || '%' or note like '%' || $1 || '%')
            + (select count(*) from payments where note like '%' || $1 || '%')
            + (select count(*) from audit_events where changes::text like '%' || $1 || '%')
            + (select count(*) from idempotency_keys where response::text like '%' || $1 || '%') as n`, [PAN]);
    expect(Number(hits[0].n)).toBe(0);
  });

  it("banka POS'una tutar gönderilemez (422); benzetim yalnız DENEME cihazında (409)", async () => {
    const r = await sec.post("/pos/intents", { terminalId: t, patientId, amount: "10.00", mode: "device" }).set("idempotency-key", key());
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("POS_DRIVER_NO_DEVICE");
    const ok = (await sec.post("/pos/intents", { terminalId: t, patientId, amount: "15.00", mode: "manual", authCode: "998877", cardLast4: "1111" }).set("idempotency-key", key()).expect(201)).body;
    const sim = await sec.post(`/pos/intents/${ok.id}/simulate`, { outcome: "approved" });
    expect(sim.status).toBe(409);
    expect(sim.body.code).toBe("POS_NOT_SIMULATED");
  });
});

describe("DENEME cihazı: tutar cihaza gider", () => {
  it("kart bekleniyor; aynı terminale ikinci işlem 409 (çift çekim koruması); onay → tahsilat", async () => {
    const t = await terminal("mock");
    const a = await deviceIntent(t, "250.00", { installments: 2 });
    expect(a).toMatchObject({ status: "awaiting_card", mode: "device", paymentId: null });
    expect(a.providerRef).toMatch(/^DENEME-\d{6}$/);
    expect(a.expiresAt).toBeTruthy();
    const busy = await sec.post("/pos/intents", { terminalId: t, patientId, amount: "1.00", mode: "device" }).set("idempotency-key", key());
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe("POS_TERMINAL_BUSY");
    expect(busy.body.details.intentId).toBe(a.id);
    expect((await ownerQuery(tenantA, "select count(*)::int as n from payments where pos_intent_id = $1", [a.id]))[0].n).toBe(0);
    const ok = (await sec.post(`/pos/intents/${a.id}/simulate`, { outcome: "approved" }).expect(200)).body;
    expect(ok).toMatchObject({ status: "approved", installments: 2 });
    expect(ok.cardMasked).toMatch(/^•••• \d{4}$/);
    expect(ok.authCode).toMatch(/^DN\d{4,}$/);
    const pay = await ownerQuery(tenantA, "select amount::text, method from payments where id = $1", [ok.paymentId]);
    expect(pay[0]).toMatchObject({ amount: "250.00", method: "card_manual" });
    expect((await sec.post(`/pos/intents/${a.id}/simulate`, { outcome: "approved" })).status).toBe(409);
    const cancel = await sec.post(`/pos/intents/${a.id}/cancel`, { reason: "vazgeçti" });
    expect(cancel.status).toBe(409);
    await deviceIntent(t, "5.00"); // terminal yeniden boş
  });

  it("ret → tahsilat yok, terminal boşalır; iptal gerekçeli", async () => {
    const t = await terminal("mock");
    const a = await deviceIntent(t);
    const d = (await sec.post(`/pos/intents/${a.id}/simulate`, { outcome: "declined" }).expect(200)).body;
    expect(d).toMatchObject({ status: "declined", paymentId: null });
    expect(d.failureReason).toContain("DENEME");
    const b = await deviceIntent(t);
    expect((await sec.post(`/pos/intents/${b.id}/cancel`, { reason: "x" })).status).toBe(422);
    expect((await sec.post(`/pos/intents/${b.id}/cancel`, { reason: "Hasta nakit ödeyecek" }).expect(200)).body.status).toBe("cancelled");
    expect((await sec.post(`/pos/intents/${b.id}/simulate`, { outcome: "approved" })).status).toBe(409);
    expect((await ownerQuery(tenantA, "select count(*)::int as n from payments where pos_intent_id in ($1, $2)", [a.id, b.id]))[0].n).toBe(0);
  });

  it("yanıt yok → sonuç bilinmiyor: iptal edilemez; fişe göre ret ya da onay ile çözülür", async () => {
    const t = await terminal("mock");
    const a = await deviceIntent(t, "75.50");
    expect((await sec.post(`/pos/intents/${a.id}/simulate`, { outcome: "no_response" }).expect(200)).body.status).toBe("unknown");
    const c = await sec.post(`/pos/intents/${a.id}/cancel`, { reason: "Hasta gitti" });
    expect(c.status).toBe(409);
    expect(c.body.code).toBe("POS_INTENT_UNKNOWN");
    expect((await sec.post("/pos/intents", { terminalId: t, patientId, amount: "1.00", mode: "device" }).set("idempotency-key", key())).status).toBe(409);
    expect((await sec.post(`/pos/intents/${a.id}/resolve`, { outcome: "declined", reason: "Fişte çekim yok" }).set("idempotency-key", key()).expect(201)).body.status).toBe("declined");

    const b = await deviceIntent(t, "75.50");
    await sec.post(`/pos/intents/${b.id}/simulate`, { outcome: "no_response" }).expect(200);
    expect((await sec.post(`/pos/intents/${b.id}/resolve`, { outcome: "approved", authCode: "445566", cardLast4: PAN }).set("idempotency-key", key())).status).toBe(422);
    const r = (await sec.post(`/pos/intents/${b.id}/resolve`, { outcome: "approved", authCode: "445566", cardLast4: "9012" }).set("idempotency-key", key()).expect(201)).body;
    expect(r).toMatchObject({ status: "approved", authCode: "445566", cardMasked: "•••• 9012" });
    expect((await ownerQuery(tenantA, "select amount::text from payments where id = $1", [r.paymentId]))[0].amount).toBe("75.50");
    const acts = (await ownerQuery(tenantA, "select action from audit_events where entity_id = $1", [b.id])).map((x) => x.action);
    expect(acts).toEqual(expect.arrayContaining(["pos_intent.send", "pos_intent.unknown", "pos_intent.resolve", "pos_intent.approve"]));
  });

  it("cihaz süresi dolunca okumada sonuç bilinmiyor olur (denetimli)", async () => {
    const t = await terminal("mock");
    const a = await deviceIntent(t);
    await ownerQuery(tenantA, "update pos_intents set sent_at = now() - interval '10 minutes' where id = $1", [a.id]);
    const g = (await sec.get(`/pos/intents/${a.id}`).expect(200)).body;
    expect(g.status).toBe("unknown");
    expect(g.failureReason).toContain("yanıt gelmedi");
    expect((await ownerQuery(tenantA, "select count(*)::int as n from audit_events where action = 'pos_intent.unknown' and entity_id = $1", [a.id]))[0].n).toBe(1);
  });
});

describe("gün sonu mutabakatı", () => {
  it("sistem toplamı; açık işlem varken kapanmaz; fark açıklamasız 422; kapanınca yeni çekim yok; tekrar 409", async () => {
    const t = await terminal("mock");
    for (const amt of ["100.00", "200.10"]) {
      const a = await deviceIntent(t, amt);
      await sec.post(`/pos/intents/${a.id}/simulate`, { outcome: "approved" }).expect(200);
    }
    const dec = await deviceIntent(t, "999.00");
    await sec.post(`/pos/intents/${dec.id}/simulate`, { outcome: "declined" }).expect(200);
    const open = await deviceIntent(t, "50.00");
    const today = tomorrowIstanbul(0);
    const day = (await sec.get(`/pos/day?date=${today}`).expect(200)).body;
    const row = day.items.find((x: { terminalId: string }) => x.terminalId === t);
    expect(row).toMatchObject({ approvedCount: 2, approvedTotal: "300.10", openCount: 1, settlement: null });
    expect(row.intents).toHaveLength(4);
    const blocked = await sec.post("/pos/settlements", { terminalId: t, date: today, slipCount: 2, slipTotal: "300.10" }).set("idempotency-key", key());
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("POS_OPEN_INTENTS");
    await sec.post(`/pos/intents/${open.id}/cancel`, { reason: "Gün sonu öncesi iptal" }).expect(200);
    const mismatch = await sec.post("/pos/settlements", { terminalId: t, date: today, slipCount: 2, slipTotal: "300.00" }).set("idempotency-key", key());
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.field_errors.note).toBeTruthy();
    const k = key();
    const s = (await sec.post("/pos/settlements", { terminalId: t, date: today, slipCount: 2, slipTotal: "300.10" }).set("idempotency-key", k).expect(201)).body;
    expect(s).toMatchObject({ matched: true, systemCount: 2, systemTotal: "300.10" });
    expect((await sec.post("/pos/settlements", { terminalId: t, date: today, slipCount: 2, slipTotal: "300.10" }).set("idempotency-key", k).expect(201)).headers["idempotent-replayed"]).toBe("true");
    const again = await sec.post("/pos/settlements", { terminalId: t, date: today, slipCount: 2, slipTotal: "300.10" }).set("idempotency-key", key());
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("POS_DAY_CLOSED");
    const late = await sec.post("/pos/intents", { terminalId: t, patientId, amount: "1.00", mode: "device" }).set("idempotency-key", key());
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("POS_DAY_CLOSED");
    const d2 = (await sec.get(`/pos/day?date=${today}`).expect(200)).body.items.find((x: { terminalId: string }) => x.terminalId === t);
    expect(d2.settlement).toMatchObject({ matched: true, slipCount: 2, slipTotal: "300.10" });
    expect((await sec.post("/pos/settlements", { terminalId: t, date: tomorrowIstanbul(1), slipCount: 0, slipTotal: "0.00" }).set("idempotency-key", key())).status).toBe(422);
    expect((await sec.get(`/pos/day?date=${tomorrowIstanbul(1)}`)).status).toBe(422);
    expect((await dentist.get(`/pos/day?date=${today}`)).status).toBe(403);
  });

  it("fark açıklamayla kapanır ve eşleşmedi olarak görünür", async () => {
    const t = await terminal("mock");
    const a = await deviceIntent(t, "40.00");
    await sec.post(`/pos/intents/${a.id}/simulate`, { outcome: "approved" }).expect(200);
    const today = tomorrowIstanbul(0);
    const s = (await sec.post("/pos/settlements", { terminalId: t, date: today, slipCount: 1, slipTotal: "45.00", note: "Fişte 5,00 fazla; bankaya soruldu" })
      .set("idempotency-key", key()).expect(201)).body;
    expect(s.matched).toBe(false);
    const d = (await fin.get(`/pos/day?date=${today}`).expect(200)).body.items.find((x: { terminalId: string }) => x.terminalId === t);
    expect(d.settlement).toMatchObject({ matched: false, systemTotal: "40.00", slipTotal: "45.00" });
  });
});

describe("veritabanı güvenceleri", () => {
  it("FORCE RLS; sonuçlanmış işlem değişmez; uygulama rolü tutar/terminal güncelleyemez, silemez; B kiracısı göremez", async () => {
    const r = await ownerQuery(null, `select relname, relrowsecurity and relforcerowsecurity as f from pg_class where relname in ('pos_terminals','pos_intents','pos_settlements') order by 1`);
    expect(r.map((x) => x.f)).toEqual([true, true, true]);
    const cols = (await ownerQuery(null, `select column_name from information_schema.column_privileges where grantee = 'viadent_app' and table_name = 'pos_intents' and privilege_type = 'UPDATE'`)).map((x) => x.column_name);
    expect(cols).not.toContain("amount");
    expect(cols).not.toContain("terminal_id");
    expect(cols).not.toContain("patient_id");
    const settleUpd = await ownerQuery(null, `select count(*)::int as n from information_schema.column_privileges where grantee = 'viadent_app' and table_name = 'pos_settlements' and privilege_type = 'UPDATE'`);
    expect(settleUpd[0].n).toBe(0);
    const del = await ownerQuery(null, `select count(*)::int as n from information_schema.role_table_grants where grantee = 'viadent_app' and table_name in ('pos_terminals','pos_intents','pos_settlements') and privilege_type = 'DELETE'`);
    expect(del[0].n).toBe(0);
    const done = (await ownerQuery(tenantA, "select id from pos_intents where status = 'approved' limit 1"))[0].id;
    await expect(ownerQuery(tenantA, "update pos_intents set status = 'cancelled', completed_at = now(), payment_id = null where id = $1", [done])).rejects.toThrow(/POS_INTENT_FINAL/);
    await expect(ownerQuery(tenantA, "update pos_intents set card_last4 = '4242424242424242' where id = $1", [done])).rejects.toThrow();
    const bT = bAdmin.session.activeMembership.tenantId;
    expect((await ownerQuery(bT, "select count(*)::int as n from pos_intents where tenant_id = $1", [tenantA]))[0].n).toBe(0);
    expect((await bAdmin.get(`/pos/intents/${done}`)).status).toBe(404);
    expect((await bAdmin.get("/pos/terminals").expect(200)).body.items.some((x: { name: string }) => x.name.includes(tag))).toBe(false);
  });
});
