/**
 * Mesajlaşma (ADR-102, 07.11.2026): elle, zamanlanmış ("alarm") ve otomatik (randevu öncesi/sonrası) SMS'in ortak kuyruklama yolu.
 * Her mesaj: amaç + kanal için kayıtlı iletişim izni şart (yoksa gönderilmez, nedeni kaydedilir); alıcı numarası iş satırında saklanmaz,
 * gönderim anında hasta kaydından okunur ve izin yeniden kontrol edilir (bridge.ts). Sağlayıcı: Netgsm hazırsa Netgsm, değilse DENEME.
 */
import type pg from "pg";
import { maskPhone } from "@viadent/contracts";
import { withContext } from "./context.js";
import { NETGSM_REPORT_STATUS, NetgsmSmsAdapter, netgsmEnv, netgsmStatus } from "./netgsm.js";

type C = pg.PoolClient;
export type QueueOutcome = { ok: true; messageId: string; provider: "netgsm" | "mock" } | { ok: false; reason: "no_consent" | "no_recipient" | "no_provider"; message: string };

/** SMS bağlantısı: Netgsm gerçek gönderime hazır ve bağlantısı etkinse o; değilse etkin DENEME bağlantısı; yoksa null. */
export async function pickSmsConnection(c: C): Promise<{ id: string; provider: string; mode: string } | null> {
  const rows = (await c.query("select id, provider, mode from integration_connections where kind = 'sms' and status = 'active' order by created_at")).rows;
  const net = rows.find((r) => r.provider === "netgsm");
  if (net && netgsmStatus().ready) return net;
  return rows.find((r) => r.provider === "mock") ?? null;
}

export async function queueSms(c: C, tenantId: string, i: { patientId: string; purpose: string; body: string; createdBy: string; source: "manual" | "schedule" | "rule" }): Promise<QueueOutcome> {
  const pref = (await c.query("select status from communication_preferences where patient_id = $1 and purpose = $2 and channel = 'sms' order by recorded_at desc limit 1",
    [i.patientId, i.purpose])).rows[0];
  if (pref?.status !== "granted") return { ok: false, reason: "no_consent", message: "Hastanın bu amaç için SMS izni yok" };
  const to = (await c.query("select phone_e164 from patients where id = $1 and status = 'active'", [i.patientId])).rows[0]?.phone_e164 as string | undefined;
  if (!to) return { ok: false, reason: "no_recipient", message: "Hastanın telefonu yok" };
  const cn = await pickSmsConnection(c);
  if (!cn) return { ok: false, reason: "no_provider", message: "Etkin SMS sağlayıcı bağlantısı yok" };
  const provider = cn.provider === "netgsm" ? "netgsm" : "mock";
  const m = await c.query(
    `insert into messages(tenant_id, patient_id, purpose, channel, recipient_masked, body, provider, created_by, source)
     values ($1,$2,$3,'sms',$4,$5,$6,$7,$8) returning id`, [tenantId, i.patientId, i.purpose, maskPhone(to), i.body, provider, i.createdBy, i.source]);
  const mid = m.rows[0].id as string;
  await c.query("insert into delivery_events(tenant_id, message_id, status, source, detail) values ($1,$2,'queued','system',$3)",
    [tenantId, mid, provider === "netgsm" ? "Kuyruğa alındı (Netgsm)" : "Kuyruğa alındı (Deneme sağlayıcı — gerçek gönderim yok)"]);
  const j = await c.query(
    `insert into integration_jobs(tenant_id, connection_id, operation, source_type, source_id, idempotency_key, payload, approval_status, transport_status, requested_by)
     values ($1,$2,'sms.send','message',$3,$4,$5,'not_required','queued',$6) returning id`,
    [tenantId, cn.id, mid, `msg_${mid}`, JSON.stringify({ channel: "sms", body: i.body }), i.createdBy]);
  await c.query("update messages set integration_job_id = $2 where id = $1", [mid, j.rows[0].id]);
  return { ok: true, messageId: mid, provider };
}

/** Şablon: {hasta} {tarih} {saat} {hekim} {klinik}. Bilinmeyen yer tutucu olduğu gibi kalır. */
export function renderMessage(body: string, v: Record<string, string>): string {
  return body.replace(/\{(hasta|tarih|saat|hekim|klinik)\}/g, (all, k: string) => v[k] ?? all).slice(0, 640);
}
const fmt = (d: Date, tz: string) => {
  const p = new Intl.DateTimeFormat("tr-TR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { tarih: `${g("day")}.${g("month")}.${g("year")}`, saat: `${g("hour")}:${g("minute")}` };
};

/** Vadesi gelen zamanlanmış mesajlar. */
export async function processMessageSchedules(pool: pg.Pool, now = new Date()): Promise<number> {
  const tenants = await pool.query("select id from tenants where status = 'active'");
  let n = 0;
  for (const t of tenants.rows) {
    n += await withContext(pool, { tenantId: t.id, userId: null }, async (c) => {
      const due = (await c.query("select * from message_schedules where status = 'scheduled' and send_at <= $1 order by send_at limit 50 for update skip locked", [now])).rows;
      for (const s of due) {
        const r = await queueSms(c, t.id, { patientId: s.patient_id, purpose: s.purpose, body: s.body, createdBy: s.created_by, source: "schedule" });
        if (r.ok) await c.query("update message_schedules set status = 'queued', message_id = $2, status_reason = null where id = $1", [s.id, r.messageId]);
        else await c.query("update message_schedules set status = 'skipped', status_reason = $2 where id = $1", [s.id, r.message]);
      }
      return due.length;
    });
  }
  return n;
}

/** Otomatik mesaj kuralları: randevudan X saat önce (planlı/onaylı) ve tamamlanan randevudan X saat sonra. Kural × randevu bir kez. */
export async function processMessageRules(pool: pg.Pool, now = new Date()): Promise<number> {
  const tenants = await pool.query("select id, name, timezone from tenants where status = 'active'");
  let n = 0;
  for (const t of tenants.rows) {
    n += await withContext(pool, { tenantId: t.id, userId: null }, async (c) => {
      const rules = (await c.query("select * from message_rules where active")).rows;
      let k = 0;
      for (const rule of rules) {
        const appts = (await c.query(
          rule.kind === "before_appointment"
            ? `select a.id, a.patient_id, a.starts_at, p.first_name, pr.display_name from appointments a join patients p on p.id = a.patient_id join practitioners pr on pr.id = a.practitioner_id
                where a.status in ('planned','confirmed') and a.starts_at > $1 and a.starts_at <= $1::timestamptz + make_interval(hours => $2)
                  and a.created_at < a.starts_at - interval '30 minutes'
                  and not exists (select 1 from message_rule_runs r where r.rule_id = $3 and r.appointment_id = a.id) order by a.starts_at limit 100`
            : `select a.id, a.patient_id, a.starts_at, p.first_name, pr.display_name from appointments a join patients p on p.id = a.patient_id join practitioners pr on pr.id = a.practitioner_id
                where a.status = 'completed' and a.completed_at <= $1::timestamptz - make_interval(hours => $2) and a.completed_at > $1::timestamptz - make_interval(hours => $2 + 48)
                  and not exists (select 1 from message_rule_runs r where r.rule_id = $3 and r.appointment_id = a.id) order by a.completed_at limit 100`,
          [now, rule.hours, rule.id])).rows;
        for (const a of appts) {
          const body = renderMessage(rule.body, { hasta: a.first_name, hekim: a.display_name, klinik: t.name, ...fmt(new Date(a.starts_at), t.timezone) });
          const r = await queueSms(c, t.id, { patientId: a.patient_id, purpose: rule.kind === "before_appointment" ? "appointment_reminder" : "treatment_followup",
            body, createdBy: rule.created_by, source: "rule" });
          await c.query("insert into message_rule_runs(tenant_id, rule_id, appointment_id, outcome, message_id) values ($1,$2,$3,$4,$5) on conflict do nothing",
            [t.id, rule.id, a.id, r.ok ? "queued" : r.reason, r.ok ? r.messageId : null]);
          k++;
        }
      }
      return k;
    });
  }
  return n;
}

/** Netgsm teslim raporu: iletilen/başarısız sonucunu mesaja işler (yalnız Netgsm hazırsa). */
export async function pollNetgsmReports(pool: pg.Pool, now = new Date()): Promise<number> {
  const env = netgsmEnv();
  if (!env || !netgsmStatus().ready) return 0;
  const adapter = new NetgsmSmsAdapter(env);
  const tenants = await pool.query("select id from tenants where status = 'active'");
  let n = 0;
  for (const t of tenants.rows) {
    const rows = await withContext(pool, { tenantId: t.id, userId: null }, (c) => c.query(
      `select id, provider_message_id from messages where provider = 'netgsm' and status = 'submitted' and provider_message_id is not null
          and submitted_at < $1::timestamptz - interval '1 minute' and submitted_at > $1::timestamptz - interval '3 days' limit 50`, [now]));
    if (!rows.rowCount) continue;
    let jobs: { jobid: string; status: number; errorCode?: string }[] = [];
    try { jobs = await adapter.report(rows.rows.map((r) => r.provider_message_id)); } catch { continue; } // rapor alınamazsa sonraki turda
    await withContext(pool, { tenantId: t.id, userId: null }, async (c) => {
      for (const m of rows.rows) {
        const j = jobs.find((x) => x.jobid === m.provider_message_id);
        const s = j ? NETGSM_REPORT_STATUS[j.status] : undefined;
        if (!s || s.status === "submitted") continue;
        const st = s.status === "unknown" ? "unknown" : s.status;
        await c.query("update messages set status = $2, status_reason = $3, status_at = now() where id = $1 and status = 'submitted'", [m.id, st, st === "delivered" ? null : s.label]);
        await c.query("insert into delivery_events(tenant_id, message_id, status, source, detail) values ($1,$2,$3,'provider',$4)", [t.id, m.id, st, `Netgsm: ${s.label}`]);
        if (st === "delivered") await c.query("update integration_jobs set outcome_status = 'succeeded', updated_at = now() where source_type = 'message' and source_id = $1", [m.id]);
        else await c.query("update integration_jobs set outcome_status = 'failed', updated_at = now() where source_type = 'message' and source_id = $1", [m.id]);
        n++;
      }
    });
  }
  return n;
}
