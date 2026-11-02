import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * QA-103 (S3) — Fatura ayrıntısı durumu yansıtır: MOCK sağlayıcının düzenlediği ve sonra iptal ettiği faturada
 * "TASLAK" uyarısı, "Taslağı yazdır" düğmesi ve TASLAK filigranı YOKTUR; "MOCK — resmî değil" görünür.
 * Bağlantı sonradan pasifleşse de iptal edilmiş faturada "e-Belge sağlayıcısı bağlı değil; gönderim…" cümlesi çıkmaz.
 * Gereken: API + web + worker (MOCK e-belge işlerini işler) aynı sentetik seed üzerinde.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email); await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"), { timeout: 15_000 });
}
/** Uygulamanın kendi istemcisi gibi: yazma isteği başlığı + etkin üyelik bağlamı (lib/api.ts). */
async function call(r: APIRequestContext, method: "get" | "post" | "patch", path: string, data?: unknown, extra: Record<string, string> = {}) {
  const ctx = (await (await r.get("/api/v1/session")).json()).activeMembership?.id ?? "";
  const res = await r[method](`/api/v1${path}`, { headers: { "x-viadent-request": "1", "x-viadent-context": ctx, ...extra }, data: data as object | undefined });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

test("QA-103: MOCK düzenlenmiş → iptal faturada TASLAK/“bağlı değil” yok, 'Yazdır' + MOCK ibaresi", async ({ page, browser }) => {
  test.setTimeout(120_000);
  // Yönetici: MOCK e-belge bağlantısı (kabul davranışı) + sentetik hasta
  const adm = await (await browser.newContext()).newPage();
  await login(adm, "yonetici@demo-yesil.test");
  const mk = await call(adm.request, "post", "/integrations/connections/mock", { kind: "e_invoice" });
  expect([201, 409], `${mk.status} ${mk.body?.code ?? ""}`).toContain(mk.status); // 409 = MOCK bağlantı zaten var (gövde yazdırılmaz: imza anahtarı içerir)
  const ov = (await call(adm.request, "get", "/integrations/overview")).body;
  const conn = ov.connections.find((x: { kind: string; provider: string }) => x.kind === "e_invoice" && x.provider === "mock");
  if (conn.status !== "active") expect((await call(adm.request, "patch", `/integrations/connections/${conn.id}`, { status: "active" })).status).toBe(200);
  expect((await call(adm.request, "patch", `/integrations/connections/${conn.id}`, { mockBehavior: "accept" })).status).toBe(200);
  // Bağlantı her durumda pasife döner: diğer senaryolar (fatura-taslagi) "sağlayıcı bağlı değil" başlangıç durumunu bekler.
  try {
  // Yeniden koşuda aynı sentetik hasta "olası mükerrer" uyarısı verir; bilinçli olarak yeni kayıt açılır.
  const pr = await call(adm.request, "post", "/patients", { firstName: "Fatura", lastName: "QA103 Sentetik", birthDate: "1985-04-04", acknowledgeDuplicates: true });
  expect(pr.status, pr.body?.code).toBe(201);
  const patientId = pr.body.patient.id as string;

  // Finans: taslak → gönder → (worker) issued → iptal iste → (worker) cancelled
  await page.context().addInitScript(() => { window.print = () => {}; });
  await login(page, "finans@demo-yesil.test");
  const inv = await call(page.request, "post", "/invoices", { patientId, docType: "e_arsiv", buyerType: "individual", buyerName: "QA103 Alıcı", lines: [{ description: "Muayene", quantity: 1, unitPrice: "500.00", vatRate: 10 }] },
    { "idempotency-key": `qa103-${Date.now()}` });
  expect(inv.status).toBe(201);
  const id = inv.body.id as string;
  expect((await call(page.request, "post", `/invoices/${id}/submit`, {})).status).toBe(200);
  await expect.poll(async () => (await call(page.request, "get", `/invoices/${id}`)).body.status, { timeout: 30_000 }).toBe("issued");
  const invoiceNo = (await call(page.request, "get", `/invoices/${id}`)).body.invoiceNo as string;
  expect(invoiceNo).toMatch(/^MOCK/);

  const card = () => page.locator("section.card", { hasText: "Fatura taslakları" });
  async function openDrawer(status: RegExp) {
    await page.goto(`/hastalar/${patientId}?sekme=finans`);
    await card().locator("table tbody tr", { hasText: "QA103 Alıcı" }).first().getByRole("button", { name: "Aç" }).click();
    return page.getByRole("dialog", { name: status });
  }
  async function assertProviderView(v: ReturnType<Page["getByRole"]>) {
    await expect(v.getByText(invoiceNo).first()).toBeVisible();
    await expect(v.getByRole("status").filter({ hasText: "MOCK — resmî değil" })).toBeVisible();
    await expect(v.getByText(/TASLAK — resmî belge değildir/)).toHaveCount(0);
    await expect(v.getByText(/gönderim denemesi reddedilir/)).toHaveCount(0);
    await expect(v.getByRole("button", { name: "Taslağı yazdır" })).toHaveCount(0);
    const [popup] = await Promise.all([page.waitForEvent("popup"), v.getByRole("button", { name: "Yazdır", exact: true }).click()]);
    await popup.waitForLoadState("domcontentloaded");
    const main = popup.locator("main");
    await expect(main).toContainText(invoiceNo);
    await expect(main).toContainText("MOCK — resmî değil");
    await expect(main).not.toContainText("TASLAK");
    await popup.close();
  }

  // 1) issued (MOCK)
  await assertProviderView(await openDrawer(/e-Arşiv fatura · Düzenlendi/));

  // 2) iptal → cancelled; ardından bağlantı pasif (kanıttaki durum)
  expect((await call(page.request, "post", `/invoices/${id}/cancel`, { reason: "QA103 sentetik iptal" })).status).toBe(200);
  await expect.poll(async () => (await call(page.request, "get", `/invoices/${id}`)).body.status, { timeout: 30_000 }).toBe("cancelled");
  expect((await call(adm.request, "patch", `/integrations/connections/${conn.id}`, { status: "disabled" })).status).toBe(200);
  const v2 = await openDrawer(/e-Arşiv fatura · İptal/);
  await assertProviderView(v2);
  } finally {
    await call(adm.request, "patch", `/integrations/connections/${conn.id}`, { status: "disabled" });
    await adm.context().close();
  }
});
