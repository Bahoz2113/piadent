# Devir 1 — cezeri-duzeltici (qa-20261107-0145-b910f90, sürüm b910f90)

Kurallar: test beklentisi, plan, kanıt gevşetilmez; uygulanmış migration değiştirilmez; yama izole dalda/worktree'de; değişiklik kanıtı (diff özeti, çalıştırılan testler) `fix1.md`'ye yazılır. Üretime gönderim yok.

## QA-301 (S3) — Randevu sayfasında geçmiş gün yazılınca uyarı yok
- Dosya: `apps/web/components/appointment/new-appointment-page.tsx` (tam sayfa "Randevu ver", ADR-101).
- Beklenen: "Gün" alanına bugünden önceki bir tarih yazılınca alan altında açık uyarı ("Geçmiş gün seçilemez"); "Uygun saatler" bölümü bu durumda boş saat listesi yerine aynı nedeni söyler (veya hiç istek atmaz); "Randevuyu kaydet" sunucuya gitmeden 422 benzeri yerel hata verir. Bugün için geçmiş saat elle girilirse de "Geçmiş saat seçilemez" (eski çekmecedeki `inPast` + `APPOINTMENT_PAST_GRACE_MINUTES` kuralı). Geriye dönük kayıt yalnız sunucuda (yönetici + gerekçe) — sayfa bunu açmaz.
- Kabul: tarayıcıda Randevu ver → Gün 01.01.2026 → uyarı görünür; kaydet → sunucu isteği yok, uyarı; bugünün geçmiş saati elle → uyarı. Bir web birim veya E2E testi eklenmeli (ör. `e2e/geri-bildirim-0711.spec.ts` "Randevu ver tam sayfa" testine adım ya da `apps/web/test/` kaynak düzeyi test).
- Komşu: uygun saatler bölümü, ödeme planı, kirli sayfa uyarısı (QA-201/202 kuralı), `?yeni=1` ön doldurma (geçmiş tarihli `tarih` parametresi bugüne çekilir — mevcut davranış korunmalı).
