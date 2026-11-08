import { expect, test } from "@playwright/test";

/** Görev 8 — nonce'lu CSP: ana sayfalarda hiçbir CSP ihlali yok, satır içi betik izni yok, her istekte yeni nonce. */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

test("CSP: unsafe-inline yok, nonce istek başına değişir, gezinmede ihlal yok", async ({ page, request }) => {
  const a = await request.get("/giris");
  const b = await request.get("/giris");
  const cspA = a.headers()["content-security-policy"] ?? "";
  const cspB = b.headers()["content-security-policy"] ?? "";
  const scriptSrc = /script-src ([^;]+)/.exec(cspA)?.[1] ?? "";
  expect(scriptSrc).toContain("'strict-dynamic'");
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  const nonce = (s: string) => /'nonce-([^']+)'/.exec(s)?.[1];
  expect(nonce(cspA)).toBeTruthy();
  expect(nonce(cspA)).not.toBe(nonce(cspB));
  // sayfadaki her betik o isteğin nonce'ını taşır
  const html = await a.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) expect(s).toContain(`nonce="${nonce(cspA)}"`);

  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => console.error(`Refused to (CSP): ${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill("yonetici@demo-yesil.test");
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Bugünün randevuları", level: 2 })).toBeVisible();
  for (const path of ["/hastalar", "/ajanda", "/finans", "/raporlar", "/operasyon", "/yonetim", "/hesabim"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  await page.goto("/hastalar?q=1");
  await page.locator("a.rowlink").first().click();
  await expect(page.getByRole("tab", { name: "Özet" })).toBeVisible();
  expect(violations, violations.join("\n")).toEqual([]);
});
