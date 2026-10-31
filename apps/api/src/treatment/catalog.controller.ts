import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { ProcedureUpsert, TariffCreate, TariffItemsSet, localDate } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";
import { lookupPrice } from "./pricing.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
const PriceQuery = z.object({ procedureId: z.uuid(), practitionerId: z.uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** İşlem kataloğu (T01) ve sürümlü tarife (T02/T03). Yayınlanmış tarife değişmez; yeni sürüm açılır. */
@Controller()
export class CatalogController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("procedures")
  @Require("treatment.read")
  procedures(@Ctx() ctx: RequestContext, @Query("all") all?: string) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select id, code, name, category, tooth_scope, default_minutes, active from procedures
          where ($1::boolean or active) order by category nulls last, code`,
        [all === "1"],
      );
      return { items: r.rows.map((p) => ({ id: p.id, code: p.code, name: p.name, category: p.category, toothScope: p.tooth_scope, defaultMinutes: p.default_minutes, active: p.active })) };
    });
  }

  @Post("procedures")
  @Require("catalog.manage")
  createProcedure(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(ProcedureUpsert, body);
    return this.db.tx(ctx, async (c) => {
      try {
        const r = await c.query(
          "insert into procedures(tenant_id, code, name, category, tooth_scope, default_minutes) values ($1,$2,$3,$4,$5,$6) returning id",
          [ctx.tenantId, i.code, i.name, i.category ?? null, i.toothScope, i.defaultMinutes ?? null],
        );
        await audit(c, ctx, { action: "procedure.create", entityType: "procedure", entityId: r.rows[0].id, changes: { code: { from: null, to: i.code }, name: { from: null, to: i.name } } });
        return { id: r.rows[0].id };
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new AppError(409, "CODE_EXISTS", "Bu kodla bir işlem zaten var.", { code: "Kod kullanımda." });
        throw e;
      }
    });
  }

  /** Kod ve kapsam değişmez (geçmiş plan/işlem kayıtları kodu snapshot olarak taşır); ad, kategori, süre, etkinlik değişebilir. */
  @Patch("procedures/:id")
  @Require("catalog.manage")
  updateProcedure(@Ctx() ctx: RequestContext, @Param("id", id) pid: string, @Body() body: unknown) {
    const i = parse(ProcedureUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const cur = await c.query("select code, name, tooth_scope, active from procedures where id = $1 for update", [pid]);
      if (!cur.rowCount) throw Errors.notFound("İşlem");
      if (cur.rows[0].code !== i.code || cur.rows[0].tooth_scope !== i.toothScope) {
        throw new AppError(422, "IMMUTABLE_FIELD", "İşlem kodu ve kapsamı değiştirilemez; gerekirse yeni işlem tanımlayın.");
      }
      await c.query("update procedures set name=$2, category=$3, default_minutes=$4, active=$5 where id = $1",
        [pid, i.name, i.category ?? null, i.defaultMinutes ?? null, i.active ?? cur.rows[0].active]);
      await audit(c, ctx, { action: "procedure.update", entityType: "procedure", entityId: pid,
        changes: { name: { from: cur.rows[0].name, to: i.name }, active: { from: cur.rows[0].active, to: i.active ?? cur.rows[0].active } } });
      return { ok: true };
    });
  }

  @Get("tariffs")
  @Require("treatment.read")
  tariffs(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select tv.id, tv.name, tv.valid_from, tv.status, tv.currency, tv.practitioner_id, p.display_name, tv.published_at,
                (select count(*)::int from tariff_items ti where ti.tariff_version_id = tv.id) as item_count
           from tariff_versions tv left join practitioners p on p.id = tv.practitioner_id
          order by tv.status = 'draft' desc, tv.valid_from desc, tv.created_at desc`,
      );
      return { items: r.rows.map((t) => ({ id: t.id, name: t.name, validFrom: t.valid_from, status: t.status, currency: t.currency,
        practitionerId: t.practitioner_id, practitionerName: t.display_name, publishedAt: t.published_at, itemCount: t.item_count })) };
    });
  }

  @Get("tariffs/:id")
  @Require("treatment.read")
  tariff(@Ctx() ctx: RequestContext, @Param("id", id) tid: string) {
    return this.db.tx(ctx, async (c) => {
      const t = await c.query("select id, name, valid_from, status, practitioner_id from tariff_versions where id = $1", [tid]);
      if (!t.rowCount) throw Errors.notFound("Tarife");
      const items = await c.query(
        `select p.id as procedure_id, p.code, p.name, p.active, ti.price::text as price
           from procedures p left join tariff_items ti on ti.procedure_id = p.id and ti.tariff_version_id = $1
          order by p.code`,
        [tid],
      );
      return { id: t.rows[0].id, name: t.rows[0].name, validFrom: t.rows[0].valid_from, status: t.rows[0].status, practitionerId: t.rows[0].practitioner_id,
        items: items.rows.map((x) => ({ procedureId: x.procedure_id, code: x.code, name: x.name, active: x.active, price: x.price })) };
    });
  }

  @Post("tariffs")
  @Require("catalog.manage")
  createTariff(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(TariffCreate, body);
    return this.db.tx(ctx, async (c) => {
      if (i.practitionerId && !(await c.query("select 1 from practitioners where id = $1", [i.practitionerId])).rowCount) throw Errors.validation({ practitionerId: "Hekim bulunamadı." });
      const r = await c.query(
        "insert into tariff_versions(tenant_id, name, valid_from, practitioner_id, created_by) values ($1,$2,$3,$4,$5) returning id",
        [ctx.tenantId, i.name, i.validFrom, i.practitionerId ?? null, ctx.userId],
      );
      if (i.copyFromId) {
        await c.query(
          `insert into tariff_items(tenant_id, tariff_version_id, procedure_id, price)
           select tenant_id, $2, procedure_id, price from tariff_items where tariff_version_id = $1`,
          [i.copyFromId, r.rows[0].id],
        );
      }
      await audit(c, ctx, { action: "tariff.create", entityType: "tariff_version", entityId: r.rows[0].id, changes: { name: { from: null, to: i.name }, valid_from: { from: null, to: i.validFrom } } });
      return { id: r.rows[0].id };
    });
  }

  @Put("tariffs/:id/items")
  @Require("catalog.manage")
  setItems(@Ctx() ctx: RequestContext, @Param("id", id) tid: string, @Body() body: unknown) {
    const i = parse(TariffItemsSet, body);
    return this.db.tx(ctx, async (c) => {
      const t = await c.query("select status from tariff_versions where id = $1 for update", [tid]);
      if (!t.rowCount) throw Errors.notFound("Tarife");
      if (t.rows[0].status !== "draft") throw new AppError(409, "TARIFF_FROZEN", "Yayınlanmış tarife değiştirilemez. Kopyalayarak yeni sürüm açın.");
      await c.query("delete from tariff_items where tariff_version_id = $1", [tid]);
      for (const it of i.items) {
        await c.query("insert into tariff_items(tenant_id, tariff_version_id, procedure_id, price) values ($1,$2,$3,$4)", [ctx.tenantId, tid, it.procedureId, it.price]);
      }
      await audit(c, ctx, { action: "tariff.items", entityType: "tariff_version", entityId: tid, changes: { item_count: { from: null, to: i.items.length } } });
      return { ok: true };
    });
  }

  @Post("tariffs/:id/publish")
  @HttpCode(200)
  @Require("catalog.manage")
  publish(@Ctx() ctx: RequestContext, @Param("id", id) tid: string) {
    return this.db.tx(ctx, async (c) => {
      const t = await c.query("select status, (select count(*)::int from tariff_items where tariff_version_id = $1) as n from tariff_versions where id = $1 for update", [tid]);
      if (!t.rowCount) throw Errors.notFound("Tarife");
      if (t.rows[0].status !== "draft") throw new AppError(409, "TARIFF_FROZEN", "Tarife zaten yayınlanmış.");
      if (t.rows[0].n === 0) throw new AppError(422, "TARIFF_EMPTY", "Boş tarife yayınlanamaz.");
      await c.query("update tariff_versions set status = 'published', published_at = now(), published_by = $2 where id = $1", [tid, ctx.userId]);
      await audit(c, ctx, { action: "tariff.publish", entityType: "tariff_version", entityId: tid, changes: { status: { from: "draft", to: "published" } } });
      return { ok: true };
    });
  }

  @Post("tariffs/:id/retire")
  @HttpCode(200)
  @Require("catalog.manage")
  retire(@Ctx() ctx: RequestContext, @Param("id", id) tid: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from tariff_versions where id = $1", [tid])).rowCount) throw Errors.notFound("Tarife");
      const r = await c.query("update tariff_versions set status = 'retired' where id = $1 and status = 'published' returning id", [tid]);
      if (!r.rowCount) throw new AppError(409, "TARIFF_NOT_PUBLISHED", "Yalnız yayınlanmış tarife emekliye ayrılabilir.");
      await audit(c, ctx, { action: "tariff.retire", entityType: "tariff_version", entityId: tid, changes: { status: { from: "published", to: "retired" } } });
      return { ok: true };
    });
  }

  @Get("price")
  @Require("treatment.read")
  price(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    const q = parse(PriceQuery, query);
    return this.db.tx(ctx, async (c) => (await lookupPrice(c, q.procedureId, q.practitionerId, q.date ?? localDate(new Date(), ctx.timezone))) ?? { price: null, tariffVersionId: null });
  }
}
