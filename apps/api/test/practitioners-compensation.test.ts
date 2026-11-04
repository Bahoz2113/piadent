/**
 * Hekimler modülü (madde 8, ADR-096): ücret modeli sürümleri, maaş hakedişi ve maaş ödemesi.
 *  - Liste tüm randevu okuyucularına açık; ücret/bakiye alanları yalnız finance.read ile döner (sekreterde pay = null).
 *  - Model sürümü yalnız ileriye başlar (dün → 422), aynı gün ikinci sürüm 409; sekreter/hekim yazamaz (403); denetlenir.
 *  - "Sabit maaş" modelinde prim kuralı tahakkuk doğurmaz; "maaş + prim"de doğar.
 *  - Maaş ödemesi kasadan çıkar, idempotent'tir, ayın hakedişini aşamaz (API + DB, eşzamanlı), gelecek ay ödenemez,
 *    ters kaydı bakiyeyi geri verir ve ikinci kez ters çevrilemez. Nakit raporlarında "Maaş ödemesi" olarak görünür.
 *  - Kiracı yalıtımı: B kiracısı A'nın hekim ücretini göremez/yazamaz.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, sec: Client, dentist: Client, fin: Client, bAdmin: Client;
let tenantA: string, prac: string, cashId: string;
const TZ = "Europe/Istanbul";
const key = () => `t-${randomUUID()}`;
const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};
const month = () => day(0).slice(0, 7);
const nextMonth = () => { const [y, m] = month().split("-").map(Number); const k = y! * 12 + m!; return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`; };

let slot = 0;
async function visitAndPerform(pid: string, practitionerId: string) {
  const mm = 300 + (slot++ % 40) * 15;
  const time = `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
  const a = (await admin.post("/appointments", { patientId: pid, practitionerId, date: day(0), startTime: time, durationMinutes: 15, allowOutsideHours: true, backdateReason: "Test: geriye dönük ziyaret kaydı" }).expect(201)).body;
  await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "checked_in" }).expect(200);
  const proc = (await dentist.get("/procedures").expect(200)).body.items.find((p: { code: string }) => p.code === "TEM-01");
  return (await dentist.post(`/patients/${pid}/performed`, { appointmentId: a.id, procedureId: proc.id, location: { kind: "mouth" }, quantity: 1 }).expect(201)).body;
}

beforeAll(async () => {
  app = await startApp();
  [admin, sec, dentist, fin, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aSecretary), login(app, EMAILS.aDentist), login(app, EMAILS.aFinance), login(app, EMAILS.bAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  prac = (await admin.post("/practitioners", { displayName: `Zz Dt. Maaş ${randomUUID().slice(0, 4)}` }).expect(201)).body.id;
  cashId = (await fin.get("/cash-accounts").expect(200)).body.items.find((a: { kind: string; active: boolean }) => a.kind === "cash" && a.active).id;
});
afterAll(async () => { await app.close(); });

describe("Hekimler listesi", () => {
  it("sekreter listeyi görür ama ücret alanları null; finans ücret alanlarını görür", async () => {
    const s = (await sec.get("/practitioners/overview").expect(200)).body;
    const row = s.items.find((x: { id: string }) => x.id === prac);
    expect(row).toMatchObject({ active: true, pay: null, month: { appointments: 0, completed: 0, noShow: 0 } });
    const f = (await fin.get("/practitioners/overview").expect(200)).body.items.find((x: { id: string }) => x.id === prac);
    expect(f.pay).toMatchObject({ model: null, monthlySalary: null, commissionPayable: "0.00", salaryDue: "0.00", salaryPaid: "0.00" });
    expect((await sec.get(`/practitioners/${prac}/compensation`)).status).toBe(403);
  });
});

describe("ücret modeli sürümleri", () => {
  it("geriye dönük 422, maaşsız maaş modeli 422, sekreter/hekim 403; geçerli sürüm 201 + denetim; aynı gün 409", async () => {
    expect((await fin.post(`/practitioners/${prac}/compensation`, { payModel: "salary", monthlySalary: "30000.00", validFrom: day(-1) })).status).toBe(422);
    const r0 = await fin.post(`/practitioners/${prac}/compensation`, { payModel: "salary", validFrom: day(0) });
    expect(r0.status).toBe(422);
    expect(r0.body.field_errors.monthlySalary).toBeTruthy();
    expect((await fin.post(`/practitioners/${prac}/compensation`, { payModel: "commission", monthlySalary: "100.00", validFrom: day(0) })).status).toBe(422);
    expect((await sec.post(`/practitioners/${prac}/compensation`, { payModel: "salary", monthlySalary: "30000.00", validFrom: day(0) })).status).toBe(403);
    expect((await dentist.post(`/practitioners/${prac}/compensation`, { payModel: "salary", monthlySalary: "30000.00", validFrom: day(0) })).status).toBe(403);
    const r = (await fin.post(`/practitioners/${prac}/compensation`, { payModel: "salary", monthlySalary: "30000.00", validFrom: day(0), note: "Sentetik maaş" }).expect(201)).body;
    const ev = await ownerQuery(tenantA, "select changes from audit_events where action = 'compensation.create' and entity_id = $1", [r.id]);
    expect(ev[0].changes.pay_model.to).toBe("salary");
    expect(ev[0].changes.monthly_salary.to).toBe("30000.00");
    expect((await fin.post(`/practitioners/${prac}/compensation`, { payModel: "commission", validFrom: day(0) })).body.code).toBe("COMPENSATION_EXISTS");
    const c = (await fin.get(`/practitioners/${prac}/compensation`).expect(200)).body;
    expect(c.current).toMatchObject({ payModel: "salary", monthlySalary: "30000.00", validFrom: day(0) });
    expect(c.months).toHaveLength(12);
    expect(c.months[11]).toMatchObject({ month: month(), salaryDue: "30000.00", salaryPaid: "0.00", salaryRemaining: "30000.00" });
    expect(c.totals.salaryOutstanding).toBe("30000.00");
  });

  it("sabit maaş modelinde tedavi primi tahakkuk etmez; ileri tarihli 'maaş + prim' sürümü planlı görünür", async () => {
    await fin.post("/commission-rules", { practitionerId: prac, basis: "treatment", rate: "20", validFrom: day(0), note: "Sentetik" }).expect(201);
    const pid = (await sec.post("/patients", { firstName: "Maaş", lastName: `Hekim ${randomUUID().slice(0, 4)}`, birthDate: "1979-03-03" }).expect(201)).body.patient.id;
    await visitAndPerform(pid, prac);
    expect(await ownerQuery(tenantA, "select 1 from commission_accruals where practitioner_id = $1", [prac])).toHaveLength(0);
    await fin.post(`/practitioners/${prac}/compensation`, { payModel: "salary_commission", monthlySalary: "20000.00", validFrom: day(40) }).expect(201);
    const c = (await fin.get(`/practitioners/${prac}/compensation`).expect(200)).body;
    expect(c.versions.map((v: { state: string }) => v.state)).toEqual(["scheduled", "current"]);
    expect(c.current.payModel).toBe("salary");
  });
});

describe("maaş ödemesi", () => {
  it("hakedişi aşamaz, kasadan çıkar, idempotent, gelecek ay 422, sekreter 403; ters kayıt bakiyeyi geri verir; eşzamanlı aşım yok", async () => {
    const body = { practitionerId: prac, period: month(), cashAccountId: cashId };
    expect((await fin.post("/salary-payments", { ...body, amount: "30000.01" }).set("idempotency-key", key())).body.code).toBe("SALARY_EXCEEDS_DUE");
    expect((await fin.post("/salary-payments", { ...body, period: nextMonth(), amount: "1.00" }).set("idempotency-key", key())).status).toBe(422);
    expect((await sec.post("/salary-payments", { ...body, amount: "1.00" }).set("idempotency-key", key())).status).toBe(403);
    expect((await fin.post("/salary-payments", { ...body, amount: "1.00" })).status).toBe(428); // idempotency anahtarı zorunlu
    const k = key();
    const p = (await fin.post("/salary-payments", { ...body, amount: "20000.00", note: "Ekim avans" }).set("idempotency-key", k).expect(201)).body;
    const again = await fin.post("/salary-payments", { ...body, amount: "20000.00", note: "Ekim avans" }).set("idempotency-key", k).expect(201);
    expect(again.body.id).toBe(p.id);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect((await ownerQuery(tenantA, "select amount::text from cash_movements where source = 'salary_payment' and source_id = $1", [p.id]))[0].amount).toBe("-20000.00");
    let c = (await fin.get(`/practitioners/${prac}/compensation`).expect(200)).body;
    expect(c.months[11]).toMatchObject({ salaryPaid: "20000.00", salaryRemaining: "10000.00" });
    // eşzamanlı 2 × 6.000: kalan 10.000'i biri geçer, diğeri aşacağı için reddedilir
    const res = await Promise.all([1, 2].map(() => fin.post("/salary-payments", { ...body, amount: "6000.00" }).set("idempotency-key", key())));
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    await fin.post(`/salary-payments/${p.id}/reverse`, { reason: "Yanlış kasa" }).expect(201);
    expect((await fin.post(`/salary-payments/${p.id}/reverse`, { reason: "tekrar" })).body.code).toBe("ALREADY_REVERSED");
    c = (await fin.get(`/practitioners/${prac}/compensation`).expect(200)).body;
    expect(c.months[11]).toMatchObject({ salaryPaid: "6000.00", salaryRemaining: "24000.00" });
    expect(c.totals.salaryOutstanding).toBe("24000.00");
    expect(c.salaryPayments.find((x: { id: string }) => x.id === p.id).reversed).toBe(true);
    const ov = (await fin.get("/practitioners/overview").expect(200)).body.items.find((x: { id: string }) => x.id === prac);
    expect(ov.pay).toMatchObject({ model: "salary", monthlySalary: "30000.00", salaryDue: "30000.00", salaryPaid: "6000.00" });
    // nakit raporu kaynağı
    const rep = (await fin.get(`/reports/nakit-hareketleri?from=${day(0)}&to=${day(0)}&source=salary_payment`).expect(200)).body;
    expect(rep.rows.length).toBeGreaterThanOrEqual(3);
    expect(rep.rows.every((r: { sourceLabel: string }) => r.sourceLabel === "Maaş ödemesi")).toBe(true);
  });

  it("B kiracısı A'nın hekim ücretini göremez ve yazamaz", async () => {
    expect((await bAdmin.get(`/practitioners/${prac}/compensation`)).status).toBe(404);
    expect((await bAdmin.post(`/practitioners/${prac}/compensation`, { payModel: "commission", validFrom: day(1) })).status).toBe(404);
    const b = (await bAdmin.get("/practitioners/overview").expect(200)).body;
    expect(b.items.some((x: { id: string }) => x.id === prac)).toBe(false);
  });
});
