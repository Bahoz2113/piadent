/**
 * Alan düzeyinde şifreleme (ADR-059): T.C. kimlik no gibi yüksek riskli tanımlayıcılar veritabanında şifreli saklanır
 * (ADR-052 anahtar halkasıyla), eşitlik araması ve benzersizlik için anahtarlı özet (HMAC) dizini tutulur.
 *  - HMAC anahtarı güncel uygulama anahtarından HKDF ile türetilir (bilgi: "viadent/national-id-index/v1"); kiracı kimliği
 *    girdiye katılır → klinikler arası korelasyon yapılamaz, aynı kimlik iki klinikte farklı özet verir.
 *  - Anahtar döndürmede (rotate-keys) şifreli değer çözülüp yeniden şifrelenir ve özet yeniden hesaplanır.
 *  - Veritabanı dökümü ele geçse de kimlik numaraları açık değildir; anahtar yalnız uygulama ortamındadır.
 */
import { createHmac, hkdfSync } from "node:crypto";
import { currentKeyBuffer, decryptSecret, encryptSecret } from "./bridge.js";

export const encryptField = (plain: string): string => encryptSecret(plain);
export const decryptField = (blob: string): string => decryptSecret(blob);

function indexKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", currentKeyBuffer(), "viadent", "viadent/national-id-index/v1", 32));
}
/** Eşitlik araması için deterministik, kiracıya bağlı özet (hex, 64 karakter). */
export function indexHash(tenantId: string, value: string): string {
  return createHmac("sha256", indexKey()).update(`${tenantId}\u0000${value.trim()}`).digest("hex");
}
