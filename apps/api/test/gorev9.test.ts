/**
 * Görev 9 — güvenlik derinleştirme: parola değişikliği (mevcut parola + MFA kodu zorunlu, diğer oturumlar kapanır),
 * yönetici parola sıfırlaması (geçici parola, ilk girişte değiştirme zorunlu), MFA kurulum kodu deneme sınırı,
 * takvimsel tarih doğrulaması. Gerçek PostgreSQL (viadent_test).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { totpAt, totpStep } from "@viadent/db";
import { EMAILS, adminQuery, login, ownerQuery, resetRateLimiter, startApp, type Client } from "./helpers.js";
import { TEST_PASSWORD } from "./env.js";

let app: INestApplication;
let admin: Client;
let tenantA: string;
beforeAll(async () => { app = await startApp(); admin = await login(app, EMAILS.aAdmin); tenantA = admin.session.activeMembership.tenantId; });
afterAll(async () => { await resetRateLimiter(); await app.close(); });

describe("parola değişikliği (ADR-056)", () => {
  it("mevcut parola hatalıysa reddedilir; doğruysa değişir ve diğer oturumlar kapanır, bu oturum kalır", async () => {
    const email = EMAILS.aSecretary;
    const other = await login(app, email); // kapanacak oturum
    const me = await login(app, email);    // değişikliği yapan oturum
    expect((await me.post("/me/password", { currentPassword: "yanlis-parola", newPassword: "yepyeni-parola-1" })).status).toBe(422);
    const newPw = "yeni-guclu-parola-9";
    await me.post("/me/password", { currentPassword: TEST_PASSWORD, newPassword: newPw }).expect(200);
    // diğer oturum düştü
    expect((await other.get("/session")).status).toBe(401);
    // bu oturum çalışıyor
    expect((await me.get("/session")).status).toBe(200);
    // yeni parola ile giriş, eski ile değil
    const s = app.getHttpServer();
    expect((await request(s).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email, password: TEST_PASSWORD })).status).toBe(401);
    expect((await request(s).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email, password: newPw })).status).toBe(200);
    // denetim kaydı (parola değeri yok)
    const au = await ownerQuery(tenantA, "select changes from audit_events a join users u on u.id=a.actor_user_id where u.email=$1 and action='password.change' order by a.id desc limit 1", [email]);
    expect(au.length).toBe(1);
    expect(JSON.stringify(au[0])).not.toContain(newPw);
    // geri al (diğer testler için)
    await me.post("/me/password", { currentPassword: newPw, newPassword: TEST_PASSWORD }).expect(200);
    await resetRateLimiter();
  });

  it("MFA açıkken parola değişikliği 6 haneli kod ister", async () => {
    const email = EMAILS.aAssistant;
    const me = await login(app, email);
    const secret = (await me.post("/me/mfa/setup").expect(200)).body.secret as string;
    await me.post("/me/mfa/enable", { code: totpAt(secret, totpStep()) }).expect(200);
    const me2 = me; // mevcut oturum geçerli (MFA login helper'da yok); parola değişimi mevcut parola + kod ister
    // kodsuz → hata
    expect((await me2.post("/me/password", { currentPassword: TEST_PASSWORD, newPassword: "degisik-parola-x1" })).status).toBe(422);
    // yanlış kod → hata
    expect((await me2.post("/me/password", { currentPassword: TEST_PASSWORD, newPassword: "degisik-parola-x1", code: "000000" })).status).toBe(422);
    // doğru kod → başarı (sonra geri al)
    await me2.post("/me/password", { currentPassword: TEST_PASSWORD, newPassword: "degisik-parola-x1", code: totpAt(secret, totpStep()) }).expect(200);
    await me2.post("/me/password", { currentPassword: "degisik-parola-x1", newPassword: TEST_PASSWORD, code: totpAt(secret, totpStep()) }).expect(200);
    // temizle: yöneticiyle MFA sıfırla
    const team = (await admin.get("/team").expect(200)).body.items;
    await admin.post(`/team/${team.find((x: { email: string }) => x.email === email).id}/mfa-reset`, { reason: "Test temizliği (sentetik)" }).expect(200);
    await resetRateLimiter();
  });

  it("MFA kurulum kodu 5 yanlış denemeden sonra kilitlenir (kod taraması engellenir)", async () => {
    const me = await login(app, EMAILS.aFinance);
    await me.post("/me/mfa/setup").expect(200);
    let locked = false;
    for (let i = 0; i < 7; i++) {
      const r = await me.post("/me/mfa/enable", { code: "000000" });
      if (r.status === 429) locked = true;
    }
    expect(locked).toBe(true);
    await resetRateLimiter();
  });
});

describe("yönetici parola sıfırlaması", () => {
  it("geçici parola üretir, oturumları kapatır, ilk girişte değiştirme zorunlu, kendine yapılamaz", async () => {
    const email = EMAILS.aDentist;
    const victimBefore = await login(app, email);
    const team = (await admin.get("/team").expect(200)).body.items;
    const m = team.find((x: { email: string }) => x.email === email);
    const self = team.find((x: { isSelf: boolean }) => x.isSelf);
    expect((await admin.post(`/team/${self.id}/password-reset`, { reason: "kendim deneme" })).status).toBe(422);
    expect((await admin.post(`/team/${m.id}/password-reset`, {})).status).toBe(422); // gerekçe yok
    const r = await admin.post(`/team/${m.id}/password-reset`, { reason: "Telefonla kimlik doğrulandı (sentetik)" }).expect(200);
    const temp = r.body.temporaryPassword as string;
    expect(temp).toBeTruthy();
    // eski oturum düştü
    expect((await victimBefore.get("/session")).status).toBe(401);
    // eski parola geçmez, geçici parola geçer ama klinik verisi kapalı
    const s = app.getHttpServer();
    expect((await request(s).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email, password: TEST_PASSWORD })).status).toBe(401);
    const forced = await login(app, email, temp);
    expect(forced.session.mustChangePassword).toBe(true);
    // klinik ucu 403 PASSWORD_CHANGE_REQUIRED
    const blocked = await forced.get("/patients");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
    // parola değiştir → erişim açılır
    await forced.post("/me/password", { currentPassword: temp, newPassword: TEST_PASSWORD }).expect(200);
    const after = await login(app, email);
    expect(after.session.mustChangePassword).toBe(false);
    await after.get("/patients").expect(200);
    await resetRateLimiter();
  });
});

describe("takvimsel tarih doğrulaması (Görev 9 bulgusu)", () => {
  it("imkansız tarih 422 döner, 500 değil", async () => {
    for (const d of ["9999-99-99", "2026-02-30", "2026-13-01", "0000-00-00"]) {
      expect((await admin.get(`/appointments?date=${d}`)).status, d).toBe(422);
    }
    // geçerli tarih çalışır
    await admin.get("/appointments?date=2026-03-15").expect(200);
  });
});

describe("oturum yönetimi (ADR-056)", () => {
  it("boşta kalan oturum düşer: son görülme eski ise sonraki istek 401 ve oturum iptal edilir", async () => {
    const c = await login(app, EMAILS.aAssistant);
    await c.get("/session").expect(200);
    await ownerQuery(null, "update sessions set last_seen_at = now() - interval '3 hours' where id = (select s.id from sessions s join users u on u.id = s.user_id where u.email = $1 and s.revoked_at is null order by s.created_at desc limit 1)", [EMAILS.aAssistant]);
    expect((await c.get("/session")).status).toBe(401);
    const rows = await ownerQuery(null, "select revoked_at from sessions s join users u on u.id = s.user_id where u.email = $1 order by s.created_at desc limit 1", [EMAILS.aAssistant]);
    expect(rows[0].revoked_at).not.toBeNull();
  });

  it("boşta süresi kapalıysa (0) eski oturum düşmez", async () => {
    const app2 = await startApp({ sessionIdleMinutes: 0 }, { keepThrottle: true });
    try {
      const c = await login(app2, EMAILS.aAssistant);
      await ownerQuery(null, "update sessions set last_seen_at = now() - interval '3 hours' where id = (select s.id from sessions s join users u on u.id = s.user_id where u.email = $1 and s.revoked_at is null order by s.created_at desc limit 1)", [EMAILS.aAssistant]);
      await c.get("/session").expect(200);
    } finally { await app2.close(); }
  });

  it("açık oturumlar listelenir (belirteç yok, bu cihaz işaretli) ve diğerleri kapatılabilir", async () => {
    const a = await login(app, EMAILS.aDentist);
    const b = await login(app, EMAILS.aDentist);
    const list = (await a.get("/me/sessions").expect(200)).body.items;
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.filter((x: { current: boolean }) => x.current)).toHaveLength(1);
    expect(JSON.stringify(list)).not.toMatch(/token/i);
    const r = (await a.post("/me/sessions/revoke-others", {}).expect(200)).body;
    expect(r.revoked).toBeGreaterThanOrEqual(1);
    expect((await b.get("/session")).status).toBe(401);
    await a.get("/session").expect(200);
  });
});

describe("parola politikası", () => {
  it("yaygın, tekrarlı, ardışık veya e-posta içeren parola reddedilir; güçlü parola kabul edilir", async () => {
    const c = await login(app, EMAILS.aAssistant);
    for (const bad of ["1234567890", "aaaaaaaaaa", "abcdefghij", "asistan-demo-yesil", "Asistan1234"]) {
      const r = await c.post("/me/password", { currentPassword: TEST_PASSWORD, newPassword: bad });
      expect(r.status, bad).toBe(422);
      expect(r.body.field_errors.newPassword, bad).toBeTruthy();
    }
    // politika mesajı mevcut parola doğrulamasından SONRA gelir (yanlış mevcut parolayla politika sondası yapılamaz)
    const probe = await c.post("/me/password", { currentPassword: "yanlis-parola-xx", newPassword: "1234567890" });
    expect(probe.body.field_errors.currentPassword).toBeTruthy();
    expect(probe.body.field_errors.newPassword).toBeUndefined();
    await c.post("/me/password", { currentPassword: TEST_PASSWORD, newPassword: "Guclu-Parola-2026!" }).expect(200);
    // temizlik: eski parolaya dön
    const c2 = await login(app, EMAILS.aAssistant, "Guclu-Parola-2026!");
    await c2.post("/me/password", { currentPassword: "Guclu-Parola-2026!", newPassword: TEST_PASSWORD }).expect(200);
  });
});
