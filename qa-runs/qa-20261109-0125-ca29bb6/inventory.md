# Envanter farkı — qa-20261109-0125-ca29bb6 (önceki koşunun envanteri: qa-20261109-0040-9a6382e/inventory.md, değişmeden geçerli)

Yeni yüzeyler (ADR-109, ca29bb6) — depodan ve çalışan üründen:

| Kimlik | Yüzey | Parametreler / alanlar | Roller | Vaka |
|---|---|---|---|---|
| API-POS-1 | GET /pos/terminals | — | account.read (sekreter, finans, yönetici) | K01 |
| API-POS-2 | POST /pos/terminals, PATCH /pos/terminals/:id | name, driver(manual/mock), cashAccountId, branchId, bankName, terminalRef, active | finance.settings | K01 |
| API-POS-3 | POST /pos/intents | terminalId, patientId, amount, installments(1–12), mode(device/manual), authCode, cardLast4, allocations, appointmentId, note; Idempotency-Key | payment.write | K02 K03 K04 K06 |
| API-POS-4 | GET /pos/intents/:id | (süre aşımı geçişi) | account.read | K03 |
| API-POS-5 | POST /pos/intents/:id/simulate | outcome(approved/declined/no_response) — yalnız DENEME | payment.write | K03 K04 |
| API-POS-6 | POST /pos/intents/:id/cancel | reason | payment.write | K03 |
| API-POS-7 | POST /pos/intents/:id/resolve | outcome approved(authCode, cardLast4, installments) / declined(reason); Idempotency-Key | payment.write | K03 |
| API-POS-8 | GET /pos/day | date (bugün … −92 gün) | payment.write | K05 |
| API-POS-9 | POST /pos/settlements | terminalId, date (bugün … −31), slipCount, slipTotal, note; Idempotency-Key | payment.write | K05 |
| DB-0042 | pos_terminals, pos_intents, pos_settlements, payments.pos_intent_id | FORCE RLS, tetikleyici, kısmi tekil indeks, sütun yetkileri | viadent_app / worker | R07 K06 |
| UI-POS-1 | Hasta → Finans → Tahsilat al: Yöntem "Kart (POS)", POS terminali, Taksit, Onay kodu, Son 4 hane, "Tutarı cihaza gönder" / "Çekimi kaydet", Kartla tahsilat paneli | | sekreter, finans, yönetici | K07 K08 |
| UI-POS-2 | Finans → POS ve gün sonu: gün, terminal kartları, işlem tablosu, Sonuçlandır, Gün sonunu kapat, Terminal ekle/Düzenle | | payment.write; terminal: finance.settings | K07 K08 |

NA / açık: gerçek POS sürücüsü (yok — Faz 0), aynı gün void (kapsam dışı, iade akışı R01'de), POS üzerinden iade (kapsam dışı).
