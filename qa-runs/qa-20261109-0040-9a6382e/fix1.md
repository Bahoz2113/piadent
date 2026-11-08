# Düzeltme paketi 1 — QA-601 (tur 1)

Sürüm 9a6382e (koşu HEAD ad5ac6c; ürün kodu aynı). Tester ürün kodunu değiştirmedi.

## QA-601 (S3, FLAKY — test kodu saat penceresi), sorumlu: geliştirme
**Gözlem:** R01 tur 1 (09.11.2026 ~00:30 İstanbul): `apps/api/test/gorev13.test.ts` "ADR-073: PİA Akış eşikleri klinik ayarı" → `expected [] to deeply equal [a40]`. Önceki koşularda (gündüz) geçti.
**Kanıt:** evidence/tur1/R01-api.log.
**Kök neden (koddan):** Test randevuları gerçek `now`'a göre 20 ve 40 dk önce oluşturuyor ve `refreshViaAkis(c, tenantA, now)` çağırıyor. Gece yarısından sonraki ~45 dk içinde 40 dk önceki randevu bir önceki takvim gününe düşüyor; "geciken geliş" kuralı yalnız klinik saat dilimindeki bugünün randevularına bakıyor → görev oluşmuyor. Ürün davranışı (günü geçmiş randevuyu "geciken geliş" saymamak) bu bulgunun konusu değil; test günün saatine bağımlı.
**Beklenen:** Test saatten bağımsız olsun: referans an (`now`) bugünün klinik saat dilimindeki öğle saatine (ör. 12:00 Europe/Istanbul) sabitlenip randevular ona göre kurulsun ve `refreshViaAkis(..., now)` aynı anla çağrılsın (hekim seçimindeki `now()` penceresi de aynı ana göre). Doğrulamalar gevşetilmez (20 dk → görev yok, 40 dk → görev var, 3 dk 422, hekim 403, B etkilenmez, denetim). Gece yarısı penceresinde (ör. sistem saati taklidiyle değil, sabit referansla) ve gündüz geçtiği gösterilsin. Tek commit, gelistirme-gecmisi'ne push.
