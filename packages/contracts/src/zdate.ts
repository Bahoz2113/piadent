import { z } from "zod";

/**
 * Takvimsel geçerli ISO tarih (gg.aa.yyyy → yyyy-mm-dd). Tüm sözleşmeler bunu paylaşır.
 * Biçim regex'i 9999-99-99'u kabul ederdi; gerçek takvim kontrolü olmadan PostgreSQL ::date 500 verir (Görev 9 bulgusu).
 */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih gg.aa.yyyy biçiminde olmalı")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    if (m! < 1 || m! > 12 || d! < 1 || d! > 31 || y! < 1900 || y! > 2100) return false;
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
  }, "Geçerli bir tarih girin");
