/**
 * Görev 11 — güvenlik kapanışları: kimlik no düz sütunu kaldırıldı (ADR-062), destek erişiminde dört göz (ADR-064),
 * kademeli giriş gecikmesi (ADR-065). Gerçek PostgreSQL (viadent_test).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";
import { TEST_PASSWORD } from "./env.js";

let app: INestApplication;
let bAdmin: Client, multi: Client, aAdmin: Client;
let tenantB: string;

beforeAll(async () => {
  app = await startApp();
  [bAdmin, multi, aAdmin] = await Promise.all([login(app, EMAILS.bAdmin), login(app, EMAILS.multi), login(app, EMAILS.aAdmin)]);
  tenantB = bAdmin.session.activeMembership.tenantId;
  // çoklu kullanıcı: Mavi'de yönetici — bağlamı Mavi üyeliğine al
  const mB = multi.session.memberships.find((m: { role: string }) => m.role === "clinic_admin");
  multi.setContext(mB.id);
});
afterAll(async () => { await app.close(); });

describe("ADR-062: düz metin kimlik no sütunu yok", () => {
  it("patients tablosunda national_id yok; şifreli + HMAC sütunları tutarlılık kısıtıyla var", async () => {
    const cols = (await ownerQuery(null, "select column_name from information_schema.columns where table_name = 'patients' and column_name like 'national_id%'")).map((r) => r.column_name as string).sort();
    expect(cols).toEqual(["national_id_enc", "national_id_hmac", "national_id_type"]);
    const [{ n }] = await ownerQuery(null, "select count(*)::int as n from patients where (national_id_type is null) <> (national_id_enc is null)");
    expect(n).toBe(0);
  });
});

describe("ADR-064: destek erişiminde dört göz", () => {
  const supportEmail = `destek-${randomBytes(3).toString("hex")}@viadent.test`;
  let grantId: string;
  beforeAll(async () => {
    const { hashPassword } = await import("@viadent/db");
    await ownerQuery(null, "insert into users(email, password_hash, full_name) values ($1,$2,'VİADENT Destek 2 (sentetik)')", [supportEmail, await hashPassword(TEST_PASSWORD)]);
  });

  it("iki yöneticili klinikte talep 'pending' açılır; destek hesabı etkinleşmeden klinik bağlamına giremez", async () => {
    const list0 = (await bAdmin.get("/security/support-grants").expect(200)).body;
    expect(list0.fourEyes).toBe(true);
    const g = (await bAdmin.post("/security/support-grants", { email: supportEmail, hours: 3, reason: "Randevu çakışması incelemesi (sentetik)" }).expect(201)).body;
    expect(g.status).toBe("pending");
    grantId = g.id;
    const su = await login(app, supportEmail);
    expect(su.session.memberships.some((m: { id: string }) => m.id === grantId)).toBe(false);
    const row = (await ownerQuery(tenantB, "select status, created_by, approved_by from memberships where id = $1", [grantId]))[0];
    expect(row.status).toBe("pending"); expect(row.created_by).toBeTruthy(); expect(row.approved_by).toBeNull();
    const audit = await ownerQuery(tenantB, "select action from audit_events where entity_id = $1 order by created_at", [grantId]);
    expect(audit.map((a) => a.action)).toContain("support.grant_requested");
  });

  it("talebi açan yönetici onaylayamaz (409); başka klinik yöneticisi göremez (404); hekim onaylayamaz (403)", async () => {
    expect((await bAdmin.post(`/security/support-grants/${grantId}/approve`)).status).toBe(409);
    expect((await aAdmin.post(`/security/support-grants/${grantId}/approve`)).status).toBe(404);
    const bDentist = await login(app, EMAILS.bDentist);
    expect((await bDentist.post(`/security/support-grants/${grantId}/approve`)).status).toBe(403);
    expect((await multi.post("/security/support-grants/not-a-uuid/approve")).status).toBe(404);
  });

  it("ikinci yönetici onaylar → etkin; destek hesabı salt okunur girer; onaylayan denetimde; ikinci onay 404", async () => {
    const list = (await multi.get("/security/support-grants").expect(200)).body.items;
    expect(list.find((x: { id: string }) => x.id === grantId)).toMatchObject({ status: "pending", canApprove: true, active: false });
    await multi.post(`/security/support-grants/${grantId}/approve`).expect(200);
    const row = (await ownerQuery(tenantB, "select status, approved_by, approved_at from memberships where id = $1", [grantId]))[0];
    expect(row.status).toBe("active"); expect(row.approved_by).toBe((await ownerQuery(null, "select id from users where email = $1", [EMAILS.multi]))[0].id); expect(row.approved_at).toBeTruthy();
    const su = await login(app, supportEmail);
    expect(su.session.activeMembership.role).toBe("support");
    expect((await su.post("/patients", { firstName: "X", lastName: "Y" })).status).toBe(403);
    expect((await multi.post(`/security/support-grants/${grantId}/approve`)).status).toBe(404); // artık pending değil
    const audit = await ownerQuery(tenantB, "select action from audit_events where entity_id = $1 order by created_at", [grantId]);
    expect(audit.map((a) => a.action)).toContain("support.grant_approved");
  });

  it("süresi dolmuş talep onaylanamaz (409); tek yöneticili klinikte erişim doğrudan etkin", async () => {
    const supportEmail2 = `destek-${randomBytes(3).toString("hex")}@viadent.test`;
    const { hashPassword } = await import("@viadent/db");
    await ownerQuery(null, "insert into users(email, password_hash, full_name) values ($1,$2,'VİADENT Destek 3 (sentetik)')", [supportEmail2, await hashPassword(TEST_PASSWORD)]);
    const g = (await bAdmin.post("/security/support-grants", { email: supportEmail2, hours: 1, reason: "Süre dolumu denemesi (sentetik)" }).expect(201)).body;
    await ownerQuery(tenantB, "update memberships set expires_at = now() - interval '1 minute' where id = $1", [g.id]);
    expect((await multi.post(`/security/support-grants/${g.id}/approve`)).status).toBe(409);
    // Yeşil'de tek yönetici → dört göz uygulanamaz, doğrudan etkin (denetimde four_eyes=false)
    const ga = (await aAdmin.post("/security/support-grants", { email: supportEmail2, hours: 1, reason: "Tek yöneticili klinik denemesi" }).expect(201)).body;
    expect(ga.status).toBe("active");
    expect((await aAdmin.get("/security/support-grants").expect(200)).body.fourEyes).toBe(false);
  });

  it("veritabanı kısıtı: 'pending' yalnız destek rolü için", async () => {
    await expect(ownerQuery(tenantB, "update memberships set status = 'pending' where tenant_id = $1 and role = 'dentist'", [tenantB])).rejects.toThrow(/memberships_pending_support/);
  });
});

describe("ADR-065: kademeli giriş gecikmesi (sınırlı)", () => {
  it("3. hatadan itibaren gecikme artar, üst sınırı aşmaz; doğru girişte sayaç sıfırlanır", async () => {
    const slow = await startApp({ loginBackoffMaxMs: 600 });
    try {
      const server = slow.getHttpServer();
      const email = EMAILS.aAssistant;
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = Date.now();
        const r = await request(server).post("/api/v1/auth/login").set("x-viadent-request", "1").set("x-forwarded-for", `10.9.${i}.1`).send({ email, password: `yanlis-${i}` });
        expect(r.status).toBe(401);
        times.push(Date.now() - t0);
      }
      // 1–2. deneme gecikmesiz; 3. ≈400; 4–5. ≈600 (üst sınır)
      expect(times[0]!).toBeLessThan(300); expect(times[1]!).toBeLessThan(300);
      expect(times[2]!).toBeGreaterThanOrEqual(390); expect(times[2]!).toBeLessThan(1000);
      expect(times[3]!).toBeGreaterThanOrEqual(590); expect(times[3]!).toBeLessThan(1200);
      expect(times[4]!).toBeGreaterThanOrEqual(590); expect(times[4]!).toBeLessThan(1200);
      // doğru parola: anında ve sayaç temiz
      const t0 = Date.now();
      await request(server).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email, password: TEST_PASSWORD }).expect(200);
      expect(Date.now() - t0).toBeLessThan(1500);
      const t1 = Date.now();
      await request(server).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email, password: "yanlis-son" }).expect(401);
      expect(Date.now() - t1).toBeLessThan(300);
    } finally { await slow.close(); }
  });
});
