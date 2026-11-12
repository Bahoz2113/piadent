/**
 * ADR-110 (ürün sahibi 12.11.2026): Hekimler → aylık çalışma listesi.
 *  - Okuma randevu okuyan herkese, yazma yalnız schedule.manage (yönetici); B kiracısı görmez.
 *  - Kayıt o gün haftalık şablonun yerine geçer: uygun saatler ve "çalışma saati dışı" uyarısı listeden.
 *  - Doğrulama (saat sırası, 15 dk, çalışılmayan güne saat/ünite, yinelenen gün, pasif hekim, tarih sınırı, pasif ünite).
 *  - Plan dışında kalacak randevular: 409 + bilinçli onay; randevular silinmez; audit'te iz.
 *  - Aynı ünite aynı gün çakışan saatte iki hekime verilemez; şablona dönüş; değişmeyen gün audit üretmez; FORCE RLS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, login, ownerQuery, startApp, tomorrowIstanbul, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, sec: Client, dentist: Client, bAdmin: Client;
let tenantA: string, pracA: string, pracB: string, chairX: string, patientId: string;
const tag = Math.random().toString(36).slice(2, 7);
/** İleri tarihli hafta içi gün (offset ≥ 7: geçmiş saat elemesi etkilemesin). */
const used = new Set<string>();
function weekday(offset: number) {
  for (let o = offset; ; o++) {
    const d = tomorrowIstanbul(o); const w = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (w >= 1 && w <= 5 && !used.has(d)) { used.add(d); return d; }
  }
}
const month = (d: string) => d.slice(0, 7);

beforeAll(async () => {
  app = await startApp();
  [admin, sec, dentist, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aSecretary), login(app, EMAILS.aDentist), login(app, EMAILS.bAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  pracA = (await admin.post("/practitioners", { displayName: `Dt. Liste A ${tag}` }).expect(201)).body.id;
  pracB = (await admin.post("/practitioners", { displayName: `Dt. Liste B ${tag}` }).expect(201)).body.id;
  const blocks = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));
  await admin.put(`/practitioners/${pracA}/schedule`, { blocks }).expect(200);
  chairX = (await admin.post("/chairs", { name: `Ünite L ${tag}` }).expect(201)).body.id;
  patientId = (await sec.post("/patients", { firstName: "Liste", lastName: `Hasta${tag}`, birthDate: "1990-05-06", acknowledgeDuplicates: true }).expect(201)).body.patient.id;
});
afterAll(async () => { await app.close(); });

describe("okuma ve yetki", () => {
  it("ay görünümü: günler, hekimler (haftalık şablonla), üniteler; sekreter ve hekim okur, yazamaz; ay biçimi 422", async () => {
    const d = weekday(10);
    const r = (await sec.get(`/work-roster?month=${month(d)}`).expect(200)).body;
    expect(r.days.length).toBeGreaterThanOrEqual(28);
    expect(r.days[0]).toMatchObject({ date: `${month(d)}-01` });
    const a = r.practitioners.find((p: { id: string }) => p.id === pracA);
    expect(a.weekly).toHaveLength(5);
    expect(a.weekly[0]).toMatchObject({ weekday: 1, start: "09:00", end: "17:00" });
    expect(a.plannedDays).toBeGreaterThan(15);
    expect(r.chairs.some((c: { id: string }) => c.id === chairX)).toBe(true);
    expect((await dentist.get(`/work-roster?month=${month(d)}`)).status).toBe(200);
    expect((await sec.post("/work-roster", { cells: [{ practitionerId: pracA, date: d, kind: "off" }] })).status).toBe(403);
    expect((await dentist.post("/work-roster/clear", { cells: [{ practitionerId: pracA, date: d }] })).status).toBe(403);
    expect((await sec.get("/work-roster?month=2026-13")).status).toBe(422);
    expect((await sec.get("/work-roster?month=kasım")).status).toBe(422);
    const b = (await bAdmin.get(`/work-roster?month=${month(d)}`).expect(200)).body;
    expect(b.practitioners.some((p: { id: string }) => p.id === pracA)).toBe(false);
  });
});

describe("plan uygun saatleri belirler", () => {
  it("çalışıyor: o günün bloğu listeden; şablonla aynı gün başka saat; ünite ve not görünür; audit", async () => {
    const d = weekday(11);
    const r = (await admin.post("/work-roster", { cells: [{ practitionerId: pracA, date: d, kind: "work", start: "13:00", end: "20:00", chairId: chairX, note: "Öğleden sonra" }] }).expect(200)).body;
    expect(r).toMatchObject({ saved: 1, unchanged: 0 });
    const av = (await sec.get(`/availability?practitionerId=${pracA}&date=${d}&minutes=30`).expect(200)).body;
    expect(av).toMatchObject({ planSource: "roster", rosterOff: false, blocks: [{ start: 780, end: 1200 }] });
    expect(av.slots[0]).toBe("13:00");
    expect(av.slots.at(-1)).toBe("19:30");
    expect(av.slots).not.toContain("09:00");
    const m = (await sec.get(`/work-roster?month=${month(d)}`).expect(200)).body;
    expect(m.entries.find((e: { practitionerId: string; date: string }) => e.practitionerId === pracA && e.date === d))
      .toMatchObject({ kind: "work", start: "13:00", end: "20:00", chairId: chairX, note: "Öğleden sonra" });
    const other = weekday(12);
    expect((await sec.get(`/availability?practitionerId=${pracA}&date=${other}&minutes=30`).expect(200)).body).toMatchObject({ planSource: "weekly", blocks: [{ start: 540, end: 1020 }] });
    const au = await ownerQuery(tenantA, "select changes from audit_events where action = 'work_roster.save' and changes->'work_date'->>'to' = $1 and changes->'practitioner_id'->>'to' = $2", [d, pracA]);
    expect(au).toHaveLength(1);
    expect(au[0].changes.kind).toEqual({ from: "Haftalık şablon", to: "13:00–20:00" });
    // aynı içerik yeniden → değişiklik yok, audit yok
    expect((await admin.post("/work-roster", { cells: [{ practitionerId: pracA, date: d, kind: "work", start: "13:00", end: "20:00", chairId: chairX, note: "Öğleden sonra" }] }).expect(200)).body).toMatchObject({ saved: 0, unchanged: 1 });
  });

  it("çalışmıyor: boş saat yok; o güne randevu çalışma saati dışı uyarısı (bilinçli onayla kaydedilir); şablona dönüş", async () => {
    const d = weekday(13);
    await admin.post("/work-roster", { cells: [{ practitionerId: pracA, date: d, kind: "off" }] }).expect(200);
    const av = (await sec.get(`/availability?practitionerId=${pracA}&date=${d}&minutes=30`).expect(200)).body;
    expect(av).toMatchObject({ planSource: "roster", rosterOff: true, slots: [], blocks: [] });
    const x = await sec.post("/appointments", { patientId, practitionerId: pracA, date: d, startTime: "10:00", durationMinutes: 30 });
    expect(x.status).toBe(422);
    expect(x.body.code).toBe("OUTSIDE_WORKING_HOURS");
    const ok = await sec.post("/appointments", { patientId, practitionerId: pracA, date: d, startTime: "10:00", durationMinutes: 30, allowOutsideHours: true });
    expect(ok.status).toBe(201);
    // planlı olmayan hekim (şablonu yok) için de liste kısıt getirir
    const db = weekday(14);
    await admin.post("/work-roster", { cells: [{ practitionerId: pracB, date: db, kind: "work", start: "10:00", end: "12:00" }] }).expect(200);
    const xb = await sec.post("/appointments", { patientId, practitionerId: pracB, date: db, startTime: "14:00", durationMinutes: 30 });
    expect(xb.body.code).toBe("OUTSIDE_WORKING_HOURS");
    expect((await sec.post("/appointments", { patientId, practitionerId: pracB, date: db, startTime: "10:30", durationMinutes: 30 })).status).toBe(201);
    // şablona dön
    const c = (await admin.post("/work-roster/clear", { cells: [{ practitionerId: pracB, date: db }] }).expect(200)).body;
    expect(c.cleared).toBe(1);
    expect((await sec.get(`/availability?practitionerId=${pracB}&date=${db}&minutes=30`).expect(200)).body.planSource).toBe("default");
    expect((await ownerQuery(tenantA, "select count(*)::int as n from audit_events where action = 'work_roster.clear' and changes->'work_date'->>'to' = $1", [db]))[0].n).toBe(1);
  });
});

describe("plan dışında kalan randevular", () => {
  it("409 + randevu listesi; bilinçli onayla kaydedilir, randevu silinmez, audit'te sayı", async () => {
    const d = weekday(16);
    const appt = (await sec.post("/appointments", { patientId, practitionerId: pracA, date: d, startTime: "09:30", durationMinutes: 30 }).expect(201)).body;
    const r = await admin.post("/work-roster", { cells: [{ practitionerId: pracA, date: d, kind: "work", start: "12:00", end: "18:00" }] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ROSTER_APPOINTMENTS_OUTSIDE");
    expect(r.body.details.outside).toEqual([{ practitionerId: pracA, date: d, count: 1 }]);
    expect((await ownerQuery(tenantA, "select count(*)::int as n from work_rosters where practitioner_id = $1 and work_date = $2", [pracA, d]))[0].n).toBe(0);
    const ok = (await admin.post("/work-roster", { cells: [{ practitionerId: pracA, date: d, kind: "work", start: "12:00", end: "18:00" }], acknowledgeAppointments: true }).expect(200)).body;
    expect(ok.saved).toBe(1);
    expect((await ownerQuery(tenantA, "select status from appointments where id = $1", [appt.id]))[0].status).toBe("planned");
    const au = await ownerQuery(tenantA, "select changes from audit_events where action = 'work_roster.save' and changes->'work_date'->>'to' = $1", [d]);
    expect(au[0].changes.outside_appointments).toEqual({ from: null, to: 1 });
    // randevuyu kapsayan plan uyarı vermez
    const d2 = weekday(17);
    await sec.post("/appointments", { patientId, practitionerId: pracA, date: d2, startTime: "13:00", durationMinutes: 30 }).expect(201);
    expect((await admin.post("/work-roster", { cells: [{ practitionerId: pracA, date: d2, kind: "work", start: "12:00", end: "18:00" }] })).status).toBe(200);
  });
});

describe("doğrulama ve ünite çakışması", () => {
  it("geçersiz girdiler 422", async () => {
    const d = weekday(18);
    const bad: [string, Record<string, unknown>][] = [
      ["bitiş başlangıçtan önce", { kind: "work", start: "14:00", end: "10:00" }],
      ["eşit saat", { kind: "work", start: "10:00", end: "10:00" }],
      ["15 dk dışı", { kind: "work", start: "09:10", end: "12:00" }],
      ["saat biçimi", { kind: "work", start: "9", end: "12:00" }],
      ["saat eksik", { kind: "work", start: "09:00" }],
      ["çalışmıyor + saat", { kind: "off", start: "09:00", end: "12:00" }],
      ["çalışmıyor + ünite", { kind: "off", chairId: chairX }],
      ["bilinmeyen tür", { kind: "nöbet" }],
      ["uzun not", { kind: "off", note: "x".repeat(121) }],
      ["tarih biçimi", { kind: "off", date: "12.11.2026" }],
      ["çok eski tarih", { kind: "off", date: tomorrowIstanbul(-90) }],
      ["çok ileri tarih", { kind: "off", date: tomorrowIstanbul(500) }],
    ];
    for (const [label, b] of bad) {
      const r = await admin.post("/work-roster", { cells: [{ practitionerId: pracA, date: d, ...b }] });
      expect(r.status, label).toBe(422);
    }
    expect((await admin.post("/work-roster", { cells: [] })).status).toBe(422);
    expect((await admin.post("/work-roster", { cells: [{ practitionerId: pracA, date: d, kind: "off" }, { practitionerId: pracA, date: d, kind: "off" }] })).status).toBe(422);
    const passive = (await admin.post("/practitioners", { displayName: `Dt. Pasif ${tag}` }).expect(201)).body.id;
    await admin.patch(`/practitioners/${passive}`, { displayName: `Dt. Pasif ${tag}`, active: false }).expect(200);
    expect((await admin.post("/work-roster", { cells: [{ practitionerId: passive, date: d, kind: "off" }] })).status).toBe(422);
    const oldChair = (await admin.post("/chairs", { name: `Ünite P ${tag}` }).expect(201)).body.id;
    await admin.patch(`/chairs/${oldChair}`, { name: `Ünite P ${tag}`, active: false }).expect(200);
    expect((await admin.post("/work-roster", { cells: [{ practitionerId: pracA, date: d, kind: "work", start: "09:00", end: "12:00", chairId: oldChair }] })).status).toBe(422);
    expect((await ownerQuery(tenantA, "select count(*)::int as n from work_rosters where practitioner_id = $1 and work_date = $2", [pracA, d]))[0].n).toBe(0);
  });

  it("aynı ünite aynı gün çakışan saatte iki hekime verilemez (409); ardışık saatler olur; toplu yazım tek transaction", async () => {
    const d = weekday(19);
    await admin.post("/work-roster", { cells: [{ practitionerId: pracA, date: d, kind: "work", start: "09:00", end: "13:00", chairId: chairX }] }).expect(200);
    const clash = await admin.post("/work-roster", { cells: [{ practitionerId: pracB, date: d, kind: "work", start: "12:00", end: "16:00", chairId: chairX }] });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("CHAIR_ROSTER_CONFLICT");
    expect((await admin.post("/work-roster", { cells: [{ practitionerId: pracB, date: d, kind: "work", start: "13:00", end: "17:00", chairId: chairX }] })).status).toBe(200);
    // toplu: biri çakışırsa hiçbiri yazılmaz
    const d2 = weekday(20), d3 = weekday(21);
    await admin.post("/work-roster", { cells: [{ practitionerId: pracA, date: d3, kind: "work", start: "09:00", end: "13:00", chairId: chairX }] }).expect(200);
    const bulk = await admin.post("/work-roster", { cells: [
      { practitionerId: pracB, date: d2, kind: "work", start: "09:00", end: "13:00", chairId: chairX },
      { practitionerId: pracB, date: d3, kind: "work", start: "10:00", end: "12:00", chairId: chairX }] });
    expect(bulk.status).toBe(409);
    expect((await ownerQuery(tenantA, "select count(*)::int as n from work_rosters where practitioner_id = $1 and work_date = $2", [pracB, d2]))[0].n).toBe(0);
  });
});

describe("veritabanı", () => {
  it("FORCE RLS; B kiracısı satırları görmez; dışa aktarımda", async () => {
    const r = await ownerQuery(null, "select relrowsecurity and relforcerowsecurity as f from pg_class where relname = 'work_rosters'");
    expect(r[0].f).toBe(true);
    const bT = bAdmin.session.activeMembership.tenantId;
    expect((await ownerQuery(bT, "select count(*)::int as n from work_rosters where tenant_id = $1", [tenantA]))[0].n).toBe(0);
    expect((await bAdmin.post("/work-roster", { cells: [{ practitionerId: pracA, date: weekday(30), kind: "off" }] })).status).toBe(422);
  });
});
