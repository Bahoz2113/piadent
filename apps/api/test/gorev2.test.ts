/**
 * Görev 2: işlem kataloğu (T01), sürümlü tarife (T02/T03), tanı ve odontogram (H04/H05),
 * plan → teklif → kabul (AT-05), ziyarete bağlı gerçekleşen işlem (VD-008), plan takibi (VİA Akış).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import pg from "pg";
import { withContext } from "@viadent/db";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";
import { APP_URL, WORKER_URL } from "./env.js";
import { processOutbox } from "../../worker/src/jobs.js";

let app: INestApplication;
let admin: Client, dentist: Client, sec: Client, assistant: Client;
let tenantA: string;
let procs: Record<string, { id: string; toothScope: string }>;
let pracId: string;
let patientId: string;

const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};
async function runWorker() {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
  try { await processOutbox(pool); } finally { await pool.end(); }
}
async function visit(patient: string, offset: number, time: string, checkIn = true) {
  const a = (await sec.post("/appointments", { patientId: patient, practitionerId: pracId, date: day(offset), startTime: time, durationMinutes: 30, allowOutsideHours: true }).expect(201)).body;
  if (checkIn) await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "checked_in" }).expect(200);
  return a.id as string;
}
async function newPlan(title = "Test planı") {
  const r = (await dentist.post(`/patients/${patientId}/plans`, { title, practitionerId: pracId }).expect(201)).body;
  return r as { planId: string; versionId: string };
}
async function planVersion(versionId: string) {
  const plans = (await dentist.get(`/patients/${patientId}/plans`).expect(200)).body.items;
  for (const p of plans) for (const v of p.versions) if (v.id === versionId) return v;
  throw new Error("version not found");
}

beforeAll(async () => {
  app = await startApp();
  [admin, dentist, sec, assistant] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aAssistant)]);
  tenantA = sec.session.activeMembership.tenantId;
  const list = (await dentist.get("/procedures").expect(200)).body.items;
  procs = Object.fromEntries(list.map((p: { code: string; id: string; toothScope: string }) => [p.code, p]));
  pracId = (await sec.get("/resources").expect(200)).body.practitioners[0].id;
  patientId = (await sec.post("/patients", { firstName: "Tedavi", lastName: "Sentetik", birthDate: "1990-01-01" }).expect(201)).body.patient.id;
});
afterAll(async () => app.close());

describe("T01/T02/T03 katalog ve sürümlü tarife", () => {
  it("katalog yönetimi yöneticide; kod tekil ve değiştirilemez", async () => {
    expect((await sec.post("/procedures", { code: "TST-01", name: "Test işlemi", toothScope: "tooth" })).status).toBe(403);
    expect((await dentist.post("/procedures", { code: "TST-01", name: "Test işlemi", toothScope: "tooth" })).status).toBe(403);
    const p = await admin.post("/procedures", { code: "tst-01", name: "Test işlemi", toothScope: "tooth" }).expect(201);
    expect((await admin.post("/procedures", { code: "TST-01", name: "Başka", toothScope: "tooth" })).status).toBe(409);
    const chg = await admin.patch(`/procedures/${p.body.id}`, { code: "TST-02", name: "Test işlemi", toothScope: "tooth" });
    expect(chg.body.code).toBe("IMMUTABLE_FIELD");
    await admin.patch(`/procedures/${p.body.id}`, { code: "TST-01", name: "Test işlemi (yeni ad)", toothScope: "tooth" }).expect(200);
  });

  it("yayınlanmış tarife değişmez (API + DB); kopyadan yeni sürüm açılır; boş tarife yayınlanamaz", async () => {
    const tariffs = (await admin.get("/tariffs").expect(200)).body.items;
    const pub = tariffs.find((t: { status: string }) => t.status === "published");
    const r = await admin.patch(`/tariffs/${pub.id}`, {});
    expect(r.status).toBe(404); // yayınlanmış tarifeyi düzenleyen uç yok
    const set = await request(admin, "PUT", `/tariffs/${pub.id}/items`, { items: [] });
    expect(set.body.code).toBe("TARIFF_FROZEN");
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("update tariff_items set price = 1 where tariff_version_id = $1", [pub.id]))).rejects.toThrow(/tariff_version_not_draft/);
    } finally { await pool.end(); }
    const empty = await admin.post("/tariffs", { name: "Boş", validFrom: day(0) }).expect(201);
    expect((await admin.post(`/tariffs/${empty.body.id}/publish`)).body.code).toBe("TARIFF_EMPTY");
  });

  it("hekime özel tarife klinik tarifesinden önceliklidir; geleceğe tarihli tarife bugünü etkilemez", async () => {
    const kan = procs["KAN-01"]!.id;
    expect((await dentist.get(`/price?procedureId=${kan}&practitionerId=${pracId}`).expect(200)).body.price).toBe("3500.00");
    const special = await admin.post("/tariffs", { name: "Elif Hn. özel", validFrom: day(-1), practitionerId: pracId }).expect(201);
    await request(admin, "PUT", `/tariffs/${special.body.id}/items`, { items: [{ procedureId: kan, price: "3900.00" }] }).then((r) => expect(r.status).toBe(200));
    await admin.post(`/tariffs/${special.body.id}/publish`).expect(200);
    const future = await admin.post("/tariffs", { name: "Gelecek yıl", validFrom: day(400), copyFromId: special.body.id }).expect(201);
    await admin.post(`/tariffs/${future.body.id}/publish`).expect(200);
    expect((await dentist.get(`/price?procedureId=${kan}&practitionerId=${pracId}`).expect(200)).body.price).toBe("3900.00");
    // Başka hekim klinik tarifesini görür.
    const other = (await sec.get("/resources").expect(200)).body.practitioners[1].id;
    expect((await dentist.get(`/price?procedureId=${kan}&practitionerId=${other}`).expect(200)).body.price).toBe("3500.00");
    // Hekime özel tarifede olmayan işlem klinik tarifesine düşer.
    expect((await dentist.get(`/price?procedureId=${procs["CEK-01"]!.id}&practitionerId=${pracId}`).expect(200)).body.price).toBe("1500.00");
    await admin.post(`/tariffs/${special.body.id}/retire`).expect(200);
    await admin.post(`/tariffs/${future.body.id}/retire`).expect(200);
    expect((await dentist.get(`/price?procedureId=${kan}&practitionerId=${pracId}`).expect(200)).body.price).toBe("3500.00");
  });
});

async function request(c: Client, method: "PUT", path: string, body: object) {
  const st = await import("supertest");
  return st.default(app.getHttpServer())[method.toLowerCase() as "put"](`/api/v1${path}`).set("cookie", c.cookie)
    .set("x-viadent-request", "1").set("x-viadent-context", c.context).send(body);
}

describe("Plan kalemi doğrulaması (diş/yüzey modeli, fiyat, indirim)", () => {
  it("konum işlem kapsamına ve FDI/yüzey kurallarına uymalı", async () => {
    const { versionId } = await newPlan("Doğrulama");
    const add = (b: object) => dentist.post(`/plan-versions/${versionId}/items`, b);
    expect((await add({ procedureId: procs["DOL-01"]!.id, location: { kind: "tooth", tooth: "26" } })).body.field_errors.location).toMatch(/yüzey/);
    expect((await add({ procedureId: procs["DOL-01"]!.id, location: { kind: "tooth", tooth: "11", surfaces: ["O"] } })).body.field_errors.location).toMatch(/geçersiz yüzey/);
    expect((await add({ procedureId: procs["KAN-01"]!.id, location: { kind: "tooth", tooth: "19" } })).body.field_errors["location.tooth"]).toBeTruthy(); // FDI'de 19 yok
    expect((await add({ procedureId: procs["KAN-01"]!.id, location: { kind: "tooth", tooth: "56" } })).body.field_errors.location).toMatch(/FDI/); // süt dişinde 6 yok
    expect((await add({ procedureId: procs["TEM-01"]!.id, location: { kind: "tooth", tooth: "11" } })).status).toBe(422);
    expect((await add({ procedureId: procs["FLU-01"]!.id, location: { kind: "arch", arch: "upper" } })).status).toBe(201);
    expect((await add({ procedureId: procs["DOL-01"]!.id, location: { kind: "tooth", tooth: "11", surfaces: ["I", "M"] } })).status).toBe(201);
    expect((await add({ procedureId: procs["DOL-02"]!.id, location: { kind: "tooth", tooth: "55", surfaces: ["O", "D"] } })).status).toBe(201); // süt dişi
  });

  it("indirim gerekçe ister ve kalem tutarını aşamaz; tarifede yoksa elle fiyat + açıklama gerekir", async () => {
    const { versionId } = await newPlan("Fiyat");
    const add = (b: object) => dentist.post(`/plan-versions/${versionId}/items`, b);
    const base = { procedureId: procs["KRN-01"]!.id, location: { kind: "tooth", tooth: "16" }, quantity: 2 };
    expect((await add({ ...base, discount: "500.00" })).body.field_errors.discountReason).toBeTruthy();
    expect((await add({ ...base, discount: "15000.01", discountReason: "x" })).body.field_errors.discount).toMatch(/aşamaz/);
    expect((await add({ ...base, discount: "12.345", discountReason: "x" })).status).toBe(422);
    const ok = await add({ ...base, discount: "500.00", discountReason: "Kampanya (sentetik)" }).expect(201);
    expect(ok.body.lineTotal).toBe("14500.00");
    const noPrice = await admin.post("/procedures", { code: "NOP-01", name: "Tarifesiz işlem", toothScope: "mouth" }).expect(201);
    const r = await add({ procedureId: noPrice.body.id, location: { kind: "mouth" } });
    expect(r.body.code).toBe("NO_TARIFF_PRICE");
    expect((await add({ procedureId: noPrice.body.id, location: { kind: "mouth" }, manualPrice: "999.90" })).body.field_errors.priceNote).toBeTruthy();
    await add({ procedureId: noPrice.body.id, location: { kind: "mouth" }, manualPrice: "999.90", priceNote: "Hekim belirledi (sentetik)" }).expect(201);
    const v = await planVersion(versionId);
    expect(v.total).toBe("15499.90"); // 2×7500 − 500 + 999.90 (kesin ondalık)
    expect(v.discountTotal).toBe("500.00");
  });

  it("sekreter plan kalemi ekleyemez ama planı okuyabilir; klinik haritayı okuyamaz", async () => {
    const { versionId } = await newPlan("Yetki");
    expect((await sec.post(`/plan-versions/${versionId}/items`, { procedureId: procs["KAN-01"]!.id, location: { kind: "tooth", tooth: "16" } })).status).toBe(403);
    expect((await sec.get(`/patients/${patientId}/plans`)).status).toBe(200);
    expect((await sec.get(`/patients/${patientId}/chart`)).status).toBe(403);
    expect((await admin.get(`/patients/${patientId}/chart`)).status).toBe(403);
  });
});

describe("AT-05 plan sürümü, teklif ve kabul", () => {
  let planId: string, v1: string;
  it("teklif sunulan sürüm kilitlenir; kararsız yanıt durumu değiştirmez; kabul edilir", async () => {
    ({ planId, versionId: v1 } = await newPlan("AT-05 planı"));
    await dentist.post(`/plan-versions/${v1}/items`, { procedureId: procs["KAN-01"]!.id, location: { kind: "tooth", tooth: "36" } }).expect(201);
    await dentist.post(`/plan-versions/${v1}/items`, { procedureId: procs["KRN-01"]!.id, location: { kind: "tooth", tooth: "36" }, sessionNo: 2 }).expect(201);
    expect((await sec.post(`/plan-versions/${v1}/propose`)).status).toBe(403);
    await dentist.post(`/plan-versions/${v1}/propose`).expect(200);
    const locked = await dentist.post(`/plan-versions/${v1}/items`, { procedureId: procs["CEK-01"]!.id, location: { kind: "tooth", tooth: "38" } });
    expect(locked.body.code).toBe("PLAN_VERSION_LOCKED");
    await sec.post(`/plan-versions/${v1}/decision`, { decision: "undecided", note: "Düşünecek" }).expect(200);
    expect((await planVersion(v1)).status).toBe("proposed");
    await sec.post(`/plan-versions/${v1}/decision`, { decision: "accepted" }).expect(200);
    const v = await planVersion(v1);
    expect(v.status).toBe("accepted");
    expect(v.decisions.map((d: { decision: string }) => d.decision)).toEqual(["undecided", "accepted"]);
    expect(v.total).toBe("11000.00");
    expect((await sec.post(`/plan-versions/${v1}/decision`, { decision: "rejected" })).body.code).toBe("PLAN_NOT_PROPOSED");
  });

  it("kabul edilmiş fiyat düzenlenemez (API ve DB); tarife değişse de snapshot korunur", async () => {
    const v = await planVersion(v1);
    const item = v.items[0];
    const edit = await dentist.patch(`/plan-items/${item.id}`, { procedureId: item.procedureId, location: item.location, manualPrice: "1.00", priceNote: "x" });
    expect(edit.body.code).toBe("PLAN_VERSION_LOCKED");
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("update plan_items set unit_price = 1 where id = $1", [item.id]))).rejects.toThrow(/plan_version_not_draft/);
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("delete from plan_items where id = $1", [item.id]))).rejects.toThrow(/plan_version_not_draft/);
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("update plan_versions set status = 'draft' where id = $1", [v1]))).rejects.toThrow(/plan_invalid_transition/);
    } finally { await pool.end(); }
    // Klinik tarifesinde kanal fiyatı artar.
    const tariffs = (await admin.get("/tariffs").expect(200)).body.items;
    const base = tariffs.find((t: { status: string; practitionerId: string | null }) => t.status === "published" && !t.practitionerId);
    const nt = await admin.post("/tariffs", { name: "Zamlı tarife", validFrom: day(0), copyFromId: base.id }).expect(201);
    const items = (await admin.get(`/tariffs/${nt.body.id}`).expect(200)).body.items.filter((x: { price: string | null }) => x.price)
      .map((x: { procedureId: string; price: string; code: string }) => ({ procedureId: x.procedureId, price: x.code === "KAN-01" ? "4200.00" : x.price }));
    await request(admin, "PUT", `/tariffs/${nt.body.id}/items`, { items });
    await admin.post(`/tariffs/${nt.body.id}/publish`).expect(200);
    const after = await planVersion(v1);
    expect(after.items[0].unitPrice).toBe("3500.00");
    expect(after.total).toBe("11000.00");
  });

  it("değişiklik yeni sürümle yapılır; eski kabul geçerli kalır, yeni kabulde 'yeni sürümle değişti' olur", async () => {
    const nv = (await dentist.post(`/plans/${planId}/versions`).expect(201)).body.versionId;
    expect((await dentist.post(`/plans/${planId}/versions`)).body.code).toBe("DRAFT_EXISTS");
    let v2 = await planVersion(nv);
    expect(v2.version).toBe(2);
    expect(v2.items[0].unitPrice).toBe("3500.00"); // snapshot taşındı
    const rp = (await dentist.post(`/plan-versions/${nv}/reprice`).expect(200)).body;
    expect(rp.changed).toBeGreaterThanOrEqual(1);
    v2 = await planVersion(nv);
    expect(v2.items.find((i: { code: string }) => i.code === "KAN-01").unitPrice).toBe("4200.00");
    await dentist.post(`/plan-versions/${nv}/propose`).expect(200);
    expect((await planVersion(v1)).status).toBe("accepted"); // yeni teklif, eski kabulü bozmaz
    // Eşzamanlı iki kabul: yalnız biri işlenir.
    const [a, b] = await Promise.all([
      sec.post(`/plan-versions/${nv}/decision`, { decision: "accepted" }),
      dentist.post(`/plan-versions/${nv}/decision`, { decision: "accepted" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const old = await planVersion(v1);
    expect(old.status).toBe("superseded");
    expect(old.total).toBe("11000.00");
    expect((await planVersion(nv)).total).toBe("11700.00");
    const accepted = await ownerQuery(tenantA, "select count(*)::int as n from plan_versions where plan_id = $1 and status = 'accepted'", [planId]);
    expect(accepted[0].n).toBe(1);
  });
});

describe("VD-008 gerçekleşen işlem (ziyarete bağlı)", () => {
  let itemId: string;
  let visitId: string;
  beforeAll(async () => {
    const { versionId } = await newPlan("Gerçekleşme");
    await dentist.post(`/plan-versions/${versionId}/items`, {
      procedureId: procs["DOL-01"]!.id, location: { kind: "tooth", tooth: "46", surfaces: ["O"] }, quantity: 3, manualPrice: "1000.00", priceNote: "Test", discount: "0.01", discountReason: "Kuruş testi",
    }).expect(201);
    await dentist.post(`/plan-versions/${versionId}/propose`).expect(200);
    await sec.post(`/plan-versions/${versionId}/decision`, { decision: "accepted" }).expect(200);
    itemId = (await planVersion(versionId)).items[0].id;
    visitId = await visit(patientId, 30, "10:00");
  });

  it("geliş kaydı olmayan ziyarete işlem bağlanamaz; asistan ve sekreter işlem kaydedemez", async () => {
    const planned = await visit(patientId, 31, "10:00", false);
    const r = await dentist.post(`/patients/${patientId}/performed`, { appointmentId: planned, planItemId: itemId });
    expect(r.body.code).toBe("VISIT_REQUIRED");
    expect((await assistant.post(`/patients/${patientId}/performed`, { appointmentId: visitId, planItemId: itemId })).status).toBe(403);
    expect((await sec.post(`/patients/${patientId}/performed`, { appointmentId: visitId, planItemId: itemId })).status).toBe(403);
  });

  it("kısmi gerçekleşme: kuruş farkı son adette kapanır, toplam kalem tutarına eşit; kalanı aşılamaz", async () => {
    const p1 = (await dentist.post(`/patients/${patientId}/performed`, { appointmentId: visitId, planItemId: itemId }).expect(201)).body;
    const p2 = (await dentist.post(`/patients/${patientId}/performed`, { appointmentId: visitId, planItemId: itemId }).expect(201)).body;
    expect((await dentist.post(`/patients/${patientId}/performed`, { appointmentId: visitId, planItemId: itemId, quantity: 2 })).body.code).toBe("EXCEEDS_PLAN");
    const p3 = (await dentist.post(`/patients/${patientId}/performed`, { appointmentId: visitId, planItemId: itemId }).expect(201)).body;
    expect([p1.amount, p2.amount, p3.amount]).toEqual(["1000.00", "1000.00", "999.99"]);
    const sum = await ownerQuery(tenantA, "select sum(amount)::text as s from performed_procedures where plan_item_id = $1 and status = 'completed'", [itemId]);
    expect(sum[0].s).toBe("2999.99");
    expect((await dentist.post(`/patients/${patientId}/performed`, { appointmentId: visitId, planItemId: itemId })).body.code).toBe("EXCEEDS_PLAN");
  });

  it("iptal gerekçe ister ve kalanı serbest bırakır; düzeltme eski kaydı silmez, bağlar", async () => {
    const chart = (await dentist.get(`/patients/${patientId}/chart`).expect(200)).body;
    const last = chart.performed.find((p: { planItemId: string; status: string }) => p.planItemId === itemId && p.status === "completed");
    expect((await dentist.post(`/performed/${last.id}/cancel`, {})).status).toBe(422);
    await dentist.post(`/performed/${last.id}/cancel`, { reason: "Yanlış hastaya girildi (test)" }).expect(200);
    const again = (await dentist.post(`/patients/${patientId}/performed`, { appointmentId: visitId, planItemId: itemId }).expect(201)).body;
    const fixed = (await dentist.post(`/performed/${again.id}/correct`, { reason: "Not eksikti", note: "Düzeltilmiş kayıt" }).expect(200)).body;
    const rows = await ownerQuery(tenantA, "select id, status, corrects_id from performed_procedures where id = any($1::uuid[])", [[again.id, fixed.id]]);
    expect(rows.find((r) => r.id === again.id).status).toBe("corrected");
    expect(rows.find((r) => r.id === fixed.id).corrects_id).toBe(again.id);
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("update performed_procedures set amount = 0 where id = $1", [fixed.id]))).rejects.toThrow(/immutable/);
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("delete from performed_procedures where id = $1", [fixed.id]))).rejects.toThrow(/permission denied/);
    } finally { await pool.end(); }
  });

  it("plansız işlem tarifeden fiyatlanır; kabul edilmemiş plan kalemi gerçekleştirilemez", async () => {
    const r = (await dentist.post(`/patients/${patientId}/performed`, { appointmentId: visitId, procedureId: procs["RAD-01"]!.id, location: { kind: "tooth", tooth: "46" }, quantity: 2 }).expect(201)).body;
    expect(r).toMatchObject({ amount: "500.00", priceBasis: "tariff" });
    const { versionId } = await newPlan("Kabulsüz");
    const it = (await dentist.post(`/plan-versions/${versionId}/items`, { procedureId: procs["CEK-01"]!.id, location: { kind: "tooth", tooth: "48" } }).expect(201)).body;
    expect((await dentist.post(`/patients/${patientId}/performed`, { appointmentId: visitId, planItemId: it.id })).body.code).toBe("PLAN_NOT_ACCEPTED");
  });
});

describe("H04/H05 tanı ve odontogram bulgusu", () => {
  it("hekim bulgu ve tanı ekler; hatalı kayıt gerekçeyle işaretlenir; audit metin taşımaz", async () => {
    expect((await dentist.post(`/patients/${patientId}/findings`, { tooth: "21", surfaces: ["O"], findingType: "filling" })).status).toBe(422);
    const f = await dentist.post(`/patients/${patientId}/findings`, { tooth: "21", surfaces: ["I"], findingType: "filling" }).expect(201);
    const d = await dentist.post(`/patients/${patientId}/diagnoses`, { location: { kind: "tooth", tooth: "21", surfaces: ["M"] }, description: "Sentetik tanı metni GİZLİ-123" }).expect(201);
    expect((await assistant.post(`/patients/${patientId}/diagnoses`, { location: { kind: "mouth" }, description: "x x" })).status).toBe(403);
    expect((await dentist.post(`/diagnoses/${d.body.id}/status`, { status: "entered_in_error" })).status).toBe(422);
    await dentist.post(`/diagnoses/${d.body.id}/status`, { status: "entered_in_error", reason: "Yanlış diş" }).expect(200);
    await dentist.post(`/findings/${f.body.id}/status`, { status: "historic", reason: "Dolgu yenilendi" }).expect(200);
    const chart = (await dentist.get(`/patients/${patientId}/chart`).expect(200)).body;
    expect(chart.diagnoses.some((x: { id: string }) => x.id === d.body.id)).toBe(false); // hatalı kayıt haritada görünmez
    expect(chart.findings.find((x: { id: string }) => x.id === f.body.id).status).toBe("historic");
    const hist = (await dentist.get(`/patients/${patientId}/history`).expect(200)).body.items;
    expect(JSON.stringify(hist)).not.toContain("GİZLİ-123");
    const still = await ownerQuery(tenantA, "select status from diagnoses where id = $1", [d.body.id]);
    expect(still[0].status).toBe("entered_in_error"); // silinmedi
  });

  it("başka kliniğin hastası/plan sürümüne erişilemez", async () => {
    const b = await login(app, EMAILS.bDentist);
    expect((await b.get(`/patients/${patientId}/plans`)).status).toBe(404);
    expect((await b.get(`/patients/${patientId}/chart`)).status).toBe(404);
    const anyVersion = (await ownerQuery(tenantA, "select id from plan_versions where status = 'draft' limit 1"))[0].id;
    expect((await b.post(`/plan-versions/${anyVersion}/items`, { procedureId: procs["KAN-01"]!.id, location: { kind: "tooth", tooth: "16" } })).status).toBe(404);
    const one = async (sql: string) => (await ownerQuery(tenantA, sql))[0].id as string;
    const [proposed, diag, finding, tariff, performed, plan] = await Promise.all([
      one("select id from plan_versions where status in ('proposed','accepted') limit 1"), one("select id from diagnoses limit 1"),
      one("select id from odontogram_findings limit 1"), one("select id from tariff_versions limit 1"),
      one("select id from performed_procedures limit 1"), one("select id from treatment_plans limit 1"),
    ]);
    expect((await b.post(`/plan-versions/${proposed}/decision`, { decision: "rejected" })).status).toBe(404);
    expect((await b.post(`/plans/${plan}/versions`, {})).status).toBe(404);
    expect((await b.post(`/diagnoses/${diag}/status`, { status: "entered_in_error", reason: "x deneme" })).status).toBe(404);
    expect((await b.post(`/findings/${finding}/status`, { status: "entered_in_error", reason: "x deneme" })).status).toBe(404);
    expect((await b.get(`/tariffs/${tariff}`)).status).toBe(404);
    expect((await b.post(`/performed/${performed}/cancel`, { reason: "x deneme" })).status).toBe(404);
    expect((await b.post(`/performed/${performed}/correct`, { reason: "x deneme", quantity: 1 })).status).toBe(404);
    expect((await b.post(`/plan-versions/${proposed}/cancel`, { reason: "x deneme" })).status).toBe(404);
    const bPlans = await b.get("/plans");
    expect(bPlans.status).toBe(200);
    expect((bPlans.body.items as { patientId: string }[]).some((x) => x.patientId === patientId)).toBe(false);
  });
});

describe("VİA Akış plan takibi", () => {
  it("kabul edilen plan randevusuzsa görev açılır; randevu verilince kapanır", async () => {
    const p = (await sec.post("/patients", { firstName: "Planlı", lastName: "Randevusuz" }).expect(201)).body.patient.id;
    const { versionId } = (await dentist.post(`/patients/${p}/plans`, { title: "Takip", practitionerId: pracId }).expect(201)).body;
    await dentist.post(`/plan-versions/${versionId}/items`, { procedureId: procs["KAN-01"]!.id, location: { kind: "tooth", tooth: "16" } }).expect(201);
    await dentist.post(`/plan-versions/${versionId}/propose`).expect(200);
    await sec.post(`/plan-versions/${versionId}/decision`, { decision: "accepted" }).expect(200);
    await runWorker();
    const t = (await sec.get(`/tasks?patientId=${p}`).expect(200)).body.items.find((x: { kind: string }) => x.kind === "plan_unscheduled");
    expect(t).toBeTruthy();
    await visit(p, 50, "11:00", false);
    await runWorker();
    expect((await sec.get(`/tasks?patientId=${p}`).expect(200)).body.items.some((x: { id: string }) => x.id === t.id)).toBe(false);
  });

  it("3 günden uzun yanıt bekleyen teklif görev oluşturur; karar kaydedilince kapanır", async () => {
    const { versionId } = await newPlan("Bekleyen teklif");
    await dentist.post(`/plan-versions/${versionId}/items`, { procedureId: procs["CEK-01"]!.id, location: { kind: "tooth", tooth: "18" } }).expect(201);
    await dentist.post(`/plan-versions/${versionId}/propose`).expect(200);
    await ownerQuery(tenantA, "update plan_versions set proposed_at = now() - interval '4 days' where id = $1", [versionId]);
    await sec.post("/via-akis/refresh").expect(200);
    const t = (await sec.get(`/tasks?patientId=${patientId}`).expect(200)).body.items.find((x: { kind: string; sourceId: string }) => x.kind === "plan_decision_pending" && x.sourceId === versionId);
    expect(t.reason).toMatch(/sunuldu/);
    await sec.post(`/plan-versions/${versionId}/decision`, { decision: "rejected", note: "Maliyet" }).expect(200);
    await runWorker();
    expect((await sec.get(`/tasks?patientId=${patientId}`).expect(200)).body.items.some((x: { id: string }) => x.id === t.id)).toBe(false);
  });
});
