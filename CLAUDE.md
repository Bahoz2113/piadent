# VİADENT — geliştirici talimatları

Yeni oturumda önce oku: `docs/handoff.md`, `docs/decisions.md`, `docs/backlog.md`, `git diff`. Tamamlanmış işi yeniden kurma.

Kurallar (özet; tam liste VIADENT_Claude_Prompt.pdf):
- Tenant kimliği istemciden alınmaz; `Db.tx(ctx, …)` dışında iş verisine erişme. Yeni iş tablosu = `tenant_id` + RLS (ENABLE+FORCE) + bileşik FK + grant.
- Uygulanmış migration'ı değiştirme; yeni `NNNN_*.sql` ekle.
- Domain değişikliği + `audit()` + gerekiyorsa `enqueue()` aynı transaction'da.
- Para için kayan nokta yok; finans komutlarında idempotency + transaction + audit; silme yerine ters kayıt.
- Gerçek sağlayıcı/resmî servis yoksa yalnız etiketli mock; sahte başarı yok.
- Rakip (Macrodental) kodu, ekranı, metni, onam içeriği kopyalanmaz.
- Çalıştırmadığın testi geçmiş sayma; “tamamlandı” yalnız kabul kriteri sağlanınca.
- Arayüz metinleri Türkçe; tarih gg.aa.yyyy, saat 24 saat, klinik saat dilimi.
- Oturum sonunda `docs/handoff.md` ve `docs/verification.md` güncelle.
