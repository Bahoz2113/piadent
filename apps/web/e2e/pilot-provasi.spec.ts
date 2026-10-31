import { expect, test, type Page } from "@playwright/test";

/**
 * Görev 14 — "pilot günü provası": UAT senaryolarının (docs/uat-senaryolari.md) otomatik ön koşusu, tek akışta.
 * Yönetici veri taşır (hasta → geçmiş randevu → geçmiş işlem) → sekreter aynı hastaya randevu verir → hekim Hasta 360'ta
 * aktarılan işlemi görür → sekreter tahsilat alır → yönetici raporda hastayı görür. Elle UAT'ın yerine geçmez (imza klinik kullanıcısının).
 */
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
async function importCsv(page: Page, kind: string, name: string, csv: string, expectValid: number) {
  await page.goto("/yonetim?sekme=aktarim");
  await page.getByLabel("Aktarım türü").selectOption(kind);
  await page.getByLabel(/^Dosya/).setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(`﻿${csv}`) });
  await page.getByRole("button", { name: "Ön kontrol yap" }).click();
  await expect(page.getByText("Ön kontrol tamam. Hiçbir kayıt henüz yazılmadı.")).toBeVisible();
  const detail = page.getByRole("region", { name: "Aktarım ayrıntısı" });
  page.once("dialog", (d) => void d.accept());
  await detail.getByRole("button", { name: `${expectValid} satırı aktar` }).click();
  await expect(page.getByText(`${expectValid} kayıt aktarıldı.`)).toBeVisible();
}

test("pilot günü provası: veri taşıma → randevu → tedavi görünümü → tahsilat → rapor", async ({ browser }, info) => {
  test.skip(info.project.name !== "masaustu", "durumlu uçtan uca akış");
  test.setTimeout(240_000);
  const run = Date.now().toString(36).replace(/[0-9]/g, (d) => "ABCDEFGHJK"[Number(d)]!);
  const last = `Prova${run}`, first = `Pilot${run.slice(-3)}`;
  const dob = `0${1 + (Date.now() % 9)}.0${1 + (Date.now() % 8)}.19${60 + (Date.now() % 30)}`;

  // 1) Yönetici: hasta kartı → geçmiş randevu → geçmiş işlem → açılış bakiyesi
  const a = await browser.newContext(); const admin = await a.newPage();
  await login(admin, "yonetici@demo-yesil.test");
  await importCsv(admin, "patients", `hasta-${run}.csv`, `Kaynak_No;Adı;Soyadı;Doğum Tarihi;Telefon\r\n${run}-P1;${first};${last};${dob};0555 000 ${String(Date.now() % 100).padStart(2, "0")} 11\r\n`, 1);
  await importCsv(admin, "appointment_history", `randevu-${run}.csv`, `Randevu_No;Kaynak_No;Tarih;Saat;Hekim;Durum;İşlem\r\n${run}-R1;${run}-P1;${trDay(-30)};09:00;Dt. Elif Aras;geldi;Kontrol\r\n`, 1);
  await importCsv(admin, "treatment_history", `islem-${run}.csv`, `İşlem_No;Kaynak_No;Tarih;İşlem;Diş;Bedel;Hekim\r\n${run}-T1;${run}-P1;${trDay(-30)};DOL-01;36;1.800,00;Dt. Elif Aras\r\n`, 1);
  await importCsv(admin, "opening_balances", `bakiye-${run}.csv`, `kaynak_no;tutar;tarih;aciklama\r\n${run}-P1;500,00;${trDay(-30)};Önceki sistem açık bakiyesi\r\n`, 1);
  await a.close();

  // 2) Sekreter: hastayı bul, gelecek randevu ver (çalışma saati içinde), tahsilat al
  const s = await browser.newContext(); const sec = await s.newPage();
  await login(sec, "sekreter@demo-yesil.test");
  await sec.goto(`/hastalar?q=${encodeURIComponent(last)}`);
  await sec.locator("a.rowlink").filter({ hasText: last }).first().click();
  await sec.waitForURL(/\/hastalar\//);
  const url = sec.url();
  await expect(sec.getByText("Kontrol").first()).toBeVisible(); // aktarılan geçmiş randevu
  await sec.getByRole("link", { name: "Randevu ver" }).click();
  const ap = sec.getByRole("dialog", { name: "Randevu ver" });
  await expect(ap.getByText(`${first} ${last}`)).toBeVisible();
  await ap.getByRole("textbox", { name: "Tarih", exact: true }).fill(trDay(40 + (Date.now() % 20)));
  await ap.getByRole("textbox", { name: "Saat", exact: true }).fill("10:30");
  await ap.getByLabel("Açıklama").fill("Kontrol (prova)");
  await ap.getByRole("button", { name: "Randevuyu kaydet" }).click();
  const outside = ap.getByRole("button", { name: "Çalışma saati dışında yine de kaydet" });
  if (await outside.isVisible().catch(() => false)) await outside.click();
  await expect(sec.getByText("Randevu oluşturuldu.")).toBeVisible();
  await sec.goto(`${url.split("?")[0]}?sekme=finans`);
  await expect(sec.getByRole("heading", { name: "Hesap · VİA Net" })).toBeVisible();
  await sec.getByRole("button", { name: "Tahsilat al" }).click();
  const d = sec.getByRole("dialog", { name: "Tahsilat al" });
  await d.getByLabel("Tutar (₺)").fill("200,00");
  await d.getByRole("button", { name: "Vadesi eski olandan başlayarak dağıt" }).click();
  await d.getByRole("button", { name: "Kaydet" }).click();
  await expect(sec.getByText("Tahsilat kaydedildi ve dağıtıldı.")).toBeVisible();
  await s.close();

  // 3) Hekim: Tedavi sekmesinde aktarılan işlem (alacak yok notuyla)
  const h = await browser.newContext(); const den = await h.newPage();
  await login(den, "elif.aras@demo-yesil.test");
  await den.goto(url.split("?")[0]!);
  await den.getByRole("tab", { name: "Tedavi" }).click();
  await expect(den.getByText("DOL-01").first()).toBeVisible();
  await expect(den.getByText(/Önceki sistemden aktarıldı/).first()).toBeVisible();
  if (process.env.E2E_SHOTS_DIR) await den.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/g14-tedavi-aktarilan.png`, fullPage: true });
  await h.close();

  // 4) Finans: borç raporunda hasta 300,00 ₺ açık borçla
  const f = await browser.newContext(); const fin = await f.newPage();
  await login(fin, "finans@demo-yesil.test");
  await fin.goto("/raporlar");
  await fin.getByRole("button", { name: /Borç/ }).first().click();
  await expect(fin.getByLabel("Toplamlar").getByText("Açık borç")).toBeVisible();
  await expect(fin.getByText(last).first()).toBeVisible({ timeout: 15_000 });
  await f.close();
});
