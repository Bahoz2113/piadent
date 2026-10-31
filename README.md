# VİADENT

Diş klinikleri için çok kiracılı klinik ERP. *Kliniğin akışı, tek yerde.*

> Bu depo geliştirme aşamasındadır ve **yalnız sentetik veri** içerir. Gerçek hasta verisi, üretim sırrı veya ücretli servis gerektirmez. Satışa/canlıya hazır değildir — bkz. `docs/verification.md`.

## Gereksinimler
- Node.js **22 LTS** (≥ 22.12)
- pnpm **10** (`corepack enable` ile gelir)
- Docker Desktop (yerel PostgreSQL 16 için) — veya kurulu bir PostgreSQL 16

## Kurulum (ilk kez)
```bash
corepack enable
pnpm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
```
`.env` içindeki `CHANGE_ME_*` değerlerini yerel parolalarla değiştirin ve `VIADENT_SECRET_KEY` için `.env.example`'daki komutla bir anahtar üretin (seed ve VİA Köprü sağlayıcı sırlarını bununla şifreler; boşsa seed durur). Docker kullanıyorsanız `ADMIN_DATABASE_URL` parolası `infra/docker-compose.yml` içindeki `POSTGRES_ADMIN_PASSWORD` (varsayılan `viadent_local_admin`) ile aynı olmalı.

```bash
pnpm db:up        # PostgreSQL'i Docker'da başlatır
pnpm db:roles     # viadent_owner / viadent_app / viadent_worker rolleri + viadent ve viadent_test veritabanları
pnpm db:migrate   # şemayı kurar (RLS dahil)
pnpm db:seed      # iki sentetik klinik; parola .demo-credentials dosyasına yazılır
```

## Çalıştırma (üç terminal)
```bash
pnpm dev:api      # http://127.0.0.1:4000/api/v1
pnpm dev:worker   # outbox + VİA Köprü dış işleri (MOCK) + VİA Akış taraması
pnpm dev:web      # http://localhost:3000
```

### Demo hesapları (sentetik)
Parola: `.demo-credentials` dosyasında (veya `.env` içindeki `VIADENT_DEMO_PASSWORD`).

| E-posta | Klinik | Rol |
|---|---|---|
| yonetici@demo-yesil.test | Yeşilvadi (Demo) | Klinik yöneticisi |
| elif.aras@demo-yesil.test | Yeşilvadi (Demo) | Hekim |
| sekreter@demo-yesil.test | Yeşilvadi (Demo) | Sekreterya |
| asistan@demo-yesil.test | Yeşilvadi (Demo) | Asistan |
| finans@demo-yesil.test | Yeşilvadi (Demo) | Finans |
| yonetici@demo-mavi.test | Mavikent (Demo) | Klinik yöneticisi |
| hekim@demo-mavi.test | Mavikent (Demo) | Hekim |
| coklu@demo.test | İki klinik | Hekim + yönetici (klinik değiştirme denemesi) |

Sıfırlamak için: `pnpm db:reset && pnpm db:seed`.

## Test
```bash
pnpm typecheck
pnpm test                         # API testleri viadent_test veritabanını her koşuda yeniden kurar
cd apps/web && npx playwright install chromium   # ilk kez
E2E_PASSWORD=<demo parolası> npx playwright test # API + web çalışırken
```

## Neler çalışıyor
- Oturum, çok klinikli üyelik, klinik değiştirme, erişim kaldırma, **ekip daveti ve rol değişikliği** (sunucu tarafı, her istekte doğrulanır)
- PostgreSQL RLS ile tenant izolasyonu (uygulama rolü RLS'i atlayamaz)
- Hasta kaydı, Türkçe karakterden bağımsız arama, mükerrer aday uyarısı, rol bazlı maskeleme, **yakın/veli ve yasal temsil**
- Ajanda: gün ve **hafta** görünümü, mobil gün listesi, DB seviyesinde çakışma engeli, **çalışma saatleri, kapatmalar, işlem türleri**
- **Sürümlü anamnez** ve hekim onayı (soru seti DEMO), minimum klinik not
- **VİA Akış** (5 görev türü), **VİA İz** (hasta geçmişi)

Davet bağlantısı e-postayla gönderilmez (sağlayıcı bağlı değil); Yönetim > Ekip'te oluşturulan bağlantıyı kişiye kendiniz iletin.

Kalan işler: `docs/backlog.md`. Mimari: `docs/architecture.md`. Devir notu: `docs/handoff.md`.

## Depo yapısı
```
apps/api        NestJS API        apps/web     Next.js arayüz      apps/worker   arka plan işçisi
packages/contracts  şemalar, izinler      packages/db  migration, seed, VİA Akış     docs/  belgeler
```
