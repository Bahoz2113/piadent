/**
 * Görev 3: PİA Net — alacak, ödeme, dağıtım, avans, iade, kasa, gider, idempotency, hekim primi.
 * Gerçek PostgreSQL (viadent_test) üzerinde, kısıtlı uygulama rolüyle. AT-06..AT-10, AT-19, AT-02 (iade), rol ve tenant.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import pg from "pg";
import { withContext } from "@viadent/db";
import { zonedToUtc } from "@viadent/contracts";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";
import { APP_URL } from "./env.js";

let app: INestApplication;
let fin: Client, sec: Client, dentist: Client, admin: Client, assistant: Client, bAdmin: Client;
let tenantA: string, tenantB: string;
let cashId: string, bankId: string, pracId: string;

const key = () => `t-${randomUUID()}`;
const TZ = "Europe/Istanbul";
const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};
async function newPatient(name: string) {
  return (await sec.post("/patients", { firstName: name, lastName: "Finans", birthDate: "1985-05-05" }).expect(201)).body.patient.id as string;
}
async function receivable(patientId: string, amount: string, description = "Sentetik alacak") {
  return (await fin.post("/receivables", { patientId, amount, description, practitionerId: pracId }).set("idempotency-key", key()).expect(201)).body.id as string;
}
async function pay(c: Client, patientId: string, amount: string, allocations: { receivableId: string; amount: string }[] = [], extra: Record<string, unknown> = {}) {
  return (await c.post("/payments", { patientId, amount, method: "cash", cashAccountId: cashId, allocations, ...extra }).set("idempotency-key", key()).expect(201)).body;
}
const account = async (patientId: string) => (await fin.get(`/patients/${patientId}/account`).expect(200)).body;

beforeAll(async () => {
  app = await startApp();
  [fin, sec, dentist, admin, assistant, bAdmin] = await Promise.all([login(app, EMAILS.aFinance), login(app, EMAILS.aSecretary), login(app, EMAILS.aDentist),
    login(app, EMAILS.aAdmin), login(app, EMAILS.aAssistant), login(app, EMAILS.bAdmin)]);
  tenantA = fin.session.activeMembership.tenantId;
  tenantB = bAdmin.session.activeMembership.tenantId;
  const accts = (await fin.get("/cash-accounts").expect(200)).body.items;
  cashId = accts.find((a: { kind: string }) => a.kind === "cash").id;
  bankId = accts.find((a: { kind: string }) => a.kind === "bank").id;
  pracId = (await sec.get("/resources").expect(200)).body.practitioners[0].id;
});
afterAll(async () => app.close());

describe("AT-07 1.000 alacak / 600 ödeme / 100 iade", () => {
  let patientId: string, recId: string, paymentId: string;
  it("600 dağıtılınca açık borç 400; 100 iade dağıtım ters kaydıyla borcu 500 yapar; iz ve mutabakat korunur", async () => {
    patientId = await newPatient("Ayten");
    recId = await receivable(patientId, "1000.00");
    const p = await pay(fin, patientId, "600.00", [{ receivableId: recId, amount: "600.00" }]);
    paymentId = p.id;
    let a = await account(patientId);
    expect(a.totals).toMatchObject({ receivable: "1000.00", openDebt: "400.00", paid: "600.00", advance: "0.00", refunded: "0.00" });

    const r = (await fin.post(`/payments/${paymentId}/refunds`, { amount: "100.00", method: "cash", cashAccountId: cashId, reason: "Sentetik iade testi" })
      .set("idempotency-key", key()).expect(201)).body;
    expect(r.reversedAllocations).toEqual([{ allocationId: expect.any(String), amount: "100.00" }]);
    a = await account(patientId);
    expect(a.totals).toMatchObject({ receivable: "1000.00", openDebt: "500.00", paid: "600.00", refunded: "100.00", advance: "0.00" });
    expect(a.receivables[0]).toMatchObject({ amount: "1000.00", allocated: "500.00", open: "500.00" }); // iade ≠ indirim: alacak tutarı değişmez
    const rev = a.allocations.find((x: { reversesId: string | null }) => x.reversesId);
    expect(rev).toMatchObject({ amount: "-100.00", reason: "İade: Sentetik iade testi" });
    expect(a.reconciled).toBe(true);
    expect(a.ledger.at(-1)).toMatchObject({ openDebtAfter: "500.00", advanceAfter: "0.00" });

    const cm = await ownerQuery(tenantA, "select amount::text from cash_movements where source_id in ($1, $2) order by amount desc", [paymentId, r.id]);
    expect(cm.map((x) => x.amount)).toEqual(["600.00", "-100.00"]);
    const audit = await ownerQuery(tenantA, "select action from audit_events where patient_id = $1 order by created_at", [patientId]);
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["receivable.create", "payment.create", "allocation.create", "allocation.reverse", "payment.refund"]));
  });

  it("hekim primi: 600 dağıtım → 60; 100 iade → −10 ters prim (Plan §06 örneği)", async () => {
    const rows = await ownerQuery(tenantA,
      `select ac.amount::text, ac.rate::text, ac.reverses_id is not null as rev from commission_accruals ac join allocations a on a.id = ac.allocation_id
        where a.payment_id = $1 order by ac.created_at`, [paymentId]);
    expect(rows).toEqual([{ amount: "60.00", rate: "10.00", rev: false }, { amount: "-10.00", rate: "10.00", rev: true }]);
  });

  it("iade ödemenin iade edilebilir tutarını aşamaz; DB de engeller", async () => {
    const r = await fin.post(`/payments/${paymentId}/refunds`, { amount: "500.01", method: "cash", cashAccountId: cashId, reason: "fazla" }).set("idempotency-key", key());
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("REFUND_EXCEEDS_PAYMENT");
    // API atlatılsa bile: dağıtılmış tutar varken doğrudan iade satırı reddedilir.
    await expect(withContext(new pg.Pool({ connectionString: APP_URL, max: 1 }), { tenantId: tenantA, userId: null }, (c) =>
      c.query("insert into refunds(tenant_id, payment_id, amount, method, cash_account_id, reason, refunded_at, created_by) select $1,$2,10,'cash',$3,'x deneme',now(),received_by from payments where id = $2",
        [tenantA, paymentId, cashId]))).rejects.toThrow(/refund_requires_deallocation/);
  });

  it("hareketler değiştirilemez/silinemez (uygulama rolü)", async () => {
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("update payments set amount = 1 where id = $1", [paymentId]))).rejects.toThrow(/permission denied/);
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("delete from allocations where payment_id = $1", [paymentId]))).rejects.toThrow(/permission denied/);
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("update receivables set amount = 1 where id = $1", [recId]))).rejects.toThrow(/receivable_immutable/);
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("delete from refunds"))).rejects.toThrow(/permission denied/);
    } finally { await pool.end(); }
  });
});

describe("AT-06 aynı Idempotency-Key", () => {
  it("aynı istek iki kez → tek ödeme, tek kasa hareketi; ikinci yanıt aynı ve 'replayed' işaretli", async () => {
    const pid = await newPatient("Bora");
    const k = key();
    const body = { patientId: pid, amount: "250.00", method: "cash", cashAccountId: cashId };
    const r1 = await fin.post("/payments", body).set("idempotency-key", k).expect(201);
    const r2 = await fin.post("/payments", body).set("idempotency-key", k).expect(201);
    expect(r2.body).toEqual(r1.body);
    expect(r2.headers["idempotent-replayed"]).toBe("true");
    expect((await ownerQuery(tenantA, "select count(*)::int as n from payments where patient_id = $1", [pid]))[0].n).toBe(1);
    expect((await ownerQuery(tenantA, "select count(*)::int as n from cash_movements where source_id = $1", [r1.body.id]))[0].n).toBe(1);
    expect((await account(pid)).totals.paid).toBe("250.00");
  });

  it("aynı anahtarla farklı içerik reddedilir; anahtarsız finans isteği 428", async () => {
    const pid = await newPatient("Cansu");
    const k = key();
    await fin.post("/payments", { patientId: pid, amount: "100.00", method: "cash", cashAccountId: cashId }).set("idempotency-key", k).expect(201);
    const diff = await fin.post("/payments", { patientId: pid, amount: "999.00", method: "cash", cashAccountId: cashId }).set("idempotency-key", k);
    expect(diff.status).toBe(409);
    expect(diff.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const none = await fin.post("/payments", { patientId: pid, amount: "1.00", method: "cash", cashAccountId: cashId });
    expect(none.status).toBe(428);
    expect((await account(pid)).totals.paid).toBe("100.00");
  });

  it("aynı anahtarla 5 eşzamanlı istek → tek kayıt (çift tıklama / ağ tekrarı)", async () => {
    const pid = await newPatient("Deniz");
    const k = key();
    const body = { patientId: pid, amount: "75.50", method: "cash", cashAccountId: cashId };
    const rs = await Promise.all(Array.from({ length: 5 }, () => fin.post("/payments", body).set("idempotency-key", k)));
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect((await ownerQuery(tenantA, "select count(*)::int as n from payments where patient_id = $1", [pid]))[0].n).toBe(1);
  });
});

describe("AT-08 alacak yokken ödeme → avans", () => {
  it("300 avans ayrı görünür, eksi borç olmaz; kısmi dağıtım kullanılabilir tutarı aşamaz", async () => {
    const pid = await newPatient("Ece");
    const p = await pay(sec, pid, "300.00"); // sekreter vezne
    let a = await account(pid);
    expect(a.totals).toMatchObject({ openDebt: "0.00", advance: "300.00", receivable: "0.00" });
    expect(p.advance).toBe("300.00");

    const r1 = await receivable(pid, "200.00");
    a = await account(pid);
    expect(a.totals).toMatchObject({ openDebt: "200.00", advance: "300.00" }); // avans borçla otomatik karışmaz
    await sec.post(`/payments/${p.id}/allocations`, { allocations: [{ receivableId: r1, amount: "150.00" }] }).set("idempotency-key", key()).expect(201);
    a = await account(pid);
    expect(a.totals).toMatchObject({ openDebt: "50.00", advance: "150.00" });

    const over = await sec.post(`/payments/${p.id}/allocations`, { allocations: [{ receivableId: r1, amount: "60.00" }] }).set("idempotency-key", key());
    expect(over.status).toBe(409);
    expect(over.body.code).toBe("ALLOCATION_EXCEEDS_RECEIVABLE");
    const r2 = await receivable(pid, "500.00");
    const over2 = await sec.post(`/payments/${p.id}/allocations`, { allocations: [{ receivableId: r2, amount: "150.01" }] }).set("idempotency-key", key());
    expect(over2.status).toBe(409);
    expect(over2.body.code).toBe("ALLOCATION_EXCEEDS_PAYMENT");
    expect((await account(pid)).reconciled).toBe(true);
  });

  it("dağıtım ters kaydı avansı geri verir; ters kayıt tekrar ters çevrilemez", async () => {
    const pid = await newPatient("Fikret");
    const r = await receivable(pid, "100.00");
    const p = await pay(fin, pid, "100.00", [{ receivableId: r, amount: "100.00" }]);
    const rev = await fin.post(`/allocations/${p.allocationIds[0]}/reverse`, { reason: "Yanlış alacağa dağıtıldı" }).set("idempotency-key", key()).expect(201);
    expect((await account(pid)).totals).toMatchObject({ openDebt: "100.00", advance: "100.00" });
    const again = await fin.post(`/allocations/${p.allocationIds[0]}/reverse`, { reason: "tekrar" }).set("idempotency-key", key());
    expect(again.body.code).toBe("ALLOCATION_ALREADY_REVERSED");
    const revrev = await fin.post(`/allocations/${rev.body.id}/reverse`, { reason: "tekrar" }).set("idempotency-key", key());
    expect(revrev.body.code).toBe("ALLOCATION_IS_REVERSAL");
  });
});

describe("AT-09 eşzamanlı dağıtım", () => {
  it("iki kullanıcı aynı ödemeyi aynı anda farklı alacaklara dağıtır → toplam ödemeyi aşmaz (5 tur)", async () => {
    for (let round = 0; round < 5; round++) {
      const pid = await newPatient(["Gülay", "Nermin", "Şükran", "Tülin", "Zerrin"][round]!);
      const p = await pay(fin, pid, "500.00");
      const [r1, r2] = [await receivable(pid, "400.00"), await receivable(pid, "400.00")];
      const rs = await Promise.all([
        sec.post(`/payments/${p.id}/allocations`, { allocations: [{ receivableId: r1, amount: "400.00" }] }).set("idempotency-key", key()),
        fin.post(`/payments/${p.id}/allocations`, { allocations: [{ receivableId: r2, amount: "400.00" }] }).set("idempotency-key", key()),
      ]);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
      const s = await ownerQuery(tenantA, "select coalesce(sum(amount),0)::text as s from allocations where payment_id = $1", [p.id]);
      expect(s[0].s).toBe("400.00");
    }
  });

  it("aynı alacağa iki farklı ödemeden eşzamanlı dağıtım alacağı aşmaz", async () => {
    const pid = await newPatient("Hakan");
    const r = await receivable(pid, "300.00");
    const [p1, p2] = [await pay(fin, pid, "300.00"), await pay(fin, pid, "300.00")];
    const rs = await Promise.all([
      sec.post(`/payments/${p1.id}/allocations`, { allocations: [{ receivableId: r, amount: "300.00" }] }).set("idempotency-key", key()),
      fin.post(`/payments/${p2.id}/allocations`, { allocations: [{ receivableId: r, amount: "300.00" }] }).set("idempotency-key", key()),
    ]);
    expect(rs.map((x) => x.status).sort()).toEqual([201, 409]);
    expect((await account(pid)).totals).toMatchObject({ openDebt: "0.00", advance: "300.00" });
  });

  it("DB tetikleyicisi API'siz doğrudan aşan dağıtımı da reddeder", async () => {
    const pid = await newPatient("Irmak");
    const r = await receivable(pid, "1000.00");
    const p = await pay(fin, pid, "100.00");
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) =>
        c.query("insert into allocations(tenant_id, payment_id, receivable_id, amount, created_by) select $1,$2,$3,100.01,received_by from payments where id = $2", [tenantA, p.id, r])))
        .rejects.toThrow(/allocation_exceeds_payment/);
    } finally { await pool.end(); }
  });
});

describe("gerçekleşen işlem → alacak (VD-008)", () => {
  it("işlem tamamlanınca alacak oluşur; işlem iptalinde alacak iptal, tahsilat avansa döner; alacak doğrudan iptal edilemez", async () => {
    const pid = await newPatient("Jale");
    const appt = (await admin.post("/appointments", { patientId: pid, practitionerId: pracId, date: day(0), startTime: "06:00", durationMinutes: 30, allowOutsideHours: true, backdateReason: "Test: geriye dönük ziyaret kaydı" }).expect(201)).body;
    await sec.post(`/appointments/${appt.id}/status`, { version: appt.version, status: "checked_in" }).expect(200);
    const procs = (await dentist.get("/procedures").expect(200)).body.items;
    const tem = procs.find((p: { code: string }) => p.code === "TEM-01");
    const perf = (await dentist.post(`/patients/${pid}/performed`, { appointmentId: appt.id, procedureId: tem.id, location: { kind: "mouth" }, quantity: 1 }).expect(201)).body;
    expect(perf.receivableId).toBeTruthy();
    let a = await account(pid);
    expect(a.receivables[0]).toMatchObject({ source: "performed_procedure", amount: perf.amount, open: perf.amount });
    await pay(sec, pid, perf.amount, [{ receivableId: perf.receivableId, amount: perf.amount }]);
    expect((await account(pid)).totals.openDebt).toBe("0.00");

    const direct = await fin.post(`/receivables/${perf.receivableId}/cancel`, { reason: "deneme" });
    expect(direct.body.code).toBe("RECEIVABLE_FROM_PROCEDURE");
    await dentist.post(`/performed/${perf.id}/cancel`, { reason: "Yanlış hastaya girildi" }).expect(200);
    a = await account(pid);
    expect(a.receivables[0].status).toBe("cancelled");
    expect(a.totals).toMatchObject({ openDebt: "0.00", advance: perf.amount, receivable: "0.00", cancelledReceivable: perf.amount });
    expect(a.reconciled).toBe(true);
  });
});

describe("AT-02 / roller", () => {
  it("sekreter API ile iade, elle alacak, gelir raporu yapamaz; hekim/asistan hesap göremez", async () => {
    const pid = await newPatient("Kamil");
    const p = await pay(sec, pid, "50.00");
    expect((await sec.post(`/payments/${p.id}/refunds`, { amount: "10.00", method: "cash", cashAccountId: cashId, reason: "deneme" }).set("idempotency-key", key())).status).toBe(403);
    expect((await sec.post("/receivables", { patientId: pid, amount: "10.00", description: "x deneme" }).set("idempotency-key", key())).status).toBe(403);
    expect((await sec.get("/finance/summary")).status).toBe(403);
    expect((await sec.get(`/patients/${pid}/account`)).status).toBe(200);
    expect((await dentist.get(`/patients/${pid}/account`)).status).toBe(403);
    expect((await assistant.post("/payments", { patientId: pid, amount: "1.00", method: "cash", cashAccountId: cashId }).set("idempotency-key", key())).status).toBe(403);
    expect((await admin.get("/finance/summary")).status).toBe(200);
    expect((await admin.post("/payments", { patientId: pid, amount: "1.00", method: "cash", cashAccountId: cashId }).set("idempotency-key", key())).status).toBe(403);
    // Reddedilen iade hiçbir iz bırakmaz
    expect((await ownerQuery(tenantA, "select count(*)::int as n from refunds where payment_id = $1", [p.id]))[0].n).toBe(0);
  });
});

describe("tenant izolasyonu", () => {
  it("A finans kullanıcısı B'nin hasta hesabına, ödemesine, alacağına erişemez", async () => {
    const bPatient = (await ownerQuery(tenantB, "select patient_id from payments limit 1"))[0].patient_id;
    const bPayment = (await ownerQuery(tenantB, "select id from payments limit 1"))[0].id;
    const bRec = (await ownerQuery(tenantB, "select id from receivables limit 1"))[0].id;
    const bCash = (await ownerQuery(tenantB, "select id from cash_accounts limit 1"))[0].id;
    expect((await fin.get(`/patients/${bPatient}/account`)).status).toBe(404);
    expect((await fin.post("/payments", { patientId: bPatient, amount: "1.00", method: "cash", cashAccountId: cashId }).set("idempotency-key", key())).status).toBe(404);
    expect((await fin.post(`/payments/${bPayment}/refunds`, { amount: "1.00", method: "cash", cashAccountId: cashId, reason: "deneme" }).set("idempotency-key", key())).status).toBe(404);
    expect((await fin.post(`/payments/${bPayment}/allocations`, { allocations: [{ receivableId: bRec, amount: "1.00" }] }).set("idempotency-key", key())).status).toBe(404);
    expect((await fin.post(`/receivables/${bRec}/cancel`, { reason: "deneme" })).status).toBe(404);
    const aPid = await newPatient("Leyla");
    const aPay = await pay(fin, aPid, "10.00");
    const cross = await fin.post(`/payments/${aPay.id}/allocations`, { allocations: [{ receivableId: bRec, amount: "1.00" }] }).set("idempotency-key", key());
    expect(cross.status).toBe(422);
    const crossCash = await fin.post("/payments", { patientId: aPid, amount: "1.00", method: "cash", cashAccountId: bCash }).set("idempotency-key", key());
    expect(crossCash.status).toBe(422);
    const bal = (await fin.get("/finance/balances").expect(200)).body.items;
    expect(bal.some((x: { patientId: string }) => x.patientId === bPatient)).toBe(false);
  });
});

describe("AT-19 gün sınırı ve metrik ayrımı", () => {
  it("klinik gece yarısı: 23:59:30 dünün, 00:00:30 bugünün; aralık toplamı kayıp/çift sayım yok", async () => {
    const pid = await newPatient("Mert");
    const y = day(-1), t = day(0);
    const late = new Date(zonedToUtc(y, "23:59", TZ).getTime() + 30_000).toISOString();
    const early = new Date(zonedToUtc(t, "00:00", TZ).getTime() + 30_000).toISOString();
    const p1 = await pay(fin, pid, "11.11", [], { paidAt: late });
    const p2 = await pay(fin, pid, "22.22", [], { paidAt: early });
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    const sy = (await fin.get(`/finance/summary?from=${y}&to=${y}`).expect(200)).body;
    const st = (await fin.get(`/finance/summary?from=${t}&to=${t}`).expect(200)).body;
    const both = (await fin.get(`/finance/summary?from=${y}&to=${t}`).expect(200)).body;
    expect(ids(sy.rows.collections)).toContain(p1.id);
    expect(ids(sy.rows.collections)).not.toContain(p2.id);
    expect(ids(st.rows.collections)).toContain(p2.id);
    expect(ids(st.rows.collections)).not.toContain(p1.id);
    expect(ids(both.rows.collections)).toEqual(expect.arrayContaining([p1.id, p2.id]));
    // Alt kayıt toplamı = üst toplam; iki günün toplamı = aralık toplamı.
    const add = (xs: string[]) => (xs.reduce((s, v) => s + Math.round(Number(v) * 100), 0) / 100).toFixed(2);
    for (const s of [sy, st, both]) expect(add(s.rows.collections.map((r: { amount: string }) => r.amount))).toBe(s.metrics.collections);
    expect(add([sy.metrics.collections, st.metrics.collections])).toBe(both.metrics.collections);
    expect(both.days.find((d: { day: string }) => d.day === y)).toBeTruthy();
  });

  it("işlem tutarı ve tahsilat ayrı hesaplanır; net tahsilat = tahsilat − iade", async () => {
    const t = day(0);
    const s = (await fin.get(`/finance/summary?from=${t}&to=${t}`).expect(200)).body;
    const add = (xs: string[]) => (xs.reduce((a, v) => a + Math.round(Number(v) * 100), 0) / 100).toFixed(2);
    expect(add(s.rows.procedures.filter((r: { status: string }) => r.status === "completed").map((r: { amount: string }) => r.amount))).toBe(s.metrics.procedureAmount);
    expect(add([s.metrics.collections, `-${s.metrics.refunds}`])).toBe(s.metrics.netCollections);
    expect(Number(s.metrics.refunds)).toBeGreaterThan(0); // AT-07 iadesi bugün
    expect(s.metrics.procedureCancelledCount).toBeGreaterThan(0); // iptal edilen işlem ayrı satırda
  });

  it("tarih sınırları: gelecek tarihli ve 30 günden eski ödeme reddedilir; 92 günden uzun rapor aralığı reddedilir", async () => {
    const pid = await newPatient("Nil");
    const future = new Date(Date.now() + 3600_000).toISOString();
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    expect((await fin.post("/payments", { patientId: pid, amount: "1.00", method: "cash", cashAccountId: cashId, paidAt: future }).set("idempotency-key", key())).status).toBe(422);
    expect((await fin.post("/payments", { patientId: pid, amount: "1.00", method: "cash", cashAccountId: cashId, paidAt: old }).set("idempotency-key", key())).status).toBe(422);
    expect((await fin.get(`/finance/summary?from=${day(-100)}&to=${day(0)}`)).status).toBe(422);
  });
});

describe("kasa ve gider", () => {
  it("gider kasadan düşer, ters kaydı geri ekler; kapanış = açılış + giriş + çıkış; ikinci ters kayıt reddedilir", async () => {
    const t = day(0);
    const before = (await fin.get(`/finance/cash?from=${t}&to=${t}`).expect(200)).body.accounts.find((a: { id: string }) => a.id === bankId);
    const e = (await fin.post("/expenses", { category: "Malzeme", description: "Sentetik eldiven", amount: "120.00", cashAccountId: bankId }).set("idempotency-key", key()).expect(201)).body;
    await fin.post(`/expenses/${e.id}/reverse`, {}).set("idempotency-key", key()).expect(201);
    expect((await fin.post(`/expenses/${e.id}/reverse`, {}).set("idempotency-key", key())).body.code).toBe("EXPENSE_ALREADY_REVERSED");
    const after = (await fin.get(`/finance/cash?from=${t}&to=${t}`).expect(200)).body.accounts.find((a: { id: string }) => a.id === bankId);
    expect(after.closing).toBe(before.closing); // gider + ters kaydı net sıfır
    const add = (xs: string[]) => (xs.reduce((a, v) => a + Math.round(Number(v) * 100), 0) / 100).toFixed(2);
    expect(add([after.opening, after.inflow, after.outflow])).toBe(after.closing);
    expect((await sec.post("/expenses", { category: "Malzeme", description: "x deneme", amount: "1.00", cashAccountId: bankId }).set("idempotency-key", key())).status).toBe(403);
  });

  it("bakiyeler: açık borç ve avans ayrı listelenir, avans eksi borç olarak görünmez", async () => {
    const b = (await fin.get("/finance/balances").expect(200)).body;
    for (const i of b.items) { expect(Number(i.openDebt)).toBeGreaterThanOrEqual(0); expect(Number(i.advance)).toBeGreaterThanOrEqual(0); }
    const seeded = b.items.find((i: { openDebt: string; aging: { d31_60: string } }) => i.aging.d31_60 === "400.00");
    expect(seeded).toBeTruthy(); // seed: 40 gün önce vadeli 1.000 − 600
  });
});

describe("AT-10 prim oranı sonradan değişir", () => {
  it("yeni kural yalnız ileriye uygulanır; önceki tahakkuk ve ters kaydı eski oranla kalır; geriye dönük kural reddedilir", async () => {
    expect((await fin.post("/commission-rules", { rate: "20", validFrom: day(-1) })).status).toBe(422);
    const pid = await newPatient("Oya");
    const r = await receivable(pid, "1000.00");
    const p1 = await pay(fin, pid, "600.00", [{ receivableId: r, amount: "600.00" }]); // %10 kuralı (seed)
    await fin.post("/commission-rules", { rate: "20", validFrom: day(0), practitionerId: pracId, note: "Test: hekime özel %20" }).expect(201);
    const p2 = await pay(fin, pid, "200.00", [{ receivableId: r, amount: "200.00" }]); // yeni kural
    await fin.post(`/allocations/${p1.allocationIds[0]}/reverse`, { reason: "Kural sonrası düzeltme" }).set("idempotency-key", key()).expect(201);
    const rows = await ownerQuery(tenantA,
      `select a.payment_id, ac.base_amount::text as base, ac.rate::text, ac.amount::text from commission_accruals ac join allocations a on a.id = ac.allocation_id
        where a.payment_id = any($1::uuid[]) order by ac.created_at`, [[p1.id, p2.id]]);
    expect(rows.map((x) => [x.payment_id === p1.id ? "p1" : "p2", x.base, x.rate, x.amount])).toEqual([
      ["p1", "600.00", "10.00", "60.00"],
      ["p2", "200.00", "20.00", "40.00"],
      ["p1", "-600.00", "10.00", "-60.00"], // ters kayıt orijinal oranla, yeni %20 ile değil
    ]);
    const report = (await fin.get(`/commissions?from=${day(0)}&to=${day(0)}`).expect(200)).body;
    const g = report.groups.find((x: { practitionerId: string }) => x.practitionerId === pracId);
    const add = (xs: string[]) => (xs.reduce((a, v) => a + Math.round(Number(v) * 100), 0) / 100).toFixed(2);
    expect(add([g.accrued, g.reversed])).toBe(g.net);
    expect((await sec.post("/commission-rules", { rate: "5", validFrom: day(1) })).status).toBe(403);
  });
});
