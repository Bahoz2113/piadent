import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { PatientHealthNotesInput } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { Errors, parse } from "../infra/errors.js";
import { has, type RequestContext } from "../infra/context.js";
import { audit, auditAdminHealthView } from "../audit/audit.js";

const pid = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound("Hasta") });
const FIELDS = [["chronicConditions", "chronic_conditions", "Kronik hastalık"], ["regularMedications", "regular_medications", "Sürekli kullanılan ilaç"], ["allergies", "allergies", "Alerji"]] as const;

/**
 * Hasta sağlık özeti (07.11.2026, ADR-100): anamnez modülünün yerine kronik hastalık, sürekli kullanılan ilaç ve alerji.
 * İçerik yalnız `patient.health.read` rollerine döner; diğer roller (sekreter, finans) yalnız "kayıt var" işaretini görür —
 * randevu verirken "hastanın sağlık uyarısı var, ayrıntı hekimde" bilgisi için.
 */
@Controller("patients/:patientId/health-notes")
export class HealthNotesController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get()
  @Require("patient.read")
  get(@Ctx() ctx: RequestContext, @Param("patientId", pid) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const r = (await c.query(
        `select n.chronic_conditions, n.regular_medications, n.allergies, n.updated_at, u.full_name as updated_by
           from patient_health_notes n join users u on u.id = n.updated_by where n.patient_id = $1`, [patientId])).rows[0];
      const exists = !!r && !!(r.chronic_conditions || r.regular_medications || r.allergies);
      if (!has(ctx, "patient.health.read")) return { exists, restricted: true };
      await auditAdminHealthView(c, ctx, patientId, "Hasta kartı sağlık özeti");
      return { exists, restricted: false, chronicConditions: r?.chronic_conditions ?? null, regularMedications: r?.regular_medications ?? null,
        allergies: r?.allergies ?? null, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? null, canEdit: has(ctx, "anamnesis.write") };
    });
  }

  @Put()
  @Require("patient.health.read", "anamnesis.write")
  put(@Ctx() ctx: RequestContext, @Param("patientId", pid) patientId: string, @Body() body: unknown) {
    const i = parse(PatientHealthNotesInput, body);
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1 and status = 'active'", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const before = (await c.query("select chronic_conditions, regular_medications, allergies from patient_health_notes where patient_id = $1 for update", [patientId])).rows[0] ?? {};
      const next = Object.fromEntries(FIELDS.map(([k, col]) => [col, i[k] === undefined ? (before[col] ?? null) : i[k]]));
      const changed = FIELDS.filter(([, col]) => (before[col] ?? null) !== next[col]).map(([, , label]) => label);
      await c.query(
        `insert into patient_health_notes(tenant_id, patient_id, chronic_conditions, regular_medications, allergies, updated_by)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (tenant_id, patient_id) do update set chronic_conditions = excluded.chronic_conditions, regular_medications = excluded.regular_medications,
           allergies = excluded.allergies, updated_by = excluded.updated_by, updated_at = now()`,
        [ctx.tenantId, patientId, next.chronic_conditions, next.regular_medications, next.allergies, ctx.userId]);
      // İçerik denetim kaydına yazılmaz (sağlık verisi); yalnız hangi bölümün değiştiği. Tür "anamnesis": sağlık yetkisiz rollerin geçmişinde görünmez.
      if (changed.length) await audit(c, ctx, { action: "health_notes.update", entityType: "anamnesis", entityId: patientId, patientId, changes: { changed: { from: null, to: changed } } });
      return { ok: true, changed };
    });
  }
}
