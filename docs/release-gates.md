# Yayın kapıları (Plan §11 “Yayın tanımı”, §04 “Satış kapısı”) — durum 23.10.2026

> Son güncelleme: 26.10.2026, Görev 11 (güvenlik kapanışları + tarih alanı).
>
> **Karar: VİADENT bugün “tüm kliniklere satışa hazır” DEĞİLDİR.** Yazılımın P0 kapsamı çalışıyor ve testli; ancak resmî entegrasyon, veri işleme ve sözleşme kararları, klinik kullanıcı kabulü ve bağımsız güvenlik testi açık. Mevcut durum yalnız **sentetik demo** ve — aşağıdaki “pilot öncesi” kapıları kapandıktan sonra — **tek hedef klinikte kontrollü pilot** için uygundur. “Tam uyumlu”, “Bakanlık onaylı”, “e-Nabız entegre”, “e-Fatura entegre” ifadeleri kullanılmaz (ADR-051).

Durum: ✅ kapalı (kanıtlı) · ⚠️ kısmi · ⛔ açık · 🔒 dış erişim/karar bekliyor

## 1. Plan §11 yayın tanımı
| Kapı | Durum | Kanıt / kalan |
|---|---|---|
| Kritik testler geçer | ✅ | API 241/241, E2E 59 (5 bilinçli atlama; **derlenmiş üretim API/worker'ına karşı**), contracts 14, web kontrast 14, typecheck temiz, `next build` (bkz. `verification.md`). AT-01…AT-17, AT-19, AT-20 otomatik testli; AT-18 kısmi (aşağıda) |
| Açık kritik/yüksek güvenlik bulgusu yok | ⚠️ | İç denetim (Görev 9) 9 bulgu kapattı; Görev 10 kimlik no şifreleme, kurtarma kodları, klinik MFA politikası ve destek erişim modelini ekledi; Görev 11 düz metin kimlik sütununu kaldırdı, gerekçeli kimlik gösterimi, dört göz ve kademeli gecikme ekledi; bilinen açık kritik/yüksek yok; `pnpm audit` 0 (multer override). **Bağımsız sızma testi yapılmadı** → kapı açık sayılır (`security-review.md` A1) |
| Finans mutabakatı | ✅ (yazılım) / ⛔ (klinik) | AT-06…AT-10, AT-19, rapor toplamı = alt kayıtlar, içe aktarma tutar mutabakatı, yedek-geri yükleme finans toplamları mutabık. **Mali müşavir onayı** (KDV gösterimi, yuvarlama, prim kesinti sırası, iade belgesi) ve pilotta paralel gün sonu mutabakatı yapılmadı |
| Geri yükleme denenmiş | ✅ (teknik) / ⚠️ (işletim) | İzole geri yükleme + sayım/finans/dosya mutabakatı otomatik (AT-17); 100k hasta/1M randevu 93 sn. RPO ≤ 1 sa için **saatlik zamanlanmış yedek veya WAL arşivleme kurulmadı**; insanlı uçtan uca tatbikat yapılmadı |
| Zorunlu entegrasyon ve sözleşmeler kapalı | 🔒 | Aşağıda §3. Hedef klinik için hangilerinin **zorunlu** olduğu kararı açık |
| Klinik kullanıcı kabulü | ⛔ | Pilot hekim/sekreter/finans kabulü alınmadı; klinik içerik (anamnez, bulgu, tanı kodu, belge/onam metinleri) DEMO |
| Rollback ve destek sorumlusu belli | ⚠️ | Rollback adımları yazıldı (`runbook-deploy-rollback.md`); **sorumlu kişi, nöbet ve destek kanalı atanmadı** |

## 2. Güvenlik tabanı (Plan §08) — özet
TLS ⚠️ (Caddy otomatik TLS yapılandırması hazır, sunucu yok) · secret manager ⛔ (altyapı; anahtar döndürme ✅ ADR-052) · şifreli yedek ✅ · özel dosya deposu ✅ (üretimde ClamAV ⛔) · MFA ✅ yazılım / ⛔ üretimde zorunluluk ayarı · hız sınırlama ✅ (PostgreSQL'de paylaşılan, ADR-053; genel istek sınırı ters vekilde ⚠️) · güvenli çerez ✅ · CSRF/XSS ✅ (nonce'lu CSP, `unsafe-inline` yok — E2E'de ihlal 0) · ayrı DB rolleri ✅ · log/seed'de sır yok ✅. Ayrıntı `security-review.md`.

## 3. Resmî entegrasyon, veri işleme ve sözleşme kararları
| Konu | Durum | Gereken kanıt (Plan §08) | Sahibi |
|---|---|---|---|
| Sağlık Bakanlığı / DHBS / e-Nabız | 🔒 | Güncel kapsam teyidi (13.08.2026 SBYS yönetmelik değişikliği dahil), kayıt/tescil, test ortamı, teknik doküman | Ürün sahibi + hukuk |
| e-Fatura / e-Arşiv / e-SMM | 🔒 | Yetkili sağlayıcı sözleşmesi, test belgesi, mali müşavir onayı | Ürün sahibi + mali müşavir |
| SMS / WhatsApp | 🔒 | Sağlayıcı sözleşmesi, iletişim izni değerlendirmesi, teslim webhook'u; şu an yalnız MOCK | Ürün sahibi |
| Ödeme sağlayıcısı | 🔒 | Sözleşme, test senaryoları; kart verisi VİADENT'te tutulmaz; şu an yalnız MOCK | Ürün sahibi |
| Belge doğrulama / imza | 🔒 | Seçilen yöntemin klinik/hukuki uygunluğu; şu an yüz yüze kabul + personel beyanı | Hukuk |
| KVKK | ⛔ | Veri envanteri, aydınlatma metni, işleme şartları, **veri işleme sözleşmesi (klinik = sorumlu, VİADENT = işleyen)**, saklama/imha süreleri, alt işleyenler (barındırma, yedek, e-posta), yurt dışı aktarım değerlendirmesi, veri sahibi başvuru süreci | Hukuk + ürün sahibi |
| Barındırma | ⛔ | Sağlayıcı, bölge, şifreleme, erişim, yedek kopya yeri, SLA | Ürün sahibi |
| Müşteri sözleşmesi / SLA / fiyat | ⛔ | Hizmet sözleşmesi, destek saatleri, veri taşıma kapsamı, çıkışta veri iadesi (açık JSON dışa aktarım hazır) | Ürün sahibi |

## 4. Kabul testleri (Plan §11)
| Test | Durum | Kanıt |
|---|---|---|
| AT-01 çapraz klinik | ✅ | `tenant-isolation.test.ts`, içe/dışa aktarma çapraz klinik (gorev7) |
| AT-02 sunucu yetkisi | ✅ | izin testleri (her görev) |
| AT-03 çift rezervasyon | ✅ | gorev1/scheduling (DB exclusion) |
| AT-04 doğum tarihi / aile telefonu | ✅ | scheduling-patients; içe aktarmada zayıf aday = uyarı |
| AT-05 kabul edilmiş plan | ✅ | gorev2 |
| AT-06 … AT-10 finans | ✅ | gorev3 |
| AT-11 dosya | ✅ | gorev4 |
| AT-12 / AT-13 sağlayıcı (MOCK) | ✅ (MOCK) | gorev5 — gerçek sağlayıcı yok |
| AT-14 belge sürümü | ✅ | gorev4 |
| AT-15 klinik değiştirme | ✅ | permissions-session + E2E |
| **AT-16 içe aktarma tekrar** | ✅ | gorev7: aynı dosya → aynı batch; farklı dosya aynı kaynak no → yazılmaz; hata satırları + kaynak toplamı uzlaşır; E2E |
| **AT-17 izole geri yükleme** | ✅ (teknik) | gorev7: sayım + klinik bazında hasta/finans + dosya mutabık, süre ölçülür, kurcalama reddi; perf DB ölçümü |
| AT-18 360 px + klavye + ekran okuyucu | ⚠️ | 360 px ve klavye E2E (Görev 11: takvim klavye gezinmesi dahil); **ekran okuyucuyla elle test yok** |
| AT-19 gece yarısı | ✅ | gorev3/gorev6 |
| AT-20 erişim kaldırma | ✅ | permissions-session (worker + dosya dahil) |

## 5. Performans (Plan §11)
✅ 100.024 hasta / 1.000.009 randevu / 50 eşzamanlı kullanıcı: gerçekçi profilde p95 39,6 ms, yoğun profilde 201,8 ms; sayfalar ≤ 1,6 sn (500 ms ölçüm penceresi dahil). ⚠️ Doygunlukta (düşünme süresiz) p95 565 ms: tek süreçli API + aynı makinede DB → üretimde ayrı DB ve ≥2 API süreci. Ayrıntı `performance.md`.

## 5b. Görev 8 ile kapanan teknik kapılar
Derlenmiş üretim çıktısı (tsx yok) ✅ · konteyner tanımları ⚠️ (yazıldı; imaj deposuna erişim olmadığı için **derlenmedi**) · CI iş akışı ⚠️ (yazıldı; depo GitHub'a bağlı olmadığı için **koşmadı**) · saatlik yedek + günlük doğrulama zamanlayıcısı ✅ (compose döngüsü bir tur koşuldu; systemd birimleri doğrulandı) · paylaşılan giriş sınırlayıcısı ✅ · anahtar döndürme ✅ · nonce'lu CSP ✅ · içe aktarma satır verisi saklama ✅ (30 gün varsayılan, danışman onayı ⛔) · sağlık/hazır olma/metrik uçları ✅. Ayrıntı `deployment.md`.

## 6. Pilot öncesi kapanması gerekenler (kontrollü tek klinik pilotu için asgari)
1. Veri işleme sözleşmesi + KVKK aydınlatma/işleme şartı değerlendirmesi (hukuk) — **gerçek veri bundan önce alınmaz**.
2. Barındırma seçimi ve kurulum: sunucu, alan adı + TLS, secret manager, ayrı DB sunucusu, `infra/compose.prod.yml` veya systemd ile çalıştırma, yedek biriminin ikinci konuma kopyası, ClamAV, izleme alarmları (`deployment.md` §7). İmajların ilk derlemesi ve imaj içi duman testi.
3. `VIADENT_REQUIRE_MFA_ROLES=clinic_admin,finance`, `VIADENT_EXTERNAL_SEND_ENABLED=false`.
4. Bağımsız sızma testi (en az kimlik/oturum, çapraz klinik, dosya, içe aktarma) ve yüksek bulguların kapatılması.
5. Uçtan uca geri yükleme tatbikatı (insanlı, süre ölçümlü) + rollback provası.
6. Pilot hekimle klinik içerik onayı (anamnez soruları, bulgu/tanı listesi, belge metinleri) — onaylanmayan içerik pilotta kapalı.
7. Mali müşavir ile finans kuralları; pilot süresince paralel gün sonu mutabakatı.
8. Sorumlu kişiler: yayın sahibi, rollback kararı verici, destek ve nöbet (isimli).
9. Kullanıcı eğitimi ve klinik kullanıcı kabulü (rol bazlı senaryolar).

Bu kapılar kapanmadan **satış/pazarlama metninde** “hazır”, “uyumlu”, “entegre” iddiası kullanılmaz; demo sentetik veriyle ve MOCK etiketleri görünür halde yapılır.
