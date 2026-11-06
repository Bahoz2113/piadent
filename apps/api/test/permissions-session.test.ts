/** AT-02 (sunucu tarafı yetki), AT-15 (klinik değiştirme / eski sekme), AT-20 (erişim kaldırma), oturum güvenliği. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { adminQuery, EMAILS, login, ownerQuery, startApp, useLegacyAdmin } from "./helpers.js";

let app: INestApplication;
/** Hekimin klinik not yazdığı taze hasta; "PİA İz" testi bu kimliği kullanır (QA-005: liste indeksine bağımlılık kaldırıldı). */
let notedPatientId: string;
// ADR-098: bu dosya sağlık yetkisi olmayan yönetici rolünün süzgecini sınar; eski yönetici yetki kümesiyle koşar.
beforeAll(async () => { app = await startApp(); await useLegacyAdmin(app); });
afterAll(async () => app.close());

async function anyPatient(email: string) {
  const c = await login(app, email);
  return (await c.get("/patients").expect(200)).body.items[0].id as string;
}

describe("AT-02 sekreter doğrudan API ile yetkisiz işlem çağırır", () => {
  it("klinik not yazma ve okuma sunucuda reddedilir", async () => {
    const sec = await login(app, EMAILS.aSecretary);
    const pid = await anyPatient(EMAILS.aSecretary);
    const w = await sec.post(`/patients/${pid}/clinical-notes`, { body: "Yetkisiz deneme" });
    expect(w.status).toBe(403);
    expect(w.body.code).toBe("FORBIDDEN");
    expect((await sec.get(`/patients/${pid}/clinical-notes`)).status).toBe(403);
    const notes = await ownerQuery(sec.session.activeMembership.tenantId, "select count(*)::int as n from clinical_notes where body = 'Yetkisiz deneme'");
    expect(notes[0].n).toBe(0);
  });

  it("sekreter ekip yönetimi ve PİA Akış dışı yönetici uçlarına erişemez", async () => {
    const sec = await login(app, EMAILS.aSecretary);
    expect((await sec.get("/team")).status).toBe(403);
    const m = (await ownerQuery(sec.session.activeMembership.tenantId, "select id from memberships limit 1"))[0].id;
    expect((await sec.post(`/team/${m}/revoke`, {})).status).toBe(403);
  });

  it("klinik yöneticisi unvanı klinik notlara erişim vermez; hekim yazabilir ve okuyabilir", async () => {
    // QA-005 deseni: not sayısı beklentisi (items[0] eşleşmesi, toplam 2) liste sırasına bağlı kalmasın; taze hasta.
    const sec = await login(app, EMAILS.aSecretary);
    const pid = (await sec.post("/patients", { firstName: "Klinik", lastName: "Notsuz", birthDate: "1982-02-02" }).expect(201)).body.patient.id as string;
    notedPatientId = pid;
    const admin = await login(app, EMAILS.aAdmin);
    expect((await admin.get(`/patients/${pid}/clinical-notes`)).status).toBe(403);
    const dentist = await login(app, EMAILS.aDentist);
    const created = await dentist.post(`/patients/${pid}/clinical-notes`, { body: "Sentetik muayene notu" }).expect(201);
    const list = await dentist.get(`/patients/${pid}/clinical-notes`).expect(200);
    expect(list.body.items[0].id).toBe(created.body.id);
    // Düzeltme gerekçe ister ve önceki kaydı silmez.
    expect((await dentist.post(`/patients/${pid}/clinical-notes`, { body: "Düzeltilmiş", correctsNoteId: created.body.id })).status).toBe(422);
    await dentist.post(`/patients/${pid}/clinical-notes`, { body: "Düzeltilmiş", correctsNoteId: created.body.id, correctionReason: "Diş numarası yanlış" }).expect(201);
    expect((await dentist.get(`/patients/${pid}/clinical-notes`).expect(200)).body.items).toHaveLength(2);
  });

  it("PİA İz: sekreter hasta geçmişinde klinik not olaylarını görmez, hekim görür", async () => {
    const pid = notedPatientId; // önceki testte hekimin not yazdığı hasta (örtük items[0] bağı yerine açık)
    const sec = await login(app, EMAILS.aSecretary);
    const dentist = await login(app, EMAILS.aDentist);
    const secH = (await sec.get(`/patients/${pid}/history`).expect(200)).body.items;
    const denH = (await dentist.get(`/patients/${pid}/history`).expect(200)).body.items;
    expect(secH.some((e: { entityType: string }) => e.entityType === "clinical_note")).toBe(false);
    expect(denH.some((e: { entityType: string }) => e.entityType === "clinical_note")).toBe(true);
    // Not içeriği audit'e yazılmaz.
    expect(JSON.stringify(denH)).not.toContain("Sentetik muayene notu");
  });

  it("telefon klinik rollerinde tam görünür (ADR-093); kimlik no her rolde maskeli", async () => {
    const admin = await login(app, EMAILS.aAdmin);
    const sec = await login(app, EMAILS.aSecretary);
    const ap = (await admin.get("/patients?q=").expect(200)).body.items.find((p: { phone: string | null }) => p.phone);
    expect(ap.phoneMasked).toBe(false);
    expect(ap.phone).toMatch(/^\+90\d{10}$/);
    const sp = (await sec.get(`/patients/${ap.id}`).expect(200)).body;
    expect(sp.phone).toMatch(/^\+90\d{10}$/);
    for (const p of [ap, sp]) if (p.nationalId) expect(p.nationalId).toContain("*");
  });

  it("CSRF başlığı olmayan değiştiren istek reddedilir", async () => {
    const sec = await login(app, EMAILS.aSecretary);
    const res = await request(app.getHttpServer()).post("/api/v1/patients").set("cookie", sec.cookie)
      .set("x-viadent-context", sec.context).send({ firstName: "Csrf", lastName: "Deneme" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_HEADER_MISSING");
  });
});

describe("AT-15 kullanıcı klinik değiştirir, eski sekme açık kalır", () => {
  it("eski bağlamla gelen istek reddedilir; yeni bağlam yalnız yeni kliniğin verisini görür", async () => {
    const tabA = await login(app, EMAILS.multi);
    expect(tabA.session.memberships).toHaveLength(2);
    const aMembership = tabA.context;
    const aPatients = (await tabA.get("/patients").expect(200)).body.items.map((p: { id: string }) => p.id);
    const bMembership = tabA.session.memberships.find((m: { id: string }) => m.id !== aMembership).id;

    // Aynı oturumda ikinci sekme klinik değiştirir.
    const sw = await request(app.getHttpServer()).post("/api/v1/session/switch").set("cookie", tabA.cookie)
      .set("x-viadent-request", "1").send({ membershipId: bMembership }).expect(200);
    expect(sw.body.activeMembership.id).toBe(bMembership);

    // Eski sekme (A bağlamı) okuma ve yazmada durdurulur.
    const stale = await tabA.get("/patients");
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("CONTEXT_CHANGED");
    const staleWrite = await tabA.post("/patients", { firstName: "Eski", lastName: "Sekme" });
    expect(staleWrite.status).toBe(409);
    expect(await adminQuery("select 1 from patients where last_name = 'Sekme'")).toHaveLength(0);

    // Yeni bağlam yeniden yetkilendirilir; A hastaları görünmez.
    tabA.setContext(bMembership);
    const bList = (await tabA.get("/patients").expect(200)).body.items.map((p: { id: string }) => p.id);
    expect(bList.some((id: string) => aPatients.includes(id))).toBe(false);
    // Yetki de yeni klinikteki role göre hesaplanır (aynı kullanıcı: bir klinikte hekim, diğerinde yönetici).
    const oldRole = tabA.session.memberships.find((m: { id: string }) => m.id === aMembership).role;
    const newRole = sw.body.activeMembership.role;
    expect(oldRole).not.toBe(newRole);
    const notes = await tabA.get(`/patients/${bList[0]}/clinical-notes`);
    expect(notes.status).toBe(newRole === "dentist" ? 200 : 403);
    expect(sw.body.permissions.includes("patient.health.read")).toBe(newRole === "dentist");
  });

  it("üyesi olmadığı kliniğe geçiş reddedilir", async () => {
    const sec = await login(app, EMAILS.aSecretary);
    const bAdmin = await login(app, EMAILS.bAdmin);
    const res = await request(app.getHttpServer()).post("/api/v1/session/switch").set("cookie", sec.cookie)
      .set("x-viadent-request", "1").send({ membershipId: bAdmin.context });
    expect(res.status).toBe(403);
  });
});

describe("AT-20 erişimi kaldırılan kullanıcı açık oturumla işlem yapar", () => {
  it("üyelik iptali açık oturumda bir sonraki istekte etkili olur", async () => {
    const assistant = await login(app, EMAILS.aAssistant);
    await assistant.get("/patients").expect(200);
    const admin = await login(app, EMAILS.aAdmin);
    const team = (await admin.get("/team").expect(200)).body.items;
    const target = team.find((m: { email: string }) => m.email === EMAILS.aAssistant);
    expect((await admin.post(`/team/${admin.context}/revoke`, {})).status).toBe(422); // kendini kaldıramaz
    await admin.post(`/team/${target.id}/revoke`, { reason: "Test: görev değişikliği" }).expect(200);

    const after = await assistant.get("/patients");
    expect(after.status).toBe(403);
    expect(after.body.code).toBe("MEMBERSHIP_REVOKED");
    expect((await assistant.post("/via-akis/refresh")).status).toBe(403);
    const audit = await ownerQuery(admin.session.activeMembership.tenantId, "select action from audit_events where entity_id = $1", [target.id]);
    expect(audit.map((r) => r.action)).toContain("membership.revoke");
    // Test verisini diğer dosyalar için eski hâline getir (doğrudan sahip rolüyle; uygulama yolu değil).
    await ownerQuery(admin.session.activeMembership.tenantId, "update memberships set status = 'active', revoked_at = null where id = $1", [target.id]);
  });

  it("çıkış yapılan oturum çereziyle istek reddedilir", async () => {
    const fin = await login(app, EMAILS.aFinance);
    await request(app.getHttpServer()).post("/api/v1/auth/logout").set("cookie", fin.cookie).set("x-viadent-request", "1").expect(200);
    expect((await fin.get("/patients")).status).toBe(401);
  });
});

describe("Giriş güvenliği", () => {
  it("hatalı parola genel mesaj döner; 5 hatadan sonra kilitlenir", async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 5; i++) {
      const r = await request(server).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email: EMAILS.bDentist, password: "yanlis" });
      expect(r.status).toBe(401);
      expect(r.body.message).toBe("E-posta veya parola hatalı.");
    }
    const locked = await request(server).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email: EMAILS.bDentist, password: "yanlis" });
    expect(locked.status).toBe(429);
    const unknown = await request(server).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email: "yok@demo.test", password: "x" });
    expect(unknown.status).toBe(401);
  });

  it("oturum token'ı veritabanında düz metin saklanmaz", async () => {
    const c = await login(app, EMAILS.bAdmin);
    const token = decodeURIComponent(c.cookie.split("=")[1]!);
    const rows = await ownerQuery(null, "select encode(token_hash, 'escape') as h from sessions");
    expect(rows.some((r) => r.h.includes(token))).toBe(false);
  });
});
