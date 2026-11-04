import { expect, test, type Page } from "@playwright/test";

/** Görev 13 — geçmiş randevu içe aktarımı (ADR-072) ve PİA Akış eşikleri (ADR-073). */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"), { timeout: 15_000 });
}
const trDay = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + offset));
  return `${String(dt.getUTCDate()).padStart(2, "0")}.${String(dt.getUTCMonth() + 1).padStart(2, "0")}.${dt.getUTCFullYear()}`;
};

test("geçmiş randevu aktarımı: hasta kartları → randevular (çakışma hatalı) → onay → Hasta 360 geçmişinde görünür", async ({ page }, info) => {
  test.skip(info.project.name !== "masaustu", "durumlu akış");
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/yonetim?sekme=aktarim");
  const run = Date.now().toString(36).replace(/[0-9]/g, (d) => "ABCDEFGHJK"[Number(d)]!);
  const last = `Gecmis${run}`;
  const first = `Deniz${run.slice(-3)}`;
  const dob = `0${1 + (Date.now() % 9)}.0${1 + (Date.now() % 8)}.19${60 + (Date.now() % 30)}`;
  await page.getByLabel(/^Dosya/).setInputFiles({ name: `hasta-${run}.csv`, mimeType: "text/csv",
    buffer: Buffer.from(`﻿Kaynak_No;Adı;Soyadı;Doğum Tarihi\r\n${run}-P1;${first};${last};${dob}\r\n`) });
  await page.getByRole("button", { name: "Ön kontrol yap" }).click();
  await expect(page.getByText("Ön kontrol tamam. Hiçbir kayıt henüz yazılmadı.")).toBeVisible();
  await page.getByRole("region", { name: "Aktarım ayrıntısı" }).getByRole("button", { name: /1 satırı aktar/ }).click();
  await page.getByRole("alertdialog", { name: "Aktarımı onaylayın" }).getByRole("button", { name: "Aktar" }).click();
  await expect(page.getByText("1 kayıt aktarıldı.")).toBeVisible();

  await page.getByLabel("Aktarım türü").selectOption("appointment_history");
  await page.getByText("Beklenen sütunlar").click();
  await expect(page.getByText(/Geçmiş randevular için önce hasta kartlarını aktarın/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "Hekim", exact: true }).first()).toBeVisible();
  // koşu başına benzersiz gün: aynı seed'de tekrar koşuda DB çakışması olmasın (yalnız dosya içi çakışma sınanır)
  const d1 = trDay(-(30 + (Date.now() % 300))), d2 = trDay(-(400 + (Date.now() % 300)));
  const csv = `﻿Randevu_No;Kaynak_No;Tarih;Saat;Süre;Hekim;Durum;İşlem\r\n${run}-R1;${run}-P1;${d1};09:00;30;Dt. Elif Aras;geldi;Kontrol\r\n${run}-R2;${run}-P1;${d1};09:15;30;Dt. Elif Aras;geldi;\r\n${run}-R3;${run}-P1;${d2};10:00;30;Dt. Elif Aras;iptal;\r\n`;
  await page.getByLabel(/^Dosya/).setInputFiles({ name: `randevu-${run}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(/Sütun eşlemesi — 8 başlık bulundu, zorunlu alanlar tamam/)).toBeVisible();
  await page.getByRole("button", { name: "Ön kontrol yap" }).click();
  await expect(page.getByText("Ön kontrol tamam. Hiçbir kayıt henüz yazılmadı.")).toBeVisible();
  const detail = page.getByRole("region", { name: "Aktarım ayrıntısı" });
  await expect(detail.getByText(/Dosyada 1\. satırdaki randevuyla çakışıyor/)).toBeVisible();
  await expect(detail.getByRole("cell", { name: "Dt. Elif Aras" }).first()).toBeVisible();
  await expect(detail.getByRole("cell", { name: "İptal" })).toBeVisible();
  if (process.env.E2E_SHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/g13-randevu-aktarimi.png`, fullPage: true });
  await detail.getByRole("button", { name: /2 satırı aktar/ }).click();
  await page.getByRole("alertdialog", { name: "Aktarımı onaylayın" }).getByRole("button", { name: "Aktar" }).click();
  await expect(page.getByText("2 kayıt aktarıldı.")).toBeVisible();

  await page.goto(`/hastalar?q=${encodeURIComponent(last)}`);
  await page.locator("a.rowlink").filter({ hasText: last }).first().click();
  await page.waitForURL(/\/hastalar\//);
  await expect(page.getByText("Kontrol").first()).toBeVisible();
  await expect(page.getByText(/Tamamlandı/).first()).toBeVisible();
});

test("Yönetim → Güvenlik → PİA Akış eşikleri: sınır dışı değer reddedilir, geçerli değer kaydedilir ve kalıcıdır", async ({ page }, info) => {
  test.skip(info.project.name !== "masaustu", "durumlu akış");
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/yonetim?sekme=guvenlik");
  const f = page.getByLabel(/Geciken geliş uyarısı/);
  await expect(f).toHaveValue("10");
  await f.fill("3");
  await page.getByRole("button", { name: "Eşikleri kaydet" }).click();
  await expect(page.getByText(/Beklenen|en az|≥|5/).first()).toBeVisible();
  await f.fill("25");
  await page.getByRole("button", { name: "Eşikleri kaydet" }).click();
  await expect(page.getByText(/PİA Akış eşikleri kaydedildi/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Geciken geliş uyarısı/)).toHaveValue("25");
  await page.getByLabel(/Geciken geliş uyarısı/).fill("10");
  await page.getByRole("button", { name: "Eşikleri kaydet" }).click();
  await expect(page.getByText(/PİA Akış eşikleri kaydedildi/).last()).toBeVisible();
});
