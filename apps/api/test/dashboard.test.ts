/**
 * Panel özeti (ADR-095): GET /dashboard rol bazlıdır. Sekreter randevu sayaçlarını ve grafikleri görür; para alanları (money)
 * yalnız finance.read ile döner; tedavi dağılımı treatment.read ile ve yalnız kategori adedidir (hasta/diş içeriği yok). Diziler sabit uzunluktadır (30 gün, 12 ay) ve
 * bugünkü sayaçlar randevu listesiyle tutarlıdır. Kiracı yalıtımı: B kiracısının sayaçları A'nın randevusundan etkilenmez.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, login, startApp, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, sec: Client, dentist: Client, bAdmin: Client;

beforeAll(async () => {
  app = await startApp();
  [admin, sec, dentist, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aSecretary), login(app, EMAILS.aDentist), login(app, EMAILS.bAdmin)]);
});
afterAll(async () => { await app.close(); });

describe("GET /dashboard", () => {
  it("yönetici: para + tedavi dağılımı; sabit uzunluklu seriler; sayaçlar günün listesiyle tutarlı", async () => {
    const d = (await admin.get("/dashboard").expect(200)).body;
    expect(d.charts.appointmentDensity).toHaveLength(30);
    expect(d.charts.newPatients).toHaveLength(12);
    expect(d.charts.appointmentDensity[29].date).toBe(d.date);
    expect(d.money).not.toBeNull();
    expect(d.money.monthlyIncome).toHaveLength(12);
    expect(d.money.todayCollections).toMatch(/^-?\d+\.\d{2}$/);
    expect(d.money.openReceivables).toMatch(/^\d+\.\d{2}$/);
    expect(Array.isArray(d.charts.treatments)).toBe(true);
    const day = (await admin.get(`/appointments?date=${d.date}`).expect(200)).body.items as { status: string }[];
    expect(d.today.appointments).toBe(day.filter((a) => a.status !== "cancelled").length);
    expect(d.today.completed).toBe(day.filter((a) => a.status === "completed").length);
    expect(d.today.waiting).toBe(day.filter((a) => a.status === "checked_in").length);
    expect(d.today.activePractitioners).toBeGreaterThan(0);
    expect(d.charts.appointmentDensity[29].count).toBe(d.today.appointments);
  });

  it("sekreter: para alanları yok (null); tedavi dağılımı yalnız kategori adedi (treatment.read tüm klinik rollerinde)", async () => {
    const d = (await sec.get("/dashboard").expect(200)).body;
    expect(d.money).toBeNull();
    for (const t of d.charts.treatments) expect(Object.keys(t).sort()).toEqual(["category", "count"]);
    expect(d.today.appointments).toBeGreaterThanOrEqual(0);
  });

  it("hekim: tedavi dağılımı var, para yok", async () => {
    const d = (await dentist.get("/dashboard").expect(200)).body;
    expect(d.money).toBeNull();
    expect(Array.isArray(d.charts.treatments)).toBe(true);
  });

  it("B kiracısı kendi sayaçlarını görür (A'nın randevu sayısından bağımsız)", async () => {
    const a = (await admin.get("/dashboard").expect(200)).body;
    const b = (await bAdmin.get("/dashboard").expect(200)).body;
    const bDay = (await bAdmin.get(`/appointments?date=${b.date}`).expect(200)).body.items as { status: string }[];
    expect(b.today.appointments).toBe(bDay.filter((x) => x.status !== "cancelled").length);
    expect(a.today.activePractitioners === b.today.activePractitioners && a.today.appointments === b.today.appointments && a.charts.newPatients.every((m: { count: number }, i: number) => m.count === b.charts.newPatients[i].count)).toBe(false);
  });
});
