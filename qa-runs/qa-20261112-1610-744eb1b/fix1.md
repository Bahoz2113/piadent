# Düzeltme 1 — cezeri-duzeltici dönüşü (54b3a3a)
- QA-801: `packages/contracts/src/audit.ts` → `outside_appointments: "Plan dışında kalan randevu"`.
- QA-802: `apps/api/test/roster-1211.test.ts` afterAll'da eklenen ünite pasifleştirilir + kalmadığı doğrulanır. `geri-bildirim-0811.test.ts` değişmedi (beklenti gevşetilmedi; okuduğu `/resources` yalnız aktif üniteleri döner).
- Düzeltici raporu: önce kusur üretildi (QA-801 1 düşen; QA-802 seed=3 sırasıyla 0811 düştü), sonra web audit-field-labels 7/7, API iki dosya 3 sırayla 17/17, tam API 445/445.
- Tester yeniden sınaması: tur 2 (temiz seed, tam regresyon) — durum FIX_READY → tur 2 sonucu.
