/**
 * Parola politikası (denetim bulgusu): en az 10 karakter, en az 3 farklı karakter sınıfı değil — uzunluk ve yaygın kalıp denetimi
 * (NIST 800-63B yaklaşımı: karmaşıklık kuralı yerine uzunluk + bilinen zayıf parolalar). Ek: e-posta/ad parçası içeremez,
 * tek karakterin tekrarı veya ardışık dizi olamaz. Sunucu ve arayüz aynı kuralı kullanır.
 */
const COMMON = new Set(["1234567890", "0123456789", "qwertyuiop", "asdfghjkl1", "parola1234", "password12", "password123", "sifre12345",
  "viadent123", "viadent2026", "klinik1234", "dishekimi1", "1q2w3e4r5t", "abcdefghij", "iloveyou12", "12345678910"]);

export function passwordProblem(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < 10) return "Parola en az 10 karakter olmalı.";
  if (password.length > 200) return "Parola en çok 200 karakter olabilir.";
  const low = password.toLowerCase();
  if (COMMON.has(low)) return "Bu parola çok yaygın; başka bir parola seçin.";
  if (/^(.)\1+$/.test(low)) return "Parola tek karakterin tekrarı olamaz.";
  if (new Set(low).size < 4) return "Parola en az 4 farklı karakter içermeli.";
  const seq = "abcdefghijklmnopqrstuvwxyz0123456789";
  if (low.length <= 12 && (seq.includes(low) || [...seq].reverse().join("").includes(low))) return "Parola ardışık dizi olamaz.";
  const parts = [context.email?.split("@")[0], ...(context.name ?? "").split(/\s+/)].filter((p): p is string => !!p && p.length >= 4).map((p) => p.toLowerCase());
  if (parts.some((p) => low.includes(p))) return "Parola adınızı veya e-postanızı içeremez.";
  return null;
}
