# Güvenlik gözden geçirmesi (Görev 7, 23.10.2026)

Kapsam: Plan §08 “Teknik güvenlik tabanı” maddeleri + Görev 7'de eklenen içe/dışa aktarma, MFA ve yedek. Yöntem: kod incelemesi + otomatik testler (`security.test.ts`, `gorev7.test.ts`, `tenant-isolation.test.ts`, önceki görev testleri) + bağımlılık taraması + depo sır taraması. **Bağımsız sızma testi yapılmadı** (yayın kapısı).

## Plan §08 tabanı — durum
| Madde | Durum | Kanıt / not |
|---|---|---|
| TLS | ⛔ altyapı | Uygulama TLS sonlandırmaz; ters vekil (nginx/Caddy/yük dengeleyici) ile. Üretimde `Secure` çerez + HSTS açılır (testli). Sertifika/yapılandırma canlıya alma runbook'unda |
| Secret manager | ⛔ altyapı | Sırlar `.env`'den okunur (`.env` git dışı; `.env.example` boş/CHANGE_ME — testli). Üretimde secret manager'dan ortam değişkeni olarak enjekte edilmeli. `VIADENT_SECRET_KEY` döndürme prosedürü yok |
| Şifreli yedek | ✅ | AES-256-GCM + scrypt, kurcalama/yanlış parola reddi (testli), ayrı yalnız-okuma yedek rolü |
| Özel dosya depolama | ✅ | Görev 4: imzalı olmayan, API arkasında, tür imzası + boyut + tarama portu; üretimde ClamAV zorunlu |
| Güçlü oturum yönetimi | ✅ | Sunucu tarafı oturum, belirteç SHA-256 ile saklanır (bytea), 12 sa TTL, erişim kaldırmada iptal (AT-20), MFA sıfırlamada tüm oturumlar kapanır |
| Yönetici ve destek için MFA | ⚠️ kısmi | TOTP (RFC 6238 vektörüyle testli), tek kullanımlık meydan okuma, 5 deneme (atomik), kod tekrarına karşı adım kaydı (koşullu güncelleme), yönetici sıfırlaması (gerekçe + kendi hesabı değil + çok klinikli kullanıcıda yasak). **Zorunluluk yapılandırmayla:** `VIADENT_REQUIRE_MFA_ROLES=clinic_admin,finance` üretimde ayarlanmalı (yayın kapısı). “Destek” rolü/konsolu henüz yok → destek erişim süreci tanımlı değil |
| Hız sınırlama | ⚠️ kısmi | Giriş: e-posta+IP başına 5/15 dk **ve** hesap başına 20/15 dk (yeni, testli); MFA: meydan okuma başına 5. **Bellek içi, tek süreç** → çok süreçte paylaşılan depo (Redis/PG) gerekir. Genel API hız sınırı yok (ters vekilde önerilir) |
| Güvenli çerez | ✅ | `HttpOnly; SameSite=Lax; Secure (üretim); Path=/` — testli |
| CSRF | ✅ | SameSite=Lax + durum değiştiren her istekte `x-viadent-request: 1` özel başlık (testli); webhook ayrı imzalı yol |
| XSS | ✅ / ⚠️ | React çıktı kaçışı; `dangerouslySetInnerHTML` yok; CSP `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`. **`script-src 'unsafe-inline'`** (Next önyükleme betiği) → nonce'lu CSP backlog. CSV hücreleri formül enjeksiyonuna karşı korumalı. API yanıtlarında `default-src 'none'` |
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
| A2 | Hız sınırlayıcı bellek içi | Orta | Çok süreçte paylaşılan depo; ters vekilde genel istek sınırı |
| A3 | `VIADENT_SECRET_KEY` (webhook ve MFA sırları) tek anahtar, döndürme yok; KMS yok | Orta | Anahtar sürümlü şifreleme (`v1.` öneki var) + döndürme komutu |
| A4 | T.C. kimlik no veritabanında şifresiz (RLS + maskeleme var) | Orta | Alan düzeyinde şifreleme + arama için HMAC; yetkili danışmanla risk değerlendirmesi |
| A5 | CSP `script-src 'unsafe-inline'` | Düşük | Next middleware ile nonce'lu CSP |
| A6 | MFA zorunluluğu varsayılan kapalı (yapılandırma) | Orta | Üretim `.env`: `VIADENT_REQUIRE_MFA_ROLES=clinic_admin,finance` — runbook ve kapı listesinde |
| A7 | API/worker `tsx` ile çalışıyor (derlenmemiş) | Düşük | Üretim için derlenmiş çıktı + konteyner imajı |
| A8 | İçe aktarma satır verisi (`import_rows.data`) süresiz kalıyor | Orta (KVKK) | Saklama süresi danışmanla; pilot kabulünden sonra temizleme işi |
| A9 | Destek erişimi (VİADENT personelinin müşteri verisine erişimi) için rol, onay ve iz yok | Orta | Tanımlanana kadar destek yalnız ekran paylaşımıyla, müşteri oturumunda |
| A10 | Ekran okuyucuyla elle erişilebilirlik testi yok (AT-18 kısmi) | — | Pilot kontrol listesinde |

## Çalıştırılan kontroller
`pnpm audit` → “No known vulnerabilities found” (23.10.2026). `security.test.ts` 12/12, `gorev7.test.ts` 23/23 (MFA, dışa aktarımda sır yok, çapraz klinik). Depo sır taraması: özel anahtar, AWS/Stripe/Slack/GitHub belirteç kalıpları — 0 bulgu.
