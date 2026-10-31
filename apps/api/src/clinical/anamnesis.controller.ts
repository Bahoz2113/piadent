import { Body, Controller, Get, HttpCode, Inject, Param, ParseIntPipe, ParseUUIDPipe, Post } from "@nestjs/common";
import { ANAMNESIS_QUESTIONNAIRE_VERSION, ANAMNESIS_QUESTIONS, AnamnesisSave, criticalFlags, type AnamnesisAnswers } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import { has, type RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";

const pid = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound("Hasta") });

/**
 * Sürümlü anamnez (H07). Her kayıt yeni sürümdür, önceki sürüm değişmez. Hekim kaydı otomatik
 * onaylıdır; asistan kaydı hekim onayı bekler ve PİA Akış'ta klinik görev oluşturur.
 * Kritik işaretler tıbbi karar değildir, yalnız görünürlüktür. Soru seti DEMO'dur.
 */
@Controller("patients/:patientId/anamnesis")
export class AnamnesisController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get()
  @Require("patient.health.read")
  latest(@Ctx() ctx: RequestContext, @Param("patientId", pid) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const versions = await c.query(
        `select v.id, v.version, v.questionnaire_version, v.critical_flags, v.created_at, u.full_name as recorded_by,
                rv.reviewed_at, ru.full_name as reviewed_by
           from anamnesis_versions v
           join memberships m on m.id = v.recorded_by join users u on u.id = m.user_id
           left join anamnesis_reviews rv on rv.anamnesis_id = v.id
           left join memberships rm on rm.id = rv.reviewed_by left join users ru on ru.id = rm.user_id
          where v.patient_id = $1 order by v.version desc`,
        [patientId],
      );
      const latest = versions.rows[0];
      const answers = latest ? (await c.query("select answers from anamnesis_versions where id = $1", [latest.id])).rows[0].answers : {};
      return {
        questionnaire: { version: ANAMNESIS_QUESTIONNAIRE_VERSION, demo: true, questions: ANAMNESIS_QUESTIONS },
        current: latest ? { version: latest.version, answers, criticalFlags: latest.critical_flags, createdAt: latest.created_at,
          recordedBy: latest.recorded_by, reviewedAt: latest.reviewed_at, reviewedBy: latest.reviewed_by, questionnaireVersion: latest.questionnaire_version } : null,
        history: versions.rows.map((v) => ({ version: v.version, createdAt: v.created_at, recordedBy: v.recorded_by, reviewedAt: v.reviewed_at,
          reviewedBy: v.reviewed_by, criticalFlags: v.critical_flags })),
      };
    });
  }

  @Get(":version")
  @Require("patient.health.read")
  version(@Ctx() ctx: RequestContext, @Param("patientId", pid) patientId: string, @Param("version", ParseIntPipe) version: number) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query("select version, answers, critical_flags, created_at from anamnesis_versions where patient_id = $1 and version = $2", [patientId, version]);
      if (!r.rowCount) throw Errors.notFound("Anamnez sürümü");
      const v = r.rows[0];
      return { version: v.version, answers: v.answers, criticalFlags: v.critical_flags, createdAt: v.created_at };
    });
  }

  @Post()
  @Require("patient.health.read", "anamnesis.write")
  save(@Ctx() ctx: RequestContext, @Param("patientId", pid) patientId: string, @Body() body: unknown) {
    const input = parse(AnamnesisSave, body);
    const known = new Set(ANAMNESIS_QUESTIONS.map((q) => q.key));
    const unknownKeys = Object.keys(input.answers).filter((k) => !known.has(k));
    if (unknownKeys.length) throw Errors.validation({ answers: `Tanımsız soru: ${unknownKeys.join(", ")}` });
    const answers = input.answers as AnamnesisAnswers;
    const flags = criticalFlags(answers);
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1 and status = 'active' for update", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const cur = await c.query("select coalesce(max(version), 0)::int as v from anamnesis_versions where patient_id = $1", [patientId]);
      const currentVersion: number = cur.rows[0].v;
      if (currentVersion !== input.basedOnVersion) {
        throw new AppError(409, "VERSION_CONFLICT", "Anamnez siz düzenlerken güncellendi. Son sürümü yükleyip tekrar deneyin.", undefined, { currentVersion });
      }
      const r = await c.query(
        `insert into anamnesis_versions(tenant_id, patient_id, version, questionnaire_version, answers, critical_flags, recorded_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [ctx.tenantId, patientId, currentVersion + 1, ANAMNESIS_QUESTIONNAIRE_VERSION, JSON.stringify(answers), flags, ctx.membershipId],
      );
      const autoReviewed = has(ctx, "anamnesis.review");
      if (autoReviewed) {
        await c.query("insert into anamnesis_reviews(tenant_id, anamnesis_id, reviewed_by) values ($1,$2,$3)", [ctx.tenantId, r.rows[0].id, ctx.membershipId]);
      }
      // Yanıt içerikleri audit'e yazılmaz; yalnız sürüm ve kritik işaret sayısı.
      await audit(c, ctx, { action: "anamnesis.save", entityType: "anamnesis", entityId: r.rows[0].id, patientId,
        changes: { version: { from: currentVersion || null, to: currentVersion + 1 }, critical_count: { from: null, to: flags.length } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "anamnesis.save" });
      return { version: currentVersion + 1, criticalFlags: flags, reviewed: autoReviewed };
    });
  }

  @Post(":version/review")
  @HttpCode(200)
  @Require("patient.health.read", "anamnesis.review")
  review(@Ctx() ctx: RequestContext, @Param("patientId", pid) patientId: string, @Param("version", ParseIntPipe) version: number) {
    return this.db.tx(ctx, async (c) => {
      const v = await c.query("select id from anamnesis_versions where patient_id = $1 and version = $2", [patientId, version]);
      if (!v.rowCount) throw Errors.notFound("Anamnez sürümü");
      const r = await c.query(
        "insert into anamnesis_reviews(tenant_id, anamnesis_id, reviewed_by) values ($1,$2,$3) on conflict (tenant_id, anamnesis_id) do nothing returning id",
        [ctx.tenantId, v.rows[0].id, ctx.membershipId],
      );
      if (!r.rowCount) throw new AppError(409, "ALREADY_REVIEWED", "Bu sürüm zaten onaylanmış.");
      await audit(c, ctx, { action: "anamnesis.review", entityType: "anamnesis", entityId: v.rows[0].id, patientId, changes: { version: { from: null, to: version } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "anamnesis.review" });
      return { ok: true };
    });
  }
}
