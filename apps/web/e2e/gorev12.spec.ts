import { expect, test, type Page } from "@playwright/test";

/** Görev 12 — içe aktarmada açık sütun eşleme ekranı (ADR-069). */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"), { timeout: 15_000 });
}

test("veri aktarımı: tanınmayan başlıklar elle eşlenir; 'Eşlenmiyor' seçilen sütun yok sayılır; ön kontrol geçer", async ({ page }, info) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/yonetim?sekme=aktarim");
  const run = Date.now().toString(36).replace(/[0-9]/g, (d) => "ABCDEFGHJK"[Number(d)]!);
  const csv = `Hasta Numarası;Ön Ad;Aile Adı;Telefon\r\n${run}-1;Deniz;Esleme${run};0555 000 44 55\r\n`;
  await page.getByLabel(/^Dosya/).setInputFiles({ name: `esleme-${run}.csv`, mimeType: "text/csv", buffer: Buffer.from(`﻿${csv}`) });
  // başlıklar okundu; zorunlu alanlar eşlenmedi → eşleme bölümü açık
  const sum = page.getByText(/Sütun eşlemesi — 4 başlık bulundu, 3 zorunlu alan eşlenmedi/);
  await expect(sum).toBeVisible();
  await expect(page.getByLabel("Telefon sütunu")).toHaveValue("Telefon"); // takma ad önerisi
  await page.getByRole("button", { name: "Ön kontrol yap" }).click();
  await expect(page.getByText(/Zorunlu sütun eşlenmedi: Kaynak hasta no, Ad, Soyad/)).toBeVisible();
  await page.getByLabel("Kaynak hasta no sütunu").selectOption("Hasta Numarası");
  await page.getByLabel("Ad sütunu", { exact: true }).selectOption("Ön Ad");
  await page.getByLabel("Soyad sütunu", { exact: true }).selectOption("Aile Adı");
  await page.getByLabel("Telefon sütunu").selectOption("");
  await expect(page.getByText(/Yok sayılacak sütunlar: Telefon/)).toBeVisible();
  // aynı sütun iki alana seçilirse düğme kapanır
  await page.getByLabel("E-posta sütunu").selectOption("Ön Ad");
  await expect(page.getByText(/Aynı dosya sütunu birden çok alana seçildi/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ön kontrol yap" })).toBeDisabled();
  await page.getByLabel("E-posta sütunu").selectOption("");
  if (process.env.E2E_SHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/g12-sutun-eslemesi-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Ön kontrol yap" }).click();
  await expect(page.getByText("Ön kontrol tamam. Hiçbir kayıt henüz yazılmadı.")).toBeVisible();
  const detail = page.getByRole("region", { name: "Aktarım ayrıntısı" });
  await expect(detail.getByText(/Eşlenmeyen \(yok sayılan\) sütunlar: Telefon/)).toBeVisible();
});
