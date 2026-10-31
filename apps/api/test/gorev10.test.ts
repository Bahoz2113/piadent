/**
 * Görev 10 — güvenlik derinleştirme: MFA kurtarma kodları (ADR-058), T.C. kimlik no alan şifrelemesi + HMAC arama (ADR-059),
 * klinik MFA politikası (ADR-060), süreli destek erişimi (ADR-061). Gerçek PostgreSQL (viadent_test).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { currentKeyId, decryptField, indexHash, totpAt, totpStep } from "@viadent/db";
import { rotateSecrets } from "../../../packages/db/src/rotate-keys.js";
import { encryptNationalIds } from "../../../packages/db/src/encrypt-ids.js";
import { isValidTckn } from "@viadent/contracts";
import { EMAILS, adminQuery, login, ownerQuery, startApp, type Client } from "./helpers.js";
import { OWNER_URL, TEST_PASSWORD } from "./env.js";

let app: INestApplication;
let admin: Client, sec: Client, dentist: Client, bAdmin: Client;
let tenantA: string, tenantB: string;
const K0 = process.env.VIADENT_SECRET_KEY!;

function tckn(seed: number): string {
  for (let n = seed; ; n++) {
    const d = String(100000000 + (n % 800000000)).padStart(9, "1").split("").map(Number);
    if (d[0] === 0) continue;
    const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!, even = d[1]! + d[3]! + d[5]! + d[7]!;
    const d10 = (((odd * 7 - even) % 10) + 10) % 10, d11 = (d.reduce((a, b) => a + b, 0) + d10) % 10;
    const t = `${d.join("")}${d10}${d11}`;
    if (isValidTckn(t)) return t;
  }
}
const mfaPost = (server: unknown, body: unknown) => request(server as Parameters<typeof request>[0]).post("/api/v1/auth/mfa").set("x-viadent-request", "1").send(body as object);
const loginRaw = (server: unknown, email: string, password = TEST_PASSWORD) =>
  request(server as Parameters<typeof request>[0]).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email, password });

beforeAll(async () => {
  app = await startApp();
  [admin, sec, dentist, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aSecretary), login(app, EMAILS.aDentist), login(app, EMAILS.bAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  tenantB = bAdmin.session.activeMembership.tenantId;
});
afterAll(async () => { process.env.VIADENT_SECRET_KEY = K0; delete process.env.VIADENT_SECRET_KEYS_OLD; await app.close(); });

// ================================================================ ADR-059 kimlik no şifreleme
describe("T.C. kimlik no: şifreli saklama, HMAC ile arama ve mükerrer kontrolü", () => {
  const id1 = tckn(Date.now() % 50000), id2 = tckn((Date.now() % 50000) + 7777);
  let pid: string;
  it("yeni kayıtta düz metin sütunu boş, şifreli değer v2.<kid>, HMAC 64 hex; yanıtta sekreter açık / yönetici maskeli görür", async () => {
    pid = (await sec.post("/patients", { firstName: "Şifre", lastName: "Deneme", birthDate: "1988-08-08", nationalIdType: "tckn", nationalId: id1 }).expect(201)).body.patient.id;
    const row = (await ownerQuery(tenantA, "select national_id, national_id_enc, national_id_hmac from patients where id = $1", [pid]))[0];
    expect(row.national_id).toBeNull();
    expect(row.national_id_enc.startsWith(`v2.${currentKeyId()}.`)).toBe(true);
    expect(row.national_id_enc).not.toContain(id1);
    expect(row.national_id_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(row.national_id_hmac).toBe(indexHash(tenantA, id1));
    expect(decryptField(row.national_id_enc)).toBe(id1);
    expect((await sec.get(`/patients/${pid}`).expect(200)).body.nationalId).toBe(id1); // sekreterde kimlik açma yetkisi var
    const masked = (await admin.get(`/patients/${pid}`).expect(200)).body.nationalId as string;
    expect(masked).not.toBe(id1); expect(masked).toMatch(/[•*]/);
    // denetim kaydında kimlik maskeli
    const a = await ownerQuery(tenantA, "select changes from audit_events where action = 'patient.create' and entity_id = $1", [pid]);
    expect(JSON.stringify(a)).not.toContain(id1);
  });

  it("kimlik no ile arama bulur (HMAC); kısmi kimlik bulmaz; aynı kimlik ikinci kez 409; başka klinikte aynı kimlik farklı özet ve serbest", async () => {
    const r = (await sec.get(`/patients?q=${id1}`).expect(200)).body.items;
    expect(r.map((x: { id: string }) => x.id)).toContain(pid);
    expect((await sec.get(`/patients?q=${id1.slice(0, 9)}`).expect(200)).body.items.some((x: { id: string }) => x.id === pid)).toBe(false);
    const dup = await sec.post("/patients", { firstName: "Başka", lastName: "Kişi", birthDate: "1970-01-01", nationalIdType: "tckn", nationalId: id1 });
    expect(dup.status).toBe(409); expect(dup.body.code).toBe("DUPLICATE_IDENTITY");
    expect(indexHash(tenantB, id1)).not.toBe(indexHash(tenantA, id1));
    const bSec = await login(app, EMAILS.bDentist);
    await bSec.post("/patients", { firstName: "Mavi", lastName: "Hasta", birthDate: "1975-05-05", nationalIdType: "tckn", nationalId: id1 }).expect(201);
  });

  it("içe aktarma kimlik no'yu şifreli yazar; satır verisinde düz metin yok (maskeli); mükerrer kimlik yakalanır", async () => {
    const run = randomBytes(2).toString("hex");
    const csv = `kaynak_no;ad;soyad;tc\r\n${run}-1;İçe;Aktarım;${id2}\r\n${run}-2;Mükerrer;Kimlik;${id1}\r\n`;
    const b = (await admin.post("/imports", { kind: "patients", format: "csv", fileName: "k.csv", content: csv }).expect(201)).body;
    expect(b.summary).toMatchObject({ valid: 1, duplicates: 1 });
    const rows = await ownerQuery(tenantA, "select data from import_rows where batch_id = $1", [b.id]);
    expect(JSON.stringify(rows)).not.toContain(id2);
    expect(JSON.stringify(rows)).toContain("national_id_masked");
    await admin.post(`/imports/${b.id}/commit`).expect(200);
    const p = (await ownerQuery(tenantA, "select national_id, national_id_enc, national_id_hmac from patients where external_ref = $1", [`${run}-1`]))[0];
    expect(p.national_id).toBeNull(); expect(decryptField(p.national_id_enc)).toBe(id2); expect(p.national_id_hmac).toBe(indexHash(tenantA, id2));
  });

  it("dışa aktarım (hasta ve klinik) kimlik no'yu açık değerle verir, şifreli/özet sütunları taşımaz", async () => {
    const d = JSON.parse((await admin.post(`/patients/${pid}/export`, { reason: "Veri sahibi talebi (sentetik)" }).expect(200)).text);
    expect(d.sections.patient[0].national_id).toBe(id1);
    expect(d.sections.patient[0].national_id_enc).toBeUndefined();
    const c = JSON.parse((await admin.post("/exports/clinic", { reason: "Taşınabilirlik denemesi" }).expect(200)).text);
    const me = c.tables.patients.find((x: { id: string }) => x.id === pid);
    expect(me.national_id).toBe(id1); expect(me.national_id_hmac).toBeUndefined();
  });

  it("geçiş komutu: eski düz metin kayıt şifrelenir, özet üretilir, düz metin boşalır; sonra arama çalışır", async () => {
    const legacy = tckn((Date.now() % 50000) + 31337);
    const lp = (await ownerQuery(tenantA, `insert into patients(tenant_id, file_no, first_name, last_name, search_text, national_id_type, national_id, created_by)
      values ($1, 999990 + (random()*9)::int, 'Eski', 'Kayıt', 'eski kayit', 'tckn', $2, (select id from users limit 1)) returning id`, [tenantA, legacy]))[0].id;
    expect((await encryptNationalIds(OWNER_URL, false)).rows).toBeGreaterThanOrEqual(1);
    expect((await ownerQuery(tenantA, "select national_id from patients where id = $1", [lp]))[0].national_id).toBe(legacy); // önizleme yazmadı
    await encryptNationalIds(OWNER_URL, true);
    const after = (await ownerQuery(tenantA, "select national_id, national_id_enc, national_id_hmac from patients where id = $1", [lp]))[0];
    expect(after.national_id).toBeNull(); expect(decryptField(after.national_id_enc)).toBe(legacy); expect(after.national_id_hmac).toBe(indexHash(tenantA, legacy));
    expect((await encryptNationalIds(OWNER_URL, false)).rows).toBe(0);
    expect((await sec.get(`/patients?q=${legacy}`).expect(200)).body.items.some((x: { id: string }) => x.id === lp)).toBe(true);
    expect((await sec.get(`/patients/${lp}`).expect(200)).body.nationalId).toBe(legacy);
  });

  it("anahtar döndürme kimlik no'ları yeniden şifreler ve özetleri yeniden hesaplar; arama yeni anahtarla çalışır", async () => {
    const K1 = randomBytes(32).toString("base64");
    process.env.VIADENT_SECRET_KEY = K1; process.env.VIADENT_SECRET_KEYS_OLD = K0;
    const rep = await rotateSecrets(OWNER_URL, true);
    expect(rep.nationalIds).toBeGreaterThanOrEqual(2); expect(rep.failed).toBe(0);
    const row = (await ownerQuery(tenantA, "select national_id_enc, national_id_hmac from patients where id = $1", [pid]))[0];
    expect(row.national_id_enc.startsWith(`v2.${currentKeyId()}.`)).toBe(true);
    expect(row.national_id_hmac).toBe(indexHash(tenantA, id1));
    process.env.VIADENT_SECRET_KEYS_OLD = "";
    expect((await sec.get(`/patients?q=${id1}`).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(pid);
    // temizlik: önceki anahtara dön
    process.env.VIADENT_SECRET_KEY = K0; process.env.VIADENT_SECRET_KEYS_OLD = K1;
    expect((await rotateSecrets(OWNER_URL, true)).failed).toBe(0);
    delete process.env.VIADENT_SECRET_KEYS_OLD;
  });
});

// ================================================================ ADR-058 kurtarma kodları
describe("MFA kurtarma kodları", () => {
  const email = EMAILS.aAssistant;
  let secret: string, codes: string[];
  it("etkinleştirmede 8 kod bir kez gösterilir; veritabanında yalnız özet", async () => {
    const me = await login(app, email);
    secret = (await me.post("/me/mfa/setup").expect(200)).body.secret;
    const r = (await me.post("/me/mfa/enable", { code: totpAt(secret, totpStep()) }).expect(200)).body;
    codes = r.recoveryCodes;
    expect(codes).toHaveLength(8);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{2}$/);
    const db = await adminQuery("select count(*)::int as n from mfa_recovery_codes r join users u on u.id = r.user_id where u.email = $1 and used_at is null", [email]);
    expect(db[0].n).toBe(8);
    const raw = await adminQuery("select encode(code_hash,'hex') as h from mfa_recovery_codes r join users u on u.id = r.user_id where u.email = $1", [email]);
    for (const c of codes) expect(raw.some((x) => String(x.h).includes(c.replace(/-/g, "")))).toBe(false);
    expect((await me.get("/me/mfa/recovery").expect(200)).body).toEqual({ left: 8, total: 8 });
  });

  it("kurtarma koduyla giriş: tek kullanımlık, kalan sayısı döner, denetimde yöntem 'recovery'; aynı kod ikinci kez 401", async () => {
    const s = app.getHttpServer();
    const ch = (await loginRaw(s, email).expect(200)).body.challenge;
    const ok = await mfaPost(s, { challenge: ch, code: codes[0]!.toUpperCase().replace(/-/g, "") }).expect(200); // büyük harf ve tiresiz de kabul
    expect(ok.body.recoveryCodesLeft).toBe(7);
    expect(String(ok.headers["set-cookie"])).toContain("HttpOnly");
    const ch2 = (await loginRaw(s, email).expect(200)).body.challenge;
    expect((await mfaPost(s, { challenge: ch2, code: codes[0] })).status).toBe(401);
    const a = await ownerQuery(tenantA, "select changes from audit_events a join users u on u.id = a.actor_user_id where u.email = $1 and action = 'session.login' order by a.id desc limit 1", [email]);
    expect(a[0].changes.method.to).toBe("recovery");
  });

  it("kodları yenileme TOTP ister; eski kodlar geçersiz olur; MFA kapatılınca kodlar silinir", async () => {
    const me = await login(app, email, TEST_PASSWORD).catch(() => null);
    // MFA açık: login() yardımcı fonksiyonu 200 bekler ama meydan okuma döner → doğrudan akış
    const s = app.getHttpServer();
    const ch = (await loginRaw(s, email).expect(200)).body.challenge;
    const r = await mfaPost(s, { challenge: ch, code: totpAt(secret, totpStep() + 1) }).expect(200);
    const cookie = (r.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    const post = (p: string, b: unknown) => request(s).post(`/api/v1${p}`).set("cookie", cookie).set("x-viadent-request", "1").send(b as object);
    expect((await post("/me/mfa/recovery/regenerate", { code: "000000" })).status).toBe(422);
    const fresh = (await post("/me/mfa/recovery/regenerate", { code: totpAt(secret, totpStep() + 1) }).expect(200)).body.recoveryCodes as string[];
    expect(fresh).toHaveLength(8);
    expect(fresh.some((c) => codes.includes(c))).toBe(false);
    const ch3 = (await loginRaw(s, email).expect(200)).body.challenge;
    expect((await mfaPost(s, { challenge: ch3, code: codes[1] })).status).toBe(401); // eski kod artık geçersiz
    void me;
    // temizlik: yönetici sıfırlar → kodlar da silinir
    const team = (await admin.get("/team").expect(200)).body.items;
    await admin.post(`/team/${team.find((x: { email: string }) => x.email === email).id}/mfa-reset`, { reason: "Test temizliği (sentetik)" }).expect(200);
    expect((await adminQuery("select count(*)::int as n from mfa_recovery_codes r join users u on u.id = r.user_id where u.email = $1", [email]))[0].n).toBe(0);
  });
});

// ================================================================ ADR-060 klinik MFA politikası
describe("klinik düzeyinde MFA politikası", () => {
  it("yönetici MFA'sı kapalıyken kendi rolünü zorunlu yapamaz; başka rol için yapabilir; politika yalnız o kliniği etkiler", async () => {
    expect((await sec.get("/security/policy")).status).toBe(403);
    expect((await admin.get("/security/policy").expect(200)).body.requireMfaRoles).toEqual([]);
    const self = await admin.put("/security/policy", { requireMfaRoles: ["clinic_admin"] });
    expect(self.status).toBe(409); expect(self.body.code).toBe("MFA_SELF_LOCKOUT");
    await admin.put("/security/policy", { requireMfaRoles: ["finance"] }).expect(200);
    // finans kullanıcısı MFA kurmadan klinik ucuna giremez, Hesabım açık
    const fin = await login(app, EMAILS.aFinance);
    expect(fin.session.mfa).toEqual({ enabled: false, required: true });
    const r = await fin.get("/finance/summary");
    expect(r.status).toBe(403); expect(r.body.code).toBe("MFA_ENROLLMENT_REQUIRED");
    expect((await fin.get("/me/mfa").expect(200)).body.required).toBe(true);
    // B kliniği etkilenmez
    expect((await bAdmin.get("/security/policy").expect(200)).body.requireMfaRoles).toEqual([]);
    const a = await ownerQuery(tenantA, "select changes from audit_events where action = 'security.policy_update' order by id desc limit 1");
    expect(a[0].changes.require_mfa_roles.to).toEqual(["finance"]);
    await admin.put("/security/policy", { requireMfaRoles: [] }).expect(200);
    await (await login(app, EMAILS.aFinance)).get("/finance/summary").expect(200);
  });
});

// ================================================================ ADR-061 süreli destek erişimi
describe("süreli destek erişimi (support rolü)", () => {
  const supportEmail = `destek-${randomBytes(3).toString("hex")}@viadent.test`; // sentetik destek hesabı (hiçbir kliniğin üyesi değil)
  let grantId: string;
  beforeAll(async () => {
    const { hashPassword } = await import("@viadent/db");
    await ownerQuery(null, "insert into users(email, password_hash, full_name) values ($1,$2,'VİADENT Destek (sentetik)')", [supportEmail, await hashPassword(TEST_PASSWORD)]);
  });
  it("yönetici var olan kullanıcıya en çok 72 saat gerekçeli destek erişimi verir; kendine veremez; hekim veremez", async () => {
    expect((await dentist.post("/security/support-grants", { email: supportEmail, hours: 2, reason: "Hekim deneme gerekçesi" })).status).toBe(403);
    expect((await admin.post("/security/support-grants", { email: EMAILS.aAdmin, hours: 2, reason: "Kendime destek denemesi" })).status).toBe(422);
    expect((await admin.post("/security/support-grants", { email: "yok@ornek.test", hours: 2, reason: "Olmayan kullanıcı deneme" })).status).toBe(422);
    expect((await admin.post("/security/support-grants", { email: supportEmail, hours: 100, reason: "Çok uzun süre denemesi" })).status).toBe(422);
    const g = (await admin.post("/security/support-grants", { email: supportEmail, hours: 2, reason: "Rapor toplamı uyuşmazlığı incelemesi (sentetik)" }).expect(201)).body;
    grantId = g.id;
    const list = (await admin.get("/security/support-grants").expect(200)).body.items;
    expect(list.find((x: { id: string }) => x.id === grantId)).toMatchObject({ email: supportEmail, active: true });
  });

  it("destek kullanıcısı salt okunur: hasta listesi maskeli, klinik not/finans/yazma yok; denetimde rol görünür", async () => {
    const su2 = await login(app, supportEmail); // tek üyelik: destek → giriş doğrudan A kliniği bağlamında
    expect(su2.session.activeMembership.role).toBe("support");
    const list = (await su2.get("/patients?q=a").expect(200)).body.items;
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((p: { phoneMasked?: boolean; phone: string | null }) => !p.phone || p.phoneMasked)).toBe(true);
    const pid = list[0].id;
    expect((await su2.get(`/patients/${pid}`).expect(200)).body.clinical).toBeFalsy();
    for (const [p, b] of [["/patients", { firstName: "X", lastName: "Y" }], ["/appointments", {}], ["/payments", {}], ["/exports/clinic", { reason: "destek deneme" }]] as const) {
      expect((await su2.post(p, b)).status, p).toBe(403);
    }
    expect((await su2.get("/finance/summary")).status).toBe(403);
    expect((await su2.get("/team")).status).toBe(403);
    await su2.get(`/patients/${pid}/history`).expect(200); // VİA İz okunur (teşhis)
  });

  it("süre dolunca üyelik kendiliğinden geçersiz; yönetici erken kaldırabilir; destek rolü klinik rolüne çevrilemez", async () => {
    expect((await admin.post(`/team/${grantId}/role`, { role: "secretary" })).status).toBe(409);
    await ownerQuery(tenantA, "update memberships set expires_at = now() - interval '1 minute' where id = $1", [grantId]);
    const su = await login(app, supportEmail);
    expect(su.session.memberships.some((x: { id: string }) => x.id === grantId)).toBe(false);
    expect((await admin.get("/security/support-grants").expect(200)).body.items.find((x: { id: string }) => x.id === grantId).active).toBe(false);
    await ownerQuery(tenantA, "update memberships set expires_at = now() + interval '1 hour' where id = $1", [grantId]);
    await admin.post(`/team/${grantId}/revoke`, { reason: "İnceleme bitti" }).expect(200);
    const su3 = await login(app, supportEmail);
    expect(su3.session.memberships.some((x: { id: string }) => x.id === grantId)).toBe(false);
  });
});
