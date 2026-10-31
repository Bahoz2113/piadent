# Mimari

## Genel görünüm
TypeScript **modüler monolit** (Plan §07). Mikroservis yok; iş kuralları tek yerde (API).

```
apps/web      Next.js 15 (App Router) — arayüz. /api/* isteklerini API'ye ters proxy'ler (aynı origin).
apps/api      NestJS 11 + Express 5 — REST /api/v1. Tüm iş kuralları, yetki ve audit burada.
apps/worker   Arka plan işçisi — outbox tüketimi + periyodik PİA Akış taraması.
packages/contracts  Paylaşılan zod şemaları, rol/izin matrisi, Türkçe metin ve saat dilimi yardımcıları.
packages/db   SQL migration'lar, migration çalıştırıcı, rol kurulumu, sentetik seed, tenant bağlam yardımcısı, PİA Akış üreticisi.
infra/        Yerel geliştirme docker-compose (PostgreSQL 16).
docs/         Ürün ve teknik belgeler.
```

Planlanan ama henüz eklenmemiş: `packages/ui` (bileşenler şimdilik `apps/web/components`), `packages/config`, S3 uyumlu özel dosya deposu (Görev 4).

## İstek akışı
1. Tarayıcı → `web` (`/api/v1/...`) → Next rewrite → `api` (127.0.0.1:4000).
2. `ApiExceptionFilter` + correlation-id ara katmanı; her yanıtta `x-correlation-id`, `cache-control: no-store`.
3. `AuthGuard` (global):
   - Değiştiren isteklerde `x-viadent-request: 1` zorunlu (CSRF; çerez `SameSite=Lax`, `HttpOnly`).
   - `vd_session` çerezi → token SHA-256 özeti → `sessions` (düz token saklanmaz).
   - Oturumdaki aktif üyelik **her istekte** yeniden doğrulanır (iptal → anında 403, AT-20).
   - `x-viadent-context` başlığı sayfanın yüklendiği üyelikle oturumun aktif üyeliğini karşılaştırır; uyuşmazsa 409 `CONTEXT_CHANGED` (eski sekme koruması, AT-15). Değiştiren isteklerde başlık zorunlu.
   - Rol → izin matrisi (`packages/contracts/src/permissions.ts`) sunucuda uygulanır.
4. Servis, `Db.tx(ctx, fn)` ile transaction açar: `set_config('app.tenant_id', …, true)` (transaction-local). Domain değişikliği + audit + outbox aynı transaction'da yazılır.
5. Tenant kimliği **hiçbir zaman istemciden alınmaz**; doğrulanmış üyelikten türetilir.

## Çok kiracılı güvenlik (iki katman)
1. **Uygulama katmanı:** tenant bağlamı üyelikten; tüm sorgular bağlamlı transaction içinde.
2. **PostgreSQL RLS:** tenant tablolarında `ENABLE` + `FORCE ROW LEVEL SECURITY`, politika `tenant_id = app.tenant_id()`. Bağlam yoksa varsayılan red.
   - Roller: `viadent_owner` (tablo sahibi, yalnız migration/seed), `viadent_app` (API; NOSUPERUSER, NOBYPASSRLS, tablo sahibi değil), `viadent_worker` (işçi; yalnız tenant listesi ve outbox için ek politika).
   - Bileşik yabancı anahtarlar `(tenant_id, id)`: farklı kliniğin hastasına randevu/not bağlanamaz.
   - `audit_events` uygulama rolüyle yalnız INSERT/SELECT; UPDATE/DELETE tetikleyiciyle de engelli.
   - Testler: `apps/api/test/tenant-isolation.test.ts`.

## Ajanda çakışması
`appointments` üzerinde iki `EXCLUDE USING gist` kısıtı (hekim ve koltuk), aralık `tstzrange(starts_at, ends_at, '[)')`, `status <> 'cancelled'`. Eşzamanlı isteklerde yalnız biri başarılı olur; diğeri 409 `APPOINTMENT_CONFLICT` (AT-03, 6 eşzamanlı istekle test edildi).

## PİA Akış
`packages/db/src/via-akis.ts`. Görev türleri: `overdue_checkin` (bugünkü planlı/teyitli randevu saati 10 dk geçti), `contact_pending` (yarınki planlı randevu, iletişim yok), `missing_contact` (7 gün içinde randevusu olan, telefonu ve e-postası olmayan hasta). Kısmi tekil indeks `(tenant_id, dedupe_key) WHERE status IN (open, in_progress, blocked)` ile tekrar oluşmaz. Kaynak koşul çözülünce görev `closed_reason` ile kapanır.
Tetikleme: API yazımlarında outbox `via_akis.refresh` → işçi (2 sn yoklama, `FOR UPDATE SKIP LOCKED`, üstel geri çekilme, 8 denemede `dead`). Zamana bağlı koşullar için işçi her 60 sn tüm tenant'ları tarar. Kullanıcı “Listeyi yenile” ile de tetikleyebilir.

## Saat ve para
- Olay zamanı `timestamptz` (UTC); klinik saat dilimi `tenants.timezone`. Arayüz klinik saatinde gösterir. Gün filtreleri `[00:00, ertesi 00:00)` klinik saatiyle hesaplanır.
- `date` türü (doğum tarihi) dönüşümsüz metin olarak taşınır (`pg` tip ayrıştırıcı 1082).
- Para: Görev 3'te `numeric` + API'de ondalık metin; JS kayan nokta ile toplama yapılmayacak.

## Hata sözleşmesi
`{ code, message, field_errors?, details?, correlation_id }`. Kullanıcıya SQL/token/hasta verisi gösterilmez. 5xx loglarında yalnız hata türü/kodu ve correlation-id; istek gövdesi loglanmaz.

## Sürümler (22.10.2026 npm kaydından doğrulandı, lockfile ile sabit)
Node 22 LTS · pnpm 10.28 · TypeScript 5.9.3 · NestJS 11.2.7 · Express 5 · Next.js 15.5.28 · React 19.1.10 · zod 4.6.7 · pg 8.23.1 · PostgreSQL 16 · Vitest 3.2.7 · Playwright 1.64.1. Daha yeni majörler (Nest 12, Next 16, TS 7) için bkz. ADR-002.

## Bilinen mimari açıklar (bilinçli, sırası belli)
- Dosya deposu (S3 uyumlu, özel) ve virüs taraması: Görev 4.
- Idempotency-Key altyapısı: Görev 3 (finans komutlarıyla birlikte).
- Üretim derlemesi: API/worker şimdilik `tsx` ile çalışıyor; üretim paketlemesi Görev 7.
- Giriş hız sınırı bellek içi (tek süreç) — ADR-007.
- Kimlik numarası sütun düzeyinde şifreli değil (maskeli gösterim + RLS) — ADR-008.
