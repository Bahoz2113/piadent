/**
 * ADR-102 (07.11.2026): Mesajlar sekmesi, Netgsm adaptörü, zamanlanmış ve otomatik mesajlar.
 * Netgsm'e GERÇEK istek atılmaz: adaptör sahte fetch ile sınanır; ortamda kimlik bilgisi yokken sistem DENEME sağlayıcıda kalır.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { NetgsmSmsAdapter, netgsmNumber, netgsmStatus, processMessageRules, processMessageSchedules, renderMessage, ProviderError } from "@viadent/db";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, dentist: Client, sec: Client, fin: Client;
let tenantA: string;
const key = () => `t-${randomUUID()}`;
const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};
async function patient(name: string, consent: string[] = []) {
  const id = (await sec.post("/patients", { firstName: name, lastName: "Mesaj", phone: "0555 123 45 67", acknowledgeDuplicates: true }).expect(201)).body.patient.id as string;
  for (const purpose of consent) await sec.post(`/patients/${id}/communication-preferences`, { purpose, channel: "sms", status: "granted", source: "in_person" }).expect(201);
  return id;
}

beforeAll(async () => {
  app = await startApp();
  [admin, dentist, sec, fin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aFinance)]);
  tenantA = admin.session.activeMembership.tenantId;
});
afterAll(async () => app.close());

describe("Netgsm adaptörü (sahte fetch; gerçek istek yok)", () => {
  const env = { usercode: "8500000000", password: "test-parola", msgheader: "PIADENT" };
  it("gönderim: Basic yetki, TR kodlama, iysfilter 0, numara 90… biçimi; code 00 + jobid → kabul", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ code: "00", jobid: "17377215342605050417149344", description: "queued" }), { status: 200 }); }) as unknown as typeof fetch;
    const a = new NetgsmSmsAdapter(env, fake);
    const r = await a.submit("sms.send", { to: "+905551234567", body: "Sayın Ada, randevunuz yarın." });
    expect(r).toEqual({ outcome: "accepted", providerRef: "17377215342605050417149344" });
    expect(seen!.url).toBe("https://api.netgsm.com.tr/sms/rest/v2/send");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("8500000000:test-parola").toString("base64")}`);
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({ msgheader: "PIADENT", encoding: "TR", iysfilter: "0", messages: [{ msg: "Sayın Ada, randevunuz yarın.", no: "905551234567" }] });
    expect(netgsmNumber("+90 555 123 45 67")).toBe("905551234567");
  });
  it("ret kodları Türkçe; 5xx ve bağlantı hatası geçici; zaman aşımı belirsiz; durum sorgusu 'bilinmiyor' (kör tekrar yok)", async () => {
    const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await new NetgsmSmsAdapter(env, reply(200, { code: "30" })).submit("sms.send", { to: "+905551234567", body: "x y" }))
      .toMatchObject({ outcome: "rejected", code: "NETGSM_30", message: expect.stringContaining("Geçersiz kullanıcı") });
    expect(await new NetgsmSmsAdapter(env, reply(200, { code: "40" })).submit("sms.send", { to: "+905551234567", body: "x y" })).toMatchObject({ message: expect.stringContaining("Gönderen adı") });
    await expect(new NetgsmSmsAdapter(env, reply(503, {})).submit("sms.send", { to: "+905551234567", body: "x y" })).rejects.toMatchObject({ kind: "unavailable" });
    const hang = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("abort"), { name: "AbortError" }))))) as unknown as typeof fetch;
    await expect(new NetgsmSmsAdapter(env, hang, 20).submit("sms.send", { to: "+905551234567", body: "x y" })).rejects.toMatchObject({ kind: "timeout" });
    await expect(new NetgsmSmsAdapter(env, reply(200, {})).query()).rejects.toBeInstanceOf(ProviderError);
    expect(await new NetgsmSmsAdapter(env, reply(200, {})).submit("sms.send", { to: "", body: "x" })).toMatchObject({ outcome: "rejected", code: "INVALID_PAYLOAD" });
  });
  it("ortamda kimlik bilgisi/kapı yoksa hazır değil; eksikler Türkçe ve değer içermez", () => {
    const st = netgsmStatus({});
    expect(st.ready).toBe(false);
    expect(st.missing).toEqual(["kullanıcı kodu", "API parolası", "onaylı gönderen adı", "canlı gönderim kapısı (VIADENT_EXTERNAL_SEND_ENABLED)"]);
    expect(netgsmStatus({ NETGSM_USERCODE: "a", NETGSM_PASSWORD: "b", NETGSM_MSGHEADER: "C", VIADENT_EXTERNAL_SEND_ENABLED: "true" })).toMatchObject({ ready: true, sender: "C", missing: [] });
    expect(renderMessage("Sayın {hasta}, {tarih} {saat} {hekim} · {klinik} {yok}", { hasta: "Ada", tarih: "08.11.2026", saat: "10:00", hekim: "Dt. X", klinik: "K" }))
      .toBe("Sayın Ada, 08.11.2026 10:00 Dt. X · K {yok}");
  });
});

describe("Mesajlar sekmesi API", () => {
  it("durum: Netgsm hazır değil → DENEME etiketi; hekim mesaj gönderebilir (yeni yetki); finans hariç roller değişmedi", async () => {
    const s = (await dentist.get("/messaging/status").expect(200)).body;
    expect(s.realSending).toBe(false);
    expect(s.label).toMatch(/DENEME|bağlantısı yok/);
    expect(s.netgsm.missing.length).toBeGreaterThan(0);
    expect(JSON.stringify(s)).not.toMatch(/"(password|usercode|NETGSM_PASSWORD)"/); // yalnız eksik alan adları, değer yok
  });

  it("toplu gönderim: izni olan kuyruğa, izni/telefonu olmayan nedeniyle atlanır; hasta listesi izinleri gösterir", async () => {
    const ok = await patient("Izinli", ["treatment_followup"]);
    const no = await patient("Izinsiz");
    const list = (await dentist.get(`/messaging/patients?q=Mesaj`).expect(200)).body.items as { id: string; consent: Record<string, boolean>; phone: string }[];
    expect(list.find((p) => p.id === ok)!.consent.treatment_followup).toBe(true);
    expect(list.find((p) => p.id === no)!.consent.treatment_followup).toBe(false);
    expect(list.find((p) => p.id === ok)!.phone).toMatch(/\*\*\*/);
    const r = (await dentist.post("/messaging/send", { patientIds: [ok, no], purpose: "treatment_followup", body: "Kontrol randevunuzu unutmayın." }).set("idempotency-key", key()).expect(201)).body;
    expect(r).toMatchObject({ queued: 1, skipped: 1 });
    expect(r.results.find((x: { patientId: string }) => x.patientId === no).reason).toMatch(/izni yok/);
    const msgs = await ownerQuery(tenantA, "select provider, source, status from messages where patient_id = $1", [ok]);
    expect(msgs).toEqual([{ provider: "mock", source: "manual", status: "queued" }]);
    await fin.post("/messaging/send", { patientIds: [ok], purpose: "treatment_followup", body: "x y" }).set("idempotency-key", key()).expect(201); // finans message.send (önceki yetki)
    const asst = await login(app, EMAILS.aAssistant);
    await asst.post("/messaging/send", { patientIds: [ok], purpose: "treatment_followup", body: "x y" }).set("idempotency-key", key()).expect(403);
  });

  it("zamanlanmış mesaj ('alarm'): geçmiş zaman 422; vadesi gelince kuyruğa; iptal edilen gönderilmez; izin yoksa 'gönderilmedi'", async () => {
    const ok = await patient("Alarm", ["appointment_reminder"]);
    const no = await patient("AlarmIzinsiz");
    await sec.post("/messaging/schedules", { patientIds: [ok], purpose: "appointment_reminder", body: "Hatırlatma", sendAt: new Date(Date.now() - 60_000).toISOString() }).set("idempotency-key", key()).expect(422);
    const at = new Date(Date.now() + 5 * 60_000).toISOString();
    const s = (await sec.post("/messaging/schedules", { patientIds: [ok, no], purpose: "appointment_reminder", body: "Yarınki randevunuzu hatırlatırız.", sendAt: at }).set("idempotency-key", key()).expect(201)).body;
    expect(s.created).toBe(2);
    const c = (await sec.post("/messaging/schedules", { patientIds: [ok], purpose: "appointment_reminder", body: "İptal edilecek", sendAt: at }).set("idempotency-key", key()).expect(201)).body.ids[0];
    await sec.post(`/messaging/schedules/${c}/cancel`, {}).expect(200);
    await sec.post(`/messaging/schedules/${c}/cancel`, {}).expect(409);
    const { WORKER_URL } = await import("./env.js");
    const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
    try { await processMessageSchedules(pool, new Date(Date.now() + 10 * 60_000)); } finally { await pool.end(); }
    const rows = await ownerQuery(tenantA, "select patient_id, status, status_reason, message_id from message_schedules where id = any($1::uuid[]) or id = $2", [s.ids, c]);
    expect(rows.find((x) => x.patient_id === ok && x.message_id)).toMatchObject({ status: "queued" });
    expect(rows.find((x) => x.patient_id === no)).toMatchObject({ status: "skipped", status_reason: expect.stringMatching(/izni yok/) });
    expect(rows.find((x) => x.status === "cancelled")).toBeTruthy();
    expect((await ownerQuery(tenantA, "select count(*)::int as n from messages where patient_id = $1 and source = 'schedule'", [ok]))[0].n).toBe(1);
  });

  it("otomatik kural: randevudan X saat önce bir kez; yalnız yönetici düzenler; şablon doldurulur", async () => {
    await sec.put("/messaging/rules/before_appointment", { hours: 24, body: "x y", active: true }).expect(403);
    await admin.put("/messaging/rules/before_appointment", { hours: 48, body: "Sayın {hasta}, {tarih} {saat} randevunuz var.", active: true }).expect(200);
    const pid = await patient("Kural", ["appointment_reminder"]);
    const prac = (await admin.post("/practitioners", { displayName: `Dt. Kural ${randomUUID().slice(0, 4)}` }).expect(201)).body.id; // çakışmasız kendi hekimi
    const a = (await sec.post("/appointments", { patientId: pid, practitionerId: prac, date: day(1), startTime: "22:40", durationMinutes: 15, allowOutsideHours: true }).expect(201)).body;
    const { WORKER_URL } = await import("./env.js");
    const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
    try { await processMessageRules(pool); await processMessageRules(pool); } finally { await pool.end(); }
    const runs = await ownerQuery(tenantA, "select outcome from message_rule_runs where appointment_id = $1", [a.id]);
    expect(runs).toEqual([{ outcome: "queued" }]);
    const m = await ownerQuery(tenantA, "select body, source, purpose from messages where patient_id = $1", [pid]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ source: "rule", purpose: "appointment_reminder" });
    expect(m[0]!.body).toMatch(/^Sayın Kural, \d{2}\.\d{2}\.\d{4} 22:40 randevunuz var\.$/);
    await admin.put("/messaging/rules/before_appointment", { hours: 48, body: "Sayın {hasta}, {tarih} {saat} randevunuz var.", active: false }).expect(200);
    const rules = (await sec.get("/messaging/rules").expect(200)).body;
    expect(rules.canEdit).toBe(false);
    expect(rules.items.map((r: { kind: string }) => r.kind)).toEqual(["before_appointment", "after_appointment"]);
  });

  it("gönderilen mesajlar listesi Türkçe etiketli; Netgsm bağlantısı kimlik bilgisi almadan eklenir, hazır değilse DENEME sürer", async () => {
    const h = (await sec.get("/messaging/messages?days=1").expect(200)).body.items as { provider: string; source: string; statusLabel: string }[];
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((x) => /Deneme|Netgsm/.test(x.provider) && /Elle|Zamanlanmış|Otomatik/.test(x.source))).toBe(true);
    const r = await admin.post("/integrations/connections/netgsm", { usercode: "yok-sayilir" });
    expect([201, 409]).toContain(r.status);
    const cfg = await ownerQuery(tenantA, "select config::text as c, mode from integration_connections where provider = 'netgsm'");
    expect(cfg[0]).toMatchObject({ mode: "live", c: "{}" });
    expect((await sec.get("/messaging/status").expect(200)).body.realSending).toBe(false);
    await sec.post("/integrations/connections/netgsm", {}).expect(403);
  });
});
