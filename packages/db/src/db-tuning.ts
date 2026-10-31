/**
 * Süper kullanıcı gerektiren, veritabanı başına katalog ayarları (ADR-047). pg_dump bunları taşımaz; bu yüzden
 * `pnpm db:roles`, geri yükleme doğrulaması ve perf kurulumu bu adımı her hedef veritabanında uygular.
 *
 * textlike (LIKE, ~~) LEAKPROOF: RLS'li tablolarda sızdırmazlık işaretli olmayan operatör, güvenlik koşulundan önce
 * değerlendirilemediği için dizinde kullanılamaz; 100.000 hastada arama tam tablo taramasına düşer (≈100 ms/istek).
 * textlike yalnız desen (kullanıcının yazdığı arama metni) bozuksa hata verir, satır verisine göre hata/yan kanal üretmez.
 * RLS politikası aynen yürürlükte kalır; yalnız dizin kullanımı serbest kalır.
 */
import pg from "pg";

export async function applyDbTuning(adminUrl: string, database: string) {
  const u = new URL(adminUrl);
  u.pathname = `/${database}`;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  try {
    await c.query("alter function pg_catalog.textlike(text, text) leakproof");
  } finally { await c.end(); }
}
