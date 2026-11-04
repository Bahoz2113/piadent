# Devir 1 — cezeri-duzeltici (qa-20261104-1549-65201a2, sürüm 65201a2)

Kurallar: test beklentisi, plan, kanıt gevşetilmez; uygulanmış migration değiştirilmez; yama izole dalda/worktree'de; değişiklik kanıtı (diff özeti, çalıştırılan testler) `fix1.md`'ye yazılır. Üretime gönderim yok.

## QA-201 (S2) — Kirli çekmece Esc ile uyarısız kapanıyor
- Dosya: `apps/web/components/ui.tsx` (Drawer). Klavye dinleyicisi `useEffect(..., [])` içinde ilk render'ın `tryClose` kapanışını kullanıyor; `dirty` sonradan true olsa da Esc eski (`dirty=false`) değeri görüyor.
- Beklenen: Esc, X ve arka plan tıklaması aynı yolu izler — kirliyse "Kaydedilmemiş değişiklikler" uygulama modalı (`confirmDialog`), "Forma dön" veriyi korur, "Kapat" kapatır; temiz form uyarısız kapanır. Odak tuzağı ve önceki odağa dönüş bozulmamalı; iç açılır pencere (takvim) Esc'i tükettiyse çekmece kapanmamalı (mevcut davranış).
- Kabul: tarayıcıda Randevu ver → Açıklama yaz → Esc → alertdialog; Forma dön → metin korunur. Yeni hasta çekmecesinde de aynı. Bir E2E/birim testi eklenmeli (ör. `e2e/geri-bildirim-0411.spec.ts` ya da kritik akışa Esc adımı).

## QA-202 (S3) — Randevu formu "kirli" tanımı eksik
- Dosya: `apps/web/app/(app)/ajanda/page.tsx` `NewAppointment` → `dirty={!!patient || !!f.reason}`.
- Beklenen: kullanıcı herhangi bir alanı açılıştaki değerinden değiştirdiyse (hasta, işlem türü, hekim, planlanan işlem, tarih, saat, süre, koltuk, açıklama, not) form kirlidir. Önceden doldurulmuş (slot/hasta parametresi) değerler kirli sayılmaz.
- Kabul: yalnız Not doldurulup X → modal. Hiçbir alan değişmeden X → modalsız kapanır.

## Komşu akışlar (yeniden koşulacak)
Tüm Drawer kullanan formlar (hasta, randevu, ödeme, ücret modeli, fiyat, malzeme), `e2e/critical-flow.spec.ts` kapatma modalı adımı, erişilebilirlik testleri.
