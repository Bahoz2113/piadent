import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { maskPhone, normalizePhone, PHONE_RULE_MESSAGE, RelationCreate, RelationEnd, RELATION_LABELS } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import { has, type RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";

const pid = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound("Hasta") });
const rid = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound("İlişki") });

/**
 * Hasta yakınları ve veli/yasal temsilci (H03). Yakınlık tek başına yetki değildir:
 * "yasal temsilci" işareti dayanak açıklaması ister ve işaretleyen kullanıcı kayda geçer.
 * Ortak telefon kullanan aile bireyleri burada ilişkilendirilir; telefon tekilliği aranmaz.
 */
@Controller("patients/:patientId/relations")
export class RelationsController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get()
  @Require("patient.read")
  list(@Ctx() ctx: RequestContext, @Param("patientId", pid) patientId: string) {
    const unmask = has(ctx, "patient.phone.read"); // telefon klinik içinde tam görünür (destek maskeli)
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const r = await c.query(
        `select r.id, r.patient_id, r.related_patient_id, r.contact_name, r.contact_phone_e164, r.relation, r.is_legal_representative,
                r.representation_evidence, r.representation_verified_at, vu.full_name as verified_by_name, r.can_receive_info,
                r.valid_until, r.note, r.created_at,
                rp.first_name || ' ' || rp.last_name as related_name, rp.file_no as related_file_no,
                pp.first_name || ' ' || pp.last_name as owner_name, pp.file_no as owner_file_no
           from patient_relations r
           left join patients rp on rp.id = r.related_patient_id
           join patients pp on pp.id = r.patient_id
           left join users vu on vu.id = r.representation_verified_by
          where r.status = 'active' and (r.patient_id = $1 or r.related_patient_id = $1)
          order by r.is_legal_representative desc, r.created_at`,
        [patientId],
      );
      return {
        items: r.rows.map((x) => {
          // Ters yön: başka bir hastanın kaydında bu hasta yakın olarak geçiyor.
          const inverse = x.patient_id !== patientId;
          return {
            id: x.id,
            direction: inverse ? "inverse" : "direct",
            relation: x.relation,
            relationLabel: RELATION_LABELS[x.relation as keyof typeof RELATION_LABELS],
            personPatientId: inverse ? x.patient_id : x.related_patient_id,
            personName: inverse ? x.owner_name : x.related_name ?? x.contact_name,
            personFileNo: inverse ? x.owner_file_no : x.related_file_no,
            contactPhone: inverse ? null : unmask ? x.contact_phone_e164 : maskPhone(x.contact_phone_e164),
            isLegalRepresentative: x.is_legal_representative,
            representationEvidence: x.representation_evidence,
            representationVerifiedAt: x.representation_verified_at,
            representationVerifiedBy: x.verified_by_name,
            canReceiveInfo: x.can_receive_info,
            validUntil: x.valid_until,
            note: x.note,
            createdAt: x.created_at,
          };
        }),
      };
    });
  }

  @Post()
  @Require("patient.write")
  create(@Ctx() ctx: RequestContext, @Param("patientId", pid) patientId: string, @Body() body: unknown) {
    const input = parse(RelationCreate, body);
    let phone: string | null = null;
    if (input.contactPhone) {
      const n = normalizePhone(input.contactPhone);
      if (!n) throw Errors.validation({ contactPhone: PHONE_RULE_MESSAGE });
      phone = n.e164;
    }
    if (input.relatedPatientId === patientId) throw Errors.validation({ relatedPatientId: "Hasta kendisiyle ilişkilendirilemez." });
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1 and status = 'active'", [patientId])).rowCount) throw Errors.notFound("Hasta");
      if (input.relatedPatientId && !(await c.query("select 1 from patients where id = $1 and status = 'active'", [input.relatedPatientId])).rowCount) {
        throw Errors.validation({ relatedPatientId: "Yakın olarak seçilen hasta bulunamadı." });
      }
      try {
        const r = await c.query(
          `insert into patient_relations(tenant_id, patient_id, related_patient_id, contact_name, contact_phone_e164, relation,
              is_legal_representative, representation_evidence, representation_verified_by, representation_verified_at,
              can_receive_info, valid_until, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
          [ctx.tenantId, patientId, input.relatedPatientId ?? null, input.relatedPatientId ? null : input.contactName ?? null, phone,
           input.relation, !!input.isLegalRepresentative, input.isLegalRepresentative ? input.representationEvidence : null,
           input.isLegalRepresentative ? ctx.userId : null, input.isLegalRepresentative ? new Date() : null,
           !!input.canReceiveInfo, input.validUntil ?? null, input.note ?? null, ctx.userId],
        );
        await audit(c, ctx, {
          action: "relation.create", entityType: "patient_relation", entityId: r.rows[0].id, patientId,
          changes: {
            relation: { from: null, to: input.relation },
            is_legal_representative: { from: null, to: !!input.isLegalRepresentative },
            can_receive_info: { from: null, to: !!input.canReceiveInfo },
          },
        });
        return { id: r.rows[0].id };
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new AppError(409, "RELATION_EXISTS", "Bu iki hasta arasında etkin bir ilişki zaten var.");
        throw e;
      }
    });
  }

  @Post(":relationId/end")
  @HttpCode(200)
  @Require("patient.write")
  end(@Ctx() ctx: RequestContext, @Param("patientId", pid) patientId: string, @Param("relationId", rid) relationId: string, @Body() body: unknown) {
    const input = parse(RelationEnd, body);
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `update patient_relations set status = 'ended', ended_at = now(), ended_reason = $3
          where id = $1 and patient_id = $2 and status = 'active' returning id`,
        [relationId, patientId, input.reason],
      );
      if (!r.rowCount) throw Errors.notFound("İlişki");
      await audit(c, ctx, { action: "relation.end", entityType: "patient_relation", entityId: relationId, patientId,
        changes: { status: { from: "active", to: "ended" }, ended_reason: { from: null, to: input.reason } } });
      return { ok: true };
    });
  }
}
