/**
 * PİA-DENT varsayılan rol → izin matrisi (Plan §05). Bu tablo SUNUCUDA uygulanır;
 * arayüzde düğme gizlemek yalnız kolaylıktır, güvenlik değildir.
 */
/** Atanabilir klinik rolleri (davet, rol değişikliği). */
export const ROLES = ["clinic_admin", "dentist", "secretary", "assistant", "finance"] as const;
/** Tüm roller: + `support` — PİA-DENT destek erişimi; yalnız yönetici tarafından süreli verilir, davetle atanmaz (ADR-061). */
export const ALL_ROLES = [...ROLES, "support"] as const;
export type Role = (typeof ALL_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  clinic_admin: "Klinik yöneticisi",
  dentist: "Hekim",
  secretary: "Sekreterya",
  assistant: "Asistan",
  finance: "Finans",
  support: "PİA-DENT destek (süreli, salt okunur)",
};

export const PERMISSIONS = [
  "patient.read",            // kimlik/iletişim özeti (maskeli)
  "patient.write",
  "patient.identity.unmask", // tam kimlik no / telefon
  "patient.health.read",     // anamnez, klinik not
  "clinical_note.write",
  "anamnesis.write",         // anamnez yanıtı kaydetme (yeni sürüm)
  "anamnesis.review",        // hekim onayı
  "anamnesis.template",      // anamnez soru şablonu taslağı oluşturma/düzenleme (yayın: anamnesis.review olan hekim)
  "treatment.read",          // plan/teklif ve gerçekleşen işlem listesi (tanı/bulgu hariç)
  "treatment.write",         // plan taslağı, kalem, teklif sunma, yeni sürüm
  "treatment.decision",      // hastanın kabul/ret/kararsız yanıtını kaydetme
  "procedure.complete",      // gerçekleşen işlem kaydı / iptal / düzeltme
  "diagnosis.write",         // tanı ve odontogram bulgusu
  "catalog.manage",          // işlem kataloğu ve tarife sürümleri
  "appointment.read",
  "appointment.write",
  "task.read",
  "task.write",
  "finance.read",            // klinik finans özeti, günlük tahsilat/işlem metrikleri, kasa, prim (gelir raporları)
  "account.read",            // hasta hesabı: alacak, ödeme, avans, iade (PİA Net, hasta bazlı)
  "payment.write",           // tahsilat kaydı ve avans dağıtımı
  "payment.refund",          // iade (dağıtım ters kaydı dahil)
  "receivable.write",        // elle alacak, alacak iptali
  "expense.write",           // gider ve gider ters kaydı
  "finance.settings",        // kasa/banka hesapları, prim kuralı sürümleri
  "invoice.write",           // fatura taslağı oluşturma/düzenleme/iptal; sağlayıcıya gönderim (bağlıysa)
  "document.read",           // hasta belgeleri ve kanıt olayları
  "document.issue",          // onaylı şablondan hasta belgesi üretme
  "document.decision",       // yüz yüze kabul/ret kaydı (kanıt olayı)
  "document.revoke",         // belgeyi gerekçeyle iptal
  "template.manage",         // belge türü, şablon sürümü, PİA Hazır kuralları
  "file.read",               // idari dosyalar (klinik dosyalar ayrıca patient.health.read ister)
  "file.write",              // dosya yükleme
  "file.delete",             // dosyayı gerekçeyle silindi işaretleme
  "communication.write",     // iletişim tercihi kaydı
  "message.send",            // mesaj kuyruğa alma (şimdilik yalnız MOCK sağlayıcı)
  "followup.write",          // kontrol planlama
  "readiness.exception",     // PİA Hazır eksiğine gerekçeli istisna
  "integration.read",        // PİA Köprü: bağlantılar, dış işler, webhook günlüğü
  "integration.manage",      // bağlantı ayarı, sır yenileme, yeniden deneme/iptal, MOCK simülasyonu
  "integration.approve",     // onay kapısı (dört göz): onay isteyen dış işi onaylama/reddetme
  "lab.read",                // laboratuvar iş emirleri (maliyet hariç)
  "lab.write",               // iş emri oluşturma, gönderme, teslim alma, not
  "lab.decide",              // klinik kabul / revizyon kararı (hekim)
  "lab.cost",                // laboratuvar maliyeti görme/girme (cari borç doğurur)
  "supplier.manage",         // tedarikçi / laboratuvar tanımı (T15, T16, T18)
  "supplier.ledger",         // cari fatura/ödeme kaydı ve ters kaydı
  "commission.payout",       // hekim primi ödemesi (kasadan çıkış) ve ters kaydı
  "stock.read",
  "stock.write",             // giriş, kullanım, fire, sayım
  "stock.manage",            // stok kalemi tanımı
  "report.operations",       // randevu, kontrol, laboratuvar, mesaj, belge sorguları (tutar yok)
  "report.clinical",         // tedavi, plan, işlem, hekim-hasta sorguları (hekim yalnız kendi kayıtları)
  "report.analytics",        // klinik işletme analizi (metrik sözlüğü)
  "report.export",           // rapor CSV dışa aktarımı (denetlenir)
  "audit.clinic",            // klinik geneli LOG sorgulama (R15)
  "audit.read",
  "import.manage",           // içe aktarma: dry-run, onay, geri alma (VD-014)
  "export.clinic",           // klinik verisinin tamamını açık formatta dışa aktarma (gerekçeli, denetlenir)
  "export.patient",          // hasta verisi dışa aktarma (KVKK veri sahibi talebi; sağlık bölümleri ayrıca sağlık yetkisi ister)
  "team.manage",
  "schedule.manage",         // hekim/koltuk, çalışma saati, kapatma, işlem türü
  "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const base: Permission[] = ["patient.read", "appointment.read", "task.read", "task.write", "treatment.read"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Yönetici unvanı tüm klinik sağlık içeriğine sınırsız erişim anlamına gelmez (§05).
  clinic_admin: [...base, "patient.write", "appointment.write", "audit.read", "team.manage", "schedule.manage", "settings.manage", "finance.read", "catalog.manage",
    "account.read", "finance.settings",
    "document.read", "document.revoke", "template.manage", "anamnesis.template", "file.read", "file.delete", "communication.write", "message.send",
    "integration.read", "integration.manage", "integration.approve",
    "lab.read", "lab.write", "lab.cost", "supplier.manage", "supplier.ledger", "stock.read", "stock.write", "stock.manage",
    "report.operations", "report.clinical", "report.analytics", "report.export", "audit.clinic",
    "import.manage", "export.clinic", "export.patient"],
  dentist: [...base, "patient.write", "patient.identity.unmask", "patient.health.read", "clinical_note.write", "anamnesis.write", "anamnesis.review", "anamnesis.template", "appointment.write", "audit.read",
    "treatment.write", "treatment.decision", "procedure.complete", "diagnosis.write",
    "document.read", "document.issue", "document.decision", "document.revoke", "file.read", "file.write", "file.delete", "communication.write",
    "followup.write", "readiness.exception", "lab.read", "lab.write", "lab.decide", "stock.read", "stock.write", "report.clinical"],
  // Sekreterya vezne işini yapar (tahsilat, avans dağıtımı) ama iade yapamaz ve gelir raporlarını göremez (§05).
  secretary: [...base, "patient.write", "patient.identity.unmask", "appointment.write", "treatment.decision", "account.read", "payment.write",
    "document.read", "document.issue", "document.decision", "file.read", "file.write", "communication.write", "message.send",
    "lab.read", "lab.write", "report.operations"],
  assistant: [...base, "patient.health.read", "anamnesis.write", "document.read", "file.read", "file.write", "lab.read", "lab.write", "stock.read", "stock.write"],
  finance: [...base, "finance.read", "account.read", "payment.write", "payment.refund", "receivable.write", "expense.write", "finance.settings", "invoice.write", "patient.identity.unmask", "message.send",
    "integration.read", "integration.approve", "lab.read", "lab.cost", "supplier.manage", "supplier.ledger", "commission.payout", "stock.read",
    "report.analytics", "report.export"],
  // Destek: teşhis için okuma; sağlık içeriği, kimlik açma, finans/işlem yazma YOK. Her istek denetim izinde (rol görünür).
  support: ["patient.read", "appointment.read", "task.read", "treatment.read", "audit.read", "audit.clinic", "integration.read", "lab.read", "stock.read", "report.operations"],
};

export function permissionsFor(role: Role): Set<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function can(role: Role, p: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(p);
}
