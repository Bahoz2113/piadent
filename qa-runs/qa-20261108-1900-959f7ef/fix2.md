# Düzeltme paketi 2 — QA-503 (tur 2)

Sürüm 6d31dbd (koşu HEAD 37f3625; ürün kodu aynı). Tester ürün kodunu değiştirmedi.

## QA-503 (S3, FLAKY — test kodu yarışı), sorumlu: geliştirme
**Gözlem:** R04/R05 tur 2: `apps/web/e2e/geri-bildirim-0811.spec.ts:60` telefon-360'ta 60 sn zaman aşımı; tur 1'de aynı test iki profilde geçmişti (aralıklı). Düzeltici de fix1'de temiz olmayan DB'de masaüstünde bir kez görmüştü.
**Kanıt:** evidence/tur2/R04-R05-e2e-temiz-seed.log; Playwright izi: son eylemler `queryCount combobox[name="Hekim"] >> option` = **7**, ardından `selectOption combobox[name="Hekim"] {index: 6}` asılı kaldı. Hata anı sayfa görüntüsünde randevu formundaki "Hekim" listesinde **3** seçenek var (Dt. Elif Aras, Dt. Kerem Tunç, Dt. Murat İnce); gün hâlâ bugün.
**Kök neden (izden):** `page.getByRole("combobox", { name: "Hekim" })` sayfa genelinde aranıyor; sayım anında Randevular sayfasının (form açılmadan önceki) hekim süzgeci de eşleşiyor → seçenek sayısı 7 okunuyor, form seçicisinde 6. indeks yok → selectOption bekleyerek zaman aşımı.
**Beklenen:** Seçiciler randevu formu bölümüne kapsanır (ör. `page.getByRole("region", { name: "2 · İşlem, hekim ve gün" })` içindeki "Hekim"), sayım ve seçim aynı öğeden yapılır; doğrulamalar gevşetilmez. Aynı dosyadaki diğer sayfa geneli seçicileri (Gün alanı `getByPlaceholder("gg.aa.yyyy").first()`, "Uygun saatler") de aynı biçimde kapsamlansın.
Değişiklikten sonra spec iki projede en az 5 kez art arda (`--repeat-each=5`) temiz seed'de geçmeli. Tek commit, gelistirme-gecmisi'ne push.
