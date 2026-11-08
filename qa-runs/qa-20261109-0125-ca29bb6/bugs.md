# Bulgular — qa-20261109-0125-ca29bb6 (ADR-109 POS Faz 0, ca29bb6)

## QA-701 — S3 — Terminal güncellemesi verilmeyen alanları sessizce siler
- **Vaka:** K01 (tur 1, temiz seed, revizyon ca29bb6). İlk başarısızlık kanıtı: `evidence/tur1/K01-http.json` (kontrol "sekreter listeler"), DB durumu `evidence/tur1/QA-701-db.txt`.
- **Adımlar:** yönetici `POST /pos/terminals` {name, driver: manual, cashAccountId, bankName: "Sentetik Bankası", terminalRef: "TID 0042"} → 201. Ardından `PATCH /pos/terminals/:id` {name, driver, cashAccountId, active: false} (yalnız pasifleştirme).
- **Beklenen:** PATCH yalnız gönderilen alanları değiştirir (aynı uçta `active` verilmediğinde eski değer korunuyor); banka adı ve terminal no korunur; her değişen alan denetimde.
- **Gözlenen:** `bank_name` ve `terminal_ref` NULL oldu (`TID 0042` → null). Audit'te `terminal_ref` değişimi var, `bank_name` değişimi yok (iz kaybı).
- **Etki:** Düşük — arayüz tüm alanları gönderdiği için ekranda tetiklenmez; API/entegrasyon istemcisi kısmi güncellemede terminal bilgisini kaybeder ve banka adı değişikliği izlenemez. Veri sızıntısı yok, para kaydı etkilenmez.
- **Sorumlu:** cezeri-duzeltici (apps/api/src/finance/pos.controller.ts `updateTerminal`).

## Tester betiği düzeltmeleri (ürün kodu değil)
- K01 "B kiracısı güncelleyemez": ilk taslak (resmî turdan önce, kuru koşu) gövdede 1 karakterlik ad gönderdiği için 422 dönüyordu (doğrulama, kiracı kontrolünden önce). Ad geçerli uzunluğa çekildi; ölçüt (B kiracısı → 404) değişmedi.
