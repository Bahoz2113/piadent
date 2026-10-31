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
  "appointment.read",
  "appointment.write",
  "task.read",
  "task.write",
  "finance.read",
  "payment.refund",
  "audit.read",
  "team.manage",
  "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const base: Permission[] = ["patient.read", "appointment.read", "task.read", "task.write"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Yönetici unvanı tüm klinik sağlık içeriğine sınırsız erişim anlamına gelmez (§05).
  clinic_admin: [...base, "patient.write", "appointment.write", "audit.read", "team.manage", "settings.manage", "finance.read"],
  dentist: [...base, "patient.write", "patient.identity.unmask", "patient.health.read", "clinical_note.write", "appointment.write", "audit.read"],
  secretary: [...base, "patient.write", "patient.identity.unmask", "appointment.write"],
  assistant: [...base, "patient.health.read"],
  finance: [...base, "finance.read", "payment.refund", "patient.identity.unmask"],
};

export function permissionsFor(role: Role): Set<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function can(role: Role, p: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(p);
}
