import type pg from "pg";

/**
 * Tarifeden fiyat: yalnız yayınlanmış ve geçerlilik tarihi gelmiş sürümler; hekime özel tarife
 * (T03) klinik tarifesine göre önceliklidir. Fiyat bulunamazsa null (elle fiyat + açıklama gerekir).
 */
export async function lookupPrice(c: pg.PoolClient, procedureId: string, practitionerId: string, onDate: string) {
  const r = await c.query(
    `select ti.price::text as price, tv.id as tariff_version_id
       from tariff_items ti join tariff_versions tv on tv.id = ti.tariff_version_id
      where ti.procedure_id = $1 and tv.status = 'published' and tv.valid_from <= $3::date
        and (tv.practitioner_id = $2 or tv.practitioner_id is null)
      order by (tv.practitioner_id is not null) desc, tv.valid_from desc, tv.published_at desc
      limit 1`,
    [procedureId, practitionerId, onDate],
  );
  return r.rows[0] ? { price: r.rows[0].price as string, tariffVersionId: r.rows[0].tariff_version_id as string } : null;
}

/** Hekim için o tarihte geçerli tarife sürümü (bilgi amaçlı; kalem fiyatı kendi snapshot'ını taşır). */
export async function applicableTariff(c: pg.PoolClient, practitionerId: string, onDate: string): Promise<string | null> {
  const r = await c.query(
    `select id from tariff_versions where status = 'published' and valid_from <= $2::date
        and (practitioner_id = $1 or practitioner_id is null)
      order by (practitioner_id is not null) desc, valid_from desc, published_at desc limit 1`,
    [practitionerId, onDate],
  );
  return r.rows[0]?.id ?? null;
}

export function locCols(loc: { kind: string; tooth?: string; surfaces?: string[]; quadrant?: number; arch?: string }) {
  return {
    location_kind: loc.kind,
    tooth: loc.kind === "tooth" ? loc.tooth! : null,
    surfaces: loc.kind === "tooth" ? loc.surfaces ?? [] : [],
    quadrant: loc.kind === "quadrant" ? loc.quadrant! : null,
    arch: loc.kind === "arch" ? loc.arch! : null,
  };
}

export function presentLoc(r: Record<string, any>) {
  return { kind: r.location_kind, tooth: r.tooth, surfaces: r.surfaces ?? [], quadrant: r.quadrant, arch: r.arch };
}
