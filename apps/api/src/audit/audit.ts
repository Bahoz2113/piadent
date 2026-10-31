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
 * Bu olaylar yalnız `patient.health.read` yetkisiyle okunur (VİA İz, KVKK dışa aktarım access_log, denetim raporu) — Plan §05.
 * SQL kullanımı: `e.entity_type <> all($n::text[])`.
 */
export const CLINICAL_ENTITY_TYPES: readonly string[] = ["anamnesis", "clinical_note", "clinical_chart"];

/** Audit, domain değişikliğiyle AYNI transaction içinde yazılır. */
export async function audit(c: pg.PoolClient, ctx: Pick<RequestContext, "tenantId" | "userId" | "membershipId" | "correlationId">, a: AuditInput) {
  await c.query(
    `insert into audit_events(tenant_id, actor_user_id, actor_membership_id, action, entity_type, entity_id, patient_id, changes, correlation_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ctx.tenantId, ctx.userId, ctx.membershipId, a.action, a.entityType, a.entityId ?? null, a.patientId ?? null,
     JSON.stringify(a.changes ?? {}), ctx.correlationId],
  );
}

/** Yalnız değişen alanlar; maskeleyiciyle hassas değer loga tam yazılmaz (VİA İz kuralı). */
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
