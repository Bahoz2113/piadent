# Düzeltme 1 — cezeri-duzeltici (qa-20261107-0145-b910f90)

- Taban sürüm: `b910f90` (dal: mevcut çalışma dalı). Yeni sürüm: bu dosyayı içeren commit (SHA devir mesajında; `git log -1 -- qa-runs/qa-20261107-0145-b910f90/fix1.md`).
- Kapsam: yalnız **QA-301** (S3). Durum: **FIX_READY**. Kapanış yalnız bağımsız tester yeniden sınamasıyla.
- Değiştirilmeyenler: plan.json, inventory.md, results*.json, evidence/, gate (`qa/cezeri/gate.cjs`), mevcut test beklentileri, migration'lar, API. Üretime gönderim yok; push yok.

## Kusurun üretilmesi (düzeltme öncesi)
Yeni E2E adımı (aşağıda) düzeltme öncesi derlemede (web derlemesi 01:41, `new-appointment-page.tsx` son değişikliği b522c41 içinde) koşuldu:
`npx playwright test e2e/geri-bildirim-0711.spec.ts -g "Randevu ver"` → **2 failed** (masaustu + telefon-360), ikisi de
`getByText('Geçmiş gün seçilemez')` → element(s) not found (01.01.2026 yazılıp alandan çıkıldıktan sonra). Bulgudaki gözlemle aynı.

## Kök neden
Eski çekmecedeki (`app/(app)/ajanda/page.tsx`, b522c41 öncesi) `inPast` hesabı (`zonedToUtc` + `APPOINTMENT_PAST_GRACE_MINUTES`) ve
kayıt öncesi yerel `APPOINTMENT_IN_PAST` engeli tam sayfaya (ADR-101) taşınmamıştı. `DateField min` yalnız takvim seçimini sınırlar.

## Diff özeti
| Dosya | Değişiklik |
|---|---|
| `apps/web/components/appointment/past-guard.ts` (yeni, 18 satır) | Saf yardımcı `appointmentPastState(date, startTime, today, tz, nowMs)` → `{ pastDay, inPast }`; eski çekmecedeki kural birebir (`zonedToUtc`, tolerans `APPOINTMENT_PAST_GRACE_MINUTES` = 10 dk; `pastDay = date < bugün`). Türkçe metin sabitleri. |
| `apps/web/components/appointment/new-appointment-page.tsx` (+14 / −6) | (1) `pastDay`/`inPast` render'da hesaplanır. (2) Gün alanı: `error = sunucu hatası ?? (pastDay ? "Geçmiş gün seçilemez")`. (3) Geçmiş günde `/availability` isteği atılmaz (`useData` yolu `null`); Uygun saatler bölümünde uyarı "Geçmiş gün için saat listelenmez; bugün veya ileri bir gün seçin." (çalışma saati notu da gizlenir). (4) `save()` en başında `!created && inPast` → sunucuya gitmeden `ApiFailure(422, APPOINTMENT_IN_PAST, "Geçmiş bir tarih veya saate randevu oluşturulamaz. Lütfen ileri bir saat seçin.")`; alan hatası geçmiş günde `date`, aksi hâlde `startTime`. `!created`: randevu kaydedilip ödeme başarısız olduysa "Ödemeyi yeniden dene" sonradan geçmişe düşen saat yüzünden engellenmez. (5) Elle saat alanı: bugün + toleranstan eski saat → "Geçmiş saat seçilemez"; elle saat kipindeyken saat alan hatası (sunucu dahil) elle saat alanının altında gösterilir, liste altındaki tekrar eden satır gösterilmez (çift mesaj yok). |
| `apps/web/test/qa-301-past-day.test.ts` (yeni, 11 test) | Davranış: geçmiş gün, bugün/ileri gün, boş tarih, tolerans sınırı (09:49 geçmiş, 09:50 değil, şimdi 10:00), yarım saat girişi; kaynak düzeyi bağlantı: Gün hata bağı, availability isteğinin `!pastDay` ile kesilmesi, uyarı metni, elle saat hatası, kaydet engelinin `api("/appointments")` ve `setBusy(true)`'dan önce olması, `?yeni=1` ön doldurmanın bugüne çekilmesinin korunması. |
| `apps/web/e2e/geri-bildirim-0711.spec.ts` (+13) | "Randevu ver tam sayfa" testine, işlem seçiminden sonra: Gün = 01.01.2026 → "Geçmiş gün seçilemez" ve saat uyarısı görünür → "Randevuyu kaydet" → yerel mesaj görünür ve `POST …/appointments` isteği **0**. Sonra mevcut adımlar (ilk hafta içi güne dönüş, slot, kısmi ödeme, kayıt) değişmeden sürer. Var olan beklentilerin hiçbiri değiştirilmedi. |
| `qa-runs/qa-20261107-0145-b910f90/bugs.md` | Yalnız QA-301 başlığı OPEN → FIX_READY ve bir "Durum" satırı. |

Korunan komşular: `?yeni=1` geçmiş `tarih` ön doldurması yine bugüne çekilir (dokunulmadı); kirli sayfa (`dirty`) tanımı değişmedi (QA-201/202 testleri geçti); ödeme planı mantığı değişmedi; sunucu kuralı (422 APPOINTMENT_IN_PAST, yönetici+gerekçe geriye dönük kayıt) değişmedi — sayfa geriye dönük kaydı açmaz.

## Çalıştırılan komutlar ve sonuçlar (07.11.2026, yerel)
1. `cd apps/web && npx tsc --noEmit -p .` → çıkış 0.
2. `cd apps/web && npx vitest run` → **9 dosya, 97 test geçti, 0 hata** (yeni dosya 11 test dahil).
3. `bash /tmp/claude-0/restart.sh build` → web üretim derlemesi yeniden alındı (BUILD_ID 02:07), API 200, web 200.
4. `npx playwright test e2e/geri-bildirim-0711.spec.ts -g "Randevu ver"` (E2E_PASSWORD ortamdan; yazılmadı) → **2 passed** (masaustu, telefon-360).
5. Komşu E2E: `npx playwright test e2e/critical-flow.spec.ts e2e/geri-bildirim-0411.spec.ts e2e/geri-bildirim-0711.spec.ts e2e/pilot-provasi.spec.ts` → **27 passed, 3 skipped, 0 failed** (atlamalar dosyadaki bilinçli `test.skip(info.project.name !== "masaustu")`: 0411 Raporlar menü, 0711 dışa aktarım, pilot provası — telefon profili).
6. Elle saat kabulü (geçici, depoya eklenmedi, koşudan sonra silindi): bugün + Saat 00:30 (koşu 02:10) → "Geçmiş saat seçilemez" 1 kez görünür; kaydet → yerel mesaj, `POST …/appointments` 0; Saat 23:55 → uyarı kalkar. **2 passed** (masaustu, telefon-360). Saat bağımlı olduğundan kalıcı E2E'ye konmadı; kural birim testte sabit "şimdi" ile sınanır.

Çalıştırılmayanlar: tam E2E paketi (yalnız randevu sayfasına dokunan 4 dosya koşuldu), API testleri (API değişmedi), gate.

## Yan etkiler
- Yerel yığın yeniden başlatıldı ve web yeniden derlendi (`.next`); çalışan web artık düzeltmeli koddur.
- E2E koşuları yerel DB'ye sentetik "Sayfa Randevu" hastaları, randevular ve 250,00 ₺ kısmi ödemeler ekledi (düzeltme öncesi 2 başarısız koşu yalnız hasta oluşturdu, randevu oluşturmadı). Tester turundan önce temiz seed önerilir.
- `apps/web/tsconfig.tsbuildinfo` tsc ile değişti; geri alındı (commit'e girmedi).
- Çalışma ağacındaki önceden var olan `qa-runs/.scripts/*` değişiklikleri (tester'a ait) commit'e alınmadı ve dokunulmadı.

## Tester için yeniden sınama
F01 tarayıcı adımı: Randevu ver → Gün 01.01.2026 → alandan çık → Gün altında "Geçmiş gün seçilemez", Uygun saatler bölümünde "Geçmiş gün için saat listelenmez; bugün veya ileri bir gün seçin." (ağda `/availability?…date=2026-01-01` isteği yok) → Randevuyu kaydet → üstte "Geçmiş bir tarih veya saate randevu oluşturulamaz. Lütfen ileri bir saat seçin.", `POST /appointments` yok. Bugün + elle geçmiş saat (≥ 10 dk önce) → "Geçmiş saat seçilemez", kaydet yerel engellenir.
