# PİA-DENT — geliştirici talimatları

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

## Proje bitiş kuralı (CEZERİ teslim testi)
Kodlama tamamlandığında veya teslim adayı oluşturulduğunda `cezeri-teslim-testi` yeteneğini çağır. Varsa açık koşunun bulgu defterini kullan. Düzeltme geldiğinde yeniden çalıştır. Güncel sürüm için TESLİME ADAY raporu üretilene kadar "tamamlandı" yazma. İnsan onayıyla teslim et.
- Koşular `qa-runs/<id>/` altında (plan.json, results.json, bugs.md, handoff.md, release.md, evidence/). Karar: `node qa/cezeri/gate.cjs qa-runs/<id>/results.json qa-runs/<id>/plan.json $(git rev-parse HEAD)` → 0 teslim adayı, 2 durdur, 3 beklet.
- Yetenek dosyalarının kaynağı `qa/cezeri/` (kullanıcı makinesinde `~/.claude/skills/cezeri-teslim-testi/` ve `~/.claude/agents/`). Tester ürün kodunu değiştirmez; yama `cezeri-duzeltici` ile ayrı yapılır.
