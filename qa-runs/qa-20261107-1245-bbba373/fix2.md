# Düzeltme 2 — QA-402 (S3, FLAKY) → FIX_READY

Koşu: qa-20261107-1245-bbba373. Taban: bdd56f6 (cb21a24 ürün + tester kanıt commit'i). Düzeltici: cezeri-duzeltici.
Yeni sürüm kimliği: bu dosyayı içeren commit (`git log -1 --format=%H -- qa-runs/qa-20261107-1245-bbba373/fix2.md`).
Durum: FIX_READY. Kapatma yalnız bağımsız tester yeniden sınamasıyla (VERIFIED). Üretime dağıtılmadı, push yok.
Ürün kodu (src, packages, migration) değişmedi; yalnız test fikstürü.

## Kusurun yeniden üretimi (yama öncesi, bdd56f6)
- Koşu saati 2026-11-07 14:03:34 (Europe/Istanbul): `cd apps/api && npx vitest run test/appointment-past-procedure.test.ts`
  → 1 failed | 6 passed (7); `tolerans içinde … kabul edilir`: `expected 409 to be 201` (tur5 R01 ile aynı).
- Hesap: `APPOINTMENT_PAST_GRACE_MINUTES = 10` → başlangıç `şimdi − 5 dk` ≈ 13:58, 15 dk → 13:58–14:13.
- Seed (`packages/db/src/seed.ts` slots; 30 dk): bugün 09:00, 09:30, 10:00, 11:00, 14:00, 15:30; ilk hekim (pi=0,
  "Dt. Elif Aras", `/resources` ad sırasıyla practitioners[0]) için 09:00, 10:00, 14:00. Test DB sorgusu:
  `Dt. Elif Aras | 2026-11-07 14:00 | 14:30 | planned` → `appointments_practitioner_no_overlap` → 409.
- Çakışma penceresi (ilk hekim): koşu saati ≈ 09:05–09:50, 10:05–10:50, 14:05–14:50 civarı (başlangıç şimdi−5, 15 dk; seed 30 dk).

## Değişiklik (yalnız fikstür)
`apps/api/test/appointment-past-procedure.test.ts` beforeAll, +3/−1:
- Önce: `pracId = (await sec.get("/resources").expect(200)).body.practitioners[0].id;`
- Sonra: `pracId = (await admin.post("/practitioners", { displayName: \`Zz Dt. Geçmiş ${tag}\` }).expect(201)).body.id;` + 2 yorum satırı.
- Çalışma saati tanımlanmadı: tanımsız çizelgede kısıt yok (`outsideHours` → null) ve dosyadaki tüm randevu çağrıları zaten
  `allowOutsideHours: true` gönderiyor; `PUT /practitioners/:id/schedule` gereksiz.
- "Zz" öneki: `/resources` ad sırasıyla döner; yeni hekim diğer dosyaların `practitioners[0]` (Dt. Elif Aras) varsayımını
  değiştirmez (aynı yöntem: practitioners-compensation.test.ts).
- Beklentiler (durum kodları 200/201/403/422, `APPOINTMENT_IN_PAST`, `field_errors`, sayaçlar, denetim `backdated`/`backdate_reason`,
  procedureLabel, plannedPrice 1200.00/1800.00, receivables, `appointment_type.update` denetimi, standard-import) aynen kaldı.
- Diğer durumların seed varsayımları kontrol edildi: işlem türü (Dolgu→DOL-01), tarife fiyatı, B kiracısı işlemleri hekimden
  bağımsız (kiracı düzeyi). `plannedPrice` hekime özel tarife sürümünü önceler; yeni hekimin özel sürümü yok → seed genel tarife
  (TEM-01 1200.00, DOL-01 1800.00) uygulanır; seed hekiminde de özel sürüm yoktu, sonuç aynı.

## Değişen dosyalar
- `apps/api/test/appointment-past-procedure.test.ts` (+3/−1)
- `qa-runs/qa-20261107-1245-bbba373/bugs.md` — yalnız QA-402 başlığı OPEN → FIX_READY (dosyadaki tester'ın commit'lenmemiş
  tur 3–5 notları ve QA-402 bölümü olduğu gibi bu commit'e girdi; metni değiştirilmedi)
- Bu dosya.
Dokunulmayan: src/ürün kodu, plan.json, inventory.md, kapı (`qa/cezeri/`), `qa-runs/.scripts` (h-cases/n-cases yerel değişiklikleri
tester'a ait, commit'lenmedi), evidence/ (tur3–5 commit'lenmedi), handoff.md, bugs.json. `apps/web/tsconfig.tsbuildinfo` geri alındı
(çalışmadan önce de değişmiş durumdaydı; derleme çıktısı).

## Komutlar ve sonuçlar (yama sonrası)
1. Çakışma penceresi içinde 3 ardışık koşu (14:04:45, 14:04:50, 14:04:55): `cd apps/api && npx vitest run test/appointment-past-procedure.test.ts`
   → her biri 1 dosya, 7/7 geçti, çıkış 0. Test DB: `Zz Dt. Geçmiş d3zv8o | 2026-11-07 14:00 | 14:15 | cancelled` — seed'in
   14:00–14:30 randevusuyla aynı aralık, kendi hekiminde 201. `vi.setSystemTime` kullanılmadı.
2. Tam API paketi (14:06:03–14:07:35): `cd apps/api && npx vitest run` → Test Files 44 passed (44), Tests 414 passed (414), çıkış 0.
3. `cd apps/api && npx tsc --noEmit -p .` → 0 hata.

## Yan etkiler
- Her koşu test DB'sinde A kiracısına 1 pasif olmayan sentetik hekim ("Zz Dt. Geçmiş <tag>") ekler; test DB global setup'ta
  her pakette sıfırlanır. Üretim/demo verisi etkilenmez.

## Tester için yeniden sınama
1. R01: `cd apps/api && npx vitest run` → 414/414; tercihen seed çakışma penceresinde (≈14:05–14:50) ayrıca
   `npx vitest run test/appointment-past-procedure.test.ts` birkaç kez.
2. Kabul: QA-402 → VERIFIED yalnız tester kararıyla; kapı `node qa/cezeri/gate.cjs …` tester tarafından.
