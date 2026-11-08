/**
 * ADR-109 (09.11.2026): POS entegrasyonu — Faz 0 (sözleşme ve arayüz kaynak denetimi).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  POS_DEVICE_DRIVERS, POS_DRIVER_LABELS, POS_INTENT_STATUS_LABELS, PosIntentCreate, PosIntentResolve, PosSettlementCreate, PosTerminalUpsert,
} from "@viadent/contracts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";

describe("sözleşmeler", () => {
  it("elle eşleştirmede onay kodu ve son 4 hane zorunlu; tam kart no reddedilir", () => {
    const base = { terminalId: U, patientId: V, amount: "100.00", mode: "manual" as const };
    expect(PosIntentCreate.safeParse(base).success).toBe(false);
    expect(PosIntentCreate.safeParse({ ...base, authCode: "AB1234", cardLast4: "4242" }).success).toBe(true);
    expect(PosIntentCreate.safeParse({ ...base, authCode: "AB1234", cardLast4: "4242424242424242" }).success).toBe(false);
    expect(PosIntentCreate.safeParse({ ...base, authCode: "AB-12", cardLast4: "4242" }).success).toBe(false);
    expect(PosIntentCreate.safeParse({ ...base, mode: "device" }).success).toBe(true);
    expect(PosIntentCreate.safeParse({ ...base, mode: "device", installments: 13 }).success).toBe(false);
    expect(PosIntentCreate.safeParse({ ...base, mode: "device", amount: "0.00" }).success).toBe(false);
  });
  it("çözüm: onay kart özeti ister, ret gerekçe ister", () => {
    expect(PosIntentResolve.safeParse({ outcome: "approved", authCode: "123456", cardLast4: "1111" }).success).toBe(true);
    expect(PosIntentResolve.safeParse({ outcome: "approved", authCode: "123456" }).success).toBe(false);
    expect(PosIntentResolve.safeParse({ outcome: "declined", reason: "x" }).success).toBe(false);
  });
  it("gün sonu ve terminal doğrulaması", () => {
    expect(PosSettlementCreate.safeParse({ terminalId: U, date: "2026-11-09", slipCount: 2, slipTotal: "300.10" }).success).toBe(true);
    expect(PosSettlementCreate.safeParse({ terminalId: U, date: "2026-11-09", slipCount: -1, slipTotal: "1.00" }).success).toBe(false);
    expect(PosTerminalUpsert.safeParse({ name: "Ön büro", driver: "manual", cashAccountId: U, terminalRef: "T-0001" }).success).toBe(true);
    expect(PosTerminalUpsert.safeParse({ name: "Ön büro", driver: "ingenico", cashAccountId: U }).success).toBe(false);
  });
  it("yalnız DENEME sürücüsü tutar gönderir; etiketler Türkçe ve dürüst", () => {
    expect(POS_DEVICE_DRIVERS).toEqual(["mock"]);
    expect(POS_DRIVER_LABELS.mock).toMatch(/DENEME/);
    expect(POS_DRIVER_LABELS.manual).toMatch(/tutar cihaza gönderilmez/);
    expect(POS_INTENT_STATUS_LABELS.unknown).toMatch(/bilinmiyor/);
  });
});

describe("arayüz", () => {
  it("tahsilat çekmecesi: Kart (POS) terminal üzerinden; banka POS'unda onay kodu + son 4 hane; cihazda tutar gönderilir", () => {
    const a = read("components/finance/account-tab.tsx");
    expect(a).toMatch(/"Kart \(POS\)"/);
    expect(a).toMatch(/label="POS terminali"/);
    expect(a).toMatch(/"Tutarı cihaza gönder"/);
    expect(a).toMatch(/<AuthCodeField/);
    expect(a).toMatch(/<Last4Field/);
    expect(a).toMatch(/Açık işlemi göster/);
  });
  it("son 4 hane alanı 4 rakamla sınırlı; DENEME benzetimi etiketli; sonuç bilinmiyor iptal değil çözüm ister", () => {
    const p = read("components/finance/pos.tsx");
    expect(p).toMatch(/maxLength=\{4\}/);
    expect(p).toMatch(/replace\(\/\\D\/g, ""\)\.slice\(0, 4\)/);
    expect(p).toMatch(/Kart onaylandı \(deneme\)/);
    expect(p).toMatch(/POS fişinde bu çekim var mı\?/);
    expect(p).toMatch(/Gün sonunu kapat/);
  });
  it("Finans'ta POS ve gün sonu sekmesi vezne yetkisiyle açılır; hekime kapalı kalır", () => {
    const f = read("app/(app)/finans/page.tsx");
    expect(f).toMatch(/\{ id: "pos", label: "POS ve gün sonu", perm: "payment.write" \}/);
    expect(f).toMatch(/if \(!tabs\.length\)/);
    expect(f).toMatch(/<PosDayPanel/);
  });
});
