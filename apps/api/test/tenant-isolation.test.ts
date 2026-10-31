/** AT-01 + RLS savunma katmanı: çapraz tenant erişimi sızmaz, uygulama rolü RLS'i atlayamaz. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import pg from "pg";
import { withContext } from "@viadent/db";
import { EMAILS, login, ownerQuery, startApp, tomorrowIstanbul, type Client } from "./helpers.js";
import { APP_URL } from "./env.js";

let app: INestApplication;
let a: Client;
let b: Client;
let bPatientId: string;
let aTenant: string;
let bTenant: string;

beforeAll(async () => {
  app = await startApp();
  a = await login(app, EMAILS.aSecretary);
  b = await login(app, EMAILS.bAdmin);
  aTenant = a.session.activeMembership.tenantId;
  bTenant = b.session.activeMembership.tenantId;
  const list = await b.get("/patients").expect(200);
  bPatientId = list.body.items[0].id;
});
afterAll(async () => app.close());

describe("AT-01 çapraz tenant erişimi", () => {
  it("A kullanıcısı B'nin bilinen hasta ID'sini isteyince içerik ve varlık bilgisi sızmaz", async () => {
    const res = await a.get(`/patients/${bPatientId}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
    const text = JSON.stringify(res.body);
    const bp = (await ownerQuery(bTenant, "select first_name, last_name from patients where id = $1", [bPatientId]))[0];
    expect(text).not.toContain(bp.first_name);
    expect(text).not.toContain(bp.last_name);
    expect(text).not.toContain(bTenant);
  });

  it("reddedilen erişim A kliniğinin audit kaydına yazılır", async () => {
    const rows = await ownerQuery(aTenant, "select action from audit_events where entity_id = $1 and tenant_id = $2", [bPatientId, aTenant]);
    expect(rows.map((r) => r.action)).toContain("access.denied_or_missing");
    const inB = await ownerQuery(bTenant, "select 1 from audit_events where entity_id = $1 and action = 'access.denied_or_missing'", [bPatientId]);
    expect(inB).toHaveLength(0);
  });

  it("geçmiş, randevu listesi ve klinik not uçları da B hastası için 404/403 döner", async () => {
    expect((await a.get(`/patients/${bPatientId}/history`)).status).toBe(404);
    expect((await a.get(`/patients/${bPatientId}/appointments`)).status).toBe(404);
    const dentist = await login(app, EMAILS.aDentist);
    expect((await dentist.get(`/patients/${bPatientId}/clinical-notes`)).status).toBe(404);
    expect((await dentist.post(`/patients/${bPatientId}/clinical-notes`, { body: "deneme" })).status).toBe(404);
  });

  it("arama B hastalarını döndürmez", async () => {
    const bp = (await ownerQuery(bTenant, "select first_name, last_name from patients where id = $1", [bPatientId]))[0];
    const res = await a.get(`/patients?q=${encodeURIComponent(bp.last_name)}`).expect(200);
    expect(res.body.items.map((p: { id: string }) => p.id)).not.toContain(bPatientId);
  });

  it("A, B'nin hastasına randevu bağlayamaz; B hekimi/koltuğu kullanılamaz", async () => {
    const aRes = (await a.get("/resources").expect(200)).body;
    const res = await a.post("/appointments", {
      patientId: bPatientId, practitionerId: aRes.practitioners[0].id, date: tomorrowIstanbul(3), startTime: "08:00", durationMinutes: 30,
    });
    expect(res.status).toBe(422);
    expect(res.body.field_errors.patientId).toBeTruthy();
    const bRes = (await b.get("/resources").expect(200)).body;
    const aPatient = (await a.get("/patients").expect(200)).body.items[0].id;
    const res2 = await a.post("/appointments", {
      patientId: aPatient, practitionerId: bRes.practitioners[0].id, date: tomorrowIstanbul(3), startTime: "08:00", durationMinutes: 30,
    });
    expect(res2.status).toBe(422);
  });

  it("istemcinin gönderdiği tenant_id yok sayılır (gövdedeki alan kullanılmaz)", async () => {
    const res = await a.post("/patients", { firstName: "Sızma", lastName: "Denemesi", tenantId: bTenant });
    expect(res.status).toBe(201);
    const rows = await ownerQuery(aTenant, "select tenant_id from patients where id = $1", [res.body.patient.id]);
    expect(rows[0].tenant_id).toBe(aTenant);
    expect(await ownerQuery(bTenant, "select 1 from patients where id = $1", [res.body.patient.id])).toHaveLength(0);
  });
});

describe("RLS ikinci savunma katmanı (W04)", () => {
  const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
  afterAll(async () => pool.end());

  it("uygulama rolü superuser, BYPASSRLS veya tablo sahibi değildir", async () => {
    const r = await pool.query(
      `select r.rolsuper, r.rolbypassrls,
              (select count(*)::int from pg_tables where schemaname = 'public' and tableowner = current_user) as owned
         from pg_roles r where r.rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owned: 0 });
  });

  it("tüm tenant tablolarında (19) RLS etkin ve FORCE açık", async () => {
    const r = await pool.query(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
        where relname = any($1::text[]) order by relname`,
      [["patients", "appointments", "tasks", "practitioners", "chairs", "clinical_notes", "branches", "memberships", "audit_events", "outbox_events", "tenant_counters", "tenants",
        "appointment_types", "work_schedules", "closures", "patient_relations", "anamnesis_versions", "anamnesis_reviews", "invitations"]],
    );
    expect(r.rows).toHaveLength(19);
    for (const row of r.rows) expect([row.relname, row.relrowsecurity, row.relforcerowsecurity]).toEqual([row.relname, true, true]);
  });

  it("tenant bağlamı olmadan hiçbir hasta görünmez (default deny)", async () => {
    const r = await pool.query("select count(*)::int as n from patients");
    expect(r.rows[0].n).toBe(0);
  });

  it("bağlam transaction-local'dir; havuza dönen bağlantıda sızmaz", async () => {
    const inside = await withContext(pool, { tenantId: aTenant, userId: null }, async (c) =>
      (await c.query("select count(*)::int as n from patients")).rows[0].n,
    );
    expect(inside).toBeGreaterThan(0);
    const after = await pool.query("select current_setting('app.tenant_id', true) as t, (select count(*)::int from patients) as n");
    expect(after.rows[0].t ?? "").toBe("");
    expect(after.rows[0].n).toBe(0);
  });

  it("başka tenant_id ile doğrudan yazma RLS tarafından reddedilir", async () => {
    await expect(
      withContext(pool, { tenantId: aTenant, userId: null }, (c) =>
        c.query("insert into tasks(tenant_id, kind, source_type, dedupe_key, title, reason, next_step) values ($1,'manual','test','x','x','x','x')", [bTenant]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("audit kayıtları uygulama rolüyle güncellenemez/silinemez", async () => {
    await expect(withContext(pool, { tenantId: aTenant, userId: null }, (c) => c.query("update audit_events set action = 'x'"))).rejects.toThrow();
    await expect(withContext(pool, { tenantId: aTenant, userId: null }, (c) => c.query("delete from audit_events"))).rejects.toThrow();
  });
});
