/** Faz 4.3 (ADR-087) — PİA Akış SLA: vadesi eşikten uzun süredir geçmiş açık görev yöneticiye yükseltilir; yönetici kuyruğunda "mine"; ayar sınırları. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import pg from "pg";
import { refreshViaAkis, withContext } from "@viadent/db";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";
import { OWNER_URL } from "./env.js";

let app: INestApplication; let admin: Client; let sec: Client; let tenantA: string; let taskId: string;
beforeAll(async () => {
  app = await startApp();
  [admin, sec] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aSecretary)]);
  tenantA = admin.session.activeMembership.tenantId;
});
afterAll(async () => { await admin.put("/security/akis", { overdueCheckinMinutes: 10, missingContactDays: 7, planUnscheduledDays: 2, proposalPendingDays: 3, escalationHours: 24 }); await app.close(); });

async function refresh(now: Date) {
  const pool = new pg.Pool({ connectionString: OWNER_URL, max: 1 });
  try { return await withContext(pool, { tenantId: tenantA, userId: null }, (c) => refreshViaAkis(c, tenantA, now)); } finally { await pool.end(); }
}

describe("SLA yükseltme", () => {
  it("ayar: escalationHours varsayılan 24, sınır 1–168 (0 ve 500 → 422)", async () => {
    const s = (await admin.get("/security/akis").expect(200)).body;
    expect(s.defaults.escalationHours).toBe(24);
    await admin.put("/security/akis", { ...s.settings, escalationHours: 0 }).expect(422);
    await admin.put("/security/akis", { ...s.settings, escalationHours: 500 }).expect(422);
    await admin.put("/security/akis", { ...s.settings, escalationHours: 2 }).expect(200);
  });
  it("vadesi 1 saat geçmiş görev yükseltilmez; 3 saat geçmiş görev yöneticiye yükseltilir (kopya yok, rol korunur); yönetici kuyruğunda 'mine' ve işaretli", async () => {
    const dueAt = new Date(Date.now() - 3 * 3600 * 1000);
    const r = await ownerQuery(tenantA, `insert into tasks(tenant_id, kind, source_type, dedupe_key, title, reason, next_step, assignee_role, due_at)
      values ($1,'manual','manual','sla-test:' || gen_random_uuid()::text,'SLA sentetik görev','Test','Test adımı','secretary',$2) returning id`, [tenantA, dueAt]);
    taskId = r[0].id;
    await refresh(new Date(dueAt.getTime() + 60 * 60 * 1000)); // vade +1 saat: eşik (2 saat) dolmadı
    expect((await ownerQuery(tenantA, "select escalated_at from tasks where id = $1", [taskId]))[0].escalated_at).toBeNull();
    await refresh(new Date()); // vade +3 saat
    const row = (await ownerQuery(tenantA, "select escalated_at, escalated_to_role, assignee_role from tasks where id = $1", [taskId]))[0];
    expect(row.escalated_at).not.toBeNull(); expect(row.escalated_to_role).toBe("clinic_admin"); expect(row.assignee_role).toBe("secretary");
    expect(await ownerQuery(tenantA, "select count(*)::int as n from tasks where title = 'SLA sentetik görev' and status = 'open'")).toEqual([{ n: expect.any(Number) }]);
    const a = (await admin.get("/tasks").expect(200)).body.items.find((t: { id: string }) => t.id === taskId);
    expect(a).toMatchObject({ mine: true, escalated: true, escalatedToRole: "clinic_admin", overdue: true });
    const s = (await sec.get("/tasks").expect(200)).body.items.find((t: { id: string }) => t.id === taskId);
    expect(s).toMatchObject({ mine: true, escalated: true }); // sekreterin sorumluluğu kalkmaz
  });
  it("yöneticiye atanmış görev kendine yükseltilmez; kapatılan görev yükseltilmez", async () => {
    const r = await ownerQuery(tenantA, `insert into tasks(tenant_id, kind, source_type, dedupe_key, title, reason, next_step, assignee_role, due_at)
      values ($1,'manual','manual','sla-admin:' || gen_random_uuid()::text,'SLA yönetici görevi','Test','Adım','clinic_admin', now() - interval '5 hours') returning id`, [tenantA]);
    await refresh(new Date());
    expect((await ownerQuery(tenantA, "select escalated_at from tasks where id = $1", [r[0].id]))[0].escalated_at).toBeNull();
    await admin.post(`/tasks/${taskId}/status`, { status: "done", reason: "Sentetik kapanış" }).expect(200);
  });
});
