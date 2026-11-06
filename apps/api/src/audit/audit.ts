import type pg from "pg";
import type { RequestContext } from "../infra/context.js";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  patientId?: string | null;
  changes?: Record<string, { from: unknown; to: unknown }> | Record<string, unknown>;
}

/**
 * Sağlık içeriği taşıyan audit varlık türleri (anamnez, klinik not, odontogram bulgu/tanı).
 * Bu olaylar yalnız `patient.health.read` yetkisiyle okunur (PİA İz, KVKK dışa aktarım access_log, denetim raporu) — Plan §05.
 * SQL kullanımı: `e.entity_type <> all($n::text[])`.
 */
export const CLINICAL_ENTITY_TYPES: readonly string[] = ["anamnesis", "clinical_note", "clinical_chart"];

/**
 * QA-102: klinik çıktı belgesi (ADR-085, `document_types.category = 'clinical_output'`) olayları da sağlık içeriğidir;
 * varlık türü `patient_document` olduğundan türe göre değil belge kategorisine göre süzülür. Sağlık yetkisi yoksa
 * `CLINICAL_ENTITY_TYPES` süzgeciyle birlikte kullanılır. `alias`: audit_events tablo takma adı (boş = nitelemesiz).
 */
export const notClinicalOutputDocSql = (alias = "e") => {
  const p = alias ? `${alias}.` : "";
  return `not (${p}entity_type = 'patient_document' and exists (select 1 from patient_documents cod join document_types cdt on cdt.id = cod.document_type_id
           where cod.id = ${p}entity_id and cdt.category = 'clinical_output'))`;
};

/**
 * QA-104/105: belge kimliği taşıyan satırlar (patient_documents.id, consent_requests/evidence_events/file_assets.patient_document_id)
 * için aynı süzgeç. `docIdExpr` NULL ise (belgeye bağlı olmayan dosya) koşul doğrudur. Sağlık yetkisi yoksa uygulanır.
 */
export const notClinicalOutputDocIdSql = (docIdExpr: string) =>
  `not exists (select 1 from patient_documents cod join document_types cdt on cdt.id = cod.document_type_id
           where cod.id = ${docIdExpr} and cdt.category = 'clinical_output')`;

/**
 * QA-106/107 (ADR-089): sağlık yetkisi olmayan rol için görünür dosya = idari hassasiyetli **ve** klinik çıktı belgesine bağlı değil
 * (bağlı dosya kategorisinden bağımsız klinik sayılır). Dosya listesi/uçları, dosyayı kanıt olarak bağlayan uç ve hasta dışa aktarımı
 * aynı koşulu kullanır: `($n::boolean or ${nonClinicalFileSql("f")})`, `$n` = `patient.health.read`.
 */
export const nonClinicalFileSql = (alias: string) =>
  `(${alias}.sensitivity = 'administrative' and ${notClinicalOutputDocIdSql(`${alias}.patient_document_id`)})`;

/**
 * QA-108 (ADR-090): dosya denetim olayları (`entity_type = 'file'`: file.upload/file.delete) yalnız ADR-089'a göre görünür dosya için
 * listelenir. Sağlık yetkisi yoksa `CLINICAL_ENTITY_TYPES` ve `notClinicalOutputDocSql` ile birlikte kullanılır (PİA İz, KVKK
 * access_log, denetim raporu). Dosya satırı yoksa olay gösterilmez (güvenli varsayılan). `alias`: audit_events takma adı.
 */
export const notHiddenFileEventSql = (alias = "e") => {
  const p = alias ? `${alias}.` : "";
  return `not (${p}entity_type = 'file' and not exists (select 1 from file_assets hf where hf.id = ${p}entity_id and ${nonClinicalFileSql("hf")}))`;
};

/**
 * QA-109 (ADR-091): `clinical` hassasiyetli görevin (ör. gizli dosyanın karantina görevi, anamnez onayı) denetim olayları
 * (`entity_type = 'task'`: `task.status`) görev listesiyle aynı kapıya tabidir; sağlık yetkisi yoksa `notHiddenFileEventSql` yanında kullanılır.
 */
export const notHiddenTaskEventSql = (alias = "e") => {
  const p = alias ? `${alias}.` : "";
  return `not (${p}entity_type = 'task' and exists (select 1 from tasks ht where ht.id = ${p}entity_id and ht.sensitivity = 'clinical'))`;
};

/**
 * QA-108 (ADR-090): dosyaya kimlikle atıf yapan sütun (ör. `evidence_events.file_id`) için görünür değer; görünmeyen dosyada NULL.
 * Satırın kendisi kalır. `health`: `patient.health.read` SQL ifadesi (ör. `$2::boolean`).
 */
export const visibleFileIdSql = (expr: string, health: string) =>
  `(case when ${health} or ${expr} is null or exists (select 1 from file_assets vf where vf.id = ${expr} and ${nonClinicalFileSql("vf")}) then ${expr} end)`;

/** Audit, domain değişikliğiyle AYNI transaction içinde yazılır. */
export async function audit(c: pg.PoolClient, ctx: Pick<RequestContext, "tenantId" | "userId" | "membershipId" | "correlationId">, a: AuditInput) {
  await c.query(
    `insert into audit_events(tenant_id, actor_user_id, actor_membership_id, action, entity_type, entity_id, patient_id, changes, correlation_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ctx.tenantId, ctx.userId, ctx.membershipId, a.action, a.entityType, a.entityId ?? null, a.patientId ?? null,
     JSON.stringify(a.changes ?? {}), ctx.correlationId],
  );
}

/**
 * ADR-098: yönetici sağlık içeriğini görür; her görüntüleme PİA İz'e düşer (KVKK özel nitelikli veri — erişim izi).
 * Hekim/asistan rutin klinik işini yaptığından onların okuması kayda geçmez; yalnız yönetici unvanı izlenir.
 */
export async function auditAdminHealthView(c: pg.PoolClient, ctx: RequestContext, patientId: string, section: "Diş şeması" | "Klinik notlar" | "Anamnez" | "Hasta kartı sağlık özeti") {
  if (ctx.role !== "clinic_admin") return;
  await audit(c, ctx, { action: "patient.health_view", entityType: "patient", entityId: patientId, patientId, changes: { section } });
}

/** Yalnız değişen alanlar; maskeleyiciyle hassas değer loga tam yazılmaz (PİA İz kuralı). */
export function diff<T extends Record<string, unknown>>(
  before: T | null,
  after: T,
  fields: (keyof T & string)[],
  mask: Partial<Record<keyof T & string, (v: unknown) => unknown>> = {},
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    const a = before ? before[f] ?? null : null;
    const b = after[f] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const m = mask[f];
    out[f] = { from: m ? m(a) : a, to: m ? m(b) : b };
  }
  return out;
}

export async function enqueue(c: pg.PoolClient, tenantId: string, topic: string, payload: Record<string, unknown> = {}) {
  await c.query("insert into outbox_events(tenant_id, topic, payload) values ($1,$2,$3)", [tenantId, topic, JSON.stringify(payload)]);
}
