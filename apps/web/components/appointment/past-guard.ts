import { APPOINTMENT_PAST_GRACE_MINUTES, zonedToUtc } from "@viadent/contracts";

/**
 * QA-301: randevu sayfasında geçmiş gün / geçmiş saat istemci denetimi (eski çekmecedeki `inPast` kuralı).
 * Sunucu yine 422 APPOINTMENT_IN_PAST ile engeller; bu yalnız kullanıcıya erken ve açık uyarıdır.
 * Geriye dönük kayıt yalnız sunucuda (yönetici + gerekçe) — sayfa bunu açmaz.
 */
export const PAST_DAY_ERROR = "Geçmiş gün seçilemez";
export const PAST_TIME_ERROR = "Geçmiş saat seçilemez";
export const PAST_DAY_SLOTS_NOTE = "Geçmiş gün için saat listelenmez; bugün veya ileri bir gün seçin.";
export const APPOINTMENT_IN_PAST_MESSAGE = "Geçmiş bir tarih veya saate randevu oluşturulamaz. Lütfen ileri bir saat seçin.";

export function appointmentPastState(date: string, startTime: string, today: string, tz: string, nowMs: number = Date.now()) {
  const pastDay = !!date && date < today;
  const startsAt = date && /^\d{2}:\d{2}$/.test(startTime) ? zonedToUtc(date, startTime, tz) : null;
  const inPast = pastDay || (!!startsAt && startsAt.getTime() < nowMs - APPOINTMENT_PAST_GRACE_MINUTES * 60_000);
  return { pastDay, inPast };
}
