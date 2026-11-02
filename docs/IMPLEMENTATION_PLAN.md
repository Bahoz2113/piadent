# IMPLEMENTATION_PLAN — PİA-DENT (Faz 0 çıktısı, 02.11.2026)

Kaynaklar: `PiaDent_Claude_Eksik_Tamamlama_Nihai_Dosyasi.pdf`, `PiaDent_Mevcut_Surum_Inceleme_Raporu.pdf`, `docs/GAP_MATRIX.md`. Kural: P2 işi P0 bitmeden başlamaz; her faz CEZERİ teslim testiyle kapanır; "tamamlandı" yalnız kabul ölçütü + çalıştırılmış test ile. Üretim dağıtımı kullanıcı onayıyla.

## Faz 0 — Envanter (BU BELGE) ✔
Çıktılar: `CURRENT_STATE.md`, `GAP_MATRIX.md`, bu plan. Kod değişikliği yok.
**Karar (02.11.2026):** marka yazımı **PİA-DENT** (ürün sahibi teyit etti).

## Faz 1 — Klinik çekirdek tamamlama (P0/P1)
| İş | Kapsam | Kabul ölçütü |
|---|---|---|
| 1.1 Anamnez şablonu yönetimi (D3) ✔ 02.11 (ADR-084; API 5, E2E 1) | `anamnesis_templates` (sürümlü, yayın/emeklilik, tenant), yönetim ekranı; mevcut anamnez kayıtları şablon sürümüne bağlanır | Yönetici şablon yayınlar → hekim yeni anamnezde o soruları görür; eski kayıtlar değişmez; API testi + E2E |
| 1.2 Klinik çıktı şablonları (D4) ✔ 02.11 (ADR-085; API 4, E2E 1) | Belge motoruna `clinical_output` kategorisi: epikriz, hasta bilgi föyü, reçete (ilaç listesi serbest metin; e-reçete YOK) | Hasta 360 → Belgeler'den üret/yazdır; marka başlığı; sağlık verisi rol kontrolü; test |
| 1.3 Hasta 360 küçük açıklar | Kayıt geçmişi sekmesinde filtre; süt dişi görünümü için E2E | E2E `telefon-360` + masaüstü geçer |
Çıkış kapısı: CEZERİ koşusu, yeni V-vakası: "anamnez şablonu sürümü değişince eski kayıt bozulmaz".

## Faz 2 — Finans çekirdek (P0)
| İş | Kapsam | Kabul ölçütü |
|---|---|---|
| 2.1 **Tahsilat makbuzu (B4)** ✔ 02.11 (ADR-081; API 9 test, E2E 2) | Her tahsilat/iade için `receipt_no` (tenant+yıl sıralı, boşluksuz), yazdırılabilir makbuz (printHeaderHtml), Finans sekmesinde "Makbuz" düğmesi, denetim kaydı | Aynı tahsilat tekrar yazdırılınca aynı no; iade makbuzu ters işareti gösterir; test: numaralandırma eşzamanlılık (2 oturum) |
| 2.2 **Fatura taslağı iç modeli (B5)** ✔ 02.11 (ADR-083; API 9, E2E 2) | `invoices` (draft/issued-mock/cancelled), kalem = alacak/işlem, KDV oranı, seri/no yalnız sağlayıcı yanıtıyla; UI'da "Taslak — e-belge sağlayıcısı bağlı değil" etiketi | Gerçek numara üretilmez; gönder düğmesi sağlayıcı yokken pasif + açıklama; test |
| 2.3 Mali müşavir dışa aktarımı (B10) ✔ 02.11 (rapor `muhasebe-donem`, test) | CSV: tahsilat/iade/gider/ prim dönem raporu | Rapor kataloğuna eklenir; CSV tutarları `finance/summary` ile birebir |
Çıkış kapısı: CEZERİ P01 genişletilir (makbuz no), yeni P04 "fatura taslağı sahte başarı üretmez".

## Faz 3 — Entegrasyon adaptör iskeleti (P1, sözleşme kapılı)
- Sağlayıcı arayüzleri sabit (`IntegrationAdapter`): SMS, WhatsApp, PSP, e-belge, e-Nabız. Her biri için **yalnız** mock + sözleşme testi ("contract test"); gerçek anahtar/env tanımı belgelenir, kod sağlayıcı yokken `mock:false` → özellik pasif.
- Kabul: hiçbir yol gerçek mesaj/ödeme göndermez; `VIADENT_EXTERNAL_SEND_ENABLED=0` iken worker dış çağrıyı reddeder (test var, genişletilir).
- Gerçek sağlayıcıya geçiş bu planın dışında, ayrı insan kapısı (release-gates §3).

## Faz 4 — Operasyon, raporlar, PİA Akış, UX (P1/P2)
| İş | Kabul |
|---|---|
| 4.1 Rapor kartlarında ham kodları kaldır (D2) | `sourceIds` yalnız `title` ipucunda/denetim ihracında; E2E "R\d\d" metni ana içerikte yok |
| 4.2 Rapor XLSX çıktısı (D1) | CSV ile aynı satır/toplam; xlsx testi |
| 4.3 PİA Akış SLA/yükseltme (C5) | `due_at` aşımında görev `overdue`, yönetici kuyruğuna kopya, Bugün ekranında sayaç; worker testi |
| 4.4 Mobil tablo kart görünümü (D5) | ≤480px'te öncelikli kolonlar kart; axe + E2E telefon-360 |
| 4.5 İşlem başına stok sarf reçetesi (C4) | Katalog kalemine sarf listesi; işlem tamamlanınca otomatik `usage` (geri alınabilir) |
| 4.6 `docs/kilavuz` ekran görüntüleri yeni marka | Betikle yeniden üretim |
| 4.7 Görünüm kişiselleştirme (D7) ✔ 02.11 (ADR-082) | Vurgu paleti/şema/ölçek kullanıcı düzeyi; her palet × şema AA kontrast testi; koyu şemada axe |
Çıkış kapısı: tam CEZERİ koşusu, TESLİME ADAY; ardından insan kapıları.

## Riskler
- Marka kararı gecikirse Faz 1-2 metinleri iki kez değişir → önce karar.
- Makbuz numaralandırma sıralı/boşluksuz olmalı (mali denetim) → `tenant_id, year` kilitli sayaç tablosu.
- Supabase pooler (6543) ile uzun transaction/advisory lock kısıtları → sayaç için `select … for update`, advisory lock değil.
- Anahtar döndürme pilot öncesi zorunlu (handoff).

## Test planı (her faz)
`pnpm typecheck` → `pnpm --filter @viadent/api test` → web/contracts birim → `npx playwright test` (iki proje, temiz seed) → `cezeri-teslim-testi` koşusu → gate 0 → insan onayı.
