import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/** Görev 7 — veri aktarımı (dry-run → onay), dışa aktarım, iki adımlı doğrulama (kurulum → kodlu giriş → yönetici sıfırlaması). */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
const SHOTS = process.env.E2E_SHOTS_DIR;

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Bugünün randevuları", level: 2 })).toBeVisible();
}
const noOverflow = async (page: Page) => {
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "yatay taşma").toBeLessThanOrEqual(vw + 1);
};
// RFC 6238 (SHA-1, 30 sn, 6 hane) — test içinde bağımsız hesap
function b32(s: string) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out: number[] = [];
  for (const ch of s.replace(/[\s=]/g, "").toUpperCase()) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret: string, step = Math.floor(Date.now() / 30000)) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", b32(secret)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("veri aktarımı: CSV ön kontrol → hatalı satır görünür → onay → aynı dosya yeni kayıt açmaz", async ({ page }, info) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/yonetim?sekme=aktarim");
  await expect(page.getByRole("heading", { name: "Önceki sistemden veri aktarımı" })).toBeVisible();
  const run = randomUUID().slice(0, 6).toUpperCase();
  // her çalıştırmada benzersiz soyad (mükerrer aday olmasın); 'i'/'I' dışlanır: ad normalizasyonu Türkçe büyük/küçük (I→ı) uygular, metin eşleşmesi bozulurdu
  const tag = run.replace(/[0-9]/g, (d) => "ABCDEFGHJK"[Number(d)]!).toLowerCase();
  const last = `Aktarım${tag[0]!.toUpperCase()}${tag.slice(1)}`;
  const csv = `Kaynak_No;Adı;Soyadı;Doğum Tarihi;Telefon\r\n${run}-1;Deniz;${last};03.04.1990;\r\n${run}-2;Bora;;99.99.1990;\r\n${run}-3;Ece;${last};;\r\n`;
  await page.getByLabel(/^Dosya/).setInputFiles({ name: `e2e-${run}.csv`, mimeType: "text/csv", buffer: Buffer.from(`﻿${csv}`) });
  await page.getByRole("button", { name: "Ön kontrol yap" }).click();
  const detail = page.getByRole("region", { name: "Aktarım ayrıntısı" });
  await expect(detail.getByRole("heading", { name: `e2e-${run}.csv` })).toBeVisible();
  const recon = detail.getByLabel("Mutabakat");
  await expect(recon.locator(".stat").filter({ hasText: "Kaynak satır" })).toContainText("3");
  await expect(recon.locator(".stat").filter({ hasText: "Aktarılabilir" })).toContainText("2");
  await expect(detail.getByText("Soyad boş")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/g7-aktarim-on-kontrol-${info.project.name}.png`, fullPage: true });
  await noOverflow(page);
  const dl = page.waitForEvent("download");
  await detail.getByRole("button", { name: /Hatalı satırları indir/ }).click();
  const errCsv = readFileSync(await (await dl).path(), "utf8");
  expect(errCsv).toContain("satir;durum;hatalar");
  await detail.getByRole("button", { name: "2 satırı aktar" }).click();
  await page.getByRole("alertdialog", { name: "Aktarımı onaylayın" }).getByRole("button", { name: "Aktar" }).click();
  await expect(page.getByText("2 kayıt aktarıldı.")).toBeVisible();
  await expect(detail.getByText("Aktarıldı").first()).toBeVisible();
  // aynı dosya ikinci kez → aynı aktarım açılır
  await page.getByLabel(/^Dosya/).setInputFiles({ name: `kopya-${run}.csv`, mimeType: "text/csv", buffer: Buffer.from(`﻿${csv}`) });
  await page.getByRole("button", { name: "Ön kontrol yap" }).click();
  await expect(page.getByText(/daha önce yüklenmiş; mevcut aktarım açıldı/)).toBeVisible();
  await page.goto(`/hastalar?q=${encodeURIComponent(`Deniz ${last}`)}`);
  await expect(page.locator("a.rowlink").filter({ hasText: `Deniz ${last}` })).toHaveCount(1);
});

test("dışa aktarım: gerekçeyle klinik JSON indirilir; sırlar yok", async ({ page }) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/yonetim?sekme=disa");
  const btn = page.getByRole("button", { name: "Dışa aktar (JSON)" });
  await expect(btn).toBeDisabled();
  await page.getByLabel("Gerekçe").fill("E2E taşınabilirlik denemesi");
  const dl = page.waitForEvent("download");
  await btn.click();
  const text = readFileSync(await (await dl).path(), "utf8");
  const doc = JSON.parse(text);
  expect(doc.format).toBe("viadent-export");
  expect(doc.counts.patients).toBeGreaterThan(0);
  expect(text).not.toContain("password_hash");
  expect(text).not.toContain("mfa_secret_enc");
});

test("iki adımlı doğrulama: kurulum → kodla giriş → yönetici sıfırlaması", async ({ browser }, info) => {
  test.skip(info.project.name !== "masaustu", "durumlu akış; tek projede çalışır");
  const email = "asistan@demo-yesil.test";
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, email);
  await page.goto("/hesabim");
  await page.getByRole("button", { name: "Kurulumu başlat" }).click();
  await expect(page.getByRole("img", { name: /karekod/ })).toBeVisible();
  const secret = (await page.getByLabel("Kurulum anahtarı").inputValue()).replace(/\s/g, "");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/g7-mfa-kurulum.png`, fullPage: true });
  await page.getByLabel("Uygulamadaki 6 haneli kod").fill(totp(secret));
  await page.getByRole("button", { name: "Etkinleştir" }).click();
  await expect(page.getByText("İki adımlı doğrulama açıldı.")).toBeVisible();
  await ctx.close();

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto("/giris");
  await p2.getByLabel("E-posta").fill(email);
  await p2.getByLabel("Parola").fill(PASSWORD);
  await p2.getByRole("button", { name: "Giriş yap" }).click();
  await expect(p2.getByLabel("Doğrulama kodu")).toBeVisible();
  await p2.getByLabel("Doğrulama kodu").fill("000000");
  await p2.getByRole("button", { name: "Doğrula ve giriş yap" }).click();
  await expect(p2.getByText(/hatalı veya kullanılmış/)).toBeVisible();
  // etkinleştirmede kullanılan adımdan sonraki kod
  await p2.getByLabel("Doğrulama kodu").fill(totp(secret, Math.floor(Date.now() / 30000) + 1));
  await p2.getByRole("button", { name: "Doğrula ve giriş yap" }).click();
  await expect(p2.getByRole("heading", { name: "Bugünün randevuları", level: 2 })).toBeVisible();
  await ctx2.close();

  const ctx3 = await browser.newContext();
  const admin = await ctx3.newPage();
  await login(admin, "yonetici@demo-yesil.test");
  await admin.goto("/yonetim?sekme=ekip");
  const row = admin.getByRole("row").filter({ hasText: email });
  await expect(row.getByText("Açık", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Doğrulayıcıyı sıfırla" }).click();
  const mfa = admin.getByRole("alertdialog", { name: "İki adımlı doğrulamayı sıfırla" });
  await mfa.getByRole("textbox").fill("E2E: kimlik yüz yüze doğrulandı");
  await mfa.getByRole("button", { name: "Sıfırla" }).click();
  await expect(admin.getByText("İki adımlı doğrulama sıfırlandı.")).toBeVisible();
  await expect(row.getByText("Kapalı", { exact: true })).toBeVisible();
  await ctx3.close();
});

test("hasta 360: KVKK veri indirme gerekçe ister ve JSON verir", async ({ page }) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/hastalar?q=1");
  await page.locator("a.rowlink").first().click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Veriyi indir" }).click();
  const why = page.getByRole("alertdialog", { name: "Hasta verisini indir" });
  await why.getByRole("textbox").fill("Veri sahibi başvurusu E2E");
  await why.getByRole("button", { name: "İndir" }).click();
  const doc = JSON.parse(readFileSync(await (await dl).path(), "utf8"));
  expect(doc.kind).toBe("patient");
  expect(doc.sections.patient).toHaveLength(1);
});
