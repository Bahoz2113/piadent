# Güvenlik gözden geçirmesi (Görev 7, 23.10.2026; Görev 8 ve Görev 9 iç denetimi aynı gün)

Kapsam: Plan §08 “Teknik güvenlik tabanı” maddeleri + Görev 7'de eklenen içe/dışa aktarma, MFA ve yedek. Yöntem: kod incelemesi + otomatik testler (`security.test.ts`, `gorev7.test.ts`, `tenant-isolation.test.ts`, önceki görev testleri) + bağımlılık taraması + depo sır taraması. **Bağımsız sızma testi yapılmadı** (yayın kapısı).

## Plan §08 tabanı — durum
| Madde | Durum | Kanıt / not |
|---|---|---|
| TLS | ⛔ altyapı | Uygulama TLS sonlandırmaz; ters vekil (nginx/Caddy/yük dengeleyici) ile. Üretimde `Secure` çerez + HSTS açılır (testli). Sertifika/yapılandırma canlıya alma runbook'unda |
| Secret manager | ⛔ altyapı | Sırlar ortam değişkeninden okunur (`.env` yalnız yerelde; imajlarda yok). Sürümlü anahtar ve döndürme komutu hazır (ADR-052); secret manager seçimi barındırma kararı |
| Şifreli yedek | ✅ | AES-256-GCM + scrypt, kurcalama/yanlış parola reddi (testli), ayrı yalnız-okuma yedek rolü |
| Özel dosya depolama | ✅ | Görev 4: imzalı olmayan, API arkasında, tür imzası + boyut + tarama portu; üretimde ClamAV zorunlu |
| Güçlü oturum yönetimi | ✅ | Sunucu tarafı oturum, belirteç SHA-256 ile saklanır (bytea), 12 sa TTL, erişim kaldırmada iptal (AT-20), MFA sıfırlamada tüm oturumlar kapanır |
| Yönetici ve destek için MFA | ⚠️ kısmi | TOTP (RFC 6238 vektörüyle testli), tek kullanımlık meydan okuma, 5 deneme (atomik), kod tekrarına karşı adım kaydı (koşullu güncelleme), yönetici sıfırlaması (gerekçe + kendi hesabı değil + çok klinikli kullanıcıda yasak). **Zorunluluk yapılandırmayla:** `VIADENT_REQUIRE_MFA_ROLES=clinic_admin,finance` üretimde ayarlanmalı (yayın kapısı). “Destek” rolü/konsolu henüz yok → destek erişim süreci tanımlı değil |
| Hız sınırlama | ✅ | Giriş: e-posta+IP başına 5/15 dk ve hesap başına 20/15 dk; davet 5; MFA meydan okuma başına 5. **PostgreSQL'de paylaşılan** (çok süreç, yeniden başlatmaya dayanıklı; ADR-053). Genel API istek sınırı ters vekilde önerilir |
| Güvenli çerez | ✅ | `HttpOnly; SameSite=Lax; Secure (üretim); Path=/` — testli |
| CSRF | ✅ | SameSite=Lax + durum değiştiren her istekte `x-viadent-request: 1` özel başlık (testli); webhook ayrı imzalı yol |
| XSS | ✅ | React çıktı kaçışı; `dangerouslySetInnerHTML` yok; **nonce'lu CSP** (`script-src 'nonce-…' 'strict-dynamic'`, `unsafe-inline` yok), `frame-ancestors 'none'`, `object-src 'none'`; E2E'de CSP ihlali 0. CSV hücreleri formül enjeksiyonuna karşı korumalı. API yanıtlarında `default-src 'none'` |
| Dosya türü/boyut, zararlı içerik | ✅ | Görev 4 (AT-11) |
| Ayrı DB rolleri | ✅ | `viadent_app` (NOBYPASSRLS, sahip değil), `viadent_worker`, `viadent_owner` (migration), `viadent_backup` (yalnız okuma, BYPASSRLS), yönetici yalnız rol kurulumunda — testli |
| Parola/token loglarda ve seed'de yok | ✅ | Seed parolası ortamdan veya rastgele (`.demo-credentials`, git dışı); hata yanıtları iç ayrıntı içermez (testli); sır taraması testli |
| Audit uygulama rolüyle değiştirilemez | ✅ | `audit_events`: app/worker yalnız `select, insert`; `update/delete` tetikleyiciyle engelli. Ayrı append-only hedef yok (Plan: “tek başına garanti değildir”) |
| RLS | ✅ | `tenant_id` taşıyan 69 tablonun tamamında ENABLE+FORCE (otomatik keşif testi); geri yüklenen veritabanında da denetlenir |

## Görev 7'de bulunan ve düzeltilenler
| # | Bulgu | Önem | Düzeltme |
|---|---|---|---|
| S1 | Giriş sınırlayıcısı yalnız e-posta+IP: IP değiştirerek sınırsız parola denemesi | Yüksek | Hesap başına 20/15 dk ek eşik (testli) |
| S2 | MFA deneme sayacı oku-sonra-yaz: eşzamanlı tahminler 5'i aşabilirdi; aynı kod iki meydan okumada eşzamanlı kullanılabilirdi | Orta | Atomik deneme tüketimi + koşullu `used_at` ve `mfa_last_step` güncellemesi |
| S3 | Tek klinik yöneticisi, başka klinikte de üye olan kullanıcının MFA'sını sıfırlayabiliyordu (hesap güvenliği klinikler arası) | Orta | Çok klinikli kullanıcıda sıfırlama yasak → destek süreci (testli) |
| S4 | Gövde sınırı aşımı 500 dönüyordu (body-parser hatası işlenmiyordu) | Düşük | 413 `PAYLOAD_TOO_LARGE`, bozuk JSON 400 (testli) |
| S5 | API yanıtlarında CSP/çerçeve başlığı yoktu; web'de CSP ve HSTS yoktu | Orta | API: `default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options`, `Referrer-Policy`, CORP; web: CSP, COOP, HSTS (üretim) |
| S6 | Bağımlılık taraması: `postcss` (next içinde, 2 yüksek + 2 orta), `vitest/tinypool` (geliştirme, 2 kritik + 3 orta) | Yüksek (derleme zamanı) | `postcss ≥ 8.5.23` override, `vitest 4.1.12` → `pnpm audit`: **0 bilinen açık** |
| S7 | Geri yüklemede `--no-privileges` GRANT'ları düşürüyordu → geri yüklenen DB'de uygulama çalışmazdı | Yüksek (işletim) | GRANT'lar dökümle taşınır; doğrulama uygulama rolü yetkisini ve FORCE RLS'i denetler |

## Açık bulgular (yayın öncesi kapatılmalı veya kabul edilmeli)
| # | Bulgu | Önem | Öneri |
|---|---|---|---|
| A1 | Bağımsız sızma testi yapılmadı | Yüksek (kapı) | Pilot öncesi dış test; kapsam: kimlik/oturum, çapraz klinik, dosya, webhook, içe aktarma |
| A2 | ~~Hız sınırlayıcı bellek içi~~ → **kapandı (Görev 8)**: PostgreSQL'de paylaşılan sayaç, anahtar özetli (ADR-053); iki uygulama örneğinde aynı kilit testli | — | Genel istek sınırı ters vekilde önerilir |
| A3 | ~~Tek anahtar, döndürme yok~~ → **kapandı (Görev 8)**: sürümlü anahtar halkası + `db:rotate-keys` (ADR-052), uçtan uca testli | — | KMS/secret manager barındırma kararıyla |
| A4 | T.C. kimlik no veritabanında şifresiz (RLS + maskeleme var) | Orta | Alan düzeyinde şifreleme + arama için HMAC; yetkili danışmanla risk değerlendirmesi |
| A5 | ~~CSP `script-src 'unsafe-inline'`~~ → **kapandı (Görev 8)**: nonce + `strict-dynamic`; E2E'de gezinmede CSP ihlali 0 | — | — |
| A6 | MFA zorunluluğu varsayılan kapalı (yapılandırma) | Orta | Üretim `.env`: `VIADENT_REQUIRE_MFA_ROLES=clinic_admin,finance` — runbook ve kapı listesinde |
| A7 | ~~API/worker tsx ile~~ → **kapandı (Görev 8)**: derlenmiş tek dosya; tam E2E derlenmiş kodla geçti | — | İmajlar CI'da ilk kez derlenmeli |
| A8 | ~~İçe aktarma satır verisi süresiz~~ → **kısmen kapandı (Görev 8)**: worker 30 gün sonra temizler (ADR-054) | Düşük | Süreyi danışmanla kesinleştirin |
| A11 | Kilitleme DoS'u (hesap başına 20 hatalı deneme → 15 dk kilit) | Düşük | Kademeli gecikme veya CAPTCHA değerlendirmesi |
| A9 | Destek erişimi (VİADENT personelinin müşteri verisine erişimi) için rol, onay ve iz yok | Orta | Tanımlanana kadar destek yalnız ekran paylaşımıyla, müşteri oturumunda |
| A10 | Ekran okuyucuyla elle erişilebilirlik testi yok (AT-18 kısmi) | — | Pilot kontrol listesinde |

## Görev 8'de ayrıca bulunup düzeltilenler
| # | Bulgu | Önem | Düzeltme |
|---|---|---|---|
| S8 | Paketlenmiş API, `import.meta.url` kontrolü nedeniyle açılışta migration çalıştırmaya kalkardı | Yüksek (işletim) | Dosya adı kontrolü (ADR-055) |
| S9 | `roles` üretimde de `<db>_test` veritabanı oluşturuyordu | Düşük | Yalnız üretim dışı |
| S10 | Zod 4'ün `new Function` denemesi her sayfada CSP ihlali üretiyordu (önceden ölçülmemişti) | Düşük | Tarayıcıda JIT kapalı |
| S11 | Doğrulama hatalarında İngilizce iç mesaj (“Invalid input: expected string…”) kullanıcıya ulaşıyordu | Düşük | Türkçe zod yerel ayarı + eksik alan mesajı |
| S12 | `.env.example` yedek şifrelemesini yanlış tanımlıyordu (“PBKDF2”; gerçekte scrypt) | Bilgi | Düzeltildi |

## Görev 9 iç güvenlik denetimi (23.10.2026)
Kapsam: tüm API uçları ve DB katmanının kod incelemesi (yetki, kiracı izolasyonu, dinamik SQL, dosya yolları, webhook doğrulaması, oturum), ardından çalışan sisteme karşı **negatif doğrulama testleri** (`pentest.test.ts`, `gorev9.test.ts`: yetkisiz erişim, çapraz klinik, oturum/CSRF, bozuk girdi, kaba kuvvet, idempotency tekrarı, girdi temizliği). **Bu bir iç denetimdir; bağımsız sızma testi (A1) yerine geçmez.**

| # | Bulgu | Önem | Durum |
|---|---|---|---|
| S13 | **Parola değiştirme ve sıfırlama yoktu**: sızan parola değiştirilemez, kayıp parolaya yardım edilemezdi | Yüksek | Kapandı: Hesabım → Parola (mevcut parola + MFA kodu, diğer oturumlar kapanır); yönetici sıfırlaması (geçici parola, zorunlu değişiklik, denetim) — ADR-056, API + E2E testli |
| S14 | NUL karakteri içeren metin 500 üretiyordu (PostgreSQL 22021) | Orta | Kapandı: gövde temizliği 422 + veri biçimi hataları 422'ye eşlendi — ADR-057 |
| S15 | Yön değiştirme/sıfır genişlik karakterler ad alanlarına giriyordu (görsel aldatma) | Düşük | Kapandı: sessizce kaldırılır (testli) |
| S16 | Oturumda boşta kalma süresi yoktu (12 sa mutlak) | Orta | Kapandı: `SESSION_IDLE_MINUTES` (90), testli |
| S17 | Parola politikası yalnız uzunluktu (“1234567890”, e-postanın kendisi kabul) | Orta | Kapandı: yaygın/ardışık/tekrarlı/ad-e-posta içeren parola reddi; davet kabulünde de |
| S18 | MFA kurulum/kapatma kodunda deneme sınırı yoktu (ele geçirilmiş oturumla 6 haneli kod taraması) | Orta | Kapandı: kullanıcı başına 5/15 dk |
| S19 | Takvimsel geçersiz tarih (`2026-02-30`) regex'i geçip DB'de 500 üretiyordu | Düşük | Kapandı: ortak `isoDate` doğrulayıcı |
| S20 | Kullanıcı kendi açık oturumlarını göremiyor/kapatamıyordu | Düşük | Kapandı: `GET /me/sessions`, `POST /me/sessions/revoke-others` |
| S21 | Contracts paketinde `.js` uzantılı iç import Next derlemesini kırıyordu (Görev 9 düzenlemesinden) | — | Kapandı |

Doğrulanıp **sorun bulunmayan** alanlar: dinamik SQL yalnız sunucu tarafı sabit listelerden (rapor süzgeçleri, lab durumları, arama sözcükleri parametreli); dosya anahtarı sunucu üretir (yol bileşeni istemciden gelmez), indirme `attachment` + `nosniff`; webhook imzası zamanlama-güvenli karşılaştırma + replay penceresi + tekilleştirme; oturum/davet/MFA belirteçleri özetli; `/session/switch` üyelik sahipliğini doğrular; hata gövdelerinde iç ayrıntı yok; `__proto__` ile prototip kirlenmesi yok; arama limiti ≤ 50; tüm para alanları şema + DB tetikleyicisi; uygulama rolünde DELETE yalnız 3 teknik tabloda.

**Kabul edilen risk:** hesap başına 20 hatalı denemede 15 dk kilit, hedefli kullanıcıyı kısa süre kilitlemek için kötüye kullanılabilir (kilitleme DoS'u). Eşik ve süre bilinçli seçildi; alternatif (kademeli gecikme) sızma testi sonucuna göre değerlendirilecek.

## Çalıştırılan kontroller
`pnpm audit` → “No known vulnerabilities found” (23.10.2026). `security.test.ts` 12/12, `gorev7.test.ts` 23/23 (MFA, dışa aktarımda sır yok, çapraz klinik). Depo sır taraması: özel anahtar, AWS/Stripe/Slack/GitHub belirteç kalıpları — 0 bulgu.
