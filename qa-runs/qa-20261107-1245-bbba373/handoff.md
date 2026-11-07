# Devir — qa-20261107-1245-bbba373 → cezeri-duzeltici

Revizyon: bbba373 (gelistirme-gecmisi). Tester ürün kodunu değiştirmedi.

## QA-401 (S3) — erişilebilir ad / durum rozetlerinde bulgu önce
- Dosya: `apps/web/components/treatment/tooth-model.ts` → `visualLabels(v)`.
- Beklenen sıra: 1) Çekildi / Eksik diş, 2) Çürük (yüzeyli/yüzeysiz), 3) Kırık, 4) sonra mevcut sıradaki tedavi işaretleri (İmplant, Köprü gövdesi, Kron, Kanal tedavisi, Post/kor, Laminate, İnley/onley, Fissür örtücü, Dolgu).
- Kabul: `apps/web/e2e/gorev2.spec.ts` iki projede (masaüstü sonra telefon-360, aynı seed) geçer; `apps/web/test/odontogram-0711.test.ts` beklentileri yeni sırayla güncellenir (ör. 17: `["Çürük (D)", "Dolgu (O)"]`) — kural yalnız sıra; içerik aynı. E2E `odontogram-0711.spec.ts` (`^Diş 36; Çekildi`) değişmeden geçer.
- Komşu: ipucu rozetleri ve Özet kartı ayrıntı rozetleri aynı fonksiyonu kullanır (sıra oraya da yansır); `data-state` özniteliği.
- Yeniden sınama: tam E2E temiz seed (iki proje), web birim.

## QA-402 (S3, FLAKY) — appointment-past-procedure testi saate bağlı
- Dosya: `apps/api/test/appointment-past-procedure.test.ts`. `pracId` seed'in ilk hekimi (`/resources` practitioners[0]); "şimdi − (tolerans−5) dk" ve diğer saat tabanlı randevular seed günlük randevularıyla (ör. 14:00) çakışabiliyor.
- Beklenen: dosyanın kendi hekimi (`POST /practitioners` + gerekiyorsa `PUT /practitioners/:id/schedule` tüm gün) — saatten bağımsız; mevcut beklentiler (201/422 kodları, denetim ve backdated kontrolleri) aynen kalır, gevşetilmez.
- Kabul: dosya, seed hekiminin 14:00 randevusuyla çakışan saatte de (ör. `vi.setSystemTime` kullanmadan, koşuyu tekrar ederek) geçer; tam API paketi geçer.
