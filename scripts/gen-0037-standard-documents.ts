/**
 * 0037 migration üretici (ADR-104): PİA-DENT standart belge kataloğu + DEMO şablonları mevcut kiracılara.
 * Kaynak: packages/contracts/src/document-templates-standard.ts (tek doğruluk kaynağı; seed de aynısını kullanır).
 * Kullanım: packages/db/node_modules/.bin/tsx scripts/gen-0037-standard-documents.ts > packages/db/migrations/0037_standard_document_templates.sql
 * Uygulanmış migration değiştirilmez: katalog sonradan değişirse yeni migration üretilir.
 */
import { clinicalOutputStarterBody, normalizeDocumentText, STANDARD_DOCUMENT_TYPES, standardTemplateBody } from "../packages/contracts/src/index";

const q = (s: string | null) => (s === null ? "null" : `'${s.replace(/'/g, "''")}'`);
const rows = STANDARD_DOCUMENT_TYPES.map((t) => {
  const clinical = t.code === "EPIKRIZ" || t.code === "HASTA-FOYU" || t.code === "RECETE";
  const body = clinical
    ? normalizeDocumentText(`SENTETİK DEMO ŞABLON — klinik metin değildir.\n\n${clinicalOutputStarterBody(t.code as "EPIKRIZ" | "HASTA-FOYU" | "RECETE")}`)
    : normalizeDocumentText(standardTemplateBody(t.code)!);
  const tname = clinical ? `${t.code === "EPIKRIZ" ? "Epikriz" : t.code === "RECETE" ? "Reçete yazısı" : "Hasta bilgi föyü"} — DEMO şablon` : t.templateName!;
  return `(${q(t.code)}, ${q(t.name)}, ${q(t.category)}, ${t.requiresAcceptance}, ${q(t.issuerRole)}, ${q(tname)}, ${q(body)}, ${clinical})`;
});

process.stdout.write(`-- Ürün sahibi geri bildirimi 07.11.2026 (ADR-104): belge listesindeki her tür seçildiğinde belge kendiliğinden dolsun.
--  * PİA-DENT standart belge kataloğu (42 tür; özgün DEMO metinler — rakip form içeriği kullanılmadı) eksik türleri kiracıya ekler.
--  * Onaylı sürümü olmayan her türe "PİA-DENT DEMO" şablonu + onaylı 1. sürüm (is_demo; klinik hekim/hukuk incelemesi gerekir).
--  * İlk kurulumun yer tutucu DEMO metni ("SENTETİK DEMO BELGESİ …") yeni onaylı sürümle değişir, eskisi kullanımdan kalkar (silinmez;
--    üretilmiş belgeler kendi metin snapshot'ını korur). Kliniğin kendi yazdığı/onayladığı sürümlere dokunulmaz.
--  * Üretici: scripts/gen-0037-standard-documents.ts (kaynak contracts/document-templates-standard.ts). Yazar: kiracının ilk etkin yöneticisi.
create temp table std_docs (code text, name text, category text, req boolean, issuer text, tname text, body text, clinical boolean) on commit drop;
insert into std_docs values
${rows.join(",\n")};

select app.for_each_tenant($q$
  insert into document_types(tenant_id, code, name, category, requires_acceptance, issuer_role)
  select app.tenant_id(), s.code, s.name, s.category, s.req, s.issuer from std_docs s
   where not exists (select 1 from document_types d where d.code = s.code)
$q$);

select app.for_each_tenant($q$
  with author as (select m.user_id from memberships m where m.role = 'clinic_admin' and m.status = 'active' order by m.created_at limit 1),
  need as (
    select d.id as type_id, s.tname, s.body from document_types d join std_docs s on s.code = d.code
     where d.active and not exists (select 1 from templates tp join template_versions v on v.template_id = tp.id and v.status = 'approved' where tp.document_type_id = d.id)),
  tp as (
    insert into templates(tenant_id, document_type_id, name, created_by)
    select app.tenant_id(), n.type_id, n.tname, a.user_id from need n cross join author a returning id, document_type_id)
  insert into template_versions(tenant_id, template_id, version, status, body, body_hash, is_demo, change_note, created_by, approved_by, approved_at)
  select app.tenant_id(), tp.id, 1, 'approved', n.body, encode(sha256(convert_to(n.body, 'UTF8')), 'hex'), true,
         'PİA-DENT standart DEMO şablonu (ADR-104)', a.user_id, a.user_id, now()
    from tp join need n on n.type_id = tp.document_type_id cross join author a
$q$);

select app.for_each_tenant($q$
  insert into template_versions(tenant_id, template_id, version, status, body, body_hash, is_demo, change_note, created_by, approved_by, approved_at)
  select app.tenant_id(), v.template_id, v.version + 1, 'approved', s.body, encode(sha256(convert_to(s.body, 'UTF8')), 'hex'), true,
         'PİA-DENT standart DEMO metni (ADR-104): ilk kurulum yer tutucusunun yerine', v.created_by, v.created_by, now()
    from template_versions v join templates tp on tp.id = v.template_id join document_types d on d.id = tp.document_type_id join std_docs s on s.code = d.code
   where v.status = 'approved' and not s.clinical and v.body like 'SENTETİK DEMO BELGESİ%'
     and v.version = (select max(x.version) from template_versions x where x.template_id = v.template_id)
     and not exists (select 1 from template_versions dr where dr.template_id = v.template_id and dr.status = 'draft')
$q$);

select app.for_each_tenant($q$
  update template_versions v set status = 'retired'
   where v.status = 'approved' and v.body like 'SENTETİK DEMO BELGESİ%'
     and exists (select 1 from template_versions n where n.template_id = v.template_id and n.status = 'approved' and n.version > v.version)
$q$);
`);
