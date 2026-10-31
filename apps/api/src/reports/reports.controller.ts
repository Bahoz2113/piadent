/**
 * Raporlar (V09): katalog yetkiye göre süzülür; her rapor sunucuda aynı izinle çalışır (arayüzde gizlemek güvenlik değildir).
 * CSV dışa aktarım: ayrı izin, satır sınırı, denetim kaydı (parametreler; veri değil), formül enjeksiyonu koruması, UTF-8 BOM, “;” ayırıcı.
 */
import { Controller, Get, Inject, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { REPORTS, REPORT_BY_ID, addDays, csvCell, dayRangeUtc, localDate, type ReportColumn } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { Errors } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";
import { RUNNERS, type Params, type ReportResult } from "./definitions.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VIEW_LIMIT = 2000;
const EXPORT_LIMIT = 20000;

function fmtCell(v: unknown, type: ReportColumn["type"], tz: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (type === "money" || type === "qty") return String(v).replace(".", ",");
  if (type === "percent") return `${String(v).replace(".", ",")}`;
  if (type === "date") { const [y, m, d] = String(v).slice(0, 10).split("-"); return `${d}.${m}.${y}`; }
  if (type === "datetime") {
    const p = new Intl.DateTimeFormat("tr-TR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date(String(v)));
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return `${g("day")}.${g("month")}.${g("year")} ${g("hour")}:${g("minute")}`;
  }
  return String(v);
}

@Controller()
export class ReportsController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("reports")
  @Require("task.read")
  catalog(@Ctx() ctx: RequestContext) {
    const visible = REPORTS.filter((r) => ctx.permissions.has(r.perm));
    return this.db.tx(ctx, async (c) => {
      const own = ctx.role === "dentist" ? (await c.query("select id from practitioners where membership_id = $1", [ctx.membershipId])).rows[0]?.id ?? null : null;
      const pr = await c.query("select id, display_name as name from practitioners order by display_name");
      const procs = await c.query("select id, code, name from procedures order by code");
      const sup = ctx.permissions.has("lab.read") ? await c.query("select id, name, kind from suppliers order by name") : { rows: [] };
      return {
        reports: visible.map((r) => ({ ...r, ownOnly: r.perm === "report.clinical" && ctx.role === "dentist" })),
        canExport: ctx.permissions.has("report.export"),
        options: {
          practitioners: own ? pr.rows.filter((x) => x.id === own) : pr.rows,
          procedures: procs.rows.map((p) => ({ id: p.id, name: `${p.code} · ${p.name}` })),
          suppliers: sup.rows,
        },
        today: localDate(new Date(), ctx.timezone),
      };
    });
  }

  private async run(ctx: RequestContext, id: string, q: Params, limit: number): Promise<{ def: (typeof REPORTS)[number]; from: string; to: string; result: ReportResult }> {
    const def = REPORT_BY_ID[id];
    if (!def) throw Errors.notFound("Rapor");
    if (!ctx.permissions.has(def.perm)) throw Errors.forbidden();
    const today = localDate(new Date(), ctx.timezone);
    const from = q.from && DATE.test(q.from) ? q.from : `${today.slice(0, 7)}-01`;
    const to = q.to && DATE.test(q.to) ? q.to : today;
    if (to < from) throw Errors.validation({ from: "Başlangıç bitişten sonra olamaz." });
    if (def.maxDays > 1 && addDays(from, def.maxDays - 1) < to) throw Errors.validation({ to: `Bu rapor için en fazla ${def.maxDays} gün seçilebilir.` });
    const r = { from, to, fromUtc: dayRangeUtc(from, ctx.timezone).from, toUtc: dayRangeUtc(to, ctx.timezone).to };
    return this.db.tx(ctx, async (c) => {
      let own: string | null = null;
      if (def.perm === "report.clinical" && ctx.role === "dentist") {
        own = (await c.query("select id from practitioners where membership_id = $1", [ctx.membershipId])).rows[0]?.id ?? null;
        if (!own) throw Errors.forbidden();
      }
      const result = await RUNNERS[id]!({ c, ctx, p: q, r, limit, ownPractitionerId: own });
      return { def, from, to, result };
    });
  }

  @Get("reports/:id")
  @Require("task.read")
  async view(@Ctx() ctx: RequestContext, @Param("id") id: string, @Query() q: Params) {
    const { def, from, to, result } = await this.run(ctx, id, q, VIEW_LIMIT);
    return { id: def.id, title: def.title, sourceIds: def.sourceIds, from, to, timezone: ctx.timezone, limit: VIEW_LIMIT, ...result };
  }

  @Get("reports/:id/export")
  @Require("report.export")
  async export(@Ctx() ctx: RequestContext, @Param("id") id: string, @Query() q: Params, @Res() res: Response) {
    const { def, from, to, result } = await this.run(ctx, id, q, EXPORT_LIMIT);
    if (result.truncated) throw Errors.validation({ to: `Dışa aktarım en çok ${EXPORT_LIMIT} satırdır; aralığı daraltın.` }, "Satır sınırı aşıldı.");
    const cols = result.columns;
    const lines = [cols.map((c) => csvCell(c.label)).join(";")];
    for (const row of result.rows) lines.push(cols.map((c) => csvCell(fmtCell(row[c.key], c.type, ctx.timezone))).join(";"));
    if (Object.keys(result.totals).length) {
      lines.push("");
      for (const [k, [label, type]] of Object.entries(result.totalLabels)) lines.push([csvCell(`TOPLAM · ${label}`), csvCell(fmtCell(result.totals[k], type, ctx.timezone))].join(";"));
    }
    lines.push("", csvCell(`VİADENT · ${def.title} · ${from} – ${to} · ${ctx.tenantName} · ${ctx.timezone}`));
    await this.db.tx(ctx, (c) => audit(c, ctx, { action: "report.export", entityType: "report", changes: {
      report: { from: null, to: def.id }, params: { from: null, to: Object.fromEntries(Object.entries({ ...q, from, to }).filter(([k]) => /^[a-zA-Z]{2,20}$/.test(k))) },
      rows: { from: null, to: result.rows.length } } }));
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="viadent-${def.id}-${from}-${to}.csv"`);
    res.send(`﻿${lines.join("\r\n")}\r\n`);
  }
}
