/**
 * ADR-108 (08.11.2026): Laboratuvar menüsü.
 *  - İş emrinde hastadan alınan ölçü (tür + tarih) ve istenen malzeme: kayıt, föy, ileri tarih / türsüz tarih 422, gönderilmiş işte kilit (409).
 *  - Malzeme siparişi: taslak → gönder → kısmi teslim → tam teslim; teslim stoğa girer (bakiye hareketlerden); fazla teslim 422 ve yazım yok;
 *    lot takipli kalemde lot zorunlu; cari borç = gelen × sipariş fiyatı (kesin kuruş), yalnız supplier.ledger; idempotent; sürüm çakışması;
 *    iptal yalnız taslak/gönderilmişte ve gerekçeli; liste fiyatı önerisi; geciken sipariş PİA Akış görevi açılır ve teslimle kapanır;
 *    FORCE RLS, uygulama rolü satır miktarını/fiyatını güncelleyemez, teslim miktarı azalamaz; B kiracısı göremez; sekreter sipariş göremez.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, sec: Client, dentist: Client, assistant: Client, fin: Client, bAdmin: Client;
let tenantA: string, sup: string, lab: string, gauze: string, implant: string, patientId: string;
const key = () => `t-${randomUUID()}`;
const tag = randomUUID().slice(0, 4).toUpperCase();
const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};
const balance = async (itemId: string) => (await ownerQuery(tenantA, "select coalesce(sum(quantity),0)::numeric(12,3)::text as b from stock_movements where item_id = $1", [itemId]))[0].b as string;

beforeAll(async () => {
  app = await startApp();
  [admin, sec, dentist, assistant, fin, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aSecretary), login(app, EMAILS.aDentist),
    login(app, EMAILS.aAssistant), login(app, EMAILS.aFinance), login(app, EMAILS.bAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  sup = (await admin.post("/suppliers", { kind: "medical", name: `Medikal Sipariş ${tag}` }).expect(201)).body.id;
  lab = (await admin.post("/suppliers", { kind: "lab", name: `Laboratuvar Ölçü ${tag}` }).expect(201)).body.id;
  gauze = (await admin.post("/stock/items", { code: `GZB-${tag}`, name: `Sipariş gazlı bez ${tag}`, unit: "paket", trackLots: false, minLevel: "0" }).expect(201)).body.id;
  implant = (await admin.post("/stock/items", { code: `IMP-${tag}`, name: `Sipariş implant ${tag}`, unit: "adet", trackLots: true, minLevel: "0" }).expect(201)).body.id;
  await admin.post("/supplier-prices", { supplierId: sup, stockItemId: implant, unitPrice: "1250.50", validFrom: day(0) }).expect(201);
  patientId = (await sec.post("/patients", { firstName: "Ölçü", lastName: `Hasta${tag}`, birthDate: "1979-05-06", acknowledgeDuplicates: true }).expect(201)).body.patient.id;
});
afterAll(async () => { await app.close(); });

describe("iş emri: ölçü ve istenen malzeme", () => {
  it("kayıt, liste, ayrıntı ve föyde görünür; denetimde etiketli", async () => {
    const r = (await sec.post("/lab-orders", { patientId, supplierId: lab, practitionerId: (await sec.get("/resources")).body.practitioners[0].id, workType: "Zirkonyum kron",
      teeth: ["16"], shade: "A2", impressionType: "digital_scan", impressionTakenOn: day(0), material: "zirconia" }).expect(201)).body;
    const d = (await sec.get(`/lab-orders/${r.id}`).expect(200)).body;
    expect(d).toMatchObject({ impressionType: "digital_scan", impressionTakenOn: day(0), material: "zirconia" });
    const ws = (await sec.get(`/lab-orders/${r.id}/work-sheet`).expect(200)).body;
    expect(ws).toMatchObject({ impressionType: "digital_scan", impressionTakenOn: day(0), material: "zirconia" });
    const list = (await sec.get("/lab-orders?status=open").expect(200)).body.items.find((x: { id: string }) => x.id === r.id);
    expect(list.material).toBe("zirconia");
    const au = await ownerQuery(tenantA, "select changes from audit_events where action = 'lab_order.create' and entity_id = $1", [r.id]);
    expect(au[0].changes.material.to).toBe("zirconia");
  });
  it("ileri ölçü tarihi, türsüz tarih, geçersiz malzeme → 422", async () => {
    const base = { patientId, supplierId: lab, practitionerId: (await sec.get("/resources")).body.practitioners[0].id, workType: "Gece plağı" };
    expect((await sec.post("/lab-orders", { ...base, impressionType: "silicone", impressionTakenOn: day(1) })).status).toBe(422);
    const noType = await sec.post("/lab-orders", { ...base, impressionTakenOn: day(0) });
    expect(noType.status).toBe(422);
    expect(noType.body.field_errors.impressionType).toBeTruthy();
    expect((await sec.post("/lab-orders", { ...base, material: "altin" })).status).toBe(422);
  });
  it("taslakta değişir; laboratuvara gönderilince ölçü/malzeme kilitli (409)", async () => {
    const pr = (await sec.get("/resources")).body.practitioners[0].id;
    const r = (await sec.post("/lab-orders", { patientId, supplierId: lab, practitionerId: pr, workType: "Geçici kron", material: "pmma" }).expect(201)).body;
    let d = (await sec.get(`/lab-orders/${r.id}`)).body;
    await sec.patch(`/lab-orders/${r.id}`, { expectedVersion: d.version, impressionType: "alginate", impressionTakenOn: day(-1) }).expect(200);
    d = (await sec.get(`/lab-orders/${r.id}`)).body;
    expect(d).toMatchObject({ impressionType: "alginate", impressionTakenOn: day(-1), material: "pmma" });
    await sec.post(`/lab-orders/${r.id}/transition`, { action: "send", targetDate: day(5) }).expect(200);
    d = (await sec.get(`/lab-orders/${r.id}`)).body;
    const locked = await sec.patch(`/lab-orders/${r.id}`, { expectedVersion: d.version, material: "emax" });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe("LAB_SPEC_LOCKED");
  });
});

describe("malzeme siparişi", () => {
  let po: { id: string; orderNo: number };
  it("sekreter sipariş göremez/açamaz; B kiracısı göremez", async () => {
    expect((await sec.get("/purchase-orders")).status).toBe(403);
    expect((await sec.post("/purchase-orders", { supplierId: sup, lines: [{ itemId: gauze, quantity: "1" }] }).set("idempotency-key", key())).status).toBe(403);
  });
  it("doğrulama: kalemsiz, aynı kalem iki kez, geçmiş beklenen tarih, bilinmeyen kalem, idempotency anahtarı yok → hata; yazım yok", async () => {
    const n0 = (await ownerQuery(tenantA, "select count(*)::int as n from purchase_orders"))[0].n;
    expect((await assistant.post("/purchase-orders", { supplierId: sup, lines: [] }).set("idempotency-key", key())).status).toBe(422);
    expect((await assistant.post("/purchase-orders", { supplierId: sup, lines: [{ itemId: gauze, quantity: "1" }, { itemId: gauze, quantity: "2" }] }).set("idempotency-key", key())).status).toBe(422);
    expect((await assistant.post("/purchase-orders", { supplierId: sup, expectedDate: day(-1), lines: [{ itemId: gauze, quantity: "1" }] }).set("idempotency-key", key())).status).toBe(422);
    expect((await assistant.post("/purchase-orders", { supplierId: sup, lines: [{ itemId: randomUUID(), quantity: "1" }] }).set("idempotency-key", key())).status).toBe(422);
    expect((await assistant.post("/purchase-orders", { supplierId: sup, lines: [{ itemId: gauze, quantity: "0" }] }).set("idempotency-key", key())).status).toBe(422);
    expect((await assistant.post("/purchase-orders", { supplierId: sup, lines: [{ itemId: gauze, quantity: "1" }] })).status).toBe(428); // idempotency anahtarı zorunlu (finans komutu kuralı)
    expect((await ownerQuery(tenantA, "select count(*)::int as n from purchase_orders"))[0].n).toBe(n0);
  });
  it("asistan taslak açar (idempotent); fiyatsız kaleme liste fiyatı önerilir; toplam yalnız tüm fiyatlar varsa", async () => {
    const k = key();
    const body = { supplierId: sup, expectedDate: day(3), note: "Haftalık sipariş", lines: [{ itemId: gauze, quantity: "10", unitPrice: "12.35" }, { itemId: implant, quantity: "3" }] };
    po = (await assistant.post("/purchase-orders", body).set("idempotency-key", k).expect(201)).body;
    const again = await assistant.post("/purchase-orders", body).set("idempotency-key", k).expect(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body.id).toBe(po.id);
    const d = (await assistant.get(`/purchase-orders/${po.id}`).expect(200)).body;
    expect(d.status).toBe("draft");
    expect(d.lines.map((l: { unitPrice: string }) => l.unitPrice)).toEqual(["12.35", "1250.50"]);
    expect(d.total).toBe("3875.00"); // 10 × 12,35 + 3 × 1250,50
    const au = await ownerQuery(tenantA, "select changes from audit_events where action = 'purchase_order.create' and entity_id = $1", [po.id]);
    expect(au[0].changes.line_count.to).toBe(2);
  });
  it("taslak teslim alınamaz; gönder; eski sürümle işlem 409", async () => {
    let d = (await assistant.get(`/purchase-orders/${po.id}`)).body;
    expect((await assistant.post(`/purchase-orders/${po.id}/receive`, { expectedVersion: d.version, lines: [{ lineId: d.lines[0].id, quantity: "1" }] }).set("idempotency-key", key())).status).toBe(409);
    await assistant.post(`/purchase-orders/${po.id}/transition`, { action: "send", expectedVersion: d.version }).expect(200);
    expect((await assistant.post(`/purchase-orders/${po.id}/transition`, { action: "send", expectedVersion: d.version })).status).toBe(409);
    d = (await assistant.get(`/purchase-orders/${po.id}`)).body;
    expect(d.status).toBe("sent");
    expect(d.sentAt).toBeTruthy();
  });
  it("kısmi teslim stoğa girer; fazla teslim 422 ve hiçbir yazım yok; lot takipli kalemde lot zorunlu; borç için yetki", async () => {
    let d = (await assistant.get(`/purchase-orders/${po.id}`)).body;
    const [lg, li] = d.lines as { id: string }[];
    const b0 = await balance(gauze);
    const over = await assistant.post(`/purchase-orders/${po.id}/receive`, { expectedVersion: d.version, lines: [{ lineId: lg!.id, quantity: "4" }, { lineId: li!.id, quantity: "5" }] }).set("idempotency-key", key());
    expect(over.status).toBe(422);
    expect(await balance(gauze)).toBe(b0); // ilk satır da yazılmadı (tek transaction)
    expect((await assistant.post(`/purchase-orders/${po.id}/receive`, { expectedVersion: d.version, lines: [{ lineId: li!.id, quantity: "1" }] }).set("idempotency-key", key())).status).toBe(422); // lot yok
    expect((await assistant.post(`/purchase-orders/${po.id}/receive`, { expectedVersion: d.version, createBill: true, lines: [{ lineId: lg!.id, quantity: "4" }] }).set("idempotency-key", key())).status).toBe(403);
    const r = (await assistant.post(`/purchase-orders/${po.id}/receive`, { expectedVersion: d.version, lines: [{ lineId: lg!.id, quantity: "4" }, { lineId: li!.id, quantity: "1", lotNo: `L-${tag}`, expiryDate: day(400) }] })
      .set("idempotency-key", key()).expect(201)).body;
    expect(r).toMatchObject({ status: "partial", billId: null, receipts: 2 });
    expect(Number(await balance(gauze)) - Number(b0)).toBe(4);
    d = (await assistant.get(`/purchase-orders/${po.id}`)).body;
    expect(d.lines.map((l: { receivedQty: string }) => Number(l.receivedQty))).toEqual([4, 1]);
    expect(d.receipts.find((x: { lotNo: string | null }) => x.lotNo === `L-${tag}`)).toBeTruthy();
    const mv = await ownerQuery(tenantA, "select unit_cost::text, supplier_id, reason from stock_movements m join purchase_receipts r on r.movement_id = m.id where r.line_id = $1", [lg!.id]);
    expect(mv[0]).toMatchObject({ unit_cost: "12.35", supplier_id: sup, reason: `Sipariş ${po.orderNo}` });
    const sm = (await assistant.get("/purchase-orders-summary").expect(200)).body;
    expect(sm.partial).toBeGreaterThanOrEqual(1);
  });
  it("kalanı yönetici cari borçla teslim alır: borç = gelen × fiyat (kesin kuruş), kaynak purchase_receipt; sipariş kapanır; iptal edilemez", async () => {
    let d = (await admin.get(`/purchase-orders/${po.id}`)).body;
    const [lg, li] = d.lines as { id: string }[];
    const r = (await admin.post(`/purchase-orders/${po.id}/receive`, { expectedVersion: d.version, createBill: true, documentNo: `F-${tag}`,
      lines: [{ lineId: lg!.id, quantity: "6" }, { lineId: li!.id, quantity: "2", lotNo: `L-${tag}` }] }).set("idempotency-key", key()).expect(201)).body;
    expect(r.status).toBe("received");
    const bill = (await ownerQuery(tenantA, "select amount::text, source, document_no, supplier_id from supplier_entries where id = $1", [r.billId]))[0];
    expect(bill).toMatchObject({ amount: "2575.10", source: "purchase_receipt", document_no: `F-${tag}`, supplier_id: sup }); // 6 × 12,35 + 2 × 1250,50
    d = (await admin.get(`/purchase-orders/${po.id}`)).body;
    expect(d.status).toBe("received");
    expect(d.receivedAt).toBeTruthy();
    expect(d.doneLines).toBe(2);
    expect((await admin.post(`/purchase-orders/${po.id}/transition`, { action: "cancel", expectedVersion: d.version, reason: "Vazgeçildi" })).status).toBe(409);
    expect((await admin.post(`/purchase-orders/${po.id}/receive`, { expectedVersion: d.version, lines: [{ lineId: lg!.id, quantity: "1" }] }).set("idempotency-key", key())).status).toBe(409);
  });
  it("iptal: gerekçesiz 422; gerekçeli taslak iptal edilir", async () => {
    const p = (await assistant.post("/purchase-orders", { supplierId: sup, lines: [{ itemId: gauze, quantity: "2" }] }).set("idempotency-key", key()).expect(201)).body;
    const d = (await assistant.get(`/purchase-orders/${p.id}`)).body;
    expect((await assistant.post(`/purchase-orders/${p.id}/transition`, { action: "cancel", expectedVersion: d.version })).status).toBe(422);
    await assistant.post(`/purchase-orders/${p.id}/transition`, { action: "cancel", expectedVersion: d.version, reason: "Yanlış tedarikçi" }).expect(200);
    const after = (await assistant.get(`/purchase-orders/${p.id}`)).body;
    expect(after).toMatchObject({ status: "cancelled", cancelReason: "Yanlış tedarikçi" });
  });
  it("geciken sipariş PİA Akış görevi açar; teslimle kapanır", async () => {
    const p = (await assistant.post("/purchase-orders", { supplierId: sup, expectedDate: day(1), lines: [{ itemId: gauze, quantity: "1", unitPrice: "5.00" }] }).set("idempotency-key", key()).expect(201)).body;
    let d = (await assistant.get(`/purchase-orders/${p.id}`)).body;
    await assistant.post(`/purchase-orders/${p.id}/transition`, { action: "send", expectedVersion: d.version }).expect(200);
    await ownerQuery(tenantA, "update purchase_orders set expected_date = $2 where id = $1", [p.id, day(-2)]);
    await assistant.post("/via-akis/refresh").expect(200);
    const t = await ownerQuery(tenantA, "select status, title from tasks where kind = 'purchase_overdue' and source_id = $1", [p.id]);
    expect(t[0]).toMatchObject({ status: "open", title: "Geciken malzeme siparişi" });
    expect((await assistant.get("/purchase-orders?status=overdue")).body.items.some((x: { id: string; overdue: boolean }) => x.id === p.id && x.overdue)).toBe(true);
    d = (await assistant.get(`/purchase-orders/${p.id}`)).body;
    await assistant.post(`/purchase-orders/${p.id}/receive`, { expectedVersion: d.version, lines: [{ lineId: d.lines[0].id, quantity: "1" }] }).set("idempotency-key", key()).expect(201);
    await assistant.post("/via-akis/refresh").expect(200);
    expect((await ownerQuery(tenantA, "select status from tasks where kind = 'purchase_overdue' and source_id = $1", [p.id]))[0].status).toBe("done");
  });
});

describe("veritabanı güvenceleri", () => {
  it("FORCE RLS; uygulama rolü satır miktarı/fiyatı güncelleyemez, yalnız teslim miktarı; B kiracısı satır göremez", async () => {
    const r = await ownerQuery(null, `select relname, relrowsecurity and relforcerowsecurity as f from pg_class where relname in ('purchase_orders','purchase_order_lines','purchase_receipts') order by 1`);
    expect(r.map((x) => x.f)).toEqual([true, true, true]);
    const cols = await ownerQuery(null, `select column_name from information_schema.column_privileges where grantee = 'viadent_app' and table_name = 'purchase_order_lines' and privilege_type = 'UPDATE' order by 1`);
    expect(cols.map((x) => x.column_name)).toEqual(["received_qty"]);
    const del = await ownerQuery(null, `select count(*)::int as n from information_schema.role_table_grants where grantee = 'viadent_app' and table_name in ('purchase_orders','purchase_order_lines','purchase_receipts') and privilege_type = 'DELETE'`);
    expect(del[0].n).toBe(0);
    const bT = bAdmin.session.activeMembership.tenantId;
    expect((await ownerQuery(bT, "select count(*)::int as n from purchase_orders where tenant_id = $1", [tenantA]))[0].n).toBe(0);
    expect((await bAdmin.get("/purchase-orders?status=all").expect(200)).body.items.some((x: { supplier: string }) => x.supplier.includes(tag))).toBe(false);
  });
  it("teslim miktarı azalamaz ve sipariş miktarını aşamaz (tetikleyici / kısıt)", async () => {
    const line = (await ownerQuery(tenantA, "select l.id from purchase_order_lines l join purchase_orders po on po.id = l.order_id where po.supplier_id = $1 and l.received_qty > 0 limit 1", [sup]))[0].id;
    await expect(ownerQuery(tenantA, "update purchase_order_lines set received_qty = received_qty - 1 where id = $1", [line])).rejects.toThrow(/PURCHASE_RECEIVED_DECREASE/);
    await expect(ownerQuery(tenantA, "update purchase_order_lines set received_qty = quantity + 1 where id = $1", [line])).rejects.toThrow(/check/i);
  });
});
