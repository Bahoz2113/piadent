import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/** Görev 10 — kurtarma kodları (etkinleştirmede gösterilir, biriyle giriş), Yönetim → Güvenlik (MFA politikası, destek erişimi), Hesabım oturumlar. */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris") || u.search.length > 0, { timeout: 15_000 }).catch(() => undefined);
}
function b32(s: string) { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out: number[] = [];
  for (const ch of s.replace(/[\s=]/g, "").toUpperCase()) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function totp(secret: string, step = Math.floor(Date.now() / 30000)) { const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", b32(secret)).update(msg).digest(); const o = h[h.length - 1]! & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0"); }

test("kurtarma kodları: etkinleştirmede 8 kod → kaydettim → kurtarma koduyla giriş → Hesabım uyarısı → yönetici sıfırlar", async ({ browser }, info) => {
  test.skip(info.project.name !== "masaustu", "durumlu akış");
  const email = "asistan@demo-yesil.test";
  const c = await browser.newContext(); const page = await c.newPage();
  await login(page, email);
  await page.goto("/hesabim");
  await page.getByRole("button", { name: "Kurulumu başlat" }).click();
  const secret = (await page.getByLabel("Kurulum anahtarı").inputValue()).replace(/\s/g, "");
  await page.getByLabel("Uygulamadaki 6 haneli kod").fill(totp(secret));
  await page.getByRole("button", { name: "Etkinleştir" }).click();
  const region = page.getByRole("region", { name: "Kurtarma kodları" });
  await expect(region).toBeVisible();
  const codes = (await region.locator("div[style*='padding']").allInnerTexts()).map((t) => t.trim()).filter((t) => /^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{2}$/.test(t));
  expect(codes).toHaveLength(8);
  if (process.env.E2E_SHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/g10-kurtarma-kodlari.png`, fullPage: true });
  await page.getByRole("button", { name: "Kodları kaydettim" }).click();
  await expect(page.getByText(/Kurtarma kodu: 8 \/ 8/)).toBeVisible();
  await c.close();

  const c2 = await browser.newContext(); const p2 = await c2.newPage();
  await p2.goto("/giris");
  await p2.getByLabel("E-posta").fill(email); await p2.getByLabel("Parola").fill(PASSWORD);
  await p2.getByRole("button", { name: "Giriş yap" }).click();
  await p2.getByLabel("Doğrulama kodu").fill(codes[0]!);
  await p2.getByRole("button", { name: "Doğrula ve giriş yap" }).click();
  await expect(p2).toHaveURL(/\/hesabim\?kurtarma=7/);
  await expect(p2.getByText("Kurtarma koduyla giriş yaptınız")).toBeVisible();
  await expect(p2.getByText(/Kurtarma kodu: 7 \/ 8/)).toBeVisible();
  await expect(p2.getByRole("heading", { name: "Açık oturumlar" })).toBeVisible();
  await c2.close();

  const c3 = await browser.newContext(); const admin = await c3.newPage();
  await login(admin, "yonetici@demo-yesil.test");
  await admin.goto("/yonetim?sekme=ekip");
  await admin.getByRole("row").filter({ hasText: email }).getByRole("button", { name: "Doğrulayıcıyı sıfırla" }).click();
  const mfaDlg = admin.getByRole("alertdialog", { name: "İki adımlı doğrulamayı sıfırla" });
  await mfaDlg.getByRole("textbox").fill("E2E temizlik: kimlik doğrulandı");
  await mfaDlg.getByRole("button", { name: "Sıfırla" }).click();
  await expect(admin.getByText("İki adımlı doğrulama sıfırlandı.")).toBeVisible();
  await c3.close();
});

test("Yönetim → Güvenlik: kendi rolünü MFA'sız zorunlu yapamaz; finans için politika; destek erişimi verilir ve listelenir", async ({ page }, info) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/yonetim?sekme=guvenlik");
  await expect(page.getByRole("heading", { name: "İki adımlı doğrulama politikası" })).toBeVisible();
  await page.getByLabel("Klinik yöneticisi").check();
  await page.getByRole("button", { name: "Politikayı kaydet" }).click();
  await expect(page.getByText(/Önce kendi hesabınızda iki adımlı doğrulamayı açın/)).toBeVisible();
  await page.getByLabel("Klinik yöneticisi").uncheck();
  await page.getByLabel("Finans").check();
  await page.getByRole("button", { name: "Politikayı kaydet" }).click();
  await expect(page.getByText("Güvenlik politikası kaydedildi.")).toBeVisible();
  await page.getByLabel("Finans").uncheck();
  await page.getByRole("button", { name: "Politikayı kaydet" }).click();
  await expect(page.getByText("Güvenlik politikası kaydedildi.").last()).toBeVisible();

  await page.getByLabel("Destek hesabı e-postası").fill("hekim@demo-mavi.test");
  await page.getByLabel("Gerekçe (destek talebi / sorun)").fill(`E2E ${info.project.name}: rapor uyuşmazlığı incelemesi (sentetik)`);
  await page.getByRole("button", { name: "Destek erişimi ver" }).click();
  await expect(page.getByText(/Destek erişimi verildi/)).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "hekim@demo-mavi.test" }).first();
  await expect(row.getByText("Etkin")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "yatay taşma").toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  if (process.env.E2E_SHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/g10-guvenlik-${info.project.name}.png`, fullPage: true });
  await row.getByRole("button", { name: "Kaldır" }).click();
  const endDlg = page.getByRole("alertdialog", { name: "Destek erişimini sonlandır" });
  await endDlg.getByRole("textbox").fill("İnceleme bitti");
  await endDlg.getByRole("button", { name: "Sonlandır" }).click();
  await expect(page.getByText("Destek erişimi kaldırıldı.")).toBeVisible();
});
