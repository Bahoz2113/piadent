# İçe aktarma sözleşmesi (VD-014, AT-16)

Önceki sistemden PİA-DENT'e veri taşımanın teknik sözleşmesi. Ekran: **Yönetim → Veri aktarımı** (yalnız klinik yöneticisi, `import.manage`). API: `POST /imports`, `GET /imports[/:id]`, `GET /imports/:id/errors.csv`, `POST /imports/:id/commit`, `POST /imports/:id/rollback`.

> Gerçek hasta verisi yalnız yetkili klinikten, veri işleme sözleşmesi imzalandıktan sonra alınır. Rakip sistem hesabına bağlanılmaz, oradan veri çekilmez; klinik kendi dışa aktarımını verir.

## Akış
1. **Ön kontrol (dry-run):** dosya okunur (UTF-8, BOM'lu/BOM'suz; `;` veya `,` ayırıcı otomatik; tırnaklı alan ve satır içi satır sonu desteklenir) → başlıklar alanlara eşlenir → her satır doğrulanır → mükerrer adaylar aranır. **Hiçbir hasta veya alacak yazılmaz**; yalnız `import_batches` + `import_rows` (RLS'li) kaydı oluşur.
2. **İnceleme:** satır durumları, alan bazında Türkçe hata mesajları, mutabakat kutuları; hatalı/mükerrer satırlar CSV olarak indirilir (formül enjeksiyonu korumalı, `;`, BOM).
3. **Onay (commit):** tek transaction, klinik başına danışma kilidi; geçerli satırlar **yeniden** doğrulanır (dry-run'dan sonra eklenen kayıtlar `skipped` olur). İkinci onay `409 IMPORT_ALREADY_COMMITTED`.
4. **Geri alma:** gerekçe zorunlu; yalnız aktarımdan sonra işlem görmemiş kayıtlar (randevu, ödeme, plan, not, belge, dosya, laboratuvar, mesaj, kontrol, iletişim tercihi, kart düzenlemesi, dağıtım yoksa). Hasta **arşivlenir**, açılış alacağı **iptal edilir** — silme yok. Aksi halde `409 IMPORT_HAS_ACTIVITY`.

## Tekrar çalıştırma garantisi (AT-16)
- **Aynı dosya** (aynı tür + aynı SHA-256): yeni batch açılmaz, mevcut batch döner (`reused: true`).
- **Farklı dosya, aynı kaynak no:** satır `already_imported` olur, yazılmaz. Hasta tarafında `(tenant_id, external_ref)` benzersiz dizini (etkin kayıtlar) son savunmadır.
- **Açılış bakiyesi:** hasta başına tek etkin açılış alacağı; ikinci satır `already_imported`.
- Her hasta/alacak `import_batch_id` taşır → hangi dosyadan geldiği izlenir.

## Dosya biçimi
Sınırlar: en çok **5 MB** ve **20.000 satır** (büyük dosyayı parçalara bölün). Biçim: CSV veya JSON (dizi ya da `{ "rows": [...] }`).

### Hasta kartları (`patients`)
| Alan | Zorunlu | Tanınan başlıklar (büyük/küçük harf, Türkçe karakter, boşluk/alt çizgi farkı önemsiz) | Kural |
|---|---|---|---|
| Kaynak hasta no | evet | kaynak_no, hasta_no, kayit_no, eski_no, external_id, id | ≤ 60 karakter; dosyada tekil |
| Ad, Soyad | evet | ad/adi/isim, soyad/soyadi/surname | Türkçe başlık düzenine çevrilir (`ayşe` → `Ayşe`) |
| Doğum tarihi | – | dogum_tarihi, dt, birth_date | `gg.aa.yyyy` veya `yyyy-aa-gg`; gelecekte ya da 1900 öncesi olamaz |
| Cinsiyet | – | cinsiyet, gender | K/E, Kadın/Erkek, F/M |
| Telefon | – | telefon, tel, gsm, cep | TR numarası E.164'e çevrilir |
| E-posta | – | eposta, email, mail | biçim kontrolü |
| Şehir, Nereden duydu | – | sehir/il, nereden_duydu/referans | serbest metin (kısaltılır) |
| T.C. Kimlik No | – | tc, tckn, tc_kimlik_no | 11 hane + kontrol basamakları |

**Mükerrer adaylar:** aynı kimlik no veya aynı ad + soyad + doğum tarihi (“muhtemelen aynı kişi”) → satır `duplicate`, yazılmaz; zayıf adaylar (ör. aynı telefon — aile telefonu olabilir) yalnız **uyarı**dır (AT-04 ile tutarlı).

### Açılış bakiyeleri (`opening_balances`)
| Alan | Zorunlu | Başlıklar | Kural |
|---|---|---|---|
| Kaynak hasta no **veya** PİA-DENT dosya no | biri | kaynak_no / dosya_no | Hasta önce aktarılmış olmalı |
| Borç tutarı (₺) | evet | tutar, bakiye, borc | `1250,50`, `1250.50`, `1.250,50`, `1,250.50`; **`1.250` belirsiz → hata** (binlik mi ondalık mı bilinmez); sıfır aktarılmaz; eksi (avans) bu sürümde aktarılmaz |
| Bakiye tarihi | evet | tarih, bakiye_tarihi | vade tarihi olur; gelecekte olamaz |
| Açıklama | – | aciklama, not | varsayılan “Açılış bakiyesi (önceki sistemden aktarım)” |

Açılış bakiyesi **hayali geçmiş işlem üretmez**: kaynağı `opening_balance` olan tek bir alacak satırıdır (`receivables.import_batch_id` zorunlu, DB check). Avans/alacaklı bakiye mali müşavir onayıyla elle girilir.

### Geçmiş randevular (`appointment_history`, Görev 13 — ADR-072)
| Alan | Zorunlu | Başlıklar | Kural |
|---|---|---|---|
| Kaynak randevu no | – | randevu_no, appointment_id | Tekrar aktarımda mükerrer kaydı önler; yoksa hasta + hekim + başlangıç zamanı eşleşmesi kullanılır |
| Kaynak hasta no **veya** PİA-DENT dosya no | biri | kaynak_no / dosya_no | Hasta önce aktarılmış olmalı |
| Tarih | evet | tarih, randevu_tarihi | gg.aa.yyyy; **yalnız geçmiş** (bugün ve sonrası ajandadan girilir) |
| Saat | evet | saat, baslangic | SS:DD (24 saat), klinik saat dilimi |
| Süre (dk) | – | sure, dakika | 5–720 tam sayı; boşsa 30 |
| Hekim | evet | hekim, doktor | PİA-DENT'teki hekim adı (unvanlı/unvansız: “Dt. Elif Aras” / “Elif Aras”) ya da kullanıcı e-postası; birden çok eşleşme hata |
| Durum | – | durum | geldi / gelmedi / iptal (İngilizce karşılıkları da tanınır); boşsa geldi |
| Sebep / işlem | – | sebep, islem | Serbest metin; **tedavi, işlem ya da finans kaydı üretmez** |
| Not | – | not | Serbest metin |

Kurallar: hekimin aynı zaman aralığında başka randevusu varsa (DB'de ya da dosyada) satır hatalıdır (çakışma); iptal satırları kapasite tutmaz. Onayda `completed` randevu `completed_at = bitiş`, iptal randevu “Önceki sistemden aktarıldı (iptal)” gerekçesiyle yazılır; PİA Akış görevi üretilmez. **Geri alma silmez**: randevu “Aktarım geri alındı: <gerekçe>” ile iptal edilir, kaynak no korunur ve aynı kaynak no yeniden aktarılabilir; randevu sonradan düzenlenmiş ya da işlem/not/laboratuvar/kontrol bağlanmışsa geri alma reddedilir.

### Geçmiş işlemler (`treatment_history`, Görev 14 — ADR-075)
| Alan | Zorunlu | Başlıklar | Kural |
|---|---|---|---|
| Kaynak işlem no | – | islem_no, procedure_id | Tekrar aktarımda mükerrer önler; yoksa hasta + işlem + tarih + hekim + diş eşleşmesi |
| Kaynak hasta no **veya** PİA-DENT dosya no | biri | kaynak_no / dosya_no | Hasta önce aktarılmış olmalı |
| İşlem tarihi | evet | tarih, islem_tarihi | gg.aa.yyyy; yalnız geçmiş; saat 12:00 klinik saat dilimi |
| İşlem | evet | islem, kod, islem_adi | Katalog **kodu** (DOL-01) ya da tam **adı**; eşleşmeyen/çoklu eşleşen satır hatalı |
| Diş (FDI) | – | dis, fdi | 11–48; diş düzeyinde işlemde boşsa uyarı, ağız düzeyinde yazılır |
| Adet | – | adet, miktar | 1–50; boşsa 1 |
| Bedel (₺) | – | tutar, bedel | Bilgi amaçlı snapshot; **alacak üretmez**; boşsa 0; eksi olamaz |
| Hekim | evet | hekim, doktor | Ad (unvanlı/unvansız) ya da e-posta |
| Not | – | not, aciklama | Serbest metin |

Onayda `performed_procedures` satırı ziyaretsiz (`appointment_id` boş, `import_batch_id` dolu), `price_basis=manual`, durum tamamlandı. Geri alma iptal + gerekçe; düzeltilmiş/iptal edilmiş ya da sonradan alacak bağlanmış kayıt geri almayı engeller. Mutabakat kutularında bedel toplamları (kaynak = aktarılabilir + hatalı + mükerrer + daha önce) gösterilir — finansal mutabakat **değildir** (alacak yok).

**Ödeme geçmişi aktarılmaz** (ADR-075): net durum açılış bakiyesiyle taşınır; eski ödemeler kaynak sistemde salt okunur kalır.

## Mutabakat
Özet: `rows = valid + errors + duplicates + alreadyImported`. Açılış bakiyesinde tutarlar ayrıca uzlaştırılır: `amountSource = amountValid + amountError + amountDuplicate + amountAlreadyImported`; tutarı okunamayan satırlar `unparsedAmountRows` olarak ayrı sayılır. Onay sonrası `imported`, `skippedAtCommit`, `amountImported` eklenir ve DB'deki `sum(receivables.amount where import_batch_id = …)` ile eşleşir (testli).

## Örnek sentetik dosyalar
- `docs/samples/hasta-ornek.csv` — 4 satır: 2 geçerli, 1 hatalı (tarih/cinsiyet/telefon/e-posta), 1 dosya içi mükerrer.
- `docs/samples/acilis-bakiyesi-ornek.csv` — hasta dosyası aktarıldıktan sonra: 2 geçerli (1.550,50 ₺), 1 belirsiz tutar, 1 bulunamayan hasta.
- `docs/samples/gecmis-islem-ornek.csv` — 2 geçerli (biri adla eşleşen işlem), 1 uyarılı (diş boş), 1 katalogda olmayan işlem.
- `docs/samples/gecmis-randevu-ornek.csv` — hasta dosyası aktarıldıktan sonra: 2 geçerli (biri e-postayla hekim), 1 çakışma (09:15, aynı hekim), 1 bulunamayan hekim.

## Kapsam dışı (bu sürüm)
Ödeme geçmişi (bilinçli, ADR-075), dosya/röntgen ve belge aktarımı: kaynak sistemin gerçek dışa aktarım biçimi görülmeden alan eşlemesi uydurulmaz (randevu geçmişi Görev 13'te sentetik sözleşmeyle eklendi; gerçek kaynak dosyası gelince başlık takma adları genişletilir). Pilot klinikle örnek dosya üzerinden ayrı iş paketi (backlog VD-014 kalanları).

## Saklama
`import_rows.data` normalize edilmiş kişisel veri içerir (RLS'li). Saklama süresi yetkili danışmanla belirlenecek; önerilen: pilot kabulünden sonra satır verisinin temizlenmesi (batch özeti ve sayımlar kalır). İş açık (backlog).
