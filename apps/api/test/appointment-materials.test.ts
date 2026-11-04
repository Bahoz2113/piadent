/**
 * Ürün/fiyat listesi ve randevu malzeme gideri (madde 9, ADR-097).
 *  - Tedarikçi fiyatı sürümlüdür: geriye dönük 422, aynı gün 409, sekreter 403 (stock.manage yok); katalogda geçerli/planlı ayrımı.
 *  - Birim maliyet: son alışın tedarikçisinin geçerli liste fiyatı > en düşük liste fiyatı > son alış maliyeti; yoksa null (uydurulmaz).
 *  - Randevuya ek malzeme: yalnız hasta geldikten sonra (planlı randevuda 409); kullanım hareketi hasta + randevu bağlı, maliyet snapshot'ı;
 *    fiyat sonradan değişse de randevunun gideri değişmez; eksi stok 409 ve hiçbir satır yazılmaz; idempotent; ters kayıt gideri düşürür.
 *  - Gider/katkı: işlem bedeli ve katkı yalnız finance.read ile; kiracı yalıtımı.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, sec: Client, dentist: Client, assistant: Client, fin: Client, bAdmin: Client;
let tenantA: string, supA: string, supB: string, glove: string, noPrice: string, pracId: string, patientId: string;
const TZ = "Europe/Istanbul";
const key = () => `t-${randomUUID()}`;
const tag = randomUUID().slice(0, 4).toUpperCase();
const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};
let slot = 0;
async function appointment(status: "planned" | "checked_in") {
  const mm = 300 + (slot++ % 40) * 15;
  const time = `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
  const date = status === "planned" ? day(7) : day(0);
  const a = (await admin.post("/appointments", { patientId, practitionerId: pracId, date, startTime: time, durationMinutes: 15, allowOutsideHours: true,
    ...(status === "planned" ? {} : { backdateReason: "Test: geriye dönük ziyaret kaydı" }) }).expect(201)).body;
  if (status === "checked_in") await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "checked_in" }).expect(200);
  return a.id as string;
}

beforeAll(async () => {
  app = await startApp();
  [admin, sec, dentist, assistant, fin, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aSecretary), login(app, EMAILS.aDentist),
    login(app, EMAILS.aAssistant), login(app, EMAILS.aFinance), login(app, EMAILS.bAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  supA = (await admin.post("/suppliers", { kind: "medical", name: `Medikal Test A ${tag}` }).expect(201)).body.id;
  supB = (await admin.post("/suppliers", { kind: "medical", name: `Medikal Test B ${tag}` }).expect(201)).body.id;
  glove = (await admin.post("/stock/items", { code: `ELD-T${tag}`, name: `Test eldiveni ${tag}`, unit: "kutu", trackLots: false, minLevel: "0" }).expect(201)).body.id;
  noPrice = (await admin.post("/stock/items", { code: `GAZ-T${tag}`, name: `Test gazlı bez ${tag}`, unit: "paket", trackLots: false, minLevel: "0" }).expect(201)).body.id;
  await admin.post("/stock/receipts", { itemId: glove, quantity: "10", unitCost: "90.00", supplierId: supA }).set("idempotency-key", key()).expect(201);
  await admin.post("/stock/receipts", { itemId: noPrice, quantity: "5" }).set("idempotency-key", key()).expect(201);
  pracId = (await sec.get("/resources").expect(200)).body.practitioners[0].id;
  patientId = (await sec.post("/patients", { firstName: "Malzeme", lastName: `Gider ${tag}`, birthDate: "1981-02-02" }).expect(201)).body.patient.id;
});
afterAll(async () => { await app.close(); });

describe("tedarikçi fiyat listesi", () => {
  it("sürüm kuralları ve yetki; katalogda geçerli fiyat ve maliyet kaynağı", async () => {
    expect((await admin.post("/supplier-prices", { supplierId: supA, stockItemId: glove, unitPrice: "100.00", validFrom: day(-1) })).status).toBe(422);
    expect((await sec.post("/supplier-prices", { supplierId: supA, stockItemId: glove, unitPrice: "100.00", validFrom: day(0) })).status).toBe(403);
    expect((await assistant.post("/supplier-prices", { supplierId: supA, stockItemId: glove, unitPrice: "100.00", validFrom: day(0) })).status).toBe(403);
    const r = (await admin.post("/supplier-prices", { supplierId: supA, stockItemId: glove, unitPrice: "100.00", validFrom: day(0), supplierCode: "A-ELD" }).expect(201)).body;
    expect((await admin.post("/supplier-prices", { supplierId: supA, stockItemId: glove, unitPrice: "101.00", validFrom: day(0) })).body.code).toBe("PRICE_EXISTS");
    await admin.post("/supplier-prices", { supplierId: supB, stockItemId: glove, unitPrice: "80.00", validFrom: day(0) }).expect(201);
    await admin.post("/supplier-prices", { supplierId: supA, stockItemId: glove, unitPrice: "120.00", validFrom: day(30) }).expect(201);
    const ev = await ownerQuery(tenantA, "select changes from audit_events where action = 'supplier_price.create' and entity_id = $1", [r.id]);
    expect(ev[0].changes.unit_price.to).toBe("100.00");
    const cat = (await assistant.get("/stock/catalog").expect(200)).body.items;
    const g = cat.find((x: { id: string }) => x.id === glove);
    // Son alış A'dan: A'nın geçerli liste fiyatı (100) en düşükten (B 80) önce gelir.
    expect(g).toMatchObject({ unitCost: "100.00", costSource: "supplier_price", lastCost: "90.00", balance: "10.000" });
    expect(g.prices.map((p: { unitPrice: string; state: string }) => `${p.unitPrice}:${p.state}`).sort()).toEqual(["100.00:current", "120.00:scheduled", "80.00:current"]);
    const n = cat.find((x: { id: string }) => x.id === noPrice);
    expect(n).toMatchObject({ unitCost: null, costSource: null });
    expect((await sec.get("/stock/catalog")).status).toBe(403);
  });
});

describe("randevuda ek malzeme ve gider", () => {
  it("planlı randevuda 409; geldi durumunda kayıt: hasta+randevu bağlı, snapshot maliyet, fiyatsız kalem null; idempotent", async () => {
    const planned = await appointment("planned");
    expect((await assistant.post(`/appointments/${planned}/materials`, { items: [{ itemId: glove, quantity: "1" }] }).set("idempotency-key", key())).body.code).toBe("APPOINTMENT_NOT_STARTED");
    expect((await sec.post(`/appointments/${planned}/materials`, { items: [{ itemId: glove, quantity: "1" }] }).set("idempotency-key", key())).status).toBe(403);
    const aid = await appointment("checked_in");
    const k = key();
    const body = { items: [{ itemId: glove, quantity: "1.5" }, { itemId: noPrice, quantity: "2" }], note: "Ek sarf" };
    const r = (await assistant.post(`/appointments/${aid}/materials`, body).set("idempotency-key", k).expect(201)).body;
    expect(r.ids).toHaveLength(2);
    const again = await assistant.post(`/appointments/${aid}/materials`, body).set("idempotency-key", k).expect(201);
    expect(again.body.ids).toEqual(r.ids);
    const mv = await ownerQuery(tenantA, "select patient_id, appointment_id, unit_cost::text, quantity::text from stock_movements where id = any($1::uuid[]) order by stock_movements.quantity", [r.ids]);
    expect(mv).toEqual([
      { patient_id: patientId, appointment_id: aid, unit_cost: null, quantity: "-2.000" },
      { patient_id: patientId, appointment_id: aid, unit_cost: "100.00", quantity: "-1.500" },
    ]);
    // Fiyat değişse de gider değişmez (snapshot)
    await admin.post("/supplier-prices", { supplierId: supA, stockItemId: glove, unitPrice: "150.00", validFrom: day(1) }).expect(201);
    const m = (await assistant.get(`/appointments/${aid}/materials`).expect(200)).body;
    expect(m).toMatchObject({ status: "checked_in", editable: true, totals: { materialCost: "150.00", unknownCostLines: 1 }, revenue: null, contribution: null });
    expect(m.items.find((x: { itemId: string }) => x.itemId === glove)).toMatchObject({ quantity: "1.500", unitCost: "100.00", lineCost: "150.00", source: "manual" });
    // Hasta stok kullanım geçmişinde görünür
    const pu = (await assistant.get(`/patients/${patientId}/stock-usage`).expect(200)).body.items;
    expect(pu.some((x: { id: string }) => r.ids.includes(x.id))).toBe(true);
  });

  it("eksi stok 409 ve hiçbir satır yazılmaz; ters kayıt gideri düşürür; finans işlem bedeli ve katkıyı görür", async () => {
    const aid = await appointment("checked_in");
    const before = Number((await ownerQuery(tenantA, "select count(*)::int as n from stock_movements where appointment_id = $1", [aid]))[0].n);
    const r = await assistant.post(`/appointments/${aid}/materials`, { items: [{ itemId: glove, quantity: "1" }, { itemId: noPrice, quantity: "99" }] }).set("idempotency-key", key());
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("STOCK_INSUFFICIENT");
    expect(Number((await ownerQuery(tenantA, "select count(*)::int as n from stock_movements where appointment_id = $1", [aid]))[0].n)).toBe(before);
    const ok = (await assistant.post(`/appointments/${aid}/materials`, { items: [{ itemId: glove, quantity: "2" }] }).set("idempotency-key", key()).expect(201)).body;
    await assistant.post(`/stock/movements/${ok.ids[0]}/reverse`, { reason: "Yanlış randevuya girildi" }).expect(201);
    const rev = await ownerQuery(tenantA, "select appointment_id, unit_cost::text from stock_movements where reverses_id = $1", [ok.ids[0]]);
    expect(rev).toEqual([{ appointment_id: aid, unit_cost: "100.00" }]);
    const m = (await fin.get(`/appointments/${aid}/materials`).expect(200)).body;
    expect(m.totals.materialCost).toBe("0.00");
    expect(m.items.find((x: { reversal: boolean }) => x.reversal).lineCost).toBe("-200.00");
    expect(m.revenue).toBe("0.00");
    expect(m.contribution).toBe("0.00");
    expect(m.editable).toBe(false); // finans stock.write'a sahip değil
  });

  it("B kiracısı A'nın randevu malzemesini göremez, yazamaz; A'nın kalemi için fiyat giremez", async () => {
    const aid = await appointment("checked_in");
    expect((await bAdmin.get(`/appointments/${aid}/materials`)).status).toBe(404);
    expect((await bAdmin.post(`/appointments/${aid}/materials`, { items: [{ itemId: glove, quantity: "1" }] }).set("idempotency-key", key())).status).toBe(404);
    const bSup = (await bAdmin.post("/suppliers", { kind: "medical", name: `B Medikal ${tag}` }).expect(201)).body.id;
    expect((await bAdmin.post("/supplier-prices", { supplierId: bSup, stockItemId: glove, unitPrice: "1.00", validFrom: day(0) })).status).toBe(422);
  });
});

describe("standart ürün listesi", () => {
  it("yalnız eksik kodlar fiyatsız eklenir; ikinci çağrı 0; asistan 403", async () => {
    const { STANDARD_PRODUCTS } = await import("@viadent/contracts");
    expect((await assistant.post("/stock/items/standard-import", {})).status).toBe(403);
    const r1 = (await bAdmin.post("/stock/items/standard-import", {}).expect(201)).body;
    expect(r1.added + r1.skipped).toBe(STANDARD_PRODUCTS.length);
    expect((await bAdmin.post("/stock/items/standard-import", {}).expect(201)).body.added).toBe(0);
    const cat = (await bAdmin.get("/stock/catalog").expect(200)).body.items;
    const std = cat.filter((x: { code: string }) => x.code.startsWith("STD-"));
    expect(std.length).toBeGreaterThanOrEqual(r1.added);
    expect(std.every((x: { unitCost: string | null; balance: string }) => x.unitCost === null && x.balance === "0.000")).toBe(true);
  });
});
