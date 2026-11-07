/**
 * PİA-DENT standart belge kataloğu kurulumu (ADR-104) — uygulama içinden, kiracı bağlamında (uygulama rolü, RLS).
 * Migration 0037 ile aynı sonuç: eksik türler eklenir; onaylı sürümü olmayan türe DEMO şablon + onaylı 1. sürüm; ilk kurulumun
 * yer tutucu metni ("SENTETİK DEMO BELGESİ") yeni onaylı sürümle değişir, eskisi kullanımdan kalkar. Kliniğin kendi metnine dokunulmaz.
 * Kurulu kiracıda yalnız iki sayım sorgusu çalışır (eksik yoksa yazma yok). Canlı demoda 0037'nin büyük SQL'i yerine bu yol kullanılır.
 */
import { createHash } from "node:crypto";
import { clinicalOutputStarterBody, normalizeDocumentText, STANDARD_DOCUMENT_TYPES, standardTemplateBody } from "@viadent/contracts";
import { audit } from "../audit/audit.js";
import type { RequestContext } from "../infra/context.js";

const CLINICAL = new Set(["EPIKRIZ", "HASTA-FOYU", "RECETE"]);
const PLACEHOLDER = "SENTETİK DEMO BELGESİ%";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
function bodyOf(code: string): string | null {
  if (CLINICAL.has(code)) return normalizeDocumentText(`SENTETİK DEMO ŞABLON — klinik metin değildir.\n\n${clinicalOutputStarterBody(code as "EPIKRIZ" | "HASTA-FOYU" | "RECETE")}`);
  const b = standardTemplateBody(code); return b ? normalizeDocumentText(b) : null;
}
const tplName = (code: string, name: string, templateName: string | null) =>
  templateName ?? `${code === "EPIKRIZ" ? "Epikriz" : code === "RECETE" ? "Reçete yazısı" : code === "HASTA-FOYU" ? "Hasta bilgi föyü" : name} — DEMO şablon`;

export async function ensureStandardDocuments(c: import("pg").PoolClient, ctx: RequestContext): Promise<{ types: number; templates: number; replaced: number }> {
  const codes = STANDARD_DOCUMENT_TYPES.map((t) => t.code);
  const gap = (await c.query(
    `select (select count(*) from unnest($1::text[]) u(c) where not exists (select 1 from document_types d where d.code = u.c))::int as missing_types,
            (select count(*) from document_types d where d.active and d.code = any($1) and not exists (
               select 1 from templates t join template_versions v on v.template_id = t.id and v.status = 'approved' where t.document_type_id = d.id))::int as no_tpl,
            (select count(*) from template_versions v where v.status = 'approved' and v.body like $2)::int as placeholders`, [codes, PLACEHOLDER])).rows[0];
  if (!gap.missing_types && !gap.no_tpl && !gap.placeholders) return { types: 0, templates: 0, replaced: 0 };
  await c.query("select pg_advisory_xact_lock(hashtext('std-docs:' || $1))", [ctx.tenantId]); // eşzamanlı ilk açılışta çift kayıt yok
  let types = 0, templates = 0, replaced = 0;
  for (const t of STANDARD_DOCUMENT_TYPES) {
    const r = await c.query(
      `insert into document_types(tenant_id, code, name, category, requires_acceptance, issuer_role) values ($1,$2,$3,$4,$5,$6) on conflict (tenant_id, code) do nothing returning id`,
      [ctx.tenantId, t.code, t.name, t.category, t.requiresAcceptance, t.issuerRole]);
    types += r.rowCount ?? 0;
  }
  for (const t of STANDARD_DOCUMENT_TYPES) {
    const body = bodyOf(t.code); if (!body) continue;
    const d = (await c.query("select id, active from document_types where code = $1", [t.code])).rows[0];
    if (!d?.active) continue;
    const has = (await c.query(`select 1 from templates tp join template_versions v on v.template_id = tp.id and v.status = 'approved' where tp.document_type_id = $1 limit 1`, [d.id])).rowCount;
    if (has) {
      // yer tutucu metinli onaylı sürüm → yeni onaylı sürüm, eskisi kullanımdan kalkar
      const ph = await c.query(
        `select v.id, v.template_id, v.version from template_versions v join templates tp on tp.id = v.template_id
          where tp.document_type_id = $1 and v.status = 'approved' and v.body like $2 and not $3::boolean
            and v.version = (select max(x.version) from template_versions x where x.template_id = v.template_id)
            and not exists (select 1 from template_versions dr where dr.template_id = v.template_id and dr.status = 'draft')`,
        [d.id, PLACEHOLDER, CLINICAL.has(t.code)]);
      for (const v of ph.rows) {
        await c.query(
          `insert into template_versions(tenant_id, template_id, version, status, body, body_hash, is_demo, change_note, created_by, approved_by, approved_at)
           values ($1,$2,$3,'approved',$4,$5,true,'PİA-DENT standart DEMO metni (ADR-104): ilk kurulum yer tutucusunun yerine',$6,$6, now())`,
          [ctx.tenantId, v.template_id, v.version + 1, body, sha(body), ctx.userId]);
        await c.query("update template_versions set status = 'retired' where id = $1 and status = 'approved'", [v.id]);
        replaced++;
      }
      continue;
    }
    const tp = await c.query("insert into templates(tenant_id, document_type_id, name, created_by) values ($1,$2,$3,$4) returning id", [ctx.tenantId, d.id, tplName(t.code, t.name, t.templateName), ctx.userId]);
    await c.query(
      `insert into template_versions(tenant_id, template_id, version, status, body, body_hash, is_demo, change_note, created_by, approved_by, approved_at)
       values ($1,$2,1,'approved',$3,$4,true,'PİA-DENT standart DEMO şablonu (ADR-104)',$5,$5, now())`,
      [ctx.tenantId, tp.rows[0].id, body, sha(body), ctx.userId]);
    templates++;
  }
  await audit(c, ctx, { action: "document_catalog.install", entityType: "document_type", entityId: null, changes: { types: { from: null, to: types }, templates: { from: null, to: templates }, replaced: { from: null, to: replaced } } });
  return { types, templates, replaced };
}
