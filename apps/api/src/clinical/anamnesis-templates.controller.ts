import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import type pg from "pg";
import { ANAMNESIS_QUESTIONNAIRE_VERSION, ANAMNESIS_QUESTIONS, AnamnesisTemplateInput, type AnamnesisQuestion } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });

/** Kliniğin yürürlükteki soru seti: yayınlanmış şablon yoksa yerleşik DEMO set. Anamnez kaydı ve görüntüleme bunu kullanır. */
export async function activeQuestionnaire(c: pg.PoolClient): Promise<{ templateId: string | null; version: string; title: string; demo: boolean; questions: readonly AnamnesisQuestion[] }> {
  const r = (await c.query("select id, version, title, questions from anamnesis_templates where status = 'published'")).rows[0];
  if (!r) return { templateId: null, version: ANAMNESIS_QUESTIONNAIRE_VERSION, title: "Yerleşik DEMO soru seti", demo: true, questions: ANAMNESIS_QUESTIONS };
  return { templateId: r.id, version: `v${r.version}`, title: r.title, demo: false, questions: r.questions as AnamnesisQuestion[] };
}
/** Belirli bir anamnez kaydının soruları: şablon sürümüne bağlı; NULL = yerleşik set. */
export async function questionnaireFor(c: pg.PoolClient, templateId: string | null): Promise<readonly AnamnesisQuestion[]> {
  if (!templateId) return ANAMNESIS_QUESTIONS;
  const r = (await c.query("select questions from anamnesis_templates where id = $1", [templateId])).rows[0];
  return (r?.questions as AnamnesisQuestion[] | undefined) ?? ANAMNESIS_QUESTIONS;
}

/**
 * Anamnez soru şablonu (Faz 1.1, ADR-084): sürümlü; taslak düzenlenir, yayın **hekim** (anamnesis.review) onayıyla; yayınlanan değişmez,
 * yeni sürüm açılır; eski anamnez kayıtları kendi şablonuna bağlı kalır. Soru metinleri klinik içeriktir; rakip formu kopyalanmaz.
 */
@Controller("anamnesis-templates")
export class AnamnesisTemplatesController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get()
  @Require("anamnesis.template")
  list(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select t.id, t.version, t.status, t.title, t.note, t.questions, t.created_at, t.published_at, t.retired_at, u.full_name as created_by, pu.full_name as published_by,
                (select count(*) from anamnesis_versions v where v.template_id = t.id)::int as usage_count
           from anamnesis_templates t join users u on u.id = t.created_by left join users pu on pu.id = t.published_by order by t.version desc`);
      const active = await activeQuestionnaire(c);
      return { items: r.rows.map((t) => ({ id: t.id, version: t.version, status: t.status, title: t.title, note: t.note, questions: t.questions, createdAt: t.created_at, createdBy: t.created_by,
        publishedAt: t.published_at, publishedBy: t.published_by, retiredAt: t.retired_at, usageCount: t.usage_count })), active, builtin: { version: ANAMNESIS_QUESTIONNAIRE_VERSION, questions: ANAMNESIS_QUESTIONS } };
    });
  }

  /** Yeni taslak: gövde verilmezse yürürlükteki setin kopyasıyla açılır. Aynı anda tek taslak. */
  @Post()
  @Require("anamnesis.template")
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.db.tx(ctx, async (c) => {
      await c.query("select pg_advisory_xact_lock(hashtext('anamnesis_templates:' || $1::text))", [ctx.tenantId]);
      if ((await c.query("select 1 from anamnesis_templates where status = 'draft'")).rowCount) throw new AppError(409, "DRAFT_EXISTS", "Zaten açık bir taslak var; onu düzenleyin ya da yayınlayın.");
      const active = await activeQuestionnaire(c);
      const i = body && typeof body === "object" && Object.keys(body).length ? parse(AnamnesisTemplateInput, body)
        : { title: active.demo ? "Klinik anamnez formu" : active.title, note: undefined, questions: [...active.questions] };
      const v = (await c.query("select coalesce(max(version), 0)::int + 1 as v from anamnesis_templates")).rows[0].v as number;
      const r = await c.query("insert into anamnesis_templates(tenant_id, version, title, note, questions, created_by) values ($1,$2,$3,$4,$5,$6) returning id",
        [ctx.tenantId, v, i.title, i.note ?? null, JSON.stringify(i.questions), ctx.userId]);
      await audit(c, ctx, { action: "anamnesis_template.create", entityType: "anamnesis_template", entityId: r.rows[0].id, changes: { version: { from: null, to: v }, question_count: { from: null, to: i.questions.length } } });
      return { id: r.rows[0].id, version: v, status: "draft" };
    });
  }

  @Patch(":id")
  @Require("anamnesis.template")
  update(@Ctx() ctx: RequestContext, @Param("id", id) tplId: string, @Body() body: unknown) {
    const i = parse(AnamnesisTemplateInput, body);
    return this.db.tx(ctx, async (c) => {
      const t = (await c.query("select status, questions from anamnesis_templates where id = $1 for update", [tplId])).rows[0];
      if (!t) throw Errors.notFound("Şablon");
      if (t.status !== "draft") throw new AppError(409, "TEMPLATE_NOT_DRAFT", "Yalnız taslak düzenlenebilir; yayınlanmış şablon için yeni sürüm açın.");
      await c.query("update anamnesis_templates set title = $2, note = $3, questions = $4 where id = $1", [tplId, i.title, i.note ?? null, JSON.stringify(i.questions)]);
      await audit(c, ctx, { action: "anamnesis_template.update", entityType: "anamnesis_template", entityId: tplId,
        changes: { question_count: { from: (t.questions as unknown[]).length, to: i.questions.length } } });
      return { id: tplId, status: "draft" };
    });
  }

  /** Yayın: hekim onayı (anamnesis.review). Önceki yayın emekli olur; eski kayıtlar ona bağlı kalır. */
  @Post(":id/publish")
  @HttpCode(200)
  @Require("anamnesis.template", "anamnesis.review")
  publish(@Ctx() ctx: RequestContext, @Param("id", id) tplId: string) {
    return this.db.tx(ctx, async (c) => {
      await c.query("select pg_advisory_xact_lock(hashtext('anamnesis_templates:' || $1::text))", [ctx.tenantId]);
      const t = (await c.query("select status, version from anamnesis_templates where id = $1 for update", [tplId])).rows[0];
      if (!t) throw Errors.notFound("Şablon");
      if (t.status !== "draft") throw new AppError(409, "TEMPLATE_NOT_DRAFT", "Yalnız taslak yayınlanabilir.");
      const prev = (await c.query("update anamnesis_templates set status = 'retired', retired_at = now() where status = 'published' returning id, version")).rows[0];
      await c.query("update anamnesis_templates set status = 'published', published_at = now(), published_by = $2 where id = $1", [tplId, ctx.userId]);
      await audit(c, ctx, { action: "anamnesis_template.publish", entityType: "anamnesis_template", entityId: tplId,
        changes: { status: { from: "draft", to: "published" }, version: { from: prev?.version ?? null, to: t.version } } });
      return { id: tplId, status: "published", retiredVersion: prev?.version ?? null };
    });
  }

  /** Yayındaki şablonu emekli etmek yerleşik DEMO sete döndürür (nadiren; denetimde). Taslak emekli edilirse silinmez, iz kalır. */
  @Post(":id/retire")
  @HttpCode(200)
  @Require("anamnesis.template", "anamnesis.review")
  retire(@Ctx() ctx: RequestContext, @Param("id", id) tplId: string) {
    return this.db.tx(ctx, async (c) => {
      const t = (await c.query("select status from anamnesis_templates where id = $1 for update", [tplId])).rows[0];
      if (!t) throw Errors.notFound("Şablon");
      if (t.status === "retired") throw new AppError(409, "TEMPLATE_RETIRED", "Şablon zaten emekli.");
      await c.query("update anamnesis_templates set status = 'retired', retired_at = now() where id = $1", [tplId]);
      await audit(c, ctx, { action: "anamnesis_template.retire", entityType: "anamnesis_template", entityId: tplId, changes: { status: { from: t.status, to: "retired" } } });
      return { id: tplId, status: "retired" };
    });
  }
}
