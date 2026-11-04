import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_TRANSITIONS, addDays, can, dayRangeUtc, isValidTckn, localDate, maskNationalId, maskPhone,
  normalizePhone, limitPhoneInput, normalizeSearch, PatientCreate, toTitleTr, zonedToUtc,
} from "../src/index.js";

describe("Türkçe metin", () => {
  it("arama normalizasyonu İ/ı/ş/ğ/ç/ö/ü ve büyük harfi eşler", () => {
    expect(normalizeSearch("Şükrü IŞIK")).toBe("sukru isik");
    expect(normalizeSearch("  İREM   Çağlayan-Öz ")).toBe("irem caglayan oz");
  });
  it("başlık biçimi Türkçe kurala uyar", () => {
    expect(toTitleTr("irem ışık")).toBe("İrem Işık");
    expect(toTitleTr("YÜCEL")).toBe("Yücel");
  });
});

describe("telefon", () => {
  it("TR yerel biçimlerini E.164'e çevirir", () => {
    expect(normalizePhone("0555 000 11 22")?.e164).toBe("+905550001122");
    expect(normalizePhone("555 000 11 22")?.e164).toBe("+905550001122");
    expect(normalizePhone("+49 30 1234567")?.e164).toBe("+49301234567");
    expect(normalizePhone("12")).toBeNull();
  });
  it("yurt içi hane kuralı: 0'lı 11, 0'sız 10 hane; fazlası/eksiği reddedilir", () => {
    expect(normalizePhone("0212 555 11 22")?.e164).toBe("+902125551122");
    expect(normalizePhone("2125551122")?.e164).toBe("+902125551122");
    expect(normalizePhone("05550001122 3")).toBeNull();      // 12 hane (0'lı)
    expect(normalizePhone("055500011")).toBeNull();          // 9 hane (0'lı)
    expect(normalizePhone("55500011223")).toBeNull();        // 11 hane (0'sız)
    expect(normalizePhone("905550001122")).toBeNull();       // + olmadan ülke kodu: yurt dışı için + gerekir
    expect(normalizePhone("+90 555 000 11 22")?.e164).toBe("+905550001122");
    expect(normalizePhone("0049 30 1234567")?.e164).toBe("+49301234567");
  });
  it("yazarken sınır: 0'lı 11, 0'sız 10 haneden fazlası eklenmez", () => {
    expect(limitPhoneInput("0555 000 11 22 99")).toBe("0555 000 11 22 ");
    expect(limitPhoneInput("555 000 11 2299")).toBe("555 000 11 22");
    expect(limitPhoneInput("+49 30 1234567")).toBe("+49 30 1234567");
    expect(limitPhoneInput("05a55")).toBe("0555");
  });
  it("maskeleme son haneler dışını gizler", () => {
    expect(maskPhone("+905550001122")).toBe("+905 *** ** 22");
    expect(maskNationalId("10000000146")).toBe("•••••••0146");
  });
});

describe("TCKN biçim kontrolü", () => {
  it("kontrol basamaklarını doğrular (resmî doğrulama değildir)", () => {
    expect(isValidTckn("10000000146")).toBe(true);
    expect(isValidTckn("12345678901")).toBe(false);
    expect(isValidTckn("01234567890")).toBe(false);
  });
});

describe("saat dilimi (AT-19 temeli)", () => {
  it("klinik gece yarısı sınırında doğru günü verir", () => {
    // 2026-10-22 21:30 UTC = 2026-10-23 00:30 İstanbul
    expect(localDate(new Date("2026-10-22T21:30:00Z"), "Europe/Istanbul")).toBe("2026-10-23");
    expect(localDate(new Date("2026-10-22T20:59:59Z"), "Europe/Istanbul")).toBe("2026-10-22");
  });
  it("klinik günü [00:00, ertesi 00:00) UTC aralığına çevrilir", () => {
    const r = dayRangeUtc("2026-10-23", "Europe/Istanbul");
    expect(r.from.toISOString()).toBe("2026-10-22T21:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-23T21:00:00.000Z");
  });
  it("yaz saati geçişli bölgede yerel saat doğru çevrilir", () => {
    expect(zonedToUtc("2026-03-29", "03:30", "Europe/Berlin").toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(zonedToUtc("2026-10-25", "12:00", "Europe/Berlin").toISOString()).toBe("2026-10-25T11:00:00.000Z");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("kurallar", () => {
  it("randevu terminal durumlarından çıkış yoktur", () => {
    expect(APPOINTMENT_TRANSITIONS.completed).toEqual([]);
    expect(APPOINTMENT_TRANSITIONS.cancelled).toEqual([]);
    expect(APPOINTMENT_TRANSITIONS.planned).toContain("checked_in");
  });
  it("rol matrisi: sekreter klinik not yazamaz; yönetici sağlık içeriğini okuyamaz", () => {
    expect(can("secretary", "clinical_note.write")).toBe(false);
    expect(can("clinic_admin", "patient.health.read")).toBe(false);
    expect(can("dentist", "clinical_note.write")).toBe(true);
    expect(can("assistant", "payment.refund")).toBe(false);
  });
  it("kimlik türü ve numarası birlikte girilmeli", () => {
    expect(PatientCreate.safeParse({ firstName: "A", lastName: "B", nationalId: "123" }).success).toBe(false);
    expect(PatientCreate.safeParse({ firstName: "A", lastName: "B", email: "", phone: "" }).success).toBe(true);
  });
});

describe("finans (Görev 3)", () => {
  it("prim: 600 × %10 = 60; 100 iade → −10; yarım kuruş yukarı yuvarlanır", async () => {
    const { commissionAmount } = await import("../src/index.js");
    expect(commissionAmount("600.00", "10")).toBe("60.00");
    expect(commissionAmount("-100.00", "10")).toBe("-10.00");
    expect(commissionAmount("0.05", "10")).toBe("0.01");
    expect(commissionAmount("333.33", "12.5")).toBe("41.67");
  });
  it("rol matrisi: sekreter tahsilat alır ama iade yapamaz ve gelir raporunu göremez; hekim finans görmez", () => {
    expect(can("secretary", "payment.write")).toBe(true);
    expect(can("secretary", "payment.refund")).toBe(false);
    expect(can("secretary", "finance.read")).toBe(false);
    expect(can("finance", "payment.refund")).toBe(true);
    expect(can("dentist", "account.read")).toBe(false);
    expect(can("clinic_admin", "payment.write")).toBe(false);
  });
  it("ödeme: sıfır/negatif tutar ve TRY dışı para birimi reddedilir", async () => {
    const { PaymentCreate } = await import("../src/index.js");
    const base = { patientId: "0b8f2f8e-6a8e-4c3c-9d5f-1a2b3c4d5e6f", method: "cash", cashAccountId: "0b8f2f8e-6a8e-4c3c-9d5f-1a2b3c4d5e6f" };
    expect(PaymentCreate.safeParse({ ...base, amount: "0.00" }).success).toBe(false);
    expect(PaymentCreate.safeParse({ ...base, amount: "-5" }).success).toBe(false);
    expect(PaymentCreate.safeParse({ ...base, amount: "10.00", currency: "USD" }).success).toBe(false);
    expect(PaymentCreate.safeParse({ ...base, amount: "10.00" }).success).toBe(true);
  });
});

describe("içe aktarma başlık eşlemesi (ADR-069)", () => {
  it("CSV/JSON başlıkları çıkarılır; takma ad önerisi; açık '' eşlemesi takma adı geçersiz kılar", async () => {
    const { extractImportHeaders, mapImportHeaders } = await import("../src/import-map");
    expect(extractImportHeaders('﻿"Kaynak_No";Adı;"Soy;adı";Telefon\r\n1;Ali;Veli;0555\r\n', "csv")).toEqual(["Kaynak_No", "Adı", "Soy;adı", "Telefon"]);
    expect(extractImportHeaders('a,b,c\n1,2,3', "csv")).toEqual(["a", "b", "c"]);
    expect(extractImportHeaders('[{"hasta_no":1,"ad":"x"},{"soyad":"y"}]', "json")).toEqual(["hasta_no", "ad", "soyad"]);
    expect(extractImportHeaders("bozuk", "json")).toEqual([]);
    const auto = mapImportHeaders("patients", ["Kaynak_No", "Adı", "Soyadı", "Telefon"]);
    expect(auto.mapping).toEqual({ Kaynak_No: "external_ref", Adı: "first_name", Soyadı: "last_name", Telefon: "phone" });
    expect(auto.missing).toEqual([]);
    const ex = mapImportHeaders("patients", ["Kaynak_No", "Adı", "Soyadı", "Telefon"], { Telefon: "", Soyadı: "last_name" });
    expect(ex.mapping).not.toHaveProperty("Telefon");
    expect(ex.unmapped).toEqual(["Telefon"]);
    const bad = mapImportHeaders("patients", ["X", "Y"], { X: "external_ref", Y: "olmayan_alan" });
    expect(bad.mapping).toEqual({ X: "external_ref" });
    expect(bad.missing).toEqual(["first_name", "last_name"]);
  });
});
