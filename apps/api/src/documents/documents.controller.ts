import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  DocumentDecision, DocumentIssue, questionLabel, DocumentRevoke, TemplateCreate, TemplateVersionCreate, localDate, normalizeDocumentText, renderTemplate,
  unknownTemplateFields, type TemplateField,
} from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import { has, type RequestContext } from "../infra/context.js";
import { audit, enqueue, nonClinicalFileSql } from "../audit/audit.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const CONSENT_DAYS = 30;
const trDate = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "—");

/**
 * Belge (VD-011, Akış D). Kavramlar ayrıdır: belge türü → şablon → şablon sürümü (onaylanınca donar) → hasta belgesi
 * (üretim anındaki metin + SHA-256) → onay isteği (durum) → kanıt olayları (yalnız ekleme, her biri belge hash'ini taşır).
 * Elektronik imza yoktur; kabul, personelin yüz yüze kaydettiği yöntemle (ıslak imza/sözlü) kayda geçer (ADR-033).
 */
@Controller()
export class DocumentsController {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ------------------------------------------------------------ katalog ve şablonlar
  @Get("document-types")
  @Require("document.read")
  types(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const t = await c.query(
        `select dt.id, dt.code, dt.name, dt.category, dt.requires_acceptance, dt.issuer_role, dt.review_status, dt.active,
                (select json_agg(json_build_object('templateId', tp.id, 'templateName', tp.name, 'versionId', tv.id, 'version', tv.version, 'isDemo', tv.is_demo) order by tp.name)
                   from templates tp join lateral (select id, version, is_demo from template_versions v where v.template_id = tp.id and v.status = 'approved'
                                                   order by v.version desc limit 1) tv on true
                  where tp.document_type_id = dt.id) as approved
           from document_types dt order by dt.category, dt.name`);
      return { items: t.rows.map((x) => ({ id: x.id, code: x.code, name: x.name, category: x.category, requiresAcceptance: x.requires_acceptance,
        issuerRole: x.issuer_role, reviewStatus: x.review_status, active: x.active, approvedTemplates: x.approved ?? [] })) };
    });
  }

  @Get("templates")
  @Require("template.manage")
  templates(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const t = await c.query(
        `select tp.id, tp.name, tp.language, dt.id as type_id, dt.name as type_name, dt.code as type_code,
                (select json_agg(json_build_object('id', v.id, 'version', v.version, 'status', v.status, 'bodyHash', v.body_hash, 'isDemo', v.is_demo,
                         'changeNote', v.change_note, 'createdAt', v.created_at, 'approvedAt', v.approved_at, 'body', v.body,
                         'documentCount', (select count(*) from patient_documents d where d.template_version_id = v.id)) order by v.version desc)
                   from template_versions v where v.template_id = tp.id) as versions
           from templates tp join document_types dt on dt.id = tp.document_type_id order by dt.name, tp.name`);
      return { items: t.rows.map((x) => ({ id: x.id, name: x.name, language: x.language, typeId: x.type_id, typeName: x.type_name, typeCode: x.type_code, versions: x.versions ?? [] })) };
    });
  }

  private checkBody(body: string) {
    const unknown = unknownTemplateFields(body);
    if (unknown.length) throw Errors.validation({ body: `Tanımsız alan: ${unknown.map((u) => `{{${u}}}`).join(", ")}` }, "Şablonda yalnız izin verilen alanlar kullanılabilir.");
    return normalizeDocumentText(body);
  }

  @Post("templates")
  @Require("template.manage")
  createTemplate(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(TemplateCreate, body);
    const text = this.checkBody(i.body);
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from document_types where id = $1 and active", [i.documentTypeId])).rowCount) throw Errors.validation({ documentTypeId: "Belge türü bulunamadı." });
      const t = await c.query("insert into templates(tenant_id, document_type_id, name, language, created_by) values ($1,$2,$3,$4,$5) returning id",
        [ctx.tenantId, i.documentTypeId, i.name, i.language, ctx.userId]);
      const v = await c.query(
        "insert into template_versions(tenant_id, template_id, version, body, body_hash, change_note, created_by) values ($1,$2,1,$3,$4,$5,$6) returning id",
        [ctx.tenantId, t.rows[0].id, text, hash(text), i.changeNote ?? null, ctx.userId]);
      await audit(c, ctx, { action: "template.create", entityType: "template", entityId: t.rows[0].id, changes: { name: { from: null, to: i.name } } });
      return { id: t.rows[0].id, versionId: v.rows[0].id };
    });
  }

  @Post("templates/:id/versions")
  @Require("template.manage")
  newVersion(@Ctx() ctx: RequestContext, @Param("id", id) tid: string, @Body() body: unknown) {
    const i = parse(TemplateVersionCreate, body);
    const text = this.checkBody(i.body);
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from templates where id = $1", [tid])).rowCount) throw Errors.notFound("Şablon");
      if ((await c.query("select 1 from template_versions where template_id = $1 and status = 'draft'", [tid])).rowCount) {
        throw new AppError(409, "DRAFT_EXISTS", "Bu şablonun açık bir taslak sürümü var; onu düzenleyin.");
      }
      const max = (await c.query("select max(version)::int as v from template_versions where template_id = $1", [tid])).rows[0].v ?? 0;
      const v = await c.query(
        "insert into template_versions(tenant_id, template_id, version, body, body_hash, change_note, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [ctx.tenantId, tid, max + 1, text, hash(text), i.changeNote ?? null, ctx.userId]);
      await audit(c, ctx, { action: "template_version.create", entityType: "template_version", entityId: v.rows[0].id, changes: { version: { from: null, to: max + 1 } } });
      return { id: v.rows[0].id, version: max + 1 };
    });
  }

  @Patch("template-versions/:id")
  @Require("template.manage")
  editDraft(@Ctx() ctx: RequestContext, @Param("id", id) vid: string, @Body() body: unknown) {
    const i = parse(TemplateVersionCreate, body);
    const text = this.checkBody(i.body);
    return this.db.tx(ctx, async (c) => {
      const v = (await c.query("select status from template_versions where id = $1", [vid])).rows[0];
      if (!v) throw Errors.notFound("Şablon sürümü");
      if (v.status !== "draft") throw new AppError(409, "TEMPLATE_VERSION_LOCKED", "Onaylanmış sürüm değiştirilemez; yeni sürüm oluşturun.");
      await c.query("update template_versions set body = $2, body_hash = $3, change_note = $4 where id = $1", [vid, text, hash(text), i.changeNote ?? null]);
      return { ok: true, bodyHash: hash(text) };
    });
  }

  @Post("template-versions/:id/approve")
  @HttpCode(200)
  @Require("template.manage")
  approve(@Ctx() ctx: RequestContext, @Param("id", id) vid: string) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query("update template_versions set status = 'approved', approved_at = now(), approved_by = $2 where id = $1 and status = 'draft' returning body_hash",
        [vid, ctx.userId]);
      if (!r.rowCount) {
        if (!(await c.query("select 1 from template_versions where id = $1", [vid])).rowCount) throw Errors.notFound("Şablon sürümü");
        throw new AppError(409, "TEMPLATE_VERSION_LOCKED", "Yalnız taslak sürüm onaylanabilir.");
      }
      await audit(c, ctx, { action: "template_version.approve", entityType: "template_version", entityId: vid, changes: { status: { from: "draft", to: "approved" }, body_hash: { from: null, to: r.rows[0].body_hash } } });
      return { ok: true };
    });
  }

  @Post("template-versions/:id/retire")
  @HttpCode(200)
  @Require("template.manage")
  retire(@Ctx() ctx: RequestContext, @Param("id", id) vid: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from template_versions where id = $1", [vid])).rowCount) throw Errors.notFound("Şablon sürümü");
      const r = await c.query("update template_versions set status = 'retired' where id = $1 and status = 'approved'", [vid]);
      if (!r.rowCount) throw new AppError(409, "TEMPLATE_VERSION_LOCKED", "Yalnız onaylanmış sürüm kullanımdan kaldırılabilir.");
      await audit(c, ctx, { action: "template_version.retire", entityType: "template_version", entityId: vid, changes: { status: { from: "approved", to: "retired" } } });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ üretim
  private async render(c: import("pg").PoolClient, ctx: RequestContext, versionId: string, patientId: string, planVersionId?: string, freeText?: string) {
    const v = (await c.query(
      `select tv.id, tv.status, tv.body, tv.version, tv.is_demo, tp.name as template_name, dt.id as type_id, dt.name as type_name, dt.active, dt.requires_acceptance, dt.issuer_role, dt.category
         from template_versions tv join templates tp on tp.id = tv.template_id join document_types dt on dt.id = tp.document_type_id where tv.id = $1`, [versionId])).rows[0];
    if (!v) throw Errors.validation({ templateVersionId: "Şablon sürümü bulunamadı." });
    if (v.status !== "approved" || !v.active) throw new AppError(409, "TEMPLATE_NOT_APPROVED", "Belge yalnız onaylı ve kullanımda olan şablon sürümünden üretilir.");
    if (v.issuer_role && v.issuer_role !== ctx.role) throw new AppError(403, "FORBIDDEN", "Bu belge türünü yalnız hekim hazırlayabilir.");
    const p = (await c.query(
      `select p.first_name || ' ' || p.last_name as name, p.file_no, p.birth_date, pr.display_name as prac
         from patients p left join practitioners pr on pr.id = p.primary_practitioner_id where p.id = $1`, [patientId])).rows[0];
    if (!p) throw Errors.notFound("Hasta");
    // Klinik çıktı (ADR-085): sağlık verisi alanları yalnız sağlık yetkili rol için doldurulur; şablon başka kategoride bu alanları kullanıyorsa boş kalır.
    const clinical = v.category === "clinical_output";
    if (clinical && !has(ctx, "patient.health.read")) throw new AppError(403, "FORBIDDEN", "Klinik çıktı belgesi sağlık verisi içerir; yalnız sağlık yetkili roller hazırlar.");
    const todayStr = localDate(new Date(), ctx.timezone);
    let age = "—";
    if (p.birth_date) { const b = String(p.birth_date).slice(0, 10); const [by, bm, bd] = b.split("-").map(Number); const [ty, tm, td] = todayStr.split("-").map(Number);
      age = String(ty! - by! - ((tm! < bm!) || (tm === bm && td! < bd!) ? 1 : 0)); }
    let diagnoses = "—"; let procedures = "—"; let critical = "—";
    if (clinical) {
      const dg = await c.query("select code, description, tooth from diagnoses where patient_id = $1 and status = 'active' order by created_at", [patientId]);
      diagnoses = dg.rows.map((x) => `- ${x.code ? `${x.code} ` : ""}${x.description}${x.tooth ? ` (diş ${x.tooth})` : ""}`).join("\n") || "—";
      const pp = await c.query(
        `select completed_at, procedure_code, procedure_name, tooth, surfaces from performed_procedures where patient_id = $1 and status = 'completed' order by completed_at`, [patientId]);
      procedures = pp.rows.map((x) => `- ${trDate(localDate(new Date(x.completed_at), ctx.timezone))} ${x.procedure_code} ${x.procedure_name}${x.tooth ? ` (diş ${x.tooth}${x.surfaces?.length ? ` ${x.surfaces.join("")}` : ""})` : ""}`).join("\n") || "—";
      const an = (await c.query(
        `select v.critical_flags, (select t.questions from anamnesis_templates t where t.id = v.template_id) as questions from anamnesis_versions v where v.patient_id = $1 order by v.version desc limit 1`, [patientId])).rows[0];
      if (an) { const qs = an.questions as { key: string; label: string }[] | null; critical = (an.critical_flags as string[]).map((f) => `- ${questionLabel(f, (qs ?? undefined) as never)}`).join("\n") || "Kritik işaret yok"; }
    }
    let items = "—";
    let prac: string | null = p.prac;
    if (planVersionId) {
      const pv = (await c.query(
        `select pv.id, pr.display_name from plan_versions pv join treatment_plans tp on tp.id = pv.plan_id join practitioners pr on pr.id = pv.practitioner_id
          where pv.id = $1 and tp.patient_id = $2`, [planVersionId, patientId])).rows[0];
      if (!pv) throw Errors.validation({ planVersionId: "Plan sürümü bu hastaya ait değil." });
      prac = pv.display_name;
      const it = await c.query(
        `select procedure_code, procedure_name, location_kind, tooth, surfaces, quadrant, arch, quantity from plan_items where plan_version_id = $1 order by session_no, sort, created_at`, [planVersionId]);
      items = it.rows.map((x) => `- ${x.procedure_code} ${x.procedure_name}${x.tooth ? ` (diş ${x.tooth}${x.surfaces?.length ? ` ${x.surfaces.join("")}` : ""})` : x.quadrant ? ` (${x.quadrant}. çeyrek)` : x.arch ? ` (${x.arch === "upper" ? "üst" : "alt"} çene)` : ""} × ${x.quantity}`).join("\n") || "—";
    }
    const values: Partial<Record<TemplateField, string>> = {
      "hasta.ad_soyad": p.name, "hasta.dosya_no": String(p.file_no), "hasta.dogum_tarihi": trDate(p.birth_date), "klinik.ad": ctx.tenantName,
      "hekim.ad": prac ?? "—", "belge.tarih": trDate(todayStr), "plan.kalemler": items,
      "hasta.yas": age, "tani.liste": diagnoses, "islem.liste": procedures, "anamnez.kritik": critical, "serbest.metin": freeText?.trim() || "—",
    };
    const content = renderTemplate(v.body, values);
    return { v, content, contentHash: hash(content), title: `${v.type_name}${v.is_demo ? " (DEMO şablon)" : ""}` };
  }

  @Post("template-versions/:id/preview")
  @HttpCode(200)
  @Require("document.issue")
  preview(@Ctx() ctx: RequestContext, @Param("id", id) vid: string, @Body() body: unknown) {
    const i = parse(DocumentIssue.omit({ templateVersionId: true }), body);
    return this.db.tx(ctx, async (c) => {
      const r = await this.render(c, ctx, vid, i.patientId, i.planVersionId, i.freeText);
      return { title: r.title, content: r.content, contentHash: r.contentHash, templateVersion: r.v.version, isDemo: r.v.is_demo, requiresAcceptance: r.v.requires_acceptance };
    });
  }

  @Post("documents")
  @Require("document.issue")
  issue(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(DocumentIssue, body);
    return this.db.tx(ctx, async (c) => {
      const r = await this.render(c, ctx, i.templateVersionId, i.patientId, i.planVersionId, i.freeText);
      if (i.appointmentId && !(await c.query("select 1 from appointments where id = $1 and patient_id = $2", [i.appointmentId, i.patientId])).rowCount) {
        throw Errors.validation({ appointmentId: "Randevu bu hastaya ait değil." });
      }
      const d = await c.query(
        `insert into patient_documents(tenant_id, patient_id, document_type_id, template_version_id, appointment_id, plan_version_id, title, content, content_hash, issued_by, free_text)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, issued_at`,
        [ctx.tenantId, i.patientId, r.v.type_id, i.templateVersionId, i.appointmentId ?? null, i.planVersionId ?? null, r.title, r.content, r.contentHash, ctx.userId, i.freeText?.trim() || null]);
      const docId = d.rows[0].id as string;
      if (r.v.requires_acceptance) {
        await c.query("insert into consent_requests(tenant_id, patient_document_id, expires_at) values ($1,$2, now() + make_interval(days => $3))", [ctx.tenantId, docId, CONSENT_DAYS]);
      }
      await this.evidence(c, ctx, docId, r.contentHash, "issued", { note: `Şablon sürümü ${r.v.version}` });
      await audit(c, ctx, { action: "document.issue", entityType: "patient_document", entityId: docId, patientId: i.patientId,
        changes: { template_version_id: { from: null, to: i.templateVersionId }, content_hash: { from: null, to: r.contentHash } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "document.issue" });
      return { id: docId, contentHash: r.contentHash, requiresAcceptance: r.v.requires_acceptance };
    });
  }

  private async evidence(c: import("pg").PoolClient, ctx: RequestContext, docId: string, docHash: string, kind: string,
    o: { method?: string; fileId?: string; note?: string } = {}) {
    await c.query(
      `insert into evidence_events(tenant_id, patient_document_id, kind, method, document_hash, file_id, note, actor_user_id, actor_membership_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ctx.tenantId, docId, kind, o.method ?? null, docHash, o.fileId ?? null, o.note ?? null, ctx.userId, ctx.membershipId]);
  }

  @Get("patients/:patientId/documents")
  @Require("document.read")
  list(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const r = await c.query(
        `select d.id, d.title, d.status, d.content_hash, d.issued_at, d.revoke_reason, u.full_name as issued_by, dt.name as type_name, dt.category,
                dt.requires_acceptance, tv.version as template_version, tv.is_demo, cr.status as request_status, cr.expires_at, cr.decided_at
           from patient_documents d join document_types dt on dt.id = d.document_type_id join template_versions tv on tv.id = d.template_version_id
           join users u on u.id = d.issued_by left join consent_requests cr on cr.patient_document_id = d.id
          where d.patient_id = $1 and ($2 or dt.category <> 'clinical_output') order by d.issued_at desc`, [patientId, has(ctx, "patient.health.read")]);
      return { items: r.rows.map((x) => ({ id: x.id, title: x.title, typeName: x.type_name, category: x.category, status: x.status, requestStatus: x.request_status,
        requiresAcceptance: x.requires_acceptance, contentHash: x.content_hash, issuedAt: x.issued_at, issuedBy: x.issued_by, templateVersion: x.template_version,
        isDemo: x.is_demo, expiresAt: x.expires_at, decidedAt: x.decided_at, revokeReason: x.revoke_reason })) };
    });
  }

  @Get("documents/:id")
  @Require("document.read")
  detail(@Ctx() ctx: RequestContext, @Param("id", id) docId: string) {
    return this.db.tx(ctx, async (c) => {
      const d = (await c.query(
        `select d.*, dt.name as type_name, dt.category, dt.requires_acceptance, tv.version as template_version, tv.body_hash as template_hash, tv.is_demo, tv.status as template_status,
                cr.status as request_status, cr.expires_at, cr.decided_at
           from patient_documents d join document_types dt on dt.id = d.document_type_id join template_versions tv on tv.id = d.template_version_id
           left join consent_requests cr on cr.patient_document_id = d.id where d.id = $1`, [docId])).rows[0];
      if (!d) throw Errors.notFound("Belge");
      if (d.category === "clinical_output" && !has(ctx, "patient.health.read")) throw Errors.notFound("Belge"); // sağlık verisi: varlığı bile görünmez
      const ev = await c.query(
        `select e.kind, e.method, e.document_hash, e.file_id, e.note, e.at, u.full_name as actor
           from evidence_events e left join users u on u.id = e.actor_user_id where e.patient_document_id = $1 order by e.at, e.id`, [docId]);
      return {
        id: d.id, patientId: d.patient_id, title: d.title, typeName: d.type_name, content: d.content, contentHash: d.content_hash,
        integrityOk: hash(d.content) === d.content_hash, status: d.status, requestStatus: d.request_status, requiresAcceptance: d.requires_acceptance,
        templateVersion: d.template_version, templateHash: d.template_hash, templateStatus: d.template_status, isDemo: d.is_demo,
        issuedAt: d.issued_at, expiresAt: d.expires_at, decidedAt: d.decided_at, revokeReason: d.revoke_reason,
        evidence: ev.rows.map((e) => ({ kind: e.kind, method: e.method, documentHash: e.document_hash, fileId: e.file_id, note: e.note, at: e.at, actor: e.actor })),
      };
    });
  }

  /**
   * QA-101: belge üzerinde işlem yapan her uç önce bu kapıdan geçer. Klinik çıktı (ADR-085) sağlık verisidir;
   * `patient.health.read` yoksa var olmayan belgeyle aynı 404 döner — durum değişmez, kanıt yazılmaz, varlık sızmaz.
   */
  private async assertDocVisible(c: import("pg").PoolClient, ctx: RequestContext, docId: string) {
    const d = (await c.query("select dt.category from patient_documents d join document_types dt on dt.id = d.document_type_id where d.id = $1", [docId])).rows[0];
    if (!d || (d.category === "clinical_output" && !has(ctx, "patient.health.read"))) throw Errors.notFound("Belge");
  }

  @Post("documents/:id/print")
  @HttpCode(200)
  @Require("document.read")
  printed(@Ctx() ctx: RequestContext, @Param("id", id) docId: string) {
    return this.db.tx(ctx, async (c) => {
      await this.assertDocVisible(c, ctx, docId);
      const d = (await c.query("select content_hash, status from patient_documents where id = $1", [docId])).rows[0];
      if (!d) throw Errors.notFound("Belge");
      if (d.status !== "issued") throw new AppError(409, "DOCUMENT_REVOKED", "İptal edilmiş belge yazdırılamaz.");
      await this.evidence(c, ctx, docId, d.content_hash, "printed");
      return { ok: true };
    });
  }

  /** Yüz yüze kabul/ret kaydı. "Kabul" bir yöntemle ve personelin beyanıyla kaydedilir; e-imza değildir (ADR-033). */
  @Post("documents/:id/decision")
  @HttpCode(200)
  @Require("document.decision")
  decide(@Ctx() ctx: RequestContext, @Param("id", id) docId: string, @Body() body: unknown) {
    const i = parse(DocumentDecision, body);
    return this.db.tx(ctx, async (c) => {
      await this.assertDocVisible(c, ctx, docId);
      const d = (await c.query(
        `select d.id, d.patient_id, d.content, d.content_hash, d.status, cr.id as req_id, cr.status as req_status
           from patient_documents d left join consent_requests cr on cr.patient_document_id = d.id where d.id = $1 for update of d`, [docId])).rows[0];
      if (!d) throw Errors.notFound("Belge");
      if (!d.req_id) throw new AppError(409, "NO_DECISION_REQUIRED", "Bu belge türü kabul/ret kararı gerektirmez (bilgilendirme).");
      if (d.status !== "issued" || !["issued", "delivered", "viewed"].includes(d.req_status)) {
        throw new AppError(409, "DECISION_CLOSED", `Bu belge için karar kaydedilemez (durum: ${d.req_status}).`);
      }
      if (hash(d.content) !== d.content_hash) throw new AppError(409, "INTEGRITY_FAILED", "Belge metni hash ile uyuşmuyor; karar kaydedilemez. Destekle paylaşın.");
      let fileId: string | undefined;
      if (i.decision === "accepted" && i.fileId) {
        // QA-107 (ADR-089): sağlık yetkisi olmayan rol için görünmeyen dosya var olmayanla aynı doğrulama hatasını verir.
        const f = (await c.query(`select status, patient_id, category from file_assets f where f.id = $1 and ($2::boolean or ${nonClinicalFileSql("f")})`,
          [i.fileId, has(ctx, "patient.health.read")])).rows[0];
        if (!f || f.patient_id !== d.patient_id || f.status !== "available") throw Errors.validation({ fileId: "Taranmış nüsha bu hastanın kullanılabilir dosyası olmalı." });
        fileId = i.fileId;
      }
      await c.query("update consent_requests set status = $2, decided_at = now(), decided_by = $3 where id = $1", [d.req_id, i.decision, ctx.userId]);
      await this.evidence(c, ctx, docId, d.content_hash, i.decision, { method: i.decision === "accepted" ? i.method : undefined, note: i.note });
      if (fileId) await this.evidence(c, ctx, docId, d.content_hash, "scan_attached", { fileId });
      await audit(c, ctx, { action: `document.${i.decision}`, entityType: "patient_document", entityId: docId, patientId: d.patient_id,
        changes: { request_status: { from: d.req_status, to: i.decision }, ...(i.decision === "accepted" ? { method: { from: null, to: i.method } } : {}) } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "document.decision" });
      return { ok: true, contentHash: d.content_hash };
    });
  }

  @Post("documents/:id/revoke")
  @HttpCode(200)
  @Require("document.revoke")
  revoke(@Ctx() ctx: RequestContext, @Param("id", id) docId: string, @Body() body: unknown) {
    const i = parse(DocumentRevoke, body);
    return this.db.tx(ctx, async (c) => {
      await this.assertDocVisible(c, ctx, docId);
      const d = (await c.query("select patient_id, status, content_hash from patient_documents where id = $1", [docId])).rows[0];
      if (!d) throw Errors.notFound("Belge");
      if (d.status !== "issued") throw new AppError(409, "DOCUMENT_REVOKED", "Belge zaten iptal edilmiş.");
      await c.query("update patient_documents set status = 'revoked', revoke_reason = $2, revoked_at = now(), revoked_by = $3 where id = $1", [docId, i.reason, ctx.userId]);
      await c.query("update consent_requests set status = 'revoked' where patient_document_id = $1 and status <> 'revoked'", [docId]);
      await this.evidence(c, ctx, docId, d.content_hash, "revoked", { note: i.reason });
      await audit(c, ctx, { action: "document.revoke", entityType: "patient_document", entityId: docId, patientId: d.patient_id, changes: { reason: { from: null, to: i.reason } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "document.revoke" });
      return { ok: true };
    });
  }

  /** Belge türü listesine ek (yönetici); katalog DEMO/incelenmemiş olarak başlar. */
  @Post("document-types/:id/active")
  @HttpCode(200)
  @Require("template.manage")
  toggle(@Ctx() ctx: RequestContext, @Param("id", id) tid: string, @Body() body: { active?: unknown }) {
    if (typeof body?.active !== "boolean") throw Errors.validation({ active: "Etkin/pasif değeri gerekli." });
    return this.db.tx(ctx, async (c) => {
      const r = await c.query("update document_types set active = $2 where id = $1 returning id", [tid, body.active]);
      if (!r.rowCount) throw Errors.notFound("Belge türü");
      await audit(c, ctx, { action: "document_type.update", entityType: "document_type", entityId: tid, changes: { active: { from: !body.active, to: body.active } } });
      return { ok: true };
    });
  }
}

export const hasHealth = (ctx: RequestContext) => has(ctx, "patient.health.read");
