/**
 * Görev 7 — içe aktarma sözleşmesi (Plan §09: alan eşleme, örnek sentetik dosya, dry-run, hata satırları,
 * tarih/para biçimi, mükerrer adaylar, import_batch_id), dışa aktarım ve iki adımlı doğrulama şemaları.
 */
import { z } from "zod";

export const IMPORT_KINDS = ["patients", "opening_balances", "appointment_history", "treatment_history"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const IMPORT_KIND_LABELS: Record<ImportKind, string> = { patients: "Hasta kartları", opening_balances: "Açılış bakiyeleri (hasta borcu)", appointment_history: "Geçmiş randevular", treatment_history: "Geçmiş işlemler (tedavi geçmişi)" };

export interface ImportField { key: string; label: string; required: boolean; aliases: string[]; hint?: string }
/** Başlık eşleme: büyük/küçük harf, Türkçe karakter, boşluk/alt çizgi farkı gözetmeden takma adlarla. */
export const IMPORT_FIELDS: Record<ImportKind, ImportField[]> = {
  patients: [
    { key: "external_ref", label: "Kaynak hasta no", required: true, aliases: ["kaynak_no", "kaynak hasta no", "hasta_no", "kayit_no", "eski_no", "external_id", "external_ref", "id"],
      hint: "Önceki sistemdeki benzersiz numara; tekrar aktarımda mükerrer kaydı önler." },
    { key: "first_name", label: "Ad", required: true, aliases: ["ad", "adi", "isim", "first_name", "firstname"] },
    { key: "last_name", label: "Soyad", required: true, aliases: ["soyad", "soyadi", "last_name", "lastname", "surname"] },
    { key: "birth_date", label: "Doğum tarihi", required: false, aliases: ["dogum_tarihi", "dogum tarihi", "birth_date", "birthdate", "dt"], hint: "gg.aa.yyyy veya yyyy-aa-gg" },
    { key: "gender", label: "Cinsiyet", required: false, aliases: ["cinsiyet", "gender", "sex"], hint: "K/E, Kadın/Erkek; boş bırakılabilir" },
    { key: "phone", label: "Telefon", required: false, aliases: ["telefon", "tel", "gsm", "cep", "cep_telefonu", "phone", "mobile"] },
    { key: "email", label: "E-posta", required: false, aliases: ["eposta", "e_posta", "e-posta", "email", "mail"] },
    { key: "city", label: "Şehir", required: false, aliases: ["sehir", "il", "city"] },
    { key: "national_id", label: "T.C. Kimlik No", required: false, aliases: ["tc", "tckn", "tc_kimlik_no", "tc kimlik no", "kimlik_no", "national_id"],
      hint: "11 hane, kontrol basamakları doğrulanır" },
    { key: "referral_source", label: "Nereden duydu", required: false, aliases: ["nereden_duydu", "referans", "kaynak", "referral_source"] },
  ],
  opening_balances: [
    { key: "patient_ref", label: "Kaynak hasta no", required: false, aliases: ["kaynak_no", "kaynak hasta no", "hasta_no", "external_ref", "patient_ref"],
      hint: "Hasta kartı aktarımındaki kaynak numarası; yoksa VİADENT dosya no" },
    { key: "file_no", label: "VİADENT dosya no", required: false, aliases: ["dosya_no", "dosya", "file_no"] },
    { key: "amount", label: "Borç tutarı (₺)", required: true, aliases: ["tutar", "bakiye", "borc", "acik_borc", "amount", "balance"],
      hint: "1250,50 veya 1250.50; binlik ayırıcıyla 1.250,50. Alacaklı (avans) bakiye bu sürümde aktarılmaz." },
    { key: "as_of", label: "Bakiye tarihi", required: true, aliases: ["tarih", "bakiye_tarihi", "as_of", "date"], hint: "gg.aa.yyyy; vade tarihi olarak kullanılır" },
    { key: "description", label: "Açıklama", required: false, aliases: ["aciklama", "description", "not"] },
  ],
  appointment_history: [
    { key: "external_ref", label: "Kaynak randevu no", required: false, aliases: ["randevu_no", "kaynak_randevu_no", "appointment_id", "external_ref", "id"],
      hint: "Önceki sistemdeki randevu numarası; tekrar aktarımda mükerrer kaydı önler (yoksa hasta+hekim+zaman eşleşmesi kullanılır)" },
    { key: "patient_ref", label: "Kaynak hasta no", required: false, aliases: ["kaynak_no", "kaynak hasta no", "hasta_no", "patient_ref", "hasta"], hint: "Hasta kartı aktarımındaki kaynak numarası; yoksa VİADENT dosya no" },
    { key: "file_no", label: "VİADENT dosya no", required: false, aliases: ["dosya_no", "dosya", "file_no"] },
    { key: "date", label: "Tarih", required: true, aliases: ["tarih", "randevu_tarihi", "date"], hint: "gg.aa.yyyy; yalnız geçmiş tarihler" },
    { key: "time", label: "Saat", required: true, aliases: ["saat", "baslangic", "time", "start"], hint: "SS:DD (24 saat)" },
    { key: "duration_min", label: "Süre (dk)", required: false, aliases: ["sure", "sure_dk", "duration", "duration_min", "dakika"], hint: "Boşsa 30" },
    { key: "practitioner", label: "Hekim", required: true, aliases: ["hekim", "doktor", "practitioner", "dentist", "hekim_adi"], hint: "VİADENT'teki hekim adı (örn. Dt. Elif Aras) ya da kullanıcı e-postası" },
    { key: "status", label: "Durum", required: false, aliases: ["durum", "status"], hint: "geldi / gelmedi / iptal (boşsa geldi)" },
    { key: "reason", label: "Sebep / işlem", required: false, aliases: ["sebep", "islem", "reason", "aciklama"], hint: "Serbest metin; tedavi kaydı oluşturmaz" },
    { key: "note", label: "Not", required: false, aliases: ["not", "note"] },
  ],
  treatment_history: [
    { key: "external_ref", label: "Kaynak işlem no", required: false, aliases: ["islem_no", "kaynak_islem_no", "procedure_id", "external_ref", "id"], hint: "Tekrar aktarımda mükerrer kaydı önler; yoksa hasta+işlem+tarih+hekim eşleşmesi" },
    { key: "patient_ref", label: "Kaynak hasta no", required: false, aliases: ["kaynak_no", "kaynak hasta no", "hasta_no", "patient_ref", "hasta"], hint: "Hasta kartı aktarımındaki kaynak numarası; yoksa VİADENT dosya no" },
    { key: "file_no", label: "VİADENT dosya no", required: false, aliases: ["dosya_no", "dosya", "file_no"] },
    { key: "date", label: "İşlem tarihi", required: true, aliases: ["tarih", "islem_tarihi", "date", "completed_at"], hint: "gg.aa.yyyy; yalnız geçmiş" },
    { key: "procedure", label: "İşlem (kod veya ad)", required: true, aliases: ["islem", "islem_kodu", "kod", "procedure", "procedure_code", "islem_adi"], hint: "VİADENT kataloğundaki kod (örn. DOL-01) ya da tam ad; eşleşmeyen satır hatalı" },
    { key: "tooth", label: "Diş (FDI)", required: false, aliases: ["dis", "dis_no", "tooth", "fdi"], hint: "11–48; boşsa işlem ağız düzeyinde" },
    { key: "quantity", label: "Adet", required: false, aliases: ["adet", "miktar", "quantity", "qty"], hint: "Boşsa 1" },
    { key: "amount", label: "Bedel (₺, bilgi)", required: false, aliases: ["tutar", "bedel", "ucret", "amount", "price"], hint: "Kaynaktaki bedel; ALACAK ÜRETMEZ (borç açılış bakiyesiyle gelir); boşsa 0" },
    { key: "practitioner", label: "Hekim", required: true, aliases: ["hekim", "doktor", "practitioner", "dentist", "hekim_adi"], hint: "VİADENT'teki hekim adı ya da e-posta" },
    { key: "note", label: "Not", required: false, aliases: ["not", "note", "aciklama"] },
  ],
};

export const IMPORT_ROW_STATUS_LABELS: Record<string, string> = {
  valid: "Aktarılabilir", error: "Hatalı", duplicate: "Mükerrer / aday", already_imported: "Daha önce aktarılmış", imported: "Aktarıldı",
  skipped: "Atlandı", rolled_back: "Geri alındı",
};
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 20000;

export const ImportCreate = z.object({
  kind: z.enum(IMPORT_KINDS),
  format: z.enum(["csv", "json"]),
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1, "Dosya boş").max(IMPORT_MAX_BYTES, "Dosya en çok 5 MB olabilir"),
  /** İsteğe bağlı açık eşleme: kaynak başlık → alan anahtarı. Verilmeyen başlıklar takma adlarla eşlenir. */
  mapping: z.record(z.string().max(100), z.string().max(40)).optional(),
});
export const ImportRollback = z.object({ reason: z.string().trim().min(3, "Gerekçe gerekli").max(300) });
export const ClinicExport = z.object({ reason: z.string().trim().min(5, "Dışa aktarım gerekçesi gerekli").max(300) });

export const MfaCode = z.object({ code: z.string().trim().regex(/^\d{6}$/, "6 haneli kodu girin") });
/** İkinci adım: 6 haneli TOTP veya tek kullanımlık kurtarma kodu (xxxx-xxxx-xx). */
export const MfaLogin = z.object({ challenge: z.string().min(20).max(200),
  code: z.string().trim().regex(/^(\d{6}|[A-Za-z2-7]{4}-?[A-Za-z2-7]{4}-?[A-Za-z2-7]{2})$/, "6 haneli kodu veya kurtarma kodunu girin") });
/** Klinik güvenlik politikası (yönetici): MFA zorunlu roller. */
export const TenantSecurityPolicy = z.object({ requireMfaRoles: z.array(z.enum(["clinic_admin", "dentist", "secretary", "assistant", "finance", "support"])).max(6) });
/** VİA Akış eşikleri (ADR-073): klinik ayarı; alan yoksa varsayılan. */
export const AKIS_DEFAULTS = { overdueCheckinMinutes: 10, missingContactDays: 7, planUnscheduledDays: 2, proposalPendingDays: 3 } as const;
export const AKIS_SETTING_LABELS: Record<keyof typeof AKIS_DEFAULTS, { label: string; hint: string; unit: string; min: number; max: number }> = {
  overdueCheckinMinutes: { label: "Geciken geliş uyarısı", hint: "Planlı randevunun saati bu kadar dakika geçince sekretere görev düşer", unit: "dk", min: 5, max: 120 },
  missingContactDays: { label: "Eksik iletişim bilgisi penceresi", hint: "Önümüzdeki bu kadar gün içinde randevusu olan, telefonu ve e-postası olmayan hasta için görev", unit: "gün", min: 1, max: 30 },
  planUnscheduledDays: { label: "Kabul edilen plan için randevu süresi", hint: "Plan kabulünden bu kadar gün sonra hâlâ ileri randevu yoksa görevin vadesi dolar", unit: "gün", min: 1, max: 30 },
  proposalPendingDays: { label: "Teklif yanıt bekleme süresi", hint: "Sunulan tedavi teklifi bu kadar gün yanıtsız kalınca görev düşer", unit: "gün", min: 1, max: 30 },
};
export const AkisSettings = z.object({
  overdueCheckinMinutes: z.number().int().min(5).max(120),
  missingContactDays: z.number().int().min(1).max(30),
  planUnscheduledDays: z.number().int().min(1).max(30),
  proposalPendingDays: z.number().int().min(1).max(30),
});
export type AkisSettingsT = z.infer<typeof AkisSettings>;
export function akisSettingsFrom(raw: unknown): AkisSettingsT {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (k: keyof typeof AKIS_DEFAULTS) => { const v = Number(o[k]); const { min, max } = AKIS_SETTING_LABELS[k]; return Number.isInteger(v) && v >= min && v <= max ? v : AKIS_DEFAULTS[k]; };
  return { overdueCheckinMinutes: pick("overdueCheckinMinutes"), missingContactDays: pick("missingContactDays"), planUnscheduledDays: pick("planUnscheduledDays"), proposalPendingDays: pick("proposalPendingDays") };
}

/** Süreli destek erişimi verme (yönetici): var olan kullanıcı e-postası, süre (saat), gerekçe. */
export const SupportGrant = z.object({ email: z.email("Geçerli bir e-posta girin").max(200), hours: z.number().int().min(1).max(72), reason: z.string().trim().min(10, "Gerekçe en az 10 karakter").max(300) });

/** Parola değişikliği: mevcut parola zorunlu (oturum ele geçirilse bile parola değiştirilemez); MFA açıksa güncel kod da istenir. */
export const PasswordChange = z.object({
  currentPassword: z.string().min(1, "Mevcut parola gerekli").max(200),
  newPassword: z.string().min(10, "Yeni parola en az 10 karakter olmalı").max(200),
  code: z.string().trim().regex(/^\d{6}$/, "6 haneli kodu girin").optional(),
}).refine((v) => v.currentPassword !== v.newPassword, { message: "Yeni parola eskisiyle aynı olamaz", path: ["newPassword"] });
/** Yönetici: üyenin parolasını sıfırlar — tek kullanımlık geçici parola üretilir, kullanıcı ilk girişte değiştirmek zorundadır. */
export const PasswordReset = z.object({ reason: z.string().trim().min(5, "Gerekçe gerekli").max(300) });
/** Kimlik numarasını açma gerekçesi (ADR-063). */
export const IdentityReveal = z.object({ reason: z.string().trim().min(5, "Gerekçe en az 5 karakter").max(200) });
