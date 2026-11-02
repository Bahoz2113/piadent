/**
 * Açık format dışa aktarım (Plan §09, Ek C): belgelenmiş JSON (UTF-8), tablo başına satırlar + sayım + SHA-256.
 * Kilitlenme yok: klinik verisini başka bir sisteme taşıyabilir. Sırlar (parola özeti, oturum, webhook sırrı, MFA sırrı,
 * davet belirteci, idempotency yanıtı) asla dışa aktarılmaz. Dosya içerikleri dahil değildir (metaveri + SHA-256; içerik yedekte).
 * Her dışa aktarım gerekçeyle denetim kaydına yazılır (veri değil, sayımlar).
 */
import { createHash } from "node:crypto";
import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import type pg from "pg";
import { ClinicExport } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { CLINICAL_ENTITY_TYPES, audit, nonClinicalFileSql, notClinicalOutputDocIdSql, notClinicalOutputDocSql, notHiddenFileEventSql, notHiddenTaskEventSql, visibleFileIdSql } from "../audit/audit.js";
import { decryptField } from "@viadent/db";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
export const EXPORT_FORMAT = { format: "viadent-export", version: 1 } as const;

/** Klinik dışa aktarımına giren tablolar (sıra: bağımlılık sırasına yakın). Hariç sütunlar sırdır veya iç durumdur. */
const CLINIC_TABLES: [string, string[]][] = [
  ["branches", []], ["practitioners", []], ["chairs", []], ["appointment_types", []], ["work_schedules", []], ["closures", []],
  ["memberships", []], ["patients", ["search_text", "phone_digits"]], ["patient_relations", []], ["anamnesis_versions", []], ["anamnesis_reviews", []],
  ["appointments", []], ["clinical_notes", []], ["procedures", []], ["tariff_versions", []], ["tariff_items", []], ["odontogram_findings", []], ["diagnoses", []],
  ["treatment_plans", []], ["plan_versions", []], ["plan_items", []], ["plan_decisions", []], ["performed_procedures", []],
  ["cash_accounts", []], ["receivables", []], ["payments", []], ["allocations", []], ["refunds", []], ["expenses", []], ["cash_movements", []],
  ["commission_rule_versions", []], ["commission_accruals", []], ["commission_payouts", []],
  ["document_types", []], ["templates", []], ["template_versions", []], ["patient_documents", []], ["consent_requests", []], ["evidence_events", []],
  ["file_assets", ["object_key"]], ["communication_preferences", []], ["messages", []], ["delivery_events", []], ["follow_ups", []],
  ["readiness_rules", []], ["readiness_exceptions", []], ["tasks", []],
  ["integration_connections", ["webhook_secret_enc", "config"]], ["integration_jobs", []], ["online_payment_requests", []],
  ["suppliers", []], ["supplier_entries", []], ["lab_orders", []], ["lab_events", []], ["lab_costs", []],
  ["stock_items", []], ["stock_lots", []], ["stock_movements", []], ["import_batches", []], ["audit_events", []],
];
/** Sağlık içeriği taşıyan tablolar (hasta dışa aktarımında ayrıca sağlık yetkisi ister). */
const HEALTH = new Set(["anamnesis_versions", "anamnesis_reviews", "clinical_notes", "odontogram_findings", "diagnoses"]);
/** QA-104: bölüm kalır ama klinik çıktı belgesi (ADR-085) satırları sağlık yetkisi yoksa çıkarılır; `omitted` içinde böyle işaretlenir. */
const CLINICAL_OUTPUT_OMITTED = ["patient_documents:clinical_output", "consent_requests:clinical_output", "evidence_events:clinical_output", "files:clinical_output"] as const;
/** QA-106 (ADR-089): klinik hassasiyetli dosyalar (`sensitivity = 'clinical'`: radyograf, klinik fotoğraf, klinik belge) dosya listesiyle aynı kuralla çıkarılır. */
const CLINICAL_FILES_OMITTED = "files:clinical";

function strip(rows: Record<string, unknown>[], drop: string[]) {
  if (!drop.length) return rows;
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))));
}
/** Şifreli kimlik no'yu dışa aktarımda açık değere çevirir (veri taşınabilirliği; işlem gerekçeli ve denetimlidir), şifreli/özet sütunları düşer. */
function revealNationalId(rows: Record<string, unknown>[]) {
  return rows.map((r) => {
    const { national_id_enc, national_id_hmac, ...rest } = r;
    return { ...rest, national_id: national_id_enc ? decryptField(String(national_id_enc)) : (r.national_id ?? null) };
  });
}
/** QA-108: `visible_file_id` (SQL'de hesaplanan görünür değer) `file_id` yerine yazılır; yardımcı sütun düşer, sütun sırası korunur. */
function maskFileId(rows: Record<string, unknown>[]) {
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "visible_file_id")
    .map(([k, v]) => (k === "file_id" ? [k, r.visible_file_id ?? null] : [k, v]))));
}
const sha = (rows: unknown) => createHash("sha256").update(JSON.stringify(rows), "utf8").digest("hex");

@Controller()
export class ExportController {
  constructor(@Inject(Db) private readonly db: Db) {}

  /**
   * Klinik geneli dışa aktarım bilinçli olarak tamdır (ADR-088): veri sorumlusunun sistem değiştirme/taşınabilirlik aracıdır ve
   * anamnez, klinik not ve tanı tablolarını içerdiği gibi klinik çıktı belgelerini de içerir. Hasta dışa aktarımındaki sağlık süzgeci
   * burada uygulanmaz; yetki yalnız `export.clinic` (yönetici), gerekçe zorunlu ve her çağrı denetim kaydında.
   */
  @Post("exports/clinic")
  @HttpCode(200)
  @Require("export.clinic")
  async clinic(@Ctx() ctx: RequestContext, @Body() body: unknown, @Res() res: Response) {
    const i = parse(ClinicExport, body);
    const doc = await this.db.tx(ctx, async (c) => {
      const tables: Record<string, unknown[]> = {};
      const counts: Record<string, number> = {};
      const checksums: Record<string, string> = {};
      for (const [t, drop] of CLINIC_TABLES) {
        let rows = strip((await c.query(`select * from ${t} order by 1`)).rows, drop);
        if (t === "patients") rows = revealNationalId(rows);
        tables[t] = rows; counts[t] = rows.length; checksums[t] = sha(rows);
      }
      const users = (await c.query("select u.id, u.full_name, u.email from users u join memberships m on m.user_id = u.id")).rows;
      tables.users = users; counts.users = users.length; checksums.users = sha(users);
      const tenant = (await c.query("select id, slug, name, timezone, currency from tenants where id = $1", [ctx.tenantId])).rows[0];
      await audit(c, ctx, { action: "export.clinic", entityType: "tenant", entityId: ctx.tenantId,
        changes: { reason: { from: null, to: i.reason }, tables: { from: null, to: Object.keys(counts).length }, rows: { from: null, to: Object.values(counts).reduce((a, b) => a + b, 0) } } });
      return { ...EXPORT_FORMAT, exportedAt: new Date().toISOString(), exportedBy: ctx.userName, reason: i.reason, tenant,
        notes: ["Tarih-saatler UTC ISO 8601; para tutarları metin (2 ondalık, TRY).", "Dosya içerikleri dahil değildir: file_assets.sha256 ile yedekteki içerik eşlenir.",
          "Sırlar (parola, oturum, MFA, webhook sırrı, davet belirteci) dışa aktarılmaz."],
        counts, checksums, tables };
    });
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="viadent-klinik-disa-aktarim-${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify(doc));
  }

  /** Hasta verisi (KVKK veri sahibi talebi). Sağlık bölümleri yalnız sağlık yetkisiyle; yoksa “atlandı” olarak listelenir. */
  @Post("patients/:patientId/export")
  @HttpCode(200)
  @Require("export.patient")
  async patient(@Ctx() ctx: RequestContext, @Param("patientId", id) pid: string, @Body() body: unknown, @Res() res: Response) {
    const i = parse(ClinicExport, body);
    const health = ctx.permissions.has("patient.health.read");
    const doc = await this.db.tx(ctx, async (c: pg.PoolClient) => {
      const p = (await c.query("select * from patients where id = $1", [pid])).rows[0];
      if (!p) throw Errors.notFound("Hasta");
      const q = async (sql: string) => (await c.query(sql, [pid])).rows;
      const qd = async (sql: string) => (await c.query(sql, [pid, health])).rows;
      const sections: Record<string, unknown[]> = {
        patient: revealNationalId(strip([p], ["search_text", "phone_digits", "tenant_id"])),
        relations: await q("select * from patient_relations where patient_id = $1 or related_patient_id = $1"),
        appointments: await q("select * from appointments where patient_id = $1 order by starts_at"),
        anamnesis_versions: await q("select * from anamnesis_versions where patient_id = $1 order by version"),
        clinical_notes: await q("select * from clinical_notes where patient_id = $1 order by created_at"),
        odontogram_findings: await q("select * from odontogram_findings where patient_id = $1"),
        diagnoses: await q("select * from diagnoses where patient_id = $1"),
        treatment_plans: await q("select * from treatment_plans where patient_id = $1"),
        plan_versions: await q("select pv.* from plan_versions pv join treatment_plans tp on tp.id = pv.plan_id where tp.patient_id = $1"),
        plan_items: await q("select pi.* from plan_items pi join plan_versions pv on pv.id = pi.plan_version_id join treatment_plans tp on tp.id = pv.plan_id where tp.patient_id = $1"),
        plan_decisions: await q("select d.* from plan_decisions d join plan_versions pv on pv.id = d.plan_version_id join treatment_plans tp on tp.id = pv.plan_id where tp.patient_id = $1"),
        performed_procedures: await q("select * from performed_procedures where patient_id = $1 order by completed_at"),
        receivables: await q("select * from receivables where patient_id = $1 order by created_at"),
        payments: await q("select * from payments where patient_id = $1 order by paid_at"),
        allocations: await q("select a.* from allocations a join payments x on x.id = a.payment_id where x.patient_id = $1"),
        refunds: await q("select f.* from refunds f join payments x on x.id = f.payment_id where x.patient_id = $1"),
        // QA-104: klinik çıktı belgeleri (ADR-085) ve onlara bağlı onay/kanıt/dosya satırları sağlık verisidir; yetki yoksa dahil edilmez.
        patient_documents: await qd(`select * from patient_documents d where d.patient_id = $1 and ($2::boolean or ${notClinicalOutputDocIdSql("d.id")}) order by d.issued_at`),
        consent_requests: await qd(`select r.* from consent_requests r join patient_documents d on d.id = r.patient_document_id where d.patient_id = $1 and ($2::boolean or ${notClinicalOutputDocIdSql("d.id")})`),
        // QA-108 (ADR-090): kanıt satırı kalır; görünmeyen dosyanın (ADR-089) kimliği `file_id` sağlık yetkisi yoksa null (sütun sırası korunur).
        evidence_events: maskFileId(await qd(`select e.*, ${visibleFileIdSql("e.file_id", "$2::boolean")} as visible_file_id from evidence_events e join patient_documents d on d.id = e.patient_document_id where d.patient_id = $1 and ($2::boolean or ${notClinicalOutputDocIdSql("d.id")})`)),
        // QA-106/107: dosya listesiyle aynı görünürlük (ADR-089): idari hassasiyetli ve klinik çıktıya bağlı olmayan dosyalar.
        files: strip(await qd(`select * from file_assets f where f.patient_id = $1 and ($2::boolean or ${nonClinicalFileSql("f")})`), ["object_key"]),
        communication_preferences: await q("select * from communication_preferences where patient_id = $1 order by recorded_at"),
        messages: await q("select * from messages where patient_id = $1 order by created_at"),
        follow_ups: await q("select * from follow_ups where patient_id = $1"),
        lab_orders: await q("select * from lab_orders where patient_id = $1"),
        lab_events: await q("select e.* from lab_events e join lab_orders o on o.id = e.lab_order_id where o.patient_id = $1 order by e.seq"),
        stock_usage: await q("select m.id, m.occurred_at, i.code, i.name, l.lot_no, l.expiry_date, m.quantity from stock_movements m join stock_items i on i.id = m.item_id left join stock_lots l on l.id = m.lot_id where m.patient_id = $1"),
        online_payment_requests: await q("select * from online_payment_requests where patient_id = $1"),
        // Sağlık yetkisi yoksa klinik olaylar (anamnez/klinik not/bulgu-tanı; klinik çıktı belgesi — QA-102; gizli dosya — QA-108)
        // erişim günlüğünde de yer almaz (QA-001).
        access_log: (await c.query(
          `select id, created_at, action, entity_type, actor_user_id from audit_events
            where patient_id = $1 and ($2::boolean or (entity_type <> all($3::text[]) and ${notClinicalOutputDocSql("audit_events")} and ${notHiddenFileEventSql("audit_events")} and ${notHiddenTaskEventSql("audit_events")})) order by id`,
          [pid, health, CLINICAL_ENTITY_TYPES])).rows,
      };
      const omitted: string[] = [];
      if (!health) for (const k of Object.keys(sections)) if (HEALTH.has(k)) { delete sections[k]; omitted.push(k); }
      // Satır düzeyinde dışlanan klinik çıktılar: dışlanan satır sayısı yazılmaz (varlık ipucu olmasın), işaret her zaman aynıdır.
      if (!health) omitted.push(...CLINICAL_OUTPUT_OMITTED, CLINICAL_FILES_OMITTED);
      const counts = Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.length]));
      await audit(c, ctx, { action: "patient.export", entityType: "patient", entityId: pid, patientId: pid,
        changes: { reason: { from: null, to: i.reason }, sections: { from: null, to: Object.keys(sections).length }, omitted: { from: null, to: omitted } } });
      return { ...EXPORT_FORMAT, kind: "patient", exportedAt: new Date().toISOString(), exportedBy: ctx.userName, reason: i.reason,
        notes: ["KVKK veri sahibi talebi için hazırlanmıştır; kimlik doğrulama ve kapsam incelemesi klinik sorumluluğundadır.",
          ...(omitted.length ? ["Sağlık bölümleri dışa aktaranın sağlık verisi yetkisi olmadığı için dahil edilmedi; hekimle birlikte tamamlayın."] : []),
          ...(!health ? ["Klinik çıktı belgeleri (epikriz, hasta bilgi föyü, reçete yazısı) ve bunlara bağlı onay, kanıt ve dosya kayıtları sağlık verisidir; dışa aktaranın sağlık verisi yetkisi olmadığı için dahil edilmedi (omitted: *:clinical_output).",
            "Klinik hassasiyetli dosyalar (radyograf, klinik fotoğraf, klinik belge) sağlık verisidir; ad, kategori ve SHA-256 dahil metaverileri dışa aktaranın sağlık verisi yetkisi olmadığı için dahil edilmedi (omitted: files:clinical).",
            "Aynı gerekçeyle bu dosyaların erişim günlüğündeki (access_log) olayları dahil edilmedi ve kanıt olaylarındaki dosya kimliği (evidence_events.file_id) boş bırakıldı; kanıt satırları kalır."] : [])],
        omitted, counts, checksums: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, sha(v)])), sections };
    });
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="viadent-hasta-${String(pid).slice(0, 8)}.json"`);
    res.send(JSON.stringify(doc));
  }
}
