import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_TRANSITIONS, addDays, can, dayRangeUtc, isValidTckn, localDate, maskNationalId, maskPhone,
  normalizePhone, normalizeSearch, PatientCreate, toTitleTr, zonedToUtc,
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
