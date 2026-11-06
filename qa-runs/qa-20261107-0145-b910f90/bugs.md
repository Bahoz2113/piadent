# Bulgu defteri — qa-20261107-0145-b910f90
Sürüm: b910f90 (07.11.2026 ürün sahibi geri bildirimi). Tester ürün kodunu değiştirmez; düzeltme cezeri-duzeltici ile ayrı.

## Tur 1 — ürün kusuru bulunmadı
- HTTP: 39 + 15 vaka; başarısızlar yalnız kabul değişikliğinden etkilenen eski beklentiler (aşağıda) ve bir saat bağımlılığı (F02). G01–G15: 15/15 PASS.
- Tarayıcı: eski çekmece tabanlı betik kopyası (F01/F11/F12 "Randevu ver" çekmecesi, N04 anamnez paneli) tur başlamadan güncellenmiş betikle yer değiştirmediğinden zaman aşımına uğradı; ürün davranışı (tam sayfa, ADR-101; anamnez paneli yok, ADR-100) bilerek değişti. Tur 2'de güncel betikle yeniden koşulur.

## Tester betiği düzeltmeleri (kabul değişikliği; beklenti gevşetilmedi, kaynağı ürün sahibi kararı)
- **ADR-098 (yönetici tüm yetkili):** "yönetici görmez/yapamaz" alt kontrolleri sağlık/finans yetkisiz rolle yeniden yazıldı, yöneticinin görmesi/yapması olumlu kontrol oldu:
  - F06 maaş ödemesi: yetkisiz ödeme sekreterle (403); B yöneticisinin A hekimine ödemesi kiracı sınırıyla reddedilir (403/404/422, kayıt yok).
  - N02 fatura taslağı: yönetici taslak açar (201), sekreter 403 kalır.
  - N04 anamnez şablonu yayını: yetkisiz yayın sekreterle (403), yayını hekim yapar.
  - N05 klinik çıktı: sekreter listede/ayrıntıda görmez (404) kalır; yönetici listede ve ayrıntıda görür, KVKK dışa aktarımında klinik çıktıyı alır. Gerçek belgede yönetici iptali artık yetkili olduğundan varlık gizleme yalnız var olmayan belgeyle sınanır. Sağlık yetkisiz dışa aktaran gerçek rol kalmadı (export.patient yalnız yönetici); süzgeç API testinde eski küme kancasıyla (useLegacyAdmin) sınanır.
  - N11 dosya hassasiyeti: yönetici klinik dosyayı listede/dışa aktarımda/geçmişte/karantina görevinde görür (olumlu); sekreterin görmemesi aynen.
- **ADR-101 (randevu tam sayfa, tek işlem seçimi):** F01 geçmiş dilim sayfayı açmamalı + tarih alanı geçmişi kabul etmemeli; F11 kapatma uyarısı sayfa "Vazgeç" (temiz uyarısız, kirli/yalnız Not modal, Forma dön veriyi korur, Çık kapatır) + çekmece kuralı (X/Esc/arka plan) "Yeni hasta" çekmecesinde; F12 tek "İşlem" seçimi (eski iki alan yok) + fiyat + bakiye şeridi.
- **ADR-100 (anamnez arayüzü kaldırıldı):** N04 tarayıcı adımı Sağlık sekmesinde "Sağlık özeti" olması ve eski anamnez panelinin olmaması; sürümlü anamnez API kuralları n-cases N04'te aynen.
- **ADR-099 (MOCK → DENEME):** N02 tarayıcı rozet metni "DENEME / Deneme e-belge".
- **F02 saat bağımlılığı (tester kusuru):** saati geçmiş randevu "bugün 07:10" ile kuruluyordu; koşu 07:40'tan önce yapılınca gelecekte kalıyordu. Gece koşusunda 60 dk önce (00:15 öncesinde dün 23:10).

## Kayıtlı riskler (bulgu değil)
- Geliştirici ön koşusunda (tester turu değil) `gorev7.spec.ts` veri aktarımı testi telefon profilinde bir kez "Aktarılabilir 1" (beklenen 2) verdi; ardından 6/6 tekrarda geçti; iz dosyası üzerine yazıldığından kök neden doğrulanamadı (hipotez: test verisi/sıra). Tester tam E2E koşusunda tekrar izlenir.
- Netgsm gerçek gönderimi sınanmadı: kimlik bilgisi yok, canlı gönderim kapısı kapalı (ürün sahibi Vercel ortamına girer). Netgsm anahtarla durum sorgusu sunmadığından yanıtı alınamayan gönderim "sonuç bilinmiyor" kalır.
- Vercel'de zamanlanmış/otomatik mesajlar sistem kullanıldıkça en çok dakikada bir işlenir (sürekli worker yok).

## Tur 2 (b910f90, temiz seed, tam regresyon)
Sonuç: 59/60 PASS; E2E 110 geçti + 10 bilinçli atlama, 0 hata. Gate: BEKLET (F01).

### QA-301 — Randevu sayfasında geçmiş gün yazılınca uyarı yok (S3, OPEN)
- **Vaka:** F01 (madde 1 kabulü: "tarih alanı bugünden öncesini kabul etmez"). Profil: chromium-desktop + chromium-mobile-emulation. Rol: yönetici.
- **Adımlar:** Randevular → Randevu ver (tam sayfa) → Gün alanına 01.01.2026 yaz → alandan çık.
- **Beklenen:** Alan geçmiş günü kabul etmez veya açık uyarı ("Geçmiş gün seçilemez"); kayıt düğmesi geçmiş gün için sunucuya gitmeden engeller.
- **Gözlenen:** Değer "01.01.2026" kalır, uyarı yok (`evidence/tur2/browser-f-summary.json` F01; `masaustu-F01-ajanda.jpg`, `mobil-F01-ajanda.jpg`). Uygun saatler listesi boş görünür ama nedeni söylenmez; elle saat girilirse sunucu 422 APPOINTMENT_IN_PAST verir (veri kaybı/yanlış kayıt yok).
- **Tanı (hipotez):** eski çekmecede saat alanı `inPast` ile "Geçmiş saat seçilemez" uyarısı veriyordu; tam sayfaya taşınırken (ADR-101) bu istemci denetimi taşınmadı. `DateField min` yalnız takvim seçimini sınırlıyor, elle yazımı değil.
- **Etki:** Düşük: kayıt sunucuda engelleniyor; kullanıcı neden boş saat olmadığını anlamıyor. **Sorumlu:** cezeri-duzeltici (web).
- **Tester düzeltmesi (aynı vaka):** gece koşusunda (08:00 öncesi) ajandada bugünün "geçmiş dilimi" yoktur → geçmiş dilim kontrolü dünün gününde yapılır (saat bağımlılığı; beklenti aynı).
