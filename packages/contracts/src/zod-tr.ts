/**
 * Doğrulama mesajları Türkçe (API ve web aynı şemaları kullanır). Şemada özel mesaj verilmişse o kullanılır;
 * verilmemişse: eksik alan → “Bu alan zorunlu.”, diğerleri zod'un Türkçe yerel ayarı. (Görev 8: paketlenmiş API
 * duman testinde İngilizce “Invalid input” mesajı kullanıcıya ulaşıyordu.)
 */
import { z } from "zod";

z.config(z.locales.tr());
// Tarayıcıda JIT (new Function) kapalı: nonce'lu CSP 'unsafe-eval' vermez; zod'un eval denemesi her sayfada
// CSP ihlali raporu üretiyordu (Görev 8 E2E yakaladı). Sunucuda hızlı yol açık kalır.
if (typeof window !== "undefined") z.config({ jitless: true });
z.config({
  customError: (iss) => {
    if (iss.code === "invalid_type" && iss.input === undefined) return "Bu alan zorunlu.";
    if (iss.code === "invalid_type" && iss.input === null) return "Bu alan boş olamaz.";
    if (iss.code === "invalid_format" && iss.format === "uuid") return "Geçersiz kimlik.";
    return undefined;
  },
});
export {};
