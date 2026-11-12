# Bulgular — qa-20261112-1610-744eb1b (Anasayfa + ADR-110 çalışma listesi)

## QA-801 — S3 — `outside_appointments` audit alanı etiketsiz
- **Vaka:** R03 (web birim, tur 1 temiz seed, 744eb1b): `test/audit-field-labels.test.ts` → "API kaynağındaki her changes anahtarı Türkçe etiketli" düştü; eksik anahtar `outside_appointments` (`apps/api/src/scheduling/roster.controller.ts`, plan dışı randevu bilinerek onaylanınca yazılır). Kanıt: `evidence/tur1/R03-web.log`.
- **Beklenen:** her audit `changes` anahtarı `packages/contracts/src/audit.ts` alan etiketlerinde Türkçe (QA-003 kuralı). **Gözlenen:** etiket yok → İşlem kayıtları ekranında ham anahtar.
- **Etki:** düşük, görünürlük/denetim okunabilirliği. **Sorumlu:** cezeri-duzeltici.

## QA-802 — S3 — roster-1211 API testi demo kiracısının ünite listesini kirletiyor
- **Vaka:** R01 (API, tur 1 temiz seed): `test/geri-bildirim-0811.test.ts` → "demo kaynak adları Ünite A/B/C" düştü; gözlenen ünite listesinde `Ünite L <rastgele>` (yeni `test/roster-1211.test.ts` beforeAll'da A kiracısına aktif ünite ekliyor). Kanıt: `evidence/tur1/R01-api.log`. Test dosyası sırası çalıştırmaya göre değiştiğinden aralıklı da düşebilir.
- **Beklenen:** yeni test mevcut testlerin varsayımlarını bozmaz (yalıtım). **Gözlenen:** kalıcı yan etki.
- **Etki:** düşük — ürün davranışı değil, test takımı güvenilirliği (regresyon kapısını düşürür). **Sorumlu:** cezeri-duzeltici. Not: 0811 testinin beklentisi gevşetilmemeli; düzeltme yeni testte.
