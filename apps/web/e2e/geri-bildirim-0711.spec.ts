import { expect, test, type Page } from "@playwright/test";

/**
 * Ürün sahibi geri bildirimi 07.11.2026 — kullanıcı akışları (ADR-098…102):
 *  Panel'de "Günün randevuları" yok; Hekimler listesinde çalışma saati / bu ay randevu sütunu yok, izin-rapor-tatil kartı var;
 *  Raporlar sekmeleri (Gelirler / Giderler alt başlıkları / Tedarikçi) ve kaldırılan kartlar; İşlem kayıtları Türkçe;
 *  Yönetim sekmeleri (İşlem türleri fiyatlı, Kapatmalar ve Anamnez yok, ürün listesi Operasyon → Tedarikçi);
 *  Randevu ver tam sayfa: tek işlem seçimi, sağlık uyarısı, boş saatler, ödeme planı; Mesajlar sekmesi; klinik dışa aktarımı indirilir.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Bugünün randevuları", level: 2 })).toBeVisible();
}
async function noHorizontalOverflow(page: Page) {
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "yatay taşma").toBeLessThanOrEqual(vw + 1);
}

test("Panel ve Hekimler sadeleşti; hekim kartında izin / rapor / resmî tatil", async ({ page }) => {
  await login(page, "yonetici@demo-yesil.test");
  // 08.11.2026 geri bildirimi bu kararı değiştirdi: Panel en üstte bugünün randevularını gösterir (geri-bildirim-0811.spec.ts).
  await expect(page.getByRole("heading", { name: "Bugünün randevuları", level: 2 })).toBeVisible();
  await page.goto("/hekimler");
  const table = page.locator("table").first();
  await expect(table.getByRole("columnheader", { name: "Hekim" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Çalışma saatleri" })).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: "Bu ay randevu" })).toHaveCount(0);
  await table.locator("tbody tr").first().locator("button.link-button").click();
  await expect(page.getByRole("heading", { name: "İzin, rapor ve resmî tatiller" })).toBeVisible();
  await page.getByRole("region", { name: "İzin, rapor ve resmî tatiller" }).getByRole("button", { name: "Ekle" }).click();
  const dr = page.getByRole("dialog", { name: /İzin, rapor veya resmî tatil ekle/ });
  await dr.getByLabel("Tür").selectOption("public_holiday");
  await expect(dr.getByLabel("Resmî tatil")).toBeVisible();
  await expect(dr.getByLabel("Resmî tatil").locator("option", { hasText: "Cumhuriyet Bayramı" }).first()).toBeAttached();
  await noHorizontalOverflow(page);
});

test("Raporlar: Gelirler / Giderler (Maaşlar…Faturalar) / Tedarikçi sekmeleri; kaldırılan kartlar yok; İşlem kayıtları Türkçe", async ({ page }) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/raporlar");
  const tabs = page.getByRole("tablist", { name: "Rapor bölümleri" });
  for (const t of ["Tüm raporlar", "Gelirler", "Giderler", "Tedarikçi"]) await expect(tabs.getByRole("tab", { name: t })).toBeVisible();
  for (const gone of [/Hekim primleri/, /Online ödeme sorgulama/, /Tedavi sorgulama/, /Plan sorgulama/, /Hekim hasta sayıları/, /Kontrol sorgulama/, /SMS \/ mesaj/]) {
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
  }
  await tabs.getByRole("tab", { name: "Gelirler" }).click();
  await expect(page.getByRole("heading", { name: "Gelirler — hasta ödemeleri" })).toBeVisible();
  await expect(page.getByLabel("Toplamlar").getByText("Net gelir")).toBeVisible();
  await tabs.getByRole("tab", { name: "Giderler" }).click();
  const heads = page.getByRole("tablist", { name: "Gider başlıkları" });
  for (const h of ["Özet", "Maaşlar", "Malzemeler", "Kira", "Aidat", "Faturalar"]) await expect(heads.getByRole("tab", { name: h })).toBeVisible();
  await heads.getByRole("tab", { name: "Kira" }).click();
  await expect(heads.getByRole("tab", { name: "Kira" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Toplamlar").getByText("Kira", { exact: true })).toBeVisible();
  await tabs.getByRole("tab", { name: "Tedarikçi" }).click();
  await expect(page.getByRole("heading", { name: "Tedarikçi alımları" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Kalan borç" })).toBeVisible();
  await tabs.getByRole("tab", { name: "Tüm raporlar" }).click();
  await page.getByRole("button", { name: /İşlem kayıtları sorgulama/ }).click();
  await expect(page.getByRole("heading", { name: "İşlem kayıtları sorgulama" })).toBeVisible();
  const text = await page.locator("main table").innerText().catch(() => "");
  expect(text).not.toMatch(/\b[a-z]+_[a-z_]+\b|\b[a-z]+\.[a-z_]+\b/); // ham kod (patient.create, clinical_chart) yok
  await noHorizontalOverflow(page);
});

test("Yönetim: İşlem türleri fiyatlı; Kapatmalar ve Anamnez şablonu yok; ürün listesi Operasyon → Tedarikçi; Entegrasyonlar Türkçe", async ({ page }) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/yonetim?sekme=turler");
  const tl = page.getByRole("tablist", { name: "Yönetim bölümleri" });
  await expect(tl.getByRole("tab", { name: "Kapatmalar" })).toHaveCount(0);
  await expect(tl.getByRole("tab", { name: "Anamnez şablonu" })).toHaveCount(0);
  await expect(tl.getByRole("tab", { name: "Ürün ve fiyat listesi" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "İşlem türleri" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Fiyat" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kompozit dolgu (tek yüz)" })).toBeVisible();
  await page.goto("/yonetim?sekme=urunler"); // eski bağlantı taşınan sekmeye gider
  await expect(page).toHaveURL(/\/laboratuvar\?sekme=tedarikci/); // 08.11.2026: Tedarikçiler Laboratuvar menüsünde
  await expect(page.getByRole("heading", { name: "Ürün ve fiyat listesi" })).toBeVisible();
  await page.goto("/yonetim?sekme=kopru");
  await expect(page.getByRole("heading", { name: "Netgsm SMS" })).toBeVisible();
  const main = await page.locator("main").innerText();
  expect(main).not.toMatch(/\bMOCK\b|Webhook|HMAC|sandbox|callback/);
});

test("Randevu ver tam sayfa: tek işlem seçimi, sağlık uyarısı, uygun saatler, ödeme planı (kısmi → gerçek tahsilat)", async ({ page }) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/ajanda");
  await page.getByRole("button", { name: "Randevu ver" }).click();
  await expect(page.getByRole("heading", { name: "Randevu ver", level: 1 })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0); // çekmece değil
  await expect(page.getByLabel("İşlem türü")).toHaveCount(0);
  await expect(page.getByLabel("Planlanan işlem")).toHaveCount(0);
  // yeni hasta + sağlık özeti
  await page.getByRole("textbox", { name: "Hasta", exact: true }).fill("Sayfa Randevu");
  await page.getByRole("button", { name: /Yeni hasta oluştur/ }).click();
  const np = page.getByRole("dialog", { name: "Yeni hasta" });
  await np.getByLabel("Kronik hastalık").fill("Hipertansiyon (sentetik)");
  await np.getByLabel("Sürekli kullandığı ilaç").fill("Kan sulandırıcı (sentetik)");
  await np.getByRole("button", { name: "Hastayı kaydet" }).click();
  const warn = page.getByRole("alert").filter({ hasText: "Sağlık uyarısı" }).or(page.locator(".alert", { hasText: "Sağlık uyarısı" }));
  await expect(warn.first()).toContainText("Kan sulandırıcı (sentetik)");
  const islem = page.getByRole("combobox", { name: "İşlemler (isteğe bağlı)" });
  const opt = await islem.locator("option", { hasText: "Kompozit dolgu (tek yüz)" }).first().getAttribute("value");
  await islem.selectOption(opt!);
  // 08.11.2026 (ADR-107): seçilen işlemler listede fiyatlarıyla görünür
  await expect(page.getByRole("list", { name: "Seçilen işlemler" })).toContainText("₺");
  // QA-301: elle yazılan geçmiş gün → alan uyarır, saat listelenmez, kaydet sunucuya gitmeden engeller.
  const gun = page.getByPlaceholder("gg.aa.yyyy").first();
  await gun.fill("01.01.2026");
  await gun.blur();
  await expect(page.getByText("Geçmiş gün seçilemez")).toBeVisible();
  await expect(page.getByText("Geçmiş gün için saat listelenmez; bugün veya ileri bir gün seçin.")).toBeVisible();
  let apptPosts = 0;
  const countPost = (r: { method(): string; url(): string }) => { if (r.method() === "POST" && /\/appointments$/.test(new URL(r.url()).pathname)) apptPosts++; };
  page.on("request", countPost);
  await page.getByRole("button", { name: "Randevuyu kaydet" }).click();
  await expect(page.getByText("Geçmiş bir tarih veya saate randevu oluşturulamaz. Lütfen ileri bir saat seçin.")).toBeVisible();
  page.off("request", countPost);
  expect(apptPosts, "geçmiş gün için sunucuya randevu isteği gitmemeli").toBe(0);
  // İlk hafta içi gün (seed hekimleri hafta sonu çalışmaz; pazar günü "boş saat yok" doğru davranıştır).
  const tomorrow = new Date(Date.now() + 86_400_000);
  while ([0, 6].includes(tomorrow.getDay())) tomorrow.setDate(tomorrow.getDate() + 1);
  const ddmmyyyy = `${String(tomorrow.getDate()).padStart(2, "0")}.${String(tomorrow.getMonth() + 1).padStart(2, "0")}.${tomorrow.getFullYear()}`;
  await page.getByPlaceholder("gg.aa.yyyy").first().fill(ddmmyyyy);
  await expect(page.getByRole("heading", { name: new RegExp(`Uygun saatler.*${ddmmyyyy.replace(/\./g, "\\.")}`) })).toBeVisible();
  const slots = page.getByRole("radiogroup", { name: "Uygun saatler" });
  await expect.poll(() => slots.getByRole("radio").count(), { timeout: 10_000 }).toBeGreaterThan(3);
  await slots.getByRole("radio").nth(1).click();
  await page.getByRole("radiogroup", { name: "Ödeme" }).getByRole("radio", { name: "Kısmi ödeme" }).click();
  await page.getByLabel("Alınan tutar (₺)").fill("250,00");
  await expect(page.getByText(/Kalan:/)).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "Randevuyu kaydet" }).click();
  await expect(page.getByText(/Randevu oluşturuldu; .*250,00.* ödeme alındı/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Randevular", level: 1 })).toBeVisible();
});

test("Mesajlar sekmesi: tüm hastalar, DENEME uyarısı, zamanlama ve otomatik kurallar; hekim de mesaj yazar", async ({ page }) => {
  await login(page, "elif.aras@demo-yesil.test");
  await expect(page.getByRole("navigation").first().getByRole("link", { name: "Mesajlar" })).toBeAttached(); // menüde
  await page.goto("/mesajlar");
  await expect(page.getByRole("heading", { name: "Mesajlar", level: 1 })).toBeVisible();
  await expect(page.getByText(/DENEME — gerçek mesaj gönderilmez|SMS sağlayıcısı yok/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hastalar" })).toBeVisible();
  expect(await page.locator("main table tbody tr").count()).toBeGreaterThan(3);
  await page.getByRole("radio", { name: "Zamanla" }).click();
  await expect(page.getByLabel("Saat")).toBeVisible();
  await page.getByRole("tab", { name: "Otomatik mesajlar" }).click();
  await expect(page.getByRole("heading", { name: /Randevudan önce hatırlatma/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Randevudan sonra bilgilendirme/ })).toBeVisible();
  await expect(page.getByText("Kuralı yalnız yönetici değiştirir.").first()).toBeVisible();
  await noHorizontalOverflow(page);
});

test("Yönetim → Dışa aktarım: dosya gerçekten iner ve elle indirme bağlantısı da gösterilir", async ({ page }, info) => {
  test.skip(info.project.name !== "masaustu", "indirme masaüstünde sınanır");
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/yonetim?sekme=disa");
  await page.getByLabel("Gerekçe").fill("Sentetik E2E dışa aktarım denemesi");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Dışa aktar (JSON)" }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^viadent-klinik-disa-aktarim-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await file.path();
  const json = JSON.parse((await import("node:fs")).readFileSync(path!, "utf8"));
  expect(json.format).toBe("viadent-export");
  expect(json.counts.patients).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: /dosyasını indir/ })).toBeVisible();
});
