/**
 * VİADENT varsayılan rol → izin matrisi (Plan §05). Bu tablo SUNUCUDA uygulanır;
 * arayüzde düğme gizlemek yalnız kolaylıktır, güvenlik değildir.
 */
export const ROLES = ["clinic_admin", "dentist", "secretary", "assistant", "finance"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  clinic_admin: "Klinik yöneticisi",
  dentist: "Hekim",
  secretary: "Sekreterya",
  assistant: "Asistan",
  finance: "Finans",
};

export const PERMISSIONS = [
  "patient.read",            // kimlik/iletişim özeti (maskeli)
  "patient.write",
  "patient.identity.unmask", // tam kimlik no / telefon
  "patient.health.read",     // anamnez, klinik not
  "clinical_note.write",
  "anamnesis.write",         // anamnez yanıtı kaydetme (yeni sürüm)
  "anamnesis.review",        // hekim onayı
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
  "account.read",            // hasta hesabı: alacak, ödeme, avans, iade (VİA Net, hasta bazlı)
  "payment.write",           // tahsilat kaydı ve avans dağıtımı
  "payment.refund",          // iade (dağıtım ters kaydı dahil)
  "receivable.write",        // elle alacak, alacak iptali
  "expense.write",           // gider ve gider ters kaydı
  "finance.settings",        // kasa/banka hesapları, prim kuralı sürümleri
  "audit.read",
  "team.manage",
  "schedule.manage",         // hekim/koltuk, çalışma saati, kapatma, işlem türü
  "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const base: Permission[] = ["patient.read", "appointment.read", "task.read", "task.write", "treatment.read"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Yönetici unvanı tüm klinik sağlık içeriğine sınırsız erişim anlamına gelmez (§05).
  clinic_admin: [...base, "patient.write", "appointment.write", "audit.read", "team.manage", "schedule.manage", "settings.manage", "finance.read", "catalog.manage",
    "account.read", "finance.settings"],
  dentist: [...base, "patient.write", "patient.identity.unmask", "patient.health.read", "clinical_note.write", "anamnesis.write", "anamnesis.review", "appointment.write", "audit.read",
    "treatment.write", "treatment.decision", "procedure.complete", "diagnosis.write"],
  // Sekreterya vezne işini yapar (tahsilat, avans dağıtımı) ama iade yapamaz ve gelir raporlarını göremez (§05).
  secretary: [...base, "patient.write", "patient.identity.unmask", "appointment.write", "treatment.decision", "account.read", "payment.write"],
  assistant: [...base, "patient.health.read", "anamnesis.write"],
  finance: [...base, "finance.read", "account.read", "payment.write", "payment.refund", "receivable.write", "expense.write", "finance.settings", "patient.identity.unmask"],
};

export function permissionsFor(role: Role): Set<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function can(role: Role, p: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(p);
}
