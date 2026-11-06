/**
 * Ürün sahibi geri bildirimi 07.11.2026 — Raporlar sekmeleri ve İşlem kayıtları sorgulama.
 * - Gelirler: dönemdeki tüm hasta ödemeleri; iade edilen ve net; satır toplamı = toplam.
 * - Giderler: Maaşlar / Malzemeler / Kira / Aidat / Faturalar / Diğer; özet = başlıkların toplamı; stok kullanım maliyeti Malzemeler'e yansır.
 * - Tedarikçi: alınan ürünler, ödenen, kalan; seçili tedarikçide satırlar.
 * - Kaldırılan kartlar listede görünmez (hidden) ama iniş için tanımlı kalır.
 * - İşlem kayıtları: ekranda Türkçe etiket, ham kod yok; Türkçe aramayla süzülür.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { REPORTS } from "@viadent/contracts";
import { EMAILS, login, startApp, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, fin: Client, sec: Client;
const key = () => `t-${randomUUID()}`;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
const cents = (v: string | number) => Math.round(Number(v) * 100);
const sum = (rows: Record<string, unknown>[], k: string) => rows.reduce((n, r) => n + cents(String(r[k])), 0);
const report = async (c: Client, id: string, q: Record<string, string> = {}) =>
  (await c.get(`/reports/${id}?${new URLSearchParams({ from: today(), to: today(), ...q })}`).expect(200)).body;
let cashId: string;

beforeAll(async () => {
  app = await startApp();
  [admin, fin, sec] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aFinance), login(app, EMAILS.aSecretary)]);
  cashId = (await fin.get("/cash-accounts").expect(200)).body.items.find((a: { kind: string }) => a.kind === "cash").id;
});
afterAll(async () => app.close());

describe("Raporlar sekmeleri (07.11.2026)", () => {
  it("katalog: altı kart ve SMS kartı listeden kaldırıldı (iniş için tanımlı); üç sekme raporu var", async () => {
    const hidden = REPORTS.filter((r) => r.hidden).map((r) => r.id).sort();
    expect(hidden).toEqual(["hekim-hasta", "kontrol", "mesaj", "online-odeme", "plan", "prim", "tedavi"]);
    const cat = (await fin.get("/reports").expect(200)).body.reports as { id: string; tab?: string }[];
    expect(cat.filter((r) => r.tab).map((r) => r.tab).sort()).toEqual(["gelirler", "giderler", "tedarikci"]);
    await admin.get(`/reports/tedavi?from=${today()}&to=${today()}`).expect(200); // iniş hedefi çalışır
    await sec.get(`/reports/gelirler?from=${today()}&to=${today()}`).expect(403);
  });

  it("Gelirler: hasta ödemesi ve iadesi; satır toplamı = toplam; net = alınan − iade", async () => {
    const p = (await sec.post("/patients", { firstName: "Gelir", lastName: "Sekme", birthDate: "1990-01-01" }).expect(201)).body.patient.id;
    const pay = (await fin.post("/payments", { patientId: p, amount: "400.00", method: "cash", cashAccountId: cashId, allocations: [] }).set("idempotency-key", key()).expect(201)).body;
    await fin.post(`/payments/${pay.id}/refunds`, { amount: "75.00", method: "cash", cashAccountId: cashId, reason: "Sentetik gelir iadesi" }).set("idempotency-key", key()).expect(201);
    const r = await report(fin, "gelirler");
    const mine = r.rows.find((x: { receiptNo: string }) => x.receiptNo === pay.receiptNo);
    expect(mine).toMatchObject({ amount: "400.00", refunded: "75.00", net: "325.00", method: "Nakit" });
    expect(sum(r.rows, "amount")).toBe(cents(r.totals.amount));
    expect(sum(r.rows, "refunded")).toBe(cents(r.totals.refunded));
    expect(cents(r.totals.net)).toBe(cents(r.totals.amount) - cents(r.totals.refunded));
    expect(r.rows).toHaveLength(r.totals.count);
  });

  it("Giderler: Kira ve Aidat ayrı başlıkta; stok kullanımı Malzemeler'e maliyetle yansır; özet = başlıklar toplamı", async () => {
    const run = randomUUID().slice(0, 6);
    for (const [category, amount] of [["Kira", "12000.00"], ["Aidat", "850.00"], ["Fatura (elektrik/su/internet)", "640.50"]] as const) {
      await fin.post("/expenses", { category, description: `Sentetik ${category} ${run}`, amount, cashAccountId: cashId }).set("idempotency-key", key()).expect(201);
    }
    const item = (await admin.post("/stock/items", { code: `GB-${run}`, name: `Sentetik eldiven ${run}`, unit: "kutu", minLevel: "0" }).expect(201)).body.id;
    await admin.post("/stock/receipts", { itemId: item, quantity: "10", unitCost: "80.00" }).set("idempotency-key", key()).expect(201);
    await admin.post("/stock/usages", { itemId: item, quantity: "2" }).set("idempotency-key", key()).expect(201);

    const kira = await report(fin, "giderler", { kalem: "kira" });
    expect(kira.rows.some((x: { label: string; amount: string }) => x.label === `Sentetik Kira ${run}` && x.amount === "12000.00")).toBe(true);
    expect(sum(kira.rows, "amount")).toBe(cents(kira.totals.amount));
    const aidat = await report(fin, "giderler", { kalem: "aidat" });
    expect(aidat.rows.some((x: { label: string }) => x.label === `Sentetik Aidat ${run}`)).toBe(true);
    expect(kira.rows.some((x: { label: string }) => x.label.includes("Aidat"))).toBe(false);
    const fat = await report(fin, "giderler", { kalem: "fatura" });
    expect(fat.rows.some((x: { amount: string }) => x.amount === "640.50")).toBe(true);
    const mal = await report(fin, "giderler", { kalem: "malzeme" });
    const use = mal.rows.find((x: { label: string }) => x.label.startsWith(`Sentetik eldiven ${run}`));
    expect(use).toMatchObject({ amount: "160.00", kind: "Stok kullanımı" });
    expect(sum(mal.rows, "amount")).toBe(cents(mal.totals.amount));

    const oz = await report(fin, "giderler");
    expect(oz.rows.map((x: { head: string }) => x.head)).toEqual(["Maaşlar", "Malzemeler", "Kira", "Aidat", "Faturalar", "Diğer giderler"]);
    expect(sum(oz.rows, "amount")).toBe(cents(oz.totals.amount));
    expect(oz.rows.find((x: { head: string }) => x.head === "Kira").amount).toBe(kira.totals.amount);
    expect(oz.rows.find((x: { head: string }) => x.head === "Kira")._drill).toMatchObject({ report: "giderler", params: { kalem: "kira" } });
  });

  it("Tedarikçi: alınan ürün, ödenen, kalan; seçili tedarikçide ürün satırları; özet toplamları satırlarla mutabık", async () => {
    const run = randomUUID().slice(0, 6);
    const sup = (await admin.post("/suppliers", { kind: "medical", name: `Sentetik Medikal ${run}` }).expect(201)).body.id;
    const item = (await admin.post("/stock/items", { code: `TD-${run}`, name: `Sentetik kompozit ${run}`, unit: "adet", minLevel: "0" }).expect(201)).body.id;
    await admin.post("/stock/receipts", { itemId: item, quantity: "5", unitCost: "300.00", supplierId: sup, createBill: true, documentNo: `F-${run}` }).set("idempotency-key", key()).expect(201);
    await fin.post("/supplier-payments", { supplierId: sup, amount: "600.00", cashAccountId: cashId }).set("idempotency-key", key()).expect(201);

    const all = await report(fin, "tedarikci");
    const row = all.rows.find((x: { name: string }) => x.name === `Sentetik Medikal ${run}`);
    expect(row).toMatchObject({ items: 1, billed: "1500.00", paid: "600.00", remaining: "900.00" });
    for (const k of ["billed", "paid", "remaining"]) expect(sum(all.rows, k)).toBe(cents(all.totals[k]));
    const one = await report(fin, "tedarikci", { supplierId: sup });
    expect(one.rows.find((x: { kind: string }) => x.kind === "Alım").product).toContain(`Sentetik kompozit ${run}`);
    expect(one.totals).toMatchObject({ billed: "1500.00", paid: "600.00", remaining: "900.00" });
  });
});

describe("İşlem kayıtları sorgulama: yabancı terim yok (07.11.2026)", () => {
  it("işlem, kayıt türü ve alan adları Türkçe; Türkçe aramayla süzülür; ham kod ekranda yok", async () => {
    const r = await report(admin, "log");
    expect(r.rows.length).toBeGreaterThan(0);
    for (const x of r.rows as { action: string; entity: string; fields: string }[]) {
      expect(x.action).not.toMatch(/^[a-z_]+\.[a-z_.]+$/);
      expect(x.entity).not.toMatch(/^[a-z]+_[a-z_]+\b/);
      expect(x.fields).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    }
    const q = await report(admin, "log", { q: "gider" });
    expect(q.rows.length).toBeGreaterThan(0);
    expect((q.rows as { actionCode: string }[]).every((x) => x.actionCode.startsWith("expense."))).toBe(true);
    const def = REPORTS.find((x) => x.id === "log")!;
    expect(def.title).toBe("İşlem kayıtları sorgulama");
    expect(def.filters.find((f) => f.key === "entityType")!.kind).toBe("select");
  });
});
