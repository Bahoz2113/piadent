/**
 * Görev 7 — içe aktarma sözleşmesi (Plan §09: alan eşleme, örnek sentetik dosya, dry-run, hata satırları,
 * tarih/para biçimi, mükerrer adaylar, import_batch_id), dışa aktarım ve iki adımlı doğrulama şemaları.
 */
import { z } from "zod";

export const IMPORT_KINDS = ["patients", "opening_balances"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const IMPORT_KIND_LABELS: Record<ImportKind, string> = { patients: "Hasta kartları", opening_balances: "Açılış bakiyeleri (hasta borcu)" };

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
export const MfaLogin = z.object({ challenge: z.string().min(20).max(200), code: z.string().trim().regex(/^\d{6}$/, "6 haneli kodu girin") });
