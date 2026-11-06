/**
 * QA-301 (S3): tam sayfa "Randevu ver"de elle yazılan geçmiş gün uyarısız kalıyordu; eski çekmecedeki `inPast`
 * (zonedToUtc + APPOINTMENT_PAST_GRACE_MINUTES) istemci denetimi tam sayfaya taşınırken kaybolmuştu.
 * Davranış: geçmiş gün → Gün alanında "Geçmiş gün seçilemez", uygun saatler istenmez ve nedeni yazılır,
 * kaydet sunucuya gitmeden APPOINTMENT_IN_PAST; bugünün geçmiş saati elle → "Geçmiş saat seçilemez".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APPOINTMENT_PAST_GRACE_MINUTES, zonedToUtc } from "@viadent/contracts";
import { appointmentPastState, APPOINTMENT_IN_PAST_MESSAGE, PAST_DAY_ERROR, PAST_DAY_SLOTS_NOTE, PAST_TIME_ERROR } from "../components/appointment/past-guard";

const TZ = "Europe/Istanbul";
const TODAY = "2026-11-07";
const at = (time: string) => zonedToUtc(TODAY, time, TZ).getTime(); // klinik saatinde "şimdi"

describe("QA-301 geçmiş gün / saat kuralı", () => {
  it("metinler Türkçe ve kabul ölçütündeki gibi", () => {
    expect(PAST_DAY_ERROR).toBe("Geçmiş gün seçilemez");
    expect(PAST_TIME_ERROR).toBe("Geçmiş saat seçilemez");
    expect(PAST_DAY_SLOTS_NOTE).toBe("Geçmiş gün için saat listelenmez; bugün veya ileri bir gün seçin.");
    expect(APPOINTMENT_IN_PAST_MESSAGE).toBe("Geçmiş bir tarih veya saate randevu oluşturulamaz. Lütfen ileri bir saat seçin.");
  });

  it("bugünden önceki gün (01.01.2026) saat seçilmeden de geçmiştir", () => {
    expect(appointmentPastState("2026-01-01", "", TODAY, TZ, at("10:00"))).toEqual({ pastDay: true, inPast: true });
    expect(appointmentPastState("2026-11-06", "15:00", TODAY, TZ, at("00:05"))).toEqual({ pastDay: true, inPast: true });
  });

  it("bugün ve ileri gün geçmiş gün değildir; boş tarih uyarı vermez", () => {
    expect(appointmentPastState(TODAY, "", TODAY, TZ, at("10:00"))).toEqual({ pastDay: false, inPast: false });
    expect(appointmentPastState("2026-11-09", "09:00", TODAY, TZ, at("10:00"))).toEqual({ pastDay: false, inPast: false });
    expect(appointmentPastState("", "09:00", TODAY, TZ, at("10:00"))).toEqual({ pastDay: false, inPast: false });
  });

  it("bugün + elle geçmiş saat: tolerans (APPOINTMENT_PAST_GRACE_MINUTES) dışı geçmiş, içi kabul", () => {
    expect(APPOINTMENT_PAST_GRACE_MINUTES).toBe(10);
    expect(appointmentPastState(TODAY, "09:00", TODAY, TZ, at("10:00")).inPast).toBe(true);
    expect(appointmentPastState(TODAY, "09:49", TODAY, TZ, at("10:00")).inPast).toBe(true);
    expect(appointmentPastState(TODAY, "09:50", TODAY, TZ, at("10:00")).inPast).toBe(false); // tam sınır: geçmiş sayılmaz
    expect(appointmentPastState(TODAY, "09:55", TODAY, TZ, at("10:00")).inPast).toBe(false);
    expect(appointmentPastState(TODAY, "10:30", TODAY, TZ, at("10:00")).inPast).toBe(false);
    expect(appointmentPastState(TODAY, "09:00", TODAY, TZ, at("10:00")).pastDay).toBe(false);
  });

  it("eksik/yarım saat girişi geçmiş saat sayılmaz (saat zorunluluğu ayrı denetlenir)", () => {
    expect(appointmentPastState(TODAY, "9:0", TODAY, TZ, at("10:00")).inPast).toBe(false);
  });
});

describe("QA-301 sayfa bağlantısı (kaynak düzeyi)", () => {
  const page = readFileSync(new URL("../components/appointment/new-appointment-page.tsx", import.meta.url), "utf8");
  const save = page.slice(page.indexOf("async function save("), page.indexOf("const outside ="));

  it("durum klinik saat dilimi ve bugünle hesaplanır", () => {
    expect(page).toMatch(/const \{ pastDay, inPast \} = appointmentPastState\(f\.date, f\.startTime, today, tz\)/);
  });
  it("Gün alanı geçmiş günde hata gösterir", () => {
    expect(page).toMatch(/<DateField label="Gün"[^>]*error=\{err\?\.fieldErrors\.date \?\? \(pastDay \? PAST_DAY_ERROR : undefined\)\}/);
  });
  it("geçmiş günde uygun saatler istenmez ve nedeni yazılır", () => {
    expect(page).toMatch(/useData<Availability>\(f\.practitionerId && f\.date && !pastDay \?/);
    expect(page).toMatch(/\{pastDay \? <Alert kind="warning"[^>]*>\{PAST_DAY_SLOTS_NOTE\}<\/Alert>/);
  });
  it("elle saat alanı bugünün geçmiş saatinde uyarır", () => {
    expect(page).toMatch(/label="Saat" type="time"[\s\S]{0,400}inPast && !pastDay \? PAST_TIME_ERROR/);
  });
  it("kaydet: geçmiş denetimi sunucu isteğinden önce, yerel APPOINTMENT_IN_PAST; ödeme yeniden denemesini engellemez", () => {
    const guard = save.indexOf("if (!created && inPast)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(save.indexOf('api<{ id: string }>("/appointments"'));
    expect(guard).toBeLessThan(save.indexOf("setBusy(true)"));
    expect(save).toMatch(/code: "APPOINTMENT_IN_PAST", message: APPOINTMENT_IN_PAST_MESSAGE/);
    expect(save).toMatch(/pastDay \? \{ date: PAST_DAY_ERROR \} : \{ startTime: PAST_TIME_ERROR \}/);
  });
  it("komşu: ?yeni=1 geçmiş tarihli ön doldurma bugüne çekilir (korunur)", () => {
    expect(page).toMatch(/date: prefill\.date < today \? today : prefill\.date/);
  });
});
