# Backlog

Durum sözlüğü: **tamamlandı** = kabul kriteri sağlandı ve test edildi · **kısmi** = ilk dikey dilim çalışıyor, kalanı yazılı · **açık** = başlanmadı · **engelli** = dış erişim bekliyor.

| İş | Durum | Kanıt / kalan |
|---|---|---|
| VD-001 Depo ve geliştirme kurulumu | **tamamlandı** | README ile kurulum, `db:roles/migrate/seed`, typecheck, test komutları çalışıyor. CI yapılandırması yok (açık). |
| VD-002 Tenant ve rol temeli | **kısmi** | UI/API çapraz tenant negatif testleri ✔, RLS testleri ✔, worker kısıtlı rol ✔. Dosya erişimi Görev 4'te (dosya modülü yok). |
| VD-003 Tasarım sistemi ve kabuk | **kısmi** | Tokenlar, kabuk, form/tablo/çekmece/rozet, boş/yükleme/hata/yetkisiz durumları, klavye odağı, kontrast testi ✔. Bileşenler `packages/ui`'ye taşınmadı; Storybook benzeri örnek sayfası yok. |
| VD-004 Hasta kayıt ve arama | **tamamlandı** (ilk kapsam) | Kalıcı kayıt, maskeli arama, mükerrer aday, tarih doğrulama, audit, sürüm kontrolü — testli. Veli/yakın ilişkisi Görev 1. |
| VD-005 Ajanda ve kaynaklar | **kısmi** | DB seviyesinde çakışma (AT-03) ✔, mobil gün listesi ✔, durum/iletişim ayrımı ✔. Çalışma saatleri, kapatma, hafta görünümü, sürükle-bırak, kaynak yönetim ekranı açık. |
| VD-006 Anamnez ve klinik not | **kısmi** | Yalnız-ekleme not + gerekçeli düzeltme, yetki ✔. Anamnez sürümleri, ziyaret bağı, kaydedilmemiş değişiklik uyarısı (çekmecede var) açık. |
| VD-007 Plan ve odontogram | açık | Görev 2 |
| VD-008 Gerçekleşen işlem ve hesap | açık | Görev 2 |
| VD-009 Ödeme, dağıtım, iade | açık | Görev 3 |
| VD-010 VİA Akış / Net / İz | **kısmi** | Akış (3 tür, dedupe, otomatik kapanış, rol filtresi) ✔; İz (hasta bazlı, maskeli, rol kontrollü) ✔; Net Görev 3. |
| VD-011 Dosya ve belge sürümü | açık | Görev 4 |
| VD-012 Outbox ve entegrasyon merkezi | **kısmi** | Outbox + retry/backoff + dead durumu (iç olaylar) ✔. Dış sağlayıcı adaptörleri, webhook, idempotency Görev 5. |
| VD-013 Laboratuvar ve prim | açık | Görev 6 |
| VD-014 İçe aktarma ve pilot | açık | Görev 7 |

## Sıradaki tek iş paketi
**Görev 1 — Hasta ve ajanda dilimini tamamla:** çalışma saatleri + kapatma (T05/T06) ve çakışma; varsayılan işlem süresi (T04); veli/yakın ilişkisi (H03); sürümlü anamnez ve kritik uyarının hasta başlığında gösterimi (H07/H02); hekim/koltuk yönetim ekranı (T14); kullanıcı daveti ve rol değişikliği (T20); hafta görünümü. Testler: AT-01..04, AT-15, AT-18, AT-20 genişletilmiş.

## Küçük açık işler
- CI (GitHub Actions: PostgreSQL servisiyle `pnpm test`).
- Randevu oluşturmada Idempotency-Key (çift tık zaten arayüzde engelli; ağ tekrarına karşı).
- VİA Akış eşiklerini klinik ayarına taşıma.
- Giriş hız sınırını DB'ye taşıma (ADR-007).
- AT-19 tam senaryosu (rapor) Görev 3/6; gün sınırı birim testi var.
- Tarayıcı yerel ayarında `<input type="date">` biçimi işletim sistemine bağlı; özel tarih seçici değerlendirilecek.
