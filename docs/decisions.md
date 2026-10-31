# Karar kayıtları (ADR)

Biçim: bağlam → karar → sonuç. “VİADENT tasarım kararı” olarak işaretlenen her şey rakipte gözlenmiş davranış değildir.

## ADR-001 Modüler monolit, TypeScript yığını (22.10.2026)
Boş depo; plan Next.js + NestJS + PostgreSQL + worker öneriyor. **Karar:** pnpm workspace monorepo; `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`, `packages/db`. Mikroservis yok. **Sonuç:** iş kuralları tek API'de; worker aynı `packages/db` kodunu kullanır.

## ADR-002 Sürüm sabitleme: olgun majör hatlar
22.10.2026'da npm'de Next 16.4, NestJS 12.2, TypeScript 7.0 en yeni. Nest dekoratör/DI ekosistemi ve TS 7 (yerel derleyici) uyumu bu oturumda doğrulanamadı. **Karar:** desteklenen ve güncel yama alan hatlar sabitlendi: Next 15.5.28, NestJS 11.2.7, TS 5.9.3, React 19.1.10, Vitest 3.2.7. Lockfile commit'te. **Sonuç:** yükseltme ayrı ADR + tam test koşusuyla yapılır.

## ADR-003 Ham SQL migration + `pg`, ORM yok
RLS, exclusion constraint, kısmi tekil indeks ve transaction-local bağlam doğrudan SQL ile daha denetlenebilir. **Karar:** `packages/db/migrations/NNNN_*.sql`, checksum'lı çalıştırıcı; uygulanmış migration değiştirilemez (değişirse çalıştırıcı durur). **Sonuç:** tip güvenliği servis katmanında; ileride Kysely benzeri sorgu oluşturucu değerlendirilebilir.

## ADR-004 Tenant bağlamı ve RLS
**Karar:** tenant, oturumdaki aktif üyelikten çözülür; her istek transaction'ında `set_config('app.tenant_id', $1, true)`. RLS `ENABLE + FORCE`; üç ayrı DB rolü (owner/app/worker). Kimlik tabloları (`users`, `sessions`) RLS dışı ama hasta verisi içermez. **Sonuç:** bağlam olmadan sorgu 0 satır döner (testli); havuzda bağlam sızmaz (testli).

## ADR-005 Oturum: sunucu tarafı oturum + HttpOnly çerez + CSRF başlığı
JWT yerine iptal edilebilir sunucu oturumu (AT-20 için gerekli). Token 32 bayt rastgele, DB'de yalnız SHA-256. Çerez `HttpOnly; SameSite=Lax; Secure (üretim)`. Değiştiren isteklerde `x-viadent-request: 1`. Web ve API aynı origin (Next rewrite). MFA (yönetici/destek) Görev 7 öncesi.

## ADR-006 Eski sekme koruması (AT-15)
**Karar:** istemci sayfa yüklendiğindeki üyelik kimliğini `x-viadent-context` ile gönderir; sunucu aktif üyelikle uyuşmazsa 409 `CONTEXT_CHANGED`. Klinik değişince istemci tam sayfa yeniden yüklenir (bellek önbelleği temizlenir). **VİADENT tasarım kararı.**

## ADR-007 Giriş hız sınırı bellek içi
Tek süreç için 15 dk'da 5 hatalı deneme / e-posta+IP. Çok örnekli dağıtımda paylaşılan depoya (PostgreSQL tablosu) taşınacak — Görev 7 öncesi açık iş.

## ADR-008 Kimlik numarası saklama
TCKN/pasaport düz metin sütunda; API'de role göre maskeli; audit'e maskeli yazılır; RLS ile izole. TCKN için yalnız algoritmik biçim kontrolü (resmî doğrulama değil). **Açık:** sütun düzeyinde şifreleme + arama için HMAC — pilot öncesi güvenlik incelemesinde karar verilecek.

## ADR-009 Mükerrer hasta politikası
Telefon benzersiz anahtar değildir (aile ortak numara → yalnız bilgi uyarısı). Engelleyen durumlar: aynı kimlik no (409 `DUPLICATE_IDENTITY`). Onay isteyen durumlar: benzer ad (trigram ≥ 0.6) + aynı doğum tarihi veya aynı ad + aynı telefon (409 `DUPLICATE_CANDIDATES`, `acknowledgeDuplicates: true` ile bilinçli kayıt). **VİADENT tasarım kararı**; eşikler pilot hekim/sekreterle sınanacak (Ek C).

## ADR-010 VİA Akış ilk görev türleri
Kaynak envanterde görev listesi yok; tasarım bizim. İlk türler: geciken geliş (10 dk), yarınki teyit, eksik iletişim. Başlıkta hasta adı saklanmaz (okuma anında birleştirilir). Eşikler klinik ayarına taşınacak (Görev 1).

## ADR-011 Klinik not ilk dilimi
AT-02 ve VD-006 başlangıcı için yalnız-ekleme klinik not + gerekçeli düzeltme bağı. Ziyaret bağı, taslak otomatik kaydı, anamnez sürümleri Görev 1. Demo içerik sentetik.

## ADR-012 Arayüz yazı tipi ve ikonlar
Lisans doğrulanmadan web fontu gömülmedi; sistem yazı tipi yığını (Segoe UI / system-ui / Roboto / Noto Sans) Türkçe glifleri destekliyor. İkonlar `lucide-react` (ISC). Lisansı doğrulanmış bir font (ör. OFL) yerel olarak barındırılarak eklenebilir.

## ADR-013 Henüz geliştirilmemiş modüllerin gösterimi
Tedavi/Finans/Operasyon/Raporlar menüde “Plan” etiketiyle; sayfada gerçek durum ve planlanan kapsam yazılı. Sahte rakamlı “hazır” ekran gösterilmez (Plan §09).

## ADR-014 Seed parolası
Parola koda/seed'e gömülmez. `VIADENT_DEMO_PASSWORD` yoksa rastgele üretilir ve git dışı `.demo-credentials` dosyasına (0600) yazılır. Test veritabanı ayrı (`viadent_test`) ve yalnız testte kullanılan sentetik parolayla kurulur.
