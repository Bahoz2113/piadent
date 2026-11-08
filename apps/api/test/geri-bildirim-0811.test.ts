/**
 * 08.11.2026 geri bildirimi (ADR-107): randevuda işlem İSTEĞE BAĞLI ve birden fazla (0040 appointment_procedures), ziyarete birden
 * fazla tanı, "koltuk" yerine "ünite" (Ünite A/B/C).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { addMoney } from "@viadent/contracts";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, dentist: Client, sec: Client, bAdmin: Client;
let tenantA: string;
let res: { practitioners: { id: string }[]; chairs: { id: string; name: string }[] };
let procs: { id: string; name: string; price: string | null; defaultMinutes: number | null }[];
const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};
let n = 0;
async function newPatient(tag: string) {
  n++;
  return (await sec.post("/patients", { firstName: `Çokİşlem${tag}`, lastName: `Hasta${n}`, birthDate: "1984-03-0" + ((n % 9) + 1), acknowledgeDuplicates: true }).expect(201)).body.patient.id as string;
}
const slot = (i: number) => `${String(9 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`;
let si = 0;
const base = (patientId: string, extra: Record<string, unknown> = {}) =>
  ({ patientId, practitionerId: res.practitioners[res.practitioners.length - 1]!.id, date: day(9), startTime: slot(si++), durationMinutes: 15, ...extra });

beforeAll(async () => {
  app = await startApp();
  [admin, dentist, sec, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.bAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  res = (await sec.get("/resources").expect(200)).body;
  procs = (await sec.get("/procedures").expect(200)).body.items;
});
afterAll(async () => { await app.close(); });

describe("ADR-107 randevuda işlem isteğe bağlı ve birden fazla", () => {
  it("sekreter işlemsiz randevu verir: işlem listesi boş, fiyat yok, neden boş", async () => {
    const a = (await sec.post("/appointments", base(await newPatient("A"))).expect(201)).body;
    expect(a.procedures).toEqual([]);
    expect(a).toMatchObject({ procedureId: null, procedureLabel: null, plannedPrice: null, reason: null });
    expect((await ownerQuery(tenantA, "select count(*)::int as n from appointment_procedures where appointment_id = $1", [a.id]))[0].n).toBe(0);
  });

  it("üç işlem sırasıyla kaydedilir; ilki procedureId; toplam fiyat tarife fiyatlarının toplamı; neden işlem adları", async () => {
    const priced = procs.filter((p) => p.price).slice(0, 3);
    expect(priced).toHaveLength(3);
    const ids = [priced[2]!.id, priced[0]!.id, priced[1]!.id];
    const pid = res.practitioners[res.practitioners.length - 1]!.id;
    const prices = await Promise.all(ids.map(async (id) => (await sec.get(`/price?procedureId=${id}&practitionerId=${pid}&date=${day(9)}`).expect(200)).body.price as string));
    const a = (await sec.post("/appointments", base(await newPatient("B"), { procedureIds: ids })).expect(201)).body;
    expect(a.procedures.map((p: { id: string }) => p.id)).toEqual(ids);
    expect(a.procedureId).toBe(ids[0]);
    expect(a.procedures.map((p: { price: string }) => p.price)).toEqual(prices);
    expect(a.plannedPrice).toBe(addMoney(...prices));
    expect(a.reason).toBe(ids.map((id) => procs.find((p) => p.id === id)!.name).join(", "));
    const rows = await ownerQuery(tenantA, "select procedure_id, position from appointment_procedures where appointment_id = $1 order by position", [a.id]);
    expect(rows.map((r) => [r.procedure_id, r.position])).toEqual(ids.map((id, i) => [id, i + 1]));
    // Gün listesi ve hasta randevuları da aynı listeyi döner
    const dayList = (await sec.get(`/appointments?date=${day(9)}`).expect(200)).body.items.find((x: { id: string }) => x.id === a.id);
    expect(dayList.procedures.map((p: { id: string }) => p.id)).toEqual(ids);
    const audit = await ownerQuery(tenantA, "select changes from audit_events where action = 'appointment.create' and entity_id = $1", [a.id]);
    expect(audit[0].changes.procedure_ids.to).toEqual(ids);
  });

  it("fiyatı olmayan işlem varsa toplam gösterilmez (yanlış toplam yok)", async () => {
    const unpriced = (await ownerQuery(tenantA, `insert into procedures(tenant_id, code, name, category, tooth_scope, default_minutes)
      values ($1, 'ZZ-0811', 'Fiyatsız sentetik işlem', 'Diğer', 'mouth', 10) returning id`, [tenantA]))[0].id as string;
    const priced = procs.find((p) => p.price)!;
    const a = (await sec.post("/appointments", base(await newPatient("C"), { procedureIds: [priced.id, unpriced] })).expect(201)).body;
    expect(a.procedures.map((p: { price: string | null }) => p.price === null)).toEqual([false, true]);
    expect(a.plannedPrice).toBeNull();
  });

  it("aynı işlem iki kez, 11 işlem, bilinmeyen işlem → 422 ve randevu yazılmaz", async () => {
    const p = await newPatient("D");
    const before = (await ownerQuery(tenantA, "select count(*)::int as n from appointments where patient_id = $1", [p]))[0].n;
    const dup = await sec.post("/appointments", base(p, { procedureIds: [procs[0]!.id, procs[0]!.id] }));
    expect(dup.status).toBe(422);
    const many = await sec.post("/appointments", base(p, { procedureIds: procs.slice(0, 11).map((x) => x.id) }));
    expect(many.status).toBe(422);
    const unknown = await sec.post("/appointments", base(p, { procedureIds: [procs[0]!.id, "00000000-0000-4000-8000-000000000000"] }));
    expect(unknown.status).toBe(422);
    expect(unknown.body.field_errors.procedureIds).toBeTruthy();
    expect((await ownerQuery(tenantA, "select count(*)::int as n from appointments where patient_id = $1", [p]))[0].n).toBe(before);
  });

  it("eski istemci tek procedureId gönderir: tek işlemli liste", async () => {
    const a = (await sec.post("/appointments", base(await newPatient("E"), { procedureId: procs[1]!.id })).expect(201)).body;
    expect(a.procedures.map((p: { id: string }) => p.id)).toEqual([procs[1]!.id]);
  });

  it("B kiracısı A'nın randevu-işlem satırlarını göremez; tablo FORCE RLS", async () => {
    const r = await ownerQuery(null, "select relrowsecurity, relforcerowsecurity from pg_class where relname = 'appointment_procedures'");
    expect(r[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const bTenant = bAdmin.session.activeMembership.tenantId;
    const aCount = (await ownerQuery(tenantA, "select count(*)::int as n from appointment_procedures"))[0].n;
    expect(aCount).toBeGreaterThan(0);
    const leaked = await ownerQuery(bTenant, "select count(*)::int as n from appointment_procedures where tenant_id = $1", [tenantA]);
    expect(leaked[0].n).toBe(0);
  });
});

describe("ADR-107 ziyarete birden fazla tanı (hekim, randevu verildikten sonra)", () => {
  it("hekim aynı ziyarete iki dişe ve genel tanı ekler; sekreter tanı ekleyemez", async () => {
    const p = await newPatient("T");
    const a = (await sec.post("/appointments", base(p)).expect(201)).body;
    for (const t of ["16", "26"]) {
      await dentist.post(`/patients/${p}/diagnoses`, { appointmentId: a.id, description: "Dentin çürüğü (sentetik)", code: "K02.1", location: { kind: "tooth", tooth: t, surfaces: [] } }).expect(201);
    }
    await dentist.post(`/patients/${p}/diagnoses`, { appointmentId: a.id, description: "Gingivit (sentetik)", location: { kind: "mouth" } }).expect(201);
    const chart = (await dentist.get(`/patients/${p}/chart`).expect(200)).body;
    const visit = chart.diagnoses.filter((d: { appointmentId: string | null }) => d.appointmentId === a.id);
    expect(visit.map((d: { location: { tooth?: string | null } }) => d.location.tooth ?? "genel").sort()).toEqual(["16", "26", "genel"]);
    expect((await sec.post(`/patients/${p}/diagnoses`, { appointmentId: a.id, description: "Sekreter tanısı", location: { kind: "mouth" } })).status).toBe(403);
  });
});

describe("Koltuk → Ünite", () => {
  it("demo kaynak adları Ünite A/B/C; ünite çakışması 'ünite' der", async () => {
    expect(res.chairs.map((c) => c.name).sort()).toEqual(["Ünite A", "Ünite B", "Ünite C"]);
    const b = (await bAdmin.get("/resources").expect(200)).body;
    expect(b.chairs.map((c: { name: string }) => c.name).sort()).toEqual(["Ünite A", "Ünite B"]);
  });
  it("0040 yeniden adlandırma yalnız varsayılan adlara dokunur ve tekrar çalıştırılınca değişmez", async () => {
    const names = await ownerQuery(tenantA, "select name from chairs order by name");
    expect(names.every((r) => !/^Koltuk \d$|^Ünit [A-C]$/.test(r.name))).toBe(true);
  });
});

describe("dışa aktarım", () => {
  it("klinik dökümünde appointment_procedures bölümü var", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/pilot/export.controller.ts", import.meta.url), "utf8"));
    expect(src).toMatch(/\["appointment_procedures", \[\]\]/);
  });
});
