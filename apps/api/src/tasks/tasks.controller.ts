import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { TaskUpdate } from "@viadent/contracts";
import { refreshViaAkis } from "@viadent/db";
import { z } from "zod";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import { has, type RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";

const taskId = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound("Görev") });
const ListQuery = z.object({ status: z.enum(["open", "closed"]).default("open"), patientId: z.uuid().optional() });

/** PİA Akış: neden, sorumlu ve sonraki adımı belli tek iş listesi. */
@Controller()
export class TasksController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("tasks")
  @Require("task.read")
  async list(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    const q = parse(ListQuery, query);
    // Hassasiyet filtresi sunucuda: klinik/finans görevleri yalnız ilgili yetkiyle görünür.
    const allowed = ["general", ...(has(ctx, "patient.health.read") ? ["clinical"] : []), ...(has(ctx, "finance.read") ? ["finance"] : [])];
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select t.id, t.kind, t.sensitivity, t.source_type, t.source_id, t.patient_id, t.title, t.reason, t.next_step,
                t.assignee_role, t.due_at, t.status, t.closed_reason, t.closed_at, t.created_at,
                p.first_name || ' ' || p.last_name as patient_name, p.file_no
           from tasks t left join patients p on p.id = t.patient_id
          where t.sensitivity = any($1::text[])
            and (case when $2 = 'open' then t.status in ('open','in_progress','blocked') else t.status in ('done','cancelled') end)
            and ($3::uuid is null or t.patient_id = $3::uuid)
          order by case when $2 = 'open' then t.due_at end asc nulls last, t.closed_at desc nulls last, t.created_at desc
          limit 200`,
        [allowed, q.status, q.patientId ?? null],
      );
      return {
        items: r.rows.map((t) => ({
          id: t.id, kind: t.kind, sensitivity: t.sensitivity, sourceType: t.source_type, sourceId: t.source_id,
          patientId: t.patient_id, patientName: t.patient_name, patientFileNo: t.file_no,
          title: t.title, reason: t.reason, nextStep: t.next_step, assigneeRole: t.assignee_role,
          dueAt: t.due_at, status: t.status, closedReason: t.closed_reason, closedAt: t.closed_at, createdAt: t.created_at,
          mine: t.assignee_role === ctx.role,
        })),
      };
    });
  }

  @Post("tasks/:id/status")
  @HttpCode(200)
  @Require("task.write")
  async update(@Ctx() ctx: RequestContext, @Param("id", taskId) id: string, @Body() body: unknown) {
    const input = parse(TaskUpdate, body);
    const allowed = ["general", ...(has(ctx, "patient.health.read") ? ["clinical"] : []), ...(has(ctx, "finance.read") ? ["finance"] : [])];
    return this.db.tx(ctx, async (c) => {
      const cur = await c.query("select id, status, kind, patient_id, sensitivity from tasks where id = $1 for update", [id]);
      const t = cur.rows[0];
      if (!t || !allowed.includes(t.sensitivity)) throw Errors.notFound("Görev");
      if (["done", "cancelled"].includes(t.status)) throw new AppError(422, "TASK_CLOSED", "Kapanmış görev değiştirilemez.");
      const closing = ["done", "cancelled"].includes(input.status);
      await c.query(
        `update tasks set status = $2, closed_reason = $3, closed_at = case when $4 then now() end,
                closed_by = case when $4 then $5::uuid end, updated_at = now() where id = $1`,
        [id, input.status, closing ? input.closedReason ?? "Kullanıcı tarafından tamamlandı" : null, closing, ctx.userId],
      );
      await audit(c, ctx, { action: "task.status", entityType: "task", entityId: id, patientId: t.patient_id,
        changes: { status: { from: t.status, to: input.status } } });
      return { ok: true };
    });
  }

  @Post("via-akis/refresh")
  @HttpCode(200)
  @Require("task.write")
  refresh(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, (c) => refreshViaAkis(c, ctx.tenantId));
  }
}
