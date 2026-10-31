import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ClinicalNoteCreate } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound("Hasta") });

/**
 * Minimum klinik not (VD-006'nın ilk dilimi). Notlar silinmez/düzenlenmez; düzeltme,
 * gerekçeli yeni kayıtla önceki nota bağlanır. Anamnez sürümleri Görev 1'de eklenecek.
 */
@Controller("patients/:patientId/clinical-notes")
export class ClinicalController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get()
  @Require("patient.health.read")
  async list(@Ctx() ctx: RequestContext, @Param("patientId", uuidPipe) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      const p = await c.query("select 1 from patients where id = $1", [patientId]);
      if (!p.rowCount) throw Errors.notFound("Hasta");
      const r = await c.query(
        `select n.id, n.body, n.created_at, n.corrects_note_id, n.correction_reason, u.full_name as author_name
           from clinical_notes n join memberships m on m.id = n.author_membership_id join users u on u.id = m.user_id
          where n.patient_id = $1 order by n.created_at desc`,
        [patientId],
      );
      return {
        items: r.rows.map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at, authorName: n.author_name,
          correctsNoteId: n.corrects_note_id, correctionReason: n.correction_reason })),
      };
    });
  }

  @Post()
  @Require("patient.health.read", "clinical_note.write")
  async create(@Ctx() ctx: RequestContext, @Param("patientId", uuidPipe) patientId: string, @Body() body: unknown) {
    const input = parse(ClinicalNoteCreate, body);
    return this.db.tx(ctx, async (c) => {
      const p = await c.query("select 1 from patients where id = $1 and status = 'active'", [patientId]);
      if (!p.rowCount) throw Errors.notFound("Hasta");
      if (input.correctsNoteId) {
        const prev = await c.query("select 1 from clinical_notes where id = $1 and patient_id = $2", [input.correctsNoteId, patientId]);
        if (!prev.rowCount) throw Errors.validation({ correctsNoteId: "Düzeltilecek not bulunamadı." });
      }
      const r = await c.query(
        `insert into clinical_notes(tenant_id, patient_id, author_membership_id, body, corrects_note_id, correction_reason)
         values ($1,$2,$3,$4,$5,$6) returning id, created_at`,
        [ctx.tenantId, patientId, ctx.membershipId, input.body, input.correctsNoteId ?? null, input.correctionReason ?? null],
      );
      // Not içeriği audit'e yazılmaz; yalnız olay ve ilişki.
      await audit(c, ctx, {
        action: input.correctsNoteId ? "clinical_note.correct" : "clinical_note.create",
        entityType: "clinical_note", entityId: r.rows[0].id, patientId,
        changes: input.correctsNoteId ? { corrects_note_id: { from: null, to: input.correctsNoteId } } : {},
      });
      return { id: r.rows[0].id, createdAt: r.rows[0].created_at };
    });
  }
}
