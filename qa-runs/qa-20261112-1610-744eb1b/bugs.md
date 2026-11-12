# Bulgular — qa-20261112-1610-744eb1b (Anasayfa + ADR-110 çalışma listesi)

## QA-801 — S3 — `outside_appointments` audit alanı etiketsiz — VERIFIED (54b3a3a, tur 2)
- **Vaka:** R03 (web birim, tur 1 temiz seed, 744eb1b): `test/audit-field-labels.test.ts` → "API kaynağındaki her changes anahtarı Türkçe etiketli" düştü; eksik anahtar `outside_appointments` (`apps/api/src/scheduling/roster.controller.ts`, plan dışı randevu bilinerek onaylanınca yazılır). Kanıt: `evidence/tur1/R03-web.log`.
- **Beklenen:** her audit `changes` anahtarı `packages/contracts/src/audit.ts` alan etiketlerinde Türkçe (QA-003 kuralı). **Gözlenen:** etiket yok → İşlem kayıtları ekranında ham anahtar.
- **Etki:** düşük, görünürlük/denetim okunabilirliği. **Sorumlu:** cezeri-duzeltici.

## QA-802 — S3 — roster-1211 API testi demo kiracısının ünite listesini kirletiyor — VERIFIED (54b3a3a, tur 2; karışık sırada da geçti)
- **Vaka:** R01 (API, tur 1 temiz seed): `test/geri-bildirim-0811.test.ts` → "demo kaynak adları Ünite A/B/C" düştü; gözlenen ünite listesinde `Ünite L <rastgele>` (yeni `test/roster-1211.test.ts` beforeAll'da A kiracısına aktif ünite ekliyor). Kanıt: `evidence/tur1/R01-api.log`. Test dosyası sırası çalıştırmaya göre değiştiğinden aralıklı da düşebilir.
- **Beklenen:** yeni test mevcut testlerin varsayımlarını bozmaz (yalıtım). **Gözlenen:** kalıcı yan etki.
- **Etki:** düşük — ürün davranışı değil, test takımı güvenilirliği (regresyon kapısını düşürür). **Sorumlu:** cezeri-duzeltici. Not: 0811 testinin beklentisi gevşetilmemeli; düzeltme yeni testte.

## QA-803 — S3 — API test takımı dosya sırasına bağlı (messaging-0711 → gorev5) — mevcut kusur
- **Bulunuş:** QA-802 yeniden sınamasında tam API takımı `--sequence.shuffle.files --sequence.seed=3` ile koşuldu (tur 2 sonrası, 5e55ec1 = ürün 54b3a3a): 445'ten 8'i düştü, hepsi `test/gorev5.test.ts` (SMS teslim bildirimi, zaman aşımı/yeniden deneme/dead-letter). Kanıt `evidence/tur2/QA-802-api-shuffle-seed3.log`.
- **Daraltma:** gorev5 tek başına yanındaki dört aday dosyayla (messaging-0711, gorev8, security, adapter-contract) 4'er seed ile koşuldu; yalnız **messaging-0711 önce** koşunca 8 test düşüyor (`evidence/tur2/QA-803-messaging-then-gorev5.log`). İki dosya da 07.11'den (6124aa2) beri değişmedi → bu sürümden önce var; ADR-110/Anasayfa değişikliğiyle ilgisi yok. Normal sırada (tur 1–2 R01) geçiyor.
- **Etki:** düşük — ürün davranışı değil; regresyon kapısının güvenilirliği (sıra değişirse sahte kırmızı / gizlenen kusur). **Sorumlu:** cezeri-duzeltici. gorev5 beklentileri gevşetilmemeli; messaging-0711 yan etkisini temizlemeli.
