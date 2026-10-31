/**
 * Görev 7 (VD-014): içe aktarma (AT-16), açık format dışa aktarım, iki adımlı doğrulama, şifreli yedek + izole geri yükleme (AT-17).
 * Tüm veri sentetiktir. Gerçek PostgreSQL (viadent_test), kısıtlı uygulama rolü.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { isValidTckn } from "@viadent/contracts";
import { decryptFile, encryptFile, restoreAndVerify, runBackup, totpAt, totpStep } from "@viadent/db";
import { EMAILS, adminQuery, login, ownerQuery, startApp, type Client } from "./helpers.js";
import { ADMIN_URL, BACKUP_URL, OWNER_URL, TEST_PASSWORD } from "./env.js";

let app: INestApplication;
let admin: Client, fin: Client, sec: Client, dentist: Client, bAdmin: Client;
let tenantA: string, tenantB: string;
const run = randomUUID().slice(0, 6).toUpperCase();

function validTckn(seed: number): string {
  for (let n = seed; ; n++) {
    const d = String(100000000 + (n % 800000000)).padStart(9, "1").split("").map(Number);
    if (d[0] === 0) continue;
    const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!, even = d[1]! + d[3]! + d[5]! + d[7]!;
    const d10 = (((odd * 7 - even) % 10) + 10) % 10;
    const d11 = (d.reduce((a, b) => a + b, 0) + d10) % 10;
    const t = `${d.join("")}${d10}${d11}`;
    if (isValidTckn(t)) return t;
  }
}
const tc = validTckn(Date.now() % 100000);

const patientsCsv = (rows: string[]) => `﻿Kaynak_No;Adı;Soyadı;Doğum Tarihi;Cinsiyet;Telefon;E-posta;TC Kimlik No\r\n${rows.join("\r\n")}\r\n`;
const imp = (c: Client, body: Record<string, unknown>) => c.post("/imports", { format: "csv", fileName: "sentetik.csv", ...body });

beforeAll(async () => {
  app = await startApp();
  [admin, fin, sec, dentist, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aFinance), login(app, EMAILS.aSecretary),
    login(app, EMAILS.aDentist), login(app, EMAILS.bAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  tenantB = bAdmin.session.activeMembership.tenantId;
});
afterAll(async () => app.close());

// ================================================================ AT-16 içe aktarma
describe("içe aktarma: dry-run → onay → tekrar çalıştırma (AT-16)", () => {
  const content = patientsCsv([
    `${run}-1;ayşe;YILMAZ;01.02.1985;K;0532 111 22 33;ayse.${run}@ornek.test;${tc}`,
    `${run}-2;Mehmet;Demir;1979-11-30;E;;;`,
    `${run}-3;Zeynep;;12.13.1990;X;123;bozuk-eposta;12345678901`, // soyad boş, tarih/cinsiyet/telefon/e-posta/TCKN hatalı
    `${run}-1;Ayşe;Yılmaz;01.02.1985;K;;;`, // dosya içi aynı kaynak no
    `${run}-4;Can;Öztürk;;;;;`,
  ]);
  let batch: any;

  it("yetki: yalnız yönetici; sekreter/hekim/finans içe aktaramaz", async () => {
    for (const c of [sec, dentist, fin]) expect((await imp(c, { kind: "patients", content })).status).toBe(403);
  });

  it("dry-run hiçbir hasta yazmaz; hata satırları alan bazında, Türkçe tarih ve takma ad eşlemesi", async () => {
    const before = (await ownerQuery(tenantA, "select count(*)::int as n from patients"))[0].n;
    const r = await imp(admin, { kind: "patients", content }).expect(201);
    batch = r.body;
    expect(batch.reused).toBe(false);
    expect(batch.status).toBe("dry_run");
    expect(batch.mapping).toMatchObject({ "Kaynak_No": "external_ref", "Adı": "first_name", "Soyadı": "last_name", "Doğum Tarihi": "birth_date", "TC Kimlik No": "national_id" });
    expect(batch.summary).toMatchObject({ rows: 5, valid: 3, errors: 1, duplicates: 1 });
    expect((await ownerQuery(tenantA, "select count(*)::int as n from patients"))[0].n).toBe(before);
    const d = (await admin.get(`/imports/${batch.id}`).expect(200)).body;
    const r3 = d.rows.find((x: any) => x.rowNo === 3);
    expect(r3.status).toBe("error");
    expect(r3.errors.map((e: any) => e.field).sort()).toEqual(["birth_date", "email", "gender", "last_name", "national_id", "phone"]);
    const r1 = d.rows.find((x: any) => x.rowNo === 1);
    expect(r1.data).toMatchObject({ first_name: "Ayşe", last_name: "Yılmaz", birth_date: "1985-02-01", gender: "female", phone_e164: "+905321112233" });
    expect(d.rows.find((x: any) => x.rowNo === 4).status).toBe("duplicate");
  });

  it("hata CSV'si: BOM, ';' ayırıcı, yalnız hatalı/mükerrer satırlar", async () => {
    const r = await admin.get(`/imports/${batch.id}/errors.csv`).expect(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    const text = r.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("satir;durum;hatalar");
  });

  it("aynı dosya tekrar yüklenince aynı batch döner (yeni batch açılmaz)", async () => {
    const r = await imp(admin, { kind: "patients", content, fileName: "baska-ad.csv" }).expect(201);
    expect(r.body.id).toBe(batch.id);
    expect(r.body.reused).toBe(true);
  });

  it("onay: yalnız geçerli satırlar yazılır, kaynak no ve batch kimliği saklanır; ikinci onay 409", async () => {
    const r = await admin.post(`/imports/${batch.id}/commit`).expect(200);
    expect(r.body.status).toBe("committed");
    expect(r.body.summary.imported).toBe(3);
    const ps = await ownerQuery(tenantA, "select external_ref, first_name, national_id, import_batch_id from patients where import_batch_id = $1 order by external_ref", [batch.id]);
    expect(ps.map((p) => p.external_ref)).toEqual([`${run}-1`, `${run}-2`, `${run}-4`]);
    expect(ps[0].national_id).toBe(tc);
    const again = await admin.post(`/imports/${batch.id}/commit`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("IMPORT_ALREADY_COMMITTED");
    const audit = await ownerQuery(tenantA, "select action from audit_events where entity_id = $1 order by id", [batch.id]);
    expect(audit.map((a) => a.action)).toEqual(["import.dry_run", "import.commit"]);
  });

  it("farklı dosya ama aynı kaynak no'lar: 'daha önce aktarılmış', mükerrer hasta oluşmaz", async () => {
    const c2 = patientsCsv([`${run}-1;Ayşe;Yılmaz;01.02.1985;K;;;`, `${run}-2;Mehmet;Demir;30.11.1979;E;;;`, `${run}-5;Yeni;Hasta;;;;;`]);
    const b2 = (await imp(admin, { kind: "patients", content: c2 }).expect(201)).body;
    expect(b2.id).not.toBe(batch.id);
    expect(b2.summary).toMatchObject({ rows: 3, valid: 1, alreadyImported: 2 });
    await admin.post(`/imports/${b2.id}/commit`).expect(200);
    const n = await ownerQuery(tenantA, "select external_ref, count(*)::int as n from patients where external_ref like $1 and status = 'active' group by 1", [`${run}-%`]);
    expect(n.every((x) => x.n === 1)).toBe(true);
    expect(n).toHaveLength(4);
  });

  it("açık eşleme ile bilinmeyen başlıklar; zorunlu sütun eksikse 422 ve öneri listesi", async () => {
    const bad = await imp(admin, { kind: "patients", content: "No;İsim\r\n1;Ali\r\n" });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("IMPORT_MAPPING_INCOMPLETE");
    const ok = await imp(admin, { kind: "patients", content: `Hasta Numarası;Ön Ad;Aile Adı\r\n${run}-M1;Deniz;Kara\r\n`,
      mapping: { "Hasta Numarası": "external_ref", "Ön Ad": "first_name", "Aile Adı": "last_name" } }).expect(201);
    expect(ok.body.summary.valid).toBe(1);
  });

  it("JSON biçimi de kabul edilir (dizi veya {rows})", async () => {
    const content = JSON.stringify({ rows: [{ kaynak_no: `${run}-J1`, ad: "Ece", soyad: "Tan", dogum_tarihi: "05.06.2001" }] });
    const r = await admin.post("/imports", { kind: "patients", format: "json", fileName: "s.json", content }).expect(201);
    expect(r.body.summary).toMatchObject({ rows: 1, valid: 1 });
  });

  it("çapraz klinik: B yöneticisi A'nın batch'ini göremez/onaylayamaz; A'nın kaynak no'su B'de 'aktarılmış' sayılmaz", async () => {
    expect((await bAdmin.get(`/imports/${batch.id}`)).status).toBe(404);
    expect((await bAdmin.post(`/imports/${batch.id}/commit`)).status).toBe(404);
    expect((await bAdmin.get("/imports").expect(200)).body.items.find((x: any) => x.id === batch.id)).toBeUndefined();
    const r = await imp(bAdmin, { kind: "patients", content: patientsCsv([`${run}-1;Başka;Klinik;;;;;`]) }).expect(201);
    expect(r.body.summary).toMatchObject({ valid: 1, alreadyImported: 0 });
  });
});

describe("açılış bakiyeleri: para biçimi, kaynak toplam mutabakatı, geri alma", () => {
  let batch: any;
  const content = [
    "kaynak_no;tutar;tarih;aciklama",
    `${run}-1;1.250,50;31.12.2025;Önceki sistem bakiyesi`,
    `${run}-2;300;31.12.2025;`,
    `${run}-4;1.250;31.12.2025;`, // belirsiz: binlik mi ondalık mı → hata
    `${run}-YOK;99,90;31.12.2025;`, // hasta yok
    `${run}-1;10,00;31.12.2025;`, // aynı hasta ikinci kez
  ].join("\r\n");

  it("dry-run toplamları kaynak toplamıyla uzlaşır (geçerli + hatalı + mükerrer = kaynak)", async () => {
    batch = (await imp(admin, { kind: "opening_balances", content }).expect(201)).body;
    const s = batch.summary;
    expect(s).toMatchObject({ rows: 5, valid: 2, errors: 2, duplicates: 1, unparsedAmountRows: 1 });
    expect(s.amountValid).toBe("1550.50");
    expect(s.amountError).toBe("99.90");
    expect(s.amountDuplicate).toBe("10.00");
    expect(s.amountSource).toBe("1660.40"); // 1250,50 + 300 + 99,90 + 10; okunamayan satır ayrıca sayılır
    const d = (await admin.get(`/imports/${batch.id}?status=error`).expect(200)).body;
    expect(d.rows.find((r: any) => r.rowNo === 3).errors[0].field).toBe("amount");
  });

  it("onay: açılış alacağı kaynak 'opening_balance' + batch kimliğiyle; hasta bakiyesi ve tutar mutabık", async () => {
    const r = (await admin.post(`/imports/${batch.id}/commit`).expect(200)).body;
    expect(r.summary.amountImported).toBe("1550.50");
    const rc = await ownerQuery(tenantA, "select sum(amount)::numeric(14,2)::text as s, count(*)::int as n from receivables where import_batch_id = $1 and source = 'opening_balance'", [batch.id]);
    expect(rc[0]).toEqual({ s: "1550.50", n: 2 });
    // ikinci kez: aynı hastaya ikinci açılış bakiyesi yazılmaz
    const again = (await imp(admin, { kind: "opening_balances", content: `kaynak_no;tutar;tarih\r\n${run}-2;300;31.12.2025\r\n` }).expect(201)).body;
    expect(again.summary.alreadyImported).toBe(1);
  });

  it("geri alma: alacaklar iptal (silinmez), gerekçe ve denetim; ikinci geri alma 409", async () => {
    expect((await admin.post(`/imports/${batch.id}/rollback`, {})).status).toBe(422);
    const r = (await admin.post(`/imports/${batch.id}/rollback`, { reason: "Yanlış dosya yüklendi" }).expect(200)).body;
    expect(r.status).toBe("rolled_back");
    const rc = await ownerQuery(tenantA, "select status, count(*)::int as n from receivables where import_batch_id = $1 group by 1", [batch.id]);
    expect(rc).toEqual([{ status: "cancelled", n: 2 }]);
    expect((await admin.post(`/imports/${batch.id}/rollback`, { reason: "tekrar" })).status).toBe(409);
  });

  it("hasta aktarımı, aktarımdan sonra randevu/işlem görmüşse geri alınamaz", async () => {
    const b = (await imp(admin, { kind: "patients", content: patientsCsv([`${run}-R1;Geri;Alinacak;;;;;`, `${run}-R2;Islem;Gormus;;;;;`]) }).expect(201)).body;
    await admin.post(`/imports/${b.id}/commit`).expect(200);
    const pid = (await ownerQuery(tenantA, "select id from patients where external_ref = $1", [`${run}-R2`]))[0].id;
    const p2 = (await sec.get(`/patients/${pid}`).expect(200)).body;
    await sec.patch(`/patients/${pid}`, { version: p2.version, firstName: "İşlem" }).expect(200);
    const r = await admin.post(`/imports/${b.id}/rollback`, { reason: "Deneme geri alma" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("IMPORT_HAS_ACTIVITY");
    expect((await ownerQuery(tenantA, "select status from patients where id = $1", [pid]))[0].status).toBe("active");
  });
});

// ================================================================ dışa aktarım
describe("açık format dışa aktarım", () => {
  it("klinik: belgelenmiş JSON, sayım + SHA-256; sır sütunu yok; yalnız kendi kliniği; gerekçe zorunlu ve denetlenir", async () => {
    expect((await admin.post("/exports/clinic", {})).status).toBe(422);
    expect((await fin.post("/exports/clinic", { reason: "Yedek kopya" })).status).toBe(403);
    const r = await admin.post("/exports/clinic", { reason: "Pilot veri taşınabilirlik denemesi" }).expect(200);
    expect(r.headers["content-disposition"]).toContain("attachment");
    const doc = JSON.parse(r.text);
    expect(doc).toMatchObject({ format: "viadent-export", version: 1 });
    expect(doc.tenant.id).toBe(tenantA);
    for (const [t, rows] of Object.entries(doc.tables) as [string, any[]][]) {
      expect(doc.counts[t]).toBe(rows.length);
      for (const row of rows) if ("tenant_id" in row) expect(row.tenant_id).toBe(tenantA);
    }
    const text = r.text;
    for (const secret of ["password_hash", "token_hash", "webhook_secret_enc", "mfa_secret_enc", "mfa_pending_enc", "object_key", TEST_PASSWORD]) expect(text).not.toContain(secret);
    expect(Object.keys(doc.tables.users[0]).sort()).toEqual(["email", "full_name", "id"]);
    const dbPatients = (await ownerQuery(tenantA, "select count(*)::int as n from patients"))[0].n;
    expect(doc.counts.patients).toBe(dbPatients);
    const a = await ownerQuery(tenantA, "select changes from audit_events where action = 'export.clinic' order by id desc limit 1");
    expect(a[0].changes.reason.to).toBe("Pilot veri taşınabilirlik denemesi");
  });

  it("hasta (KVKK talebi): yalnız o hastanın kayıtları; sağlık yetkisi olmayan dışa aktaranda sağlık bölümleri atlanır", async () => {
    const pid = (await ownerQuery(tenantA, "select id from patients where external_ref = $1", [`${run}-1`]))[0].id;
    const r = await admin.post(`/patients/${pid}/export`, { reason: "Veri sahibi başvurusu (sentetik)" }).expect(200);
    const doc = JSON.parse(r.text);
    expect(doc.sections.patient[0].id).toBe(pid);
    for (const k of ["appointments", "receivables", "payments"]) for (const x of doc.sections[k]) expect(x.patient_id).toBe(pid);
    const hasHealth = admin.session.activeMembership.permissions?.includes?.("patient.health.read");
    if (!hasHealth) {
      expect(doc.omitted).toEqual(expect.arrayContaining(["clinical_notes", "anamnesis_versions"]));
      expect(doc.sections.clinical_notes).toBeUndefined();
    }
    expect((await bAdmin.post(`/patients/${pid}/export`, { reason: "Başka klinik denemesi" })).status).toBe(404);
    expect((await sec.post(`/patients/${pid}/export`, { reason: "Sekreter denemesi" })).status).toBe(403);
  });
});

// ================================================================ iki adımlı doğrulama
describe("iki adımlı doğrulama (TOTP)", () => {
  it("RFC 6238 test vektörü (SHA-1, T=59 s → 287082)", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
    expect(totpAt(secret, totpStep(59_000))).toBe("287082");
    expect(totpAt(secret, totpStep(1_111_111_109_000))).toBe("081804");
  });

  let secret: string;
  const email = EMAILS.aAssistant;
  it("kurulum → etkinleştirme; sır şifreli saklanır, açık metin veritabanında yok", async () => {
    const me = await login(app, email);
    secret = (await me.post("/me/mfa/setup").expect(200)).body.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect((await me.post("/me/mfa/enable", { code: "000000" })).status).toBe(422);
    await me.post("/me/mfa/enable", { code: totpAt(secret, totpStep()) }).expect(200);
    const u = await adminQuery(`select mfa_secret_enc, mfa_enabled_at from users where email = $1`, [email]);
    expect(u[0].mfa_enabled_at).not.toBeNull();
    expect(u[0].mfa_secret_enc).not.toContain(secret);
  });

  it("giriş: parola sonrası meydan okuma; çerez yalnız doğru kodla; aynı kod ikinci kez kullanılamaz; 5 hatalı denemede kilit", async () => {
    const server = app.getHttpServer();
    const login1 = await request(server).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email, password: TEST_PASSWORD }).expect(200);
    expect(login1.body).toMatchObject({ ok: false, mfaRequired: true });
    expect(login1.headers["set-cookie"]).toBeUndefined();
    const ch = login1.body.challenge;
    expect((await request(server).post("/api/v1/auth/mfa").set("x-viadent-request", "1").send({ challenge: ch, code: "123456" })).status).toBe(401);
    // Yeniden kullanım: son kullanılan adımdan sonraki adımın kodu (etkinleştirmede kullanılan kod tekrar geçmez)
    const used = totpAt(secret, totpStep());
    const replay = await request(server).post("/api/v1/auth/mfa").set("x-viadent-request", "1").send({ challenge: ch, code: used });
    expect(replay.status).toBe(401);
    const ok = await request(server).post("/api/v1/auth/mfa").set("x-viadent-request", "1").send({ challenge: ch, code: totpAt(secret, totpStep() + 1) }).expect(200);
    expect(String(ok.headers["set-cookie"])).toContain("HttpOnly");
    expect((await request(server).post("/api/v1/auth/mfa").set("x-viadent-request", "1").send({ challenge: ch, code: totpAt(secret, totpStep() + 1) })).status).toBe(401);
    const l2 = (await request(server).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email, password: TEST_PASSWORD }).expect(200)).body.challenge;
    for (let k = 0; k < 5; k++) await request(server).post("/api/v1/auth/mfa").set("x-viadent-request", "1").send({ challenge: l2, code: "000001" });
    expect((await request(server).post("/api/v1/auth/mfa").set("x-viadent-request", "1").send({ challenge: l2, code: totpAt(secret, totpStep() + 2) })).status).toBe(429);
    const a = await ownerQuery(tenantA, "select changes from audit_events a join users u on u.id = a.actor_user_id where u.email = $1 and action = 'session.login' order by a.id desc limit 1", [email]);
    expect(a[0].changes.mfa.to).toBe(true);
  });

  it("yönetici sıfırlaması: gerekçe zorunlu, kendi hesabı değil, oturumlar kapanır", async () => {
    const team = (await admin.get("/team").expect(200)).body.items;
    const m = team.find((x: any) => x.email === email);
    expect(m.mfaEnabled).toBe(true);
    expect((await admin.post(`/team/${m.id}/mfa-reset`, {})).status).toBe(422);
    const self = team.find((x: any) => x.isSelf);
    expect((await admin.post(`/team/${self.id}/mfa-reset`, { reason: "kendim" })).status).toBe(422);
    expect((await sec.post(`/team/${m.id}/mfa-reset`, { reason: "yetkisiz" })).status).toBe(403);
    await admin.post(`/team/${m.id}/mfa-reset`, { reason: "Telefon kayboldu; kimlik yüz yüze doğrulandı" }).expect(200);
    const u = await adminQuery("select mfa_enabled_at, mfa_secret_enc from users where email = $1", [email]);
    expect(u[0]).toEqual({ mfa_enabled_at: null, mfa_secret_enc: null });
    expect((await adminQuery("select count(*)::int as n from sessions s join users u on u.id = s.user_id where u.email = $1 and s.revoked_at is null", [email]))[0].n).toBe(0);
  });

  it("çok klinikli kullanıcının doğrulayıcısını tek klinik yöneticisi sıfırlayamaz", async () => {
    const team = (await admin.get("/team").expect(200)).body.items;
    const multi = team.find((x: any) => x.email === EMAILS.multi);
    if (!multi) return; // seed'de çok klinikli kullanıcı A'da değilse kapsam dışı
    const r = await admin.post(`/team/${multi.id}/mfa-reset`, { reason: "Deneme sıfırlama" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("MFA_RESET_MULTI_CLINIC");
  });

  it("zorunlu rol politikası: MFA kurmamış yönetici klinik uçlarına erişemez, Hesabım/MFA kurulumu açık kalır", async () => {
    const strict = await startApp({ requireMfaRoles: ["clinic_admin"] });
    try {
      const a = await login(strict, EMAILS.aAdmin);
      expect(a.session.mfa).toEqual({ enabled: false, required: true });
      const r = await a.get("/patients");
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("MFA_ENROLLMENT_REQUIRED");
      expect((await a.get("/me/mfa").expect(200)).body.required).toBe(true);
      const s = await login(strict, EMAILS.aSecretary);
      await s.get("/patients?q=a").expect(200);
    } finally { await strict.close(); }
  });
});

// ================================================================ AT-17 yedek / izole geri yükleme
describe("şifreli yedek ve izole geri yükleme (AT-17)", () => {
  const work = mkdtempSync(join(tmpdir(), "vd-at17-"));
  const pass = `test-only-${randomUUID()}`;
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it("AES-256-GCM: değiştirilmiş dosya ve yanlış parola reddedilir", async () => {
    const src = join(work, "a.bin"), enc = join(work, "a.enc"), out = join(work, "a.out");
    writeFileSync(src, Buffer.from("sentetik yedek içeriği ".repeat(1000)));
    await encryptFile(src, enc, pass);
    expect(readFileSync(enc).includes(Buffer.from("sentetik"))).toBe(false);
    await decryptFile(enc, out, pass);
    expect(readFileSync(out).equals(readFileSync(src))).toBe(true);
    await expect(decryptFile(enc, join(work, "b.out"), `${pass}x`)).rejects.toThrow();
    const t = readFileSync(enc); t[100] = t[100]! ^ 0xff; writeFileSync(join(work, "t.enc"), t);
    await expect(decryptFile(join(work, "t.enc"), join(work, "t.out"), pass)).rejects.toThrow();
  });

  it("yedek → izole DB'ye geri yükleme: tablo sayıları, klinik bazında hasta ve finans toplamları, dosyalar mutabık; süreler ölçülür", async () => {
    // Dosya mutabakatı için gerçek bir depolanmış dosya (sentetik PNG imzası) — test deposu geçici dizinde.
    const storage = join(work, "storage");
    const fileId = randomUUID();
    const key = `${tenantA}/2026/${fileId}`;
    const body = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(randomUUID())]);
    const { createHash } = await import("node:crypto");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(storage, tenantA, "2026"), { recursive: true });
    writeFileSync(join(storage, key), body);
    const sha = createHash("sha256").update(body).digest("hex");
    const anyPatient = (await ownerQuery(tenantA, "select id from patients limit 1"))[0].id;
    const uploader = (await ownerQuery(tenantA, "select u.id from users u where u.email = $1", [EMAILS.aAdmin]))[0].id;
    await ownerQuery(tenantA, `insert into file_assets(id, tenant_id, patient_id, category, sensitivity, original_name, declared_type, declared_size, detected_type, size_bytes, sha256, object_key, status, available_at, uploaded_by)
      values ($1,$2,$3,'other','administrative','yedek-testi.png','image/png',$4,'image/png',$4,$5,$6,'available',now(),$7)`, [fileId, tenantA, anyPatient, body.length, sha, key, uploader]);
    // Tablo sahibi rolü bile FORCE RLS nedeniyle dökümü alamaz — yalnız ayrı yedek rolü (BYPASSRLS, salt okuma) alabilir.
    await expect(runBackup({ backupUrl: OWNER_URL, storageDir: storage, outDir: join(work, "owner"), passphrase: pass })).rejects.toThrow(/row-level security/);
    expect(BACKUP_URL, "BACKUP_DATABASE_URL tanımlı olmalı (pnpm db:roles)").toBeTruthy();
    const b = await runBackup({ backupUrl: BACKUP_URL!, storageDir: storage, outDir: join(work, "out"), passphrase: pass });
    expect(b.manifest.files).toMatchObject({ referenced: expect.any(Number), present: expect.any(Number) });
    expect(b.manifest.files.present).toBeGreaterThanOrEqual(1);
    expect(Object.keys(b.manifest.tenants).length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(b.manifest)).not.toContain("Ayşe"); // manifest kişisel veri içermez
    const target = `viadent_at17_${Date.now()}`;
    const r = await restoreAndVerify({ backupDir: b.dir, adminUrl: ADMIN_URL, passphrase: pass, target, keep: true });
    expect(r.differences).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.restored.tenants).toEqual(b.manifest.tenants);
    expect(r.timingsMs.total).toBeLessThan(4 * 3600 * 1000); // RTO hedefi ≤ 4 saat (ölçüm docs/backup-restore.md)
    expect(r.backupAgeMinutes).toBeLessThanOrEqual(60); // RPO hedefi ≤ 1 saat
    // geri yüklenen veride RLS zorunlu ve uygulama rolü bağlamsız hiçbir hasta görmez
    const tu = new URL(ADMIN_URL); tu.pathname = `/${target}`;
    const pgm = (await import("pg")).default;
    const rc = new pgm.Client({ connectionString: tu.toString() });
    await rc.connect();
    try {
      const forced = (await rc.query("select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity")).rows[0].n;
      expect(forced).toBeGreaterThanOrEqual(60);
      await rc.query("set role viadent_app");
      expect((await rc.query("select count(*)::int as n from patients")).rows[0].n).toBe(0);
    } finally { await rc.end(); }
    await adminQuery(`drop database ${target} with (force)`);
    // kurcalanmış yedek: bütünlük kontrolü geri yüklemeye başlamadan durdurur
    const enc = join(b.dir, "db.dump.enc"); const t = readFileSync(enc); t[t.length - 5] = t[t.length - 5]! ^ 0x01; writeFileSync(enc, t);
    await expect(restoreAndVerify({ backupDir: b.dir, adminUrl: ADMIN_URL, passphrase: pass })).rejects.toThrow(/bütünlüğü/);
    expect(existsSync(b.dir)).toBe(true);
  }, 120_000);

});
