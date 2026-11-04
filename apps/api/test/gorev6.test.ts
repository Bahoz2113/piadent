/**
 * Görev 6: Operasyon ve raporlar — tedarikçi carisi, laboratuvar iş emri (aşama/revizyon/maliyet), tedavi bazlı prim + prim ödemesi,
 * stok (lot/hareket, eksi stok yok, sayım farkı), PİA Akış görevleri ve raporların alt kayıtlarla mutabakatı (AT-19 dahil).
 * Gerçek PostgreSQL (viadent_test), kısıtlı uygulama rolü.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import pg from "pg";
import { refreshViaAkis, withContext } from "@viadent/db";
import { addMoney, fromMinor, toMinor, zonedToUtc } from "@viadent/contracts";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";
import { APP_URL, WORKER_URL } from "./env.js";

let app: INestApplication;
let admin: Client, fin: Client, sec: Client, dentist: Client, assistant: Client, bAdmin: Client;
let tenantA: string;
let cashId: string, bankId: string, dentistPrac: string;
const key = () => `t-${randomUUID()}`;
const TZ = "Europe/Istanbul";
const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};
const sumCol = (rows: Record<string, unknown>[], k: string) => fromMinor(rows.reduce((s, r) => s + toMinor(String(r[k] ?? "0")), 0n));
const sumInt = (rows: Record<string, unknown>[], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);

let pn = 0;
async function newPatient(name: string) {
  pn++;
  return (await sec.post("/patients", { firstName: name, lastName: "Operasyon", birthDate: `19${60 + pn}-0${1 + (pn % 9)}-1${pn % 10}` }).expect(201)).body.patient.id as string;
}
let slot = 0;
async function visit(pid: string, practitionerId: string) {
  const m = 300 + (slot++ % 40) * 15; // 05:00'ten itibaren, çakışmasız
  const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  // Bugünün erken saati çoğu zaman geçmiştir: geriye dönük kayıt yalnız takvim yöneticisine ve gerekçeyle açık (ADR-094).
  const a = (await admin.post("/appointments", { patientId: pid, practitionerId, date: day(0), startTime: time, durationMinutes: 15, allowOutsideHours: true, backdateReason: "Test: geriye dönük ziyaret kaydı" }).expect(201)).body;
  await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "checked_in" }).expect(200);
  return a.id as string;
}
async function perform(pid: string, apptId: string, code = "TEM-01") {
  const proc = (await dentist.get("/procedures").expect(200)).body.items.find((p: { code: string }) => p.code === code);
  return (await dentist.post(`/patients/${pid}/performed`, { appointmentId: apptId, procedureId: proc.id, location: { kind: "mouth" }, quantity: 1 }).expect(201)).body;
}
async function report(c: Client, id: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams(params).toString();
  return (await c.get(`/reports/${id}${q ? `?${q}` : ""}`).expect(200)).body;
}
async function akis() {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 1 });
  try { return await withContext(pool, { tenantId: tenantA, userId: null }, (c) => refreshViaAkis(c, tenantA)); } finally { await pool.end(); }
}
const openTask = async (kind: string, sourceId: string) =>
  (await ownerQuery(tenantA, "select id, status, assignee_role from tasks where kind = $1 and source_id = $2 order by created_at desc limit 1", [kind, sourceId]))[0];

beforeAll(async () => {
  app = await startApp();
  [admin, fin, sec, dentist, assistant, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aFinance), login(app, EMAILS.aSecretary),
    login(app, EMAILS.aDentist), login(app, EMAILS.aAssistant), login(app, EMAILS.bAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  const accts = (await fin.get("/cash-accounts").expect(200)).body.items;
  cashId = accts.find((a: { kind: string }) => a.kind === "cash").id;
  bankId = accts.find((a: { kind: string }) => a.kind === "bank").id;
  dentistPrac = (await ownerQuery(tenantA, "select pr.id from practitioners pr join memberships m on m.id = pr.membership_id join users u on u.id = m.user_id where u.email = $1",
    [EMAILS.aDentist]))[0].id;
});
afterAll(async () => app.close());

// ================================================================ tedarikçi carisi
describe("tedarikçi / laboratuvar carisi (T15, T16, T18)", () => {
  let supId: string;
  it("tanım yetkisi: yönetici/finans tanımlar, sekreter tanımlayamaz ve iletişim ayrıntısını görmez", async () => {
    supId = (await admin.post("/suppliers", { kind: "lab", name: `Test Lab ${randomUUID().slice(0, 6)}`, phone: "+905550001122", taxNo: "1234567890" }).expect(201)).body.id;
    expect((await sec.post("/suppliers", { kind: "lab", name: "Sekreter Lab" })).status).toBe(403);
    const list = (await sec.get("/suppliers?kind=lab").expect(200)).body.items;
    const mine = list.find((s: { id: string }) => s.id === supId);
    expect(mine).toBeTruthy();
    expect(mine.phone).toBeUndefined();
    expect((await admin.get("/suppliers").expect(200)).body.items.find((s: { id: string }) => s.id === supId).phone).toBe("+905550001122");
    expect((await admin.post("/suppliers", { kind: "lab", name: "x", taxNo: "12" })).status).toBe(422);
  });

  it("fatura 1.000 + ödeme 400 → bakiye 600; aynı anahtar tek ödeme + tek kasa hareketi; ters kayıt bakiyeyi ve kasayı geri alır", async () => {
    await fin.post("/supplier-bills", { supplierId: supId, amount: "1000.00", description: "Sentetik fatura", documentNo: "F-1" }).set("idempotency-key", key()).expect(201);
    const k = key();
    const p1 = (await fin.post("/supplier-payments", { supplierId: supId, amount: "400.00", cashAccountId: cashId }).set("idempotency-key", k).expect(201)).body;
    const p2 = await fin.post("/supplier-payments", { supplierId: supId, amount: "400.00", cashAccountId: cashId }).set("idempotency-key", k).expect(201);
    expect(p2.body.id).toBe(p1.id);
    expect(p2.headers["idempotent-replayed"]).toBe("true");
    expect((await ownerQuery(tenantA, "select count(*)::int as n, sum(amount)::text as s from cash_movements where source = 'supplier_payment' and source_id = $1", [p1.id]))[0])
      .toEqual({ n: 1, s: "-400.00" });
    let led = (await fin.get(`/suppliers/${supId}/ledger`).expect(200)).body;
    expect(led).toMatchObject({ opening: "0.00", billed: "1000.00", paid: "400.00", closing: "600.00" });
    expect(led.entries.at(-1).balanceAfter).toBe("600.00");
    expect((await sec.post("/supplier-payments", { supplierId: supId, amount: "1.00", cashAccountId: cashId }).set("idempotency-key", key())).status).toBe(403);

    const rev = (await fin.post(`/supplier-entries/${p1.id}/reverse`, { reason: "Yanlış hesaptan ödendi" }).expect(201)).body;
    led = (await fin.get(`/suppliers/${supId}/ledger`).expect(200)).body;
    expect(led.closing).toBe("1000.00");
    expect((await ownerQuery(tenantA, "select amount::text from cash_movements where source = 'supplier_payment' and source_id = $1", [rev.id]))[0].amount).toBe("400.00");
    expect((await fin.post(`/supplier-entries/${p1.id}/reverse`, { reason: "tekrar" })).body.code).toBe("ALREADY_REVERSED");
    expect((await fin.post(`/supplier-entries/${rev.id}/reverse`, { reason: "tekrar" })).body.code).toBe("REVERSAL_INVALID");
    const bal = (await fin.get("/supplier-balances").expect(200)).body.items.find((s: { id: string }) => s.id === supId);
    expect(bal).toMatchObject({ billed: "1000.00", paid: "0.00", balance: "1000.00" });
    // Uygulama rolü cari hareketini değiştiremez/silemez (yalnız ekleme).
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("update supplier_entries set amount = 1 where id = $1", [p1.id]))).rejects.toThrow(/permission denied/);
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("delete from supplier_entries where id = $1", [p1.id]))).rejects.toThrow(/permission denied/);
    } finally { await pool.end(); }
  });
});

// ================================================================ laboratuvar
describe("laboratuvar iş emri (H12, Akış E)", () => {
  let labId: string, pid: string, orderId: string;
  beforeAll(async () => {
    labId = (await admin.post("/suppliers", { kind: "lab", name: `Akış Lab ${randomUUID().slice(0, 6)}` }).expect(201)).body.id;
    pid = await newPatient("Lale");
  });

  it("taslak → gönder (hedef tarih zorunlu) → teslim alındı → hekim revizyon (gerekçe) → yeniden teslim → kabul; olay günlüğü tam", async () => {
    const created = (await sec.post("/lab-orders", { patientId: pid, practitionerId: dentistPrac, supplierId: labId, workType: "Zirkonyum kron", teeth: ["16"], shade: "A2" }).expect(201)).body;
    orderId = created.id;
    expect(created.orderNo).toBeGreaterThan(0);
    expect((await sec.post("/lab-orders", { patientId: pid, supplierId: labId, workType: "x iş" })).body.fieldErrors?.practitionerId ?? "hekim").toBeTruthy();
    expect((await sec.post("/lab-orders", { patientId: pid, practitionerId: dentistPrac, supplierId: labId, workType: "Kron", teeth: ["19"] })).status).toBe(422);
    expect((await sec.post(`/lab-orders/${orderId}/transition`, { action: "send" })).body.code).toBe("VALIDATION_FAILED");
    // Taslağa maliyet girilmez
    expect((await fin.post(`/lab-orders/${orderId}/costs`, { stage: "initial", amount: "100.00", description: "Erken maliyet" }).set("idempotency-key", key())).body.code).toBe("LAB_NOT_SENT");
    await sec.post(`/lab-orders/${orderId}/transition`, { action: "send", targetDate: day(5) }).expect(200);
    // Gönderilmiş işin teknik tanımı ve laboratuvarı değişmez
    let o = (await sec.get(`/lab-orders/${orderId}`).expect(200)).body;
    expect((await sec.patch(`/lab-orders/${orderId}`, { expectedVersion: o.version, shade: "B1" })).body.code).toBe("LAB_SPEC_LOCKED");
    const other = (await admin.post("/suppliers", { kind: "lab", name: `Diğer Lab ${randomUUID().slice(0, 6)}` }).expect(201)).body.id;
    expect((await sec.patch(`/lab-orders/${orderId}`, { expectedVersion: o.version, supplierId: other })).body.code).toBe("LAB_SUPPLIER_LOCKED");
    expect((await sec.patch(`/lab-orders/${orderId}`, { expectedVersion: o.version + 5, targetDate: day(6) })).status).toBe(409);
    // Kabul yalnız teslimden sonra ve yalnız hekim
    expect((await dentist.post(`/lab-orders/${orderId}/transition`, { action: "accept" })).body.code).toBe("LAB_INVALID_TRANSITION");
    await sec.post(`/lab-orders/${orderId}/transition`, { action: "in_production" }).expect(200);
    await sec.post(`/lab-orders/${orderId}/transition`, { action: "receive" }).expect(200);
    expect((await sec.post(`/lab-orders/${orderId}/transition`, { action: "accept" })).status).toBe(403);
    expect((await dentist.post(`/lab-orders/${orderId}/transition`, { action: "revision" })).status).toBe(422);
    await dentist.post(`/lab-orders/${orderId}/transition`, { action: "revision", note: "Okluzyon yüksek; kontakt açık", targetDate: day(8) }).expect(200);
    o = (await sec.get(`/lab-orders/${orderId}`).expect(200)).body;
    expect(o).toMatchObject({ status: "revision", revisionCount: 1, targetDate: day(8), receivedAt: null });
    await sec.post(`/lab-orders/${orderId}/transition`, { action: "receive" }).expect(200);
    await dentist.post(`/lab-orders/${orderId}/transition`, { action: "accept", note: "Prova uygun" }).expect(200);
    o = (await dentist.get(`/lab-orders/${orderId}`).expect(200)).body;
    expect(o.status).toBe("accepted");
    expect(o.events.map((e: { kind: string }) => e.kind)).toEqual(
      ["created", "target_changed", "sent", "in_production", "received", "revision_requested", "target_changed", "received", "accepted"]);
    expect((await sec.post(`/lab-orders/${orderId}/transition`, { action: "cancel", note: "geç" })).body.code).toBe("LAB_INVALID_TRANSITION");
    // DB de geçersiz geçişi reddeder (API atlatılsa bile)
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("update lab_orders set status = 'sent' where id = $1", [orderId]))).rejects.toThrow(/lab_invalid_transition/);
    } finally { await pool.end(); }
  });

  it("maliyet: ilk iş + revizyon maliyeti → laboratuvar carisine borç; ters kayıt cariyi de düzeltir; maliyet yalnız yetkiliye görünür", async () => {
    await fin.post(`/lab-orders/${orderId}/costs`, { stage: "initial", amount: "2500.00", description: "Zirkonyum kron" }).set("idempotency-key", key()).expect(201);
    const rc = (await fin.post(`/lab-orders/${orderId}/costs`, { stage: "revision", amount: "300.00", description: "Revizyon işçiliği" }).set("idempotency-key", key()).expect(201)).body;
    const o = (await fin.get(`/lab-orders/${orderId}`).expect(200)).body;
    expect(o.cost).toBe("2800.00");
    expect(o.costs.find((x: { stage: string }) => x.stage === "revision").revisionNo).toBe(1);
    let led = (await fin.get(`/suppliers/${labId}/ledger`).expect(200)).body;
    expect(led.billed).toBe("2800.00");
    expect(led.entries.every((e: { labOrderId: string }) => e.labOrderId === orderId)).toBe(true);
    // Sekreter ve hekim maliyeti görmez
    const s = (await sec.get(`/lab-orders/${orderId}`).expect(200)).body;
    expect(s.cost).toBeUndefined();
    expect(s.costs).toBeUndefined();
    expect((await dentist.post(`/lab-orders/${orderId}/costs`, { stage: "extra", amount: "1.00", description: "x" }).set("idempotency-key", key())).status).toBe(403);
    // Cari tarafından doğrudan ters çevrilemez; maliyetten çevrilir
    const billId = (await ownerQuery(tenantA, "select supplier_entry_id from lab_costs where id = $1", [rc.id]))[0].supplier_entry_id;
    expect((await fin.post(`/supplier-entries/${billId}/reverse`, { reason: "deneme" })).body.code).toBe("USE_SOURCE_REVERSAL");
    await fin.post(`/lab-costs/${rc.id}/reverse`, { reason: "Laboratuvar revizyonu ücretsiz yaptı" }).expect(201);
    expect((await fin.get(`/lab-orders/${orderId}`).expect(200)).body.cost).toBe("2500.00");
    led = (await fin.get(`/suppliers/${labId}/ledger`).expect(200)).body;
    expect(led.closing).toBe("2500.00");
    expect((await fin.post(`/lab-costs/${rc.id}/reverse`, { reason: "tekrar" })).body.code).toBe("ALREADY_REVERSED");
  });

  it("iş föyü laboratuvara en az veri verir (baş harf + iş emri no; telefon/kimlik/anamnez yok) ve erişimi iz bırakır", async () => {
    const w = (await sec.get(`/lab-orders/${orderId}/work-sheet`).expect(200)).body;
    expect(w.patientRef).toMatch(/^L\. O\. · İş emri \d+$/);
    expect(JSON.stringify(w)).not.toMatch(/Lale|Operasyon|\+90|1980/);
    expect((await ownerQuery(tenantA, "select count(*)::int as n from audit_events where action = 'lab_order.work_sheet' and entity_id = $1", [orderId]))[0].n).toBe(1);
  });

  it("PİA Akış: gecikme (sekreter), kabul bekleyen (hekim) ve yarınki randevu için hazır olmayan iş görevleri açılır ve kaynak çözülünce kapanır", async () => {
    const p2 = await newPatient("Nehir");
    const appt = (await sec.post("/appointments", { patientId: p2, practitionerId: dentistPrac, date: day(1), startTime: "07:15", durationMinutes: 15, allowOutsideHours: true }).expect(201)).body;
    const o2 = (await sec.post("/lab-orders", { patientId: p2, practitionerId: dentistPrac, supplierId: labId, workType: "Gece plağı", appointmentId: appt.id }).expect(201)).body.id;
    await sec.post(`/lab-orders/${o2}/transition`, { action: "send", targetDate: day(3) }).expect(200);
    await akis();
    expect(await openTask("lab_not_ready", o2)).toMatchObject({ status: "open", assignee_role: "secretary" });
    // Hedef tarihi geçmişe çekilen (geciken) iş
    let v = (await sec.get(`/lab-orders/${o2}`).expect(200)).body.version;
    await sec.patch(`/lab-orders/${o2}`, { expectedVersion: v, targetDate: day(-1) }).expect(200);
    await akis();
    expect(await openTask("lab_overdue", o2)).toMatchObject({ status: "open", assignee_role: "secretary" });
    v = (await sec.get(`/lab-orders/${o2}`).expect(200)).body.version;
    await sec.patch(`/lab-orders/${o2}`, { expectedVersion: v, targetDate: day(2) }).expect(200);
    await akis();
    expect((await openTask("lab_overdue", o2)).status).toBe("done");
    await sec.post(`/lab-orders/${o2}/transition`, { action: "receive" }).expect(200);
    await akis();
    expect((await openTask("lab_not_ready", o2)).status).toBe("done");
    expect(await openTask("lab_review", o2)).toMatchObject({ status: "open", assignee_role: "dentist" });
    await dentist.post(`/lab-orders/${o2}/transition`, { action: "accept" }).expect(200);
    await akis();
    expect((await openTask("lab_review", o2)).status).toBe("done");
  });

  it("liste süzgeçleri (açık / geciken / kabul bekleyen / kapanan / tümü) ve özet sayaçlar tutarlı", async () => {
    const all = (await sec.get("/lab-orders").expect(200)).body.items;
    for (const f of ["open", "overdue", "received", "closed"]) {
      const items = (await sec.get(`/lab-orders?status=${f}`).expect(200)).body.items as { status: string; overdue: boolean }[];
      const expected = all.filter((o: { status: string; overdue: boolean }) => f === "open" ? ["draft", "sent", "in_production", "revision", "received"].includes(o.status)
        : f === "overdue" ? o.overdue : f === "received" ? o.status === "received" : ["accepted", "cancelled"].includes(o.status));
      expect(items.length, f).toBe(expected.length);
    }
    const s = (await sec.get("/lab-orders-summary").expect(200)).body;
    expect(s.overdue).toBe(all.filter((o: { overdue: boolean }) => o.overdue).length);
    expect(s.awaitingDecision).toBe(all.filter((o: { status: string }) => o.status === "received").length);
    expect(s.costThisMonth).toBeUndefined();
    expect((await fin.get("/lab-orders-summary").expect(200)).body.costThisMonth).toMatch(/^\d+\.\d{2}$/);
    expect(all.every((o: { cost?: string }) => o.cost === undefined)).toBe(true);
  });

  it("iş emri numarası kliniğe göre sıralı; B kliniği A'nın iş emrini, carisini ve föyünü göremez", async () => {
    const nos = (await ownerQuery(tenantA, "select order_no from lab_orders order by order_no")).map((r) => r.order_no);
    expect(nos).toEqual(nos.map((_, i) => i + 1));
    expect((await bAdmin.get(`/lab-orders/${orderId}`)).status).toBe(404);
    expect((await bAdmin.get(`/lab-orders/${orderId}/work-sheet`)).status).toBe(404);
    expect((await bAdmin.get(`/suppliers/${labId}/ledger`)).status).toBe(404);
    expect((await bAdmin.post(`/lab-orders/${orderId}/transition`, { action: "cancel", note: "x deneme" })).status).toBe(404);
    expect((await bAdmin.post("/lab-orders", { patientId: pid, supplierId: labId, workType: "Kron" })).status).toBe(422);
    const bl = (await report(bAdmin, "laboratuvar", { from: day(-30), to: day(0) })).rows;
    expect(bl.some((r: { lab: string }) => r.lab.startsWith("Akış Lab"))).toBe(false);
  });
});

// ================================================================ prim
describe("hekim primi: tedavi bazlı kural, ters prim ve prim ödemesi (R19, R20, VD-013)", () => {
  let prac: string, pid: string, perf: { id: string; amount: string; receivableId: string };
  beforeAll(async () => {
    prac = (await admin.post("/practitioners", { displayName: `Dt. Prim ${randomUUID().slice(0, 4)}` }).expect(201)).body.id;
    pid = await newPatient("Prim");
  });

  it("tedavi bazlı %20 kural: işlem tamamlanınca 1.200 × %20 = 240 tahakkuk; aynı gün ikinci kural reddedilir; tahsilat dağıtımı ayrıca prim doğurmaz", async () => {
    await fin.post("/commission-rules", { practitionerId: prac, basis: "treatment", rate: "20", validFrom: day(0), note: "Sentetik tedavi primi" }).expect(201);
    expect((await fin.post("/commission-rules", { practitionerId: prac, basis: "collection", rate: "10", validFrom: day(0) })).body.code).toBe("RULE_EXISTS");
    expect((await fin.post("/commission-rules", { practitionerId: prac, basis: "treatment", rate: "20", validFrom: day(-1) })).status).toBe(422);
    perf = await perform(pid, await visit(pid, prac));
    expect(perf.amount).toBe("1200.00");
    let acc = await ownerQuery(tenantA, "select basis, base_amount::text, rate::text, amount::text from commission_accruals where practitioner_id = $1", [prac]);
    expect(acc).toEqual([{ basis: "treatment", base_amount: "1200.00", rate: "20.00", amount: "240.00" }]);
    await fin.post("/payments", { patientId: pid, amount: "1200.00", method: "cash", cashAccountId: cashId, allocations: [{ receivableId: perf.receivableId, amount: "1200.00" }] })
      .set("idempotency-key", key()).expect(201);
    acc = await ownerQuery(tenantA, "select basis from commission_accruals where practitioner_id = $1", [prac]);
    expect(acc).toHaveLength(1); // çift prim yok
  });

  it("işlem iptali orijinal oranla ters prim doğurur (silinmez); yeniden işlem yeni tahakkuk", async () => {
    await dentist.post(`/performed/${perf.id}/cancel`, { reason: "Yanlış kayıt" }).expect(200);
    const rows = await ownerQuery(tenantA, "select amount::text, reverses_id is not null as rev from commission_accruals where practitioner_id = $1 order by created_at", [prac]);
    expect(rows).toEqual([{ amount: "240.00", rev: false }, { amount: "-240.00", rev: true }]);
    perf = await perform(pid, await visit(pid, prac));
    const net = (await ownerQuery(tenantA, "select sum(amount)::text as s from commission_accruals where practitioner_id = $1", [prac]))[0].s;
    expect(net).toBe("240.00");
  });

  it("prim ödemesi: tahakkuku aşamaz (API + DB), kasadan çıkar, ters kaydı bakiyeyi geri verir; eşzamanlı iki ödeme tahakkuku aşmaz", async () => {
    expect((await fin.post("/commission-payouts", { practitionerId: prac, amount: "240.01", cashAccountId: cashId }).set("idempotency-key", key())).body.code).toBe("PAYOUT_EXCEEDS_ACCRUED");
    expect((await sec.post("/commission-payouts", { practitionerId: prac, amount: "1.00", cashAccountId: cashId }).set("idempotency-key", key())).status).toBe(403);
    const p = (await fin.post("/commission-payouts", { practitionerId: prac, amount: "200.00", cashAccountId: cashId, periodFrom: day(0), periodTo: day(0) })
      .set("idempotency-key", key()).expect(201)).body;
    expect((await ownerQuery(tenantA, "select amount::text from cash_movements where source = 'commission_payout' and source_id = $1", [p.id]))[0].amount).toBe("-200.00");
    let g = (await fin.get(`/commissions?from=${day(0)}&to=${day(0)}`).expect(200)).body.groups.find((x: { practitionerId: string }) => x.practitionerId === prac);
    expect(g).toMatchObject({ accrued: "480.00", reversed: "-240.00", net: "240.00", paidPeriod: "200.00", payable: "40.00" });
    await fin.post(`/commission-payouts/${p.id}/reverse`, { reason: "Yanlış hekime ödendi" }).expect(201);
    expect((await fin.post(`/commission-payouts/${p.id}/reverse`, { reason: "tekrar" })).body.code).toBe("ALREADY_REVERSED");
    g = (await fin.get(`/commissions?from=${day(0)}&to=${day(0)}`).expect(200)).body.groups.find((x: { practitionerId: string }) => x.practitionerId === prac);
    expect(g.payable).toBe("240.00");
    // 2 × 150 eşzamanlı: biri geçer, diğeri tahakkuku aşacağı için reddedilir (hekim bazında kilit + tetikleyici)
    const res = await Promise.all([1, 2].map(() => fin.post("/commission-payouts", { practitionerId: prac, amount: "150.00", cashAccountId: cashId }).set("idempotency-key", key())));
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    // Doğrudan SQL ile de aşılamaz
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query(
        `insert into commission_payouts(tenant_id, practitioner_id, amount, cash_account_id, paid_at, created_by)
         select $1, $2, 100.00, $3, now(), created_by from commission_rule_versions where practitioner_id = $2 limit 1`, [tenantA, prac, cashId]))).rejects.toThrow(/payout_exceeds_accrued/);
    } finally { await pool.end(); }
    const rep = await report(fin, "prim", { from: day(0), to: day(0), practitionerId: prac });
    expect(rep.totals).toMatchObject({ accrued: "480.00", reversed: "-240.00", net: "240.00", payable: "90.00" });
    expect(sumCol(rep.rows, "amount")).toBe(rep.totals.net);
    expect((await report(fin, "prim", { from: day(0), to: day(0), basis: "collection", practitionerId: prac })).totals.count).toBe(0);
  });
});

// ================================================================ stok
describe("stok: lot, hareket, sayım; miktar ezilmez, eksiye düşmez", () => {
  let itemId: string, plainId: string, lotId: string;
  it("tanım yalnız yönetici; lot takipli kalemde lot zorunlu; aynı lot farklı SKT reddedilir", async () => {
    const code = `IMP-${randomUUID().slice(0, 4)}`;
    expect((await assistant.post("/stock/items", { code, name: "Test implant", unit: "adet", trackLots: true })).status).toBe(403);
    itemId = (await admin.post("/stock/items", { code, name: "Test implant", unit: "adet", trackLots: true, minLevel: "2" }).expect(201)).body.id;
    plainId = (await admin.post("/stock/items", { code: `ELD-${randomUUID().slice(0, 4)}`, name: "Test eldiven", unit: "kutu", minLevel: "1" }).expect(201)).body.id;
    expect((await assistant.post("/stock/receipts", { itemId, quantity: "5" }).set("idempotency-key", key())).status).toBe(422);
    const r = (await assistant.post("/stock/receipts", { itemId, quantity: "5", lotNo: "L-100", expiryDate: day(300) }).set("idempotency-key", key()).expect(201)).body;
    lotId = r.lotId;
    expect((await assistant.post("/stock/receipts", { itemId, quantity: "1", lotNo: "L-100", expiryDate: day(200) }).set("idempotency-key", key())).body.code).toBe("LOT_EXPIRY_MISMATCH");
    expect((await assistant.post("/stock/receipts", { itemId: plainId, quantity: "3", lotNo: "X" }).set("idempotency-key", key())).status).toBe(422);
    await assistant.post("/stock/receipts", { itemId: plainId, quantity: "3" }).set("idempotency-key", key()).expect(201);
    // Cari borç doğuran giriş yalnız cari yetkisiyle
    const supId = (await admin.post("/suppliers", { kind: "medical", name: `Depo ${randomUUID().slice(0, 6)}` }).expect(201)).body.id;
    expect((await assistant.post("/stock/receipts", { itemId: plainId, quantity: "2", unitCost: "45.50", supplierId: supId, createBill: true }).set("idempotency-key", key())).status).toBe(403);
    const withBill = (await admin.post("/stock/receipts", { itemId: plainId, quantity: "2", unitCost: "45.50", supplierId: supId, createBill: true, documentNo: "IRS-1" })
      .set("idempotency-key", key()).expect(201)).body;
    expect((await ownerQuery(tenantA, "select amount::text, source from supplier_entries where id = $1", [withBill.billId]))[0]).toEqual({ amount: "91.00", source: "stock_receipt" });
    // Girişin ters kaydı stoku ve cari borcu birlikte geri alır
    await admin.post(`/stock/movements/${withBill.id}/reverse`, { reason: "Yanlış irsaliye" }).expect(201);
    expect((await fin.get(`/suppliers/${supId}/ledger`).expect(200)).body.closing).toBe("0.00");
  });

  it("kullanım bakiyeyi aşamaz; hastaya kullanılan lot izlenir; SKT geçmiş lot hastada kullanılamaz ama imha edilebilir", async () => {
    const pid = await newPatient("Lot");
    expect((await assistant.post("/stock/usages", { itemId, lotId, quantity: "6", patientId: pid }).set("idempotency-key", key())).body.code).toBe("STOCK_INSUFFICIENT");
    expect((await assistant.post("/stock/usages", { itemId, quantity: "1" }).set("idempotency-key", key())).body.code).toBe("VALIDATION_FAILED");
    await assistant.post("/stock/usages", { itemId, lotId, quantity: "1", patientId: pid }).set("idempotency-key", key()).expect(201);
    const used = (await assistant.get(`/patients/${pid}/stock-usage`).expect(200)).body.items;
    expect(used[0]).toMatchObject({ lotNo: "L-100", quantity: "-1.000", expiry: day(300) });
    const exp = (await assistant.post("/stock/receipts", { itemId, quantity: "2", lotNo: "L-OLD", expiryDate: day(-1) }).set("idempotency-key", key()).expect(201)).body.lotId;
    expect((await assistant.post("/stock/usages", { itemId, lotId: exp, quantity: "1", patientId: pid }).set("idempotency-key", key())).body.code).toBe("LOT_EXPIRED");
    await assistant.post("/stock/waste", { itemId, lotId: exp, quantity: "2", reason: "SKT geçti, imha" }).expect(201);
    expect((await assistant.post("/stock/waste", { itemId, lotId: exp, quantity: "1", reason: "tekrar" })).body.code).toBe("STOCK_INSUFFICIENT");
  });

  it("sayım: fark düzeltme hareketi olarak yazılır (gerekçeli), eşitse hareket yok; uygulama rolü miktarı güncelleyemez", async () => {
    const before = (await assistant.get("/stock/items").expect(200)).body.items.find((i: { id: string }) => i.id === itemId);
    expect(before.balance).toBe("4.000");
    const c1 = (await assistant.post("/stock/counts", { itemId, lotId, countedQuantity: "3", reason: "Aylık sayım" }).expect(201)).body;
    expect(c1).toMatchObject({ difference: "-1.000", system: "4.000" });
    expect((await ownerQuery(tenantA, "select kind, quantity::text, reason from stock_movements where id = $1", [c1.movementId]))[0])
      .toEqual({ kind: "adjustment", quantity: "-1.000", reason: "Sayım: sistem 4, sayılan 3 · Aylık sayım" });
    expect((await assistant.post("/stock/counts", { itemId, lotId, countedQuantity: "3", reason: "Tekrar sayım" }).expect(201)).body.movementId).toBeNull();
    expect((await assistant.post("/stock/counts", { itemId, countedQuantity: "3", reason: "lotsuz" })).status).toBe(422);
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("update stock_movements set quantity = 100 where item_id = $1", [itemId]))).rejects.toThrow(/permission denied/);
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query(
        "insert into stock_movements(tenant_id, item_id, lot_id, kind, quantity, reason, occurred_at, created_by) select $1,$2,$3,'adjustment',-50,'deneme',now(),created_by from stock_items where id = $2",
        [tenantA, itemId, lotId]))).rejects.toThrow(/stock_negative/);
    } finally { await pool.end(); }
  });

  it("eşzamanlı iki kullanım tek tek sığar ama birlikte sığmaz → biri reddedilir; en az seviye ve SKT görevleri açılır", async () => {
    const res = await Promise.all([1, 2].map(() => assistant.post("/stock/usages", { itemId, lotId, quantity: "2" }).set("idempotency-key", key())));
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    const bal = (await assistant.get("/stock/items").expect(200)).body.items.find((i: { id: string }) => i.id === itemId);
    expect(bal).toMatchObject({ balance: "1.000", low: true });
    await assistant.post("/stock/receipts", { itemId, quantity: "1", lotNo: "L-SOON", expiryDate: day(10) }).set("idempotency-key", key()).expect(201);
    await akis();
    expect(await openTask("stock_low", itemId)).toMatchObject({ status: "open", assignee_role: "assistant" });
    const soonLot = (await ownerQuery(tenantA, "select id from stock_lots where lot_no = 'L-SOON' and item_id = $1", [itemId]))[0].id;
    expect((await openTask("lot_expiring", soonLot)).status).toBe("open");
    await assistant.post("/stock/receipts", { itemId, quantity: "5", lotNo: "L-100" }).set("idempotency-key", key()).expect(201);
    await akis();
    expect((await openTask("stock_low", itemId)).status).toBe("done");
    expect((await bAdmin.get(`/stock/items/${itemId}/movements`)).status).toBe(404);
    expect((await bAdmin.get("/stock/items").expect(200)).body.items.some((i: { id: string }) => i.id === itemId)).toBe(false);
  });
});

// ================================================================ raporlar: mutabakat
describe("raporlar: yetki, toplam = alt kayıtlar, kaynağa iniş, AT-19, CSV", () => {
  const range = () => ({ from: day(-30), to: day(0) });

  it("katalog role göre: sekreter finans raporu görmez/çalıştıramaz; hekim klinik raporlarda yalnız kendi kayıtları", async () => {
    const s = (await sec.get("/reports").expect(200)).body;
    const ids = s.reports.map((r: { id: string }) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["randevu", "kontrol", "mesaj", "onam", "laboratuvar"]));
    expect(ids).not.toContain("gelir-gider");
    expect(ids).not.toContain("tedavi");
    expect(s.canExport).toBe(false);
    expect((await sec.get("/reports/gelir-gider")).status).toBe(403);
    expect((await sec.get("/reports/log")).status).toBe(403);
    expect((await fin.get("/reports/tedavi")).status).toBe(403);
    const d = (await dentist.get("/reports").expect(200)).body;
    expect(d.reports.find((r: { id: string }) => r.id === "tedavi").ownOnly).toBe(true);
    expect(d.options.practitioners).toHaveLength(1);
    const other = (await ownerQuery(tenantA, "select id from practitioners where id <> $1 limit 1", [dentistPrac]))[0].id;
    const t = await report(dentist, "tedavi", { ...range(), practitionerId: other, status: "" });
    const mine = (await ownerQuery(tenantA, "select display_name from practitioners where id = $1", [dentistPrac]))[0].display_name;
    expect(t.rows.every((r: { practitioner: string }) => r.practitioner === mine)).toBe(true);
    expect((await fin.get("/reports/tedavi")).status).toBe(403);
    expect((await fin.get(`/reports/gelir-gider?from=${day(-400)}&to=${day(0)}`)).status).toBe(422);
    expect((await fin.get("/reports/olmayan")).status).toBe(404);
  });

  it("AT-19: 23:59:30 ve 00:00:30 tahsilatları klinik gününe göre doğru güne düşer; satır toplamı = gün toplamı", async () => {
    const pid = await newPatient("Gece");
    const late = zonedToUtc(day(-1), "23:59", TZ); late.setSeconds(30);
    const early = zonedToUtc(day(0), "00:00", TZ); early.setSeconds(30);
    await fin.post("/payments", { patientId: pid, amount: "11.11", method: "cash", cashAccountId: cashId, paidAt: late.toISOString() }).set("idempotency-key", key()).expect(201);
    await fin.post("/payments", { patientId: pid, amount: "22.22", method: "cash", cashAccountId: cashId, paidAt: early.toISOString() }).set("idempotency-key", key()).expect(201);
    const y = await report(fin, "nakit-hareketleri", { from: day(-1), to: day(-1), source: "payment" });
    const t = await report(fin, "nakit-hareketleri", { from: day(0), to: day(0), source: "payment" });
    expect(y.rows.some((r: { amount: string }) => r.amount === "11.11")).toBe(true);
    expect(y.rows.some((r: { amount: string }) => r.amount === "22.22")).toBe(false);
    expect(t.rows.some((r: { amount: string }) => r.amount === "22.22")).toBe(true);
    const g = await report(fin, "gelir-gider", { from: day(-1), to: day(0), groupBy: "day" });
    expect(g.rows.find((r: { period: string }) => r.period === day(-1)).collections).toBe(y.totals.collections);
    expect(g.rows.find((r: { period: string }) => r.period === day(0)).collections).toBe(t.totals.collections);
  });

  it("gelir–gider: her sütunda satır toplamı = rapor toplamı = kaynak hareketler; net = tahsilat − iade − gider − tedarikçi − prim; finans özetiyle tutarlı", async () => {
    const g = await report(fin, "gelir-gider", range());
    for (const k of ["treatment", "collections", "refunds", "expenses", "supplierPayments", "commissionPayouts", "netCash"]) expect(sumCol(g.rows, k)).toBe(g.totals[k]);
    // Haftalık gruplama (G05): aynı toplam, satırlar haftalara bölünür; hafta satırından iniş 7 günlük aralıktır
    const w = await report(fin, "gelir-gider", { ...range(), groupBy: "week" });
    for (const k of ["collections", "netCash", "treatment"]) expect(sumCol(w.rows, k)).toBe(g.totals[k]);
    expect(w.rows.every((r: { period: string }) => /^\d{2}\.\d{2}\.\d{4} haftası$/.test(r.period))).toBe(true);
    const wl = w.rows.at(-1);
    expect((await report(fin, wl._drill.report, wl._drill.params)).totals.netCash).toBe(wl.netCash);
    const T = g.totals;
    expect(toMinor(T.netCash)).toBe(toMinor(T.collections) - toMinor(T.refunds) - toMinor(T.expenses) - toMinor(T.supplierPayments) - toMinor(T.commissionPayouts));
    expect(toMinor(T.supplierPayments)).toBeGreaterThan(0n);
    expect(toMinor(T.commissionPayouts)).toBeGreaterThan(0n);
    const n = await report(fin, "nakit-hareketleri", range());
    expect(n.truncated).toBe(false);
    expect(sumCol(n.rows, "amount")).toBe(g.totals.netCash);
    for (const k of ["collections", "refunds", "expenses", "supplierPayments", "commissionPayouts", "netCash"]) expect(n.totals[k]).toBe(g.totals[k]);
    const raw = (await ownerQuery(tenantA, "select coalesce(sum(amount),0)::text as s from cash_movements where occurred_at >= $1 and occurred_at < $2",
      [zonedToUtc(range().from, "00:00", TZ), zonedToUtc(day(1), "00:00", TZ)]))[0].s;
    expect(g.totals.netCash).toBe(raw);
    const s = (await fin.get(`/finance/summary?from=${day(-30)}&to=${day(0)}`).expect(200)).body.metrics;
    expect(g.totals.collections).toBe(s.collections);
    expect(g.totals.refunds).toBe(s.refunds);
    expect(g.totals.treatment).toBe(s.procedureAmount);
    // Kaynağa iniş: aylık satır → o ayın nakit hareketleri (aralıkla kırpılmış)
    const drill = g.rows[0]._drill;
    expect(drill.report).toBe("nakit-hareketleri");
    const sub = await report(fin, drill.report, drill.params);
    expect(sub.totals.netCash).toBe(g.rows[0].netCash);
  });

  it("aylık ciro, tedavi, aylık işlem, borç, plan, hekim-hasta, randevu, kontrol, mesaj, onam, online ödeme, stok, cari, log: satır toplamı = toplam", async () => {
    const r = range();
    const ac = await report(fin, "aylik-ciro", r);
    for (const k of ["treatment", "collections", "refunds", "net"]) expect(sumCol(ac.rows, k)).toBe(ac.totals[k]);
    expect(sumInt(ac.rows, "treatmentCount")).toBe(ac.totals.treatmentCount);
    const td = await report(admin, "tedavi", { ...r, status: "completed" });
    expect(td.rows).toHaveLength(td.totals.count);
    expect(sumCol(td.rows, "amount")).toBe(td.totals.amount);
    expect(td.totals.amount).toBe(ac.totals.treatment);
    const all = await report(admin, "tedavi", { ...r, status: "" });
    expect(toMinor(all.totals.amount) - toMinor(all.totals.completedAmount)).toBe(toMinor(sumCol(all.rows.filter((x: { status: string }) => x.status !== "completed"), "amount")));
    const ai = await report(admin, "aylik-islem", r);
    expect(sumCol(ai.rows, "amount")).toBe(td.totals.amount);
    expect(sumInt(ai.rows, "count")).toBe(ai.totals.count);
    const sub = await report(admin, ai.rows[0]._drill.report, ai.rows[0]._drill.params);
    expect(sub.totals.amount).toBe(ai.rows[0].amount);

    const bb = await report(fin, "borc-bakiye");
    expect(sumCol(bb.rows, "debt")).toBe(bb.totals.debt);
    expect(bb.totals.debt).toBe((await fin.get("/finance/balances").expect(200)).body.totals.openDebt);
    for (const row of bb.rows) expect(addMoney(row.notDue, row.d0_30, row.d31_60, row.d61_90, row.d90p)).toBe(row.debt);
    const bbMin = await report(fin, "borc-bakiye", { minAmount: "400" });
    expect(bbMin.rows.every((x: { debt: string }) => toMinor(x.debt) >= 40000n)).toBe(true);
    expect(sumCol(bbMin.rows, "debt")).toBe(bbMin.totals.debt);

    const pl = await report(admin, "plan", r);
    expect(pl.totals.accepted + pl.totals.rejected + pl.totals.pending).toBe(pl.totals.proposed);
    expect(pl.rows).toHaveLength(pl.totals.proposed);
    const hh = await report(admin, "hekim-hasta", r);
    expect(sumInt(hh.rows, "procedures")).toBe(hh.totals.procedures);
    expect(sumInt(hh.rows, "visits")).toBe(hh.totals.visits);
    expect(hh.totals.patients).toBeLessThanOrEqual(sumInt(hh.rows, "patients"));
    const rv = await report(sec, "randevu", r);
    for (const k of ["total", "completed", "noShow", "cancelled", "open"]) expect(sumInt(rv.rows, k)).toBe(rv.totals[k]);
    for (const [id, c] of [["kontrol", sec], ["mesaj", sec], ["onam", sec], ["online-odeme", fin], ["log", admin]] as const) {
      const x = await report(c, id, id === "kontrol" ? { from: day(-30), to: day(30) } : r);
      expect(x.truncated).toBe(false);
      expect(x.rows, id).toHaveLength(x.totals.count);
    }
    const lg = await report(admin, "log", { ...r, action: "lab_order." });
    expect(lg.rows.every((x: { action: string }) => x.action.startsWith("lab_order."))).toBe(true);
    expect(JSON.stringify(lg.rows)).not.toMatch(/Lale|Okluzyon/); // değer içeriği yok
    const st = await report(assistant, "stok");
    expect(st.rows).toHaveLength(st.totals.items);
    expect(st.rows.filter((x: { flags: string }) => x.flags.includes("En az seviye"))).toHaveLength(st.totals.low);
    const cr = await report(fin, "cari", r);
    for (const k of ["opening", "billed", "paid", "closing"]) expect(sumCol(cr.rows, k)).toBe(cr.totals[k]);
    for (const row of cr.rows) expect(toMinor(row.closing)).toBe(toMinor(row.opening) + toMinor(row.billed) - toMinor(row.paid));
    expect(cr.totals.closing).toBe((await fin.get("/supplier-balances").expect(200)).body.totals.balance);
  });

  it("laboratuvar raporu: maliyet yalnız yetkiliye; toplam maliyet = satırlar; geciken süzgeci anlık durumdur", async () => {
    const s = await report(sec, "laboratuvar", range());
    expect(s.columns.some((c: { key: string }) => c.key === "cost")).toBe(false);
    expect(s.totals.cost).toBeUndefined();
    const f = await report(fin, "laboratuvar", range());
    expect(sumCol(f.rows, "cost")).toBe(f.totals.cost);
    const od = await report(sec, "laboratuvar", { from: day(0), to: day(0), status: "overdue" });
    expect(od.rows.length).toBeGreaterThan(0); // seed'deki geciken iş 6 gün önce açılmıştı
    expect(od.rows).toHaveLength(od.totals.overdue);
  });

  it("işletme analizi: her metrik, indiği raporun toplamına eşit (metrik sözlüğü)", async () => {
    const r = range();
    const m = await report(admin, "isletme", r);
    const val = (k: string) => m.rows.find((x: { key: string }) => x.key === k);
    for (const row of m.rows) expect(row.definition.length).toBeGreaterThan(10);
    const td = await report(admin, val("treatmentAmount")._drill.report, val("treatmentAmount")._drill.params);
    expect(val("treatmentAmount").value).toBe(td.totals.completedAmount);
    const rv = await report(admin, "randevu", r);
    expect(val("completedAppointments").value).toBe(rv.totals.completed);
    expect(val("noShowRate").value).toBe(rv.totals.noShowRate);
    expect(val("netCollections").value).toBe((await report(admin, "aylik-ciro", r)).totals.net);
    expect(val("openDebt").value).toBe((await report(admin, "borc-bakiye")).totals.debt);
    expect(val("planAcceptanceRate").value).toBe((await report(admin, "plan", r)).totals.acceptanceRate);
    expect(val("followUpCompletion").value).toBe((await report(admin, "kontrol", r)).totals.completionRate);
    expect(val("labOverdue").value).toBe((await report(admin, "laboratuvar", { ...r, status: "overdue" })).totals.overdue);
    expect(val("newPatients").value).toBe((await report(admin, "hekim-hasta", r)).totals.newPatients);
  });

  it("CSV: yetki, UTF-8 BOM, ‘;’ ayırıcı, virgüllü tutar, formül enjeksiyonu etkisiz, denetim kaydı veri taşımaz; B kliniği A verisini görmez", async () => {
    expect((await sec.get("/reports/randevu/export")).status).toBe(403);
    expect((await dentist.get("/reports/tedavi/export")).status).toBe(403);
    await admin.post("/suppliers", { kind: "other", name: "=HYPERLINK(\"http://kotu.invalid\";\"tikla\")" }).expect(201);
    const x = await fin.get(`/reports/cari/export?from=${day(-30)}&to=${day(0)}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []; res.on("data", (d: Buffer) => chunks.push(d)); res.on("end", () => cb(null, Buffer.concat(chunks).toString("utf8")));
    }).expect(200);
    const body = x.body as string;
    expect(x.headers["content-type"]).toMatch(/text\/csv/);
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body.split("\r\n")[0]).toBe("﻿Tedarikçi;Tür;Açılış;Borç (fatura/maliyet);Ödeme;Kapanış bakiyesi");
    expect(body).toContain("\"'=HYPERLINK(\"\"http://kotu.invalid\"\";\"\"tikla\"\")\"");
    expect(body).not.toMatch(/\n=HYPERLINK/);
    expect(body).toMatch(/;\d+,\d{2}(;|\r)/);
    const ev = (await ownerQuery(tenantA, "select changes from audit_events where action = 'report.export' order by id desc limit 1"))[0].changes;
    expect(ev.report.to).toBe("cari");
    expect(JSON.stringify(ev)).not.toMatch(/HYPERLINK|Lab/);
    // B kliniği: A'nın verisi hiçbir raporda yok
    const bt = await report(bAdmin, "tedavi", range());
    const aPatients = new Set((await ownerQuery(tenantA, "select first_name || ' ' || last_name as n from patients")).map((p) => p.n));
    expect(bt.rows.some((r: { patient: string }) => aPatients.has(r.patient) && r.patient.includes("Prim"))).toBe(false);
    const bc = await report(bAdmin, "cari", range());
    expect(bc.rows.some((r: { name: string }) => r.name.startsWith("Test Lab") || r.name.startsWith("Akış Lab"))).toBe(false);
  });
});
