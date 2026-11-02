# CURRENT_STATE — PİA-DENT mevcut durum (Faz 0, 02.11.2026, sürüm `08c71a5`)

## Yığın
- pnpm monorepo · Node 22 · API: NestJS 11 · Web: Next.js 15.5 (App Router; `pages/api/v1/[[...path]]` ile serverless köprü) · DB: PostgreSQL 16 (yerel) / 17 (Supabase) · Test: Vitest + Playwright 1.64 (masaüstü + telefon-360 projeleri).
- Paketler: `@viadent/contracts` (zod şemaları, etiket tabloları, rapor tanımları), `@viadent/db` (migration, pool guard), `apps/api`, `apps/web`, `apps/worker` (kuyruk/iş motoru).
- Kod kimlikleri (`@viadent/*`, `viadent_*` DB rolleri, `VIADENT_*` env, `x-viadent-*` başlıklar) bilinçli olarak değiştirilmedi; görünen marka PİA-DENT (ADR-079/080).

## Modüller ve uç sayısı
28 controller / ~212 uç (`docs/GAP_MATRIX.md` kanıt satırları). Alanlar: auth+MFA, team/security, patients/relations, clinical (anamnez, bulgu), treatment (katalog/tarife, odontogram, plan), finance (hesap, kasa, gider, prim), operations (lab, stok, tedarikçi), documents (şablon, belge, dosya, bakım/iletişim), bridge (entegrasyon mock, webhook, online ödeme), reports (19 rapor + CSV), tasks (PİA Akış), pilot (içe/dışa aktarma), ops (bootstrap).

## Veri modeli
20 migration (`packages/db/migrations/0001…0020`), hepsi uygulanmış; değişiklik yalnız yeni dosyayla. Her iş tablosu `tenant_id` + RLS (ENABLE+FORCE) + bileşik FK. Durum makineleri DB tetikleyicisiyle korunur (plan sürümü `0003:219`, lab iş emri `0007:117`). Para `numeric`, silme yerine ters kayıt.

## Ekranlar (13 sayfa)
`/giris`, `/davet/[token]`, `/bugun`, `/ajanda`, `/hastalar`, `/hastalar/[id]` (Tedavi · Finans · Belgeler · İletişim · Laboratuvar · Geçmiş), `/tedavi`, `/finans`, `/operasyon`, `/raporlar`, `/yonetim`, `/hesabim`. Rota bazlı başlıklar "X · PİA-DENT".

## Testler (çalıştırılmış, 31.10.2026 CEZERİ koşusu)
- API: 24 dosya / 293 `it()` — 260/260 geçti (tenant izolasyonu, pentest, izinler, QA-001 regresyonu dahil).
- Contracts 15, Web birim 25, E2E 17 spec / 46 test — temiz seed ile 76 geçti.
- CEZERİ teslim testi `qa-runs/qa-20261031-1706-0309309/`: 5 tur, 7 bulgu (2×S1) VERIFIED, **TESLİME ADAY (teknik)**. İnsan kapıları açık (UAT, KVKK/hukuk, mali müşavir, sızma testi).

## Ortam
`.env.example` 31 değişken (gizli değer yok). Canlı demo: Vercel (`viadent-demo.vercel.app`) + Supabase (eu-central-1, pooler 6543/5432). `VIADENT_DEMO_BOOTSTRAP=0`. Dış gönderim kapalı (`VIADENT_EXTERNAL_SEND_ENABLED`). **Tüm anahtarlar pilot öncesi döndürülmeli.**

## Bilinen açıklar (özet; ayrıntı GAP_MATRIX)
Makbuz çıktısı yok · fatura taslağı iç modeli yok (e-belge sağlayıcısı sözleşmeye bağlı) · anamnez şablonu yönetimi yok · rapor kartlarında ham kaynak kodları · PİA Akış SLA/yükseltme yok · rapor XLSX/PDF yok · mobil tablolar kart görünümüne düşmüyor · marka yazımı kararı (PİA-DENT ↔ PiaDent) bekliyor · `docs/kilavuz` ekran görüntüleri eski marka.
