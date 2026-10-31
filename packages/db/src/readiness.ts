/**
 * VİA Hazır (ziyaret hazırlığı) ve Görev 4 bakım kuralları. Tenant bağlamlı transaction içinde çağrılır.
 *  - Kurallar yetkili klinik tarafından tanımlanır (readiness_rules); tıbbi uygunluk hakkında otomatik karar verilmez.
 *  - Eksik kalem nedeniyle görünür; gerekçeli yetkili istisna kayda geçer (readiness_exceptions).
 */
import type pg from "pg";

export interface ReadinessItem { key: string; label: string; status: "ok" | "missing" | "excepted"; detail: string }

export async function readinessFor(c: pg.PoolClient, appointmentId: string): Promise<ReadinessItem[] | null> {
  const a = (await c.query("select id, patient_id, starts_at from appointments where id = $1", [appointmentId])).rows[0];
  if (!a) return null;
  const rules = (await c.query(
    `select r.id, r.kind, r.procedure_id, r.document_type_id, r.max_age_days, dt.name as doc_name, dt.requires_acceptance
       from readiness_rules r left join document_types dt on dt.id = r.document_type_id where r.active order by r.created_at`)).rows;
  if (!rules.length) return [];
  const exc = new Map((await c.query("select item_key, reason from readiness_exceptions where appointment_id = $1", [appointmentId])).rows.map((e) => [e.item_key, e.reason]));
  const items: ReadinessItem[] = [];
  const push = (key: string, label: string, ok: boolean, okDetail: string, missingDetail: string) => {
    if (items.some((i) => i.key === key)) return;
    if (ok) items.push({ key, label, status: "ok", detail: okDetail });
    else if (exc.has(key)) items.push({ key, label, status: "excepted", detail: `İstisna: ${exc.get(key)}` });
    else items.push({ key, label, status: "missing", detail: missingDetail });
  };

  for (const r of rules.filter((x) => x.kind === "anamnesis_reviewed")) {
    const v = (await c.query(
      `select v.created_at, exists (select 1 from anamnesis_reviews rv where rv.anamnesis_id = v.id) as reviewed
         from anamnesis_versions v where v.patient_id = $1 order by v.version desc limit 1`, [a.patient_id])).rows[0];
    const fresh = v && new Date(v.created_at).getTime() >= new Date(a.starts_at).getTime() - r.max_age_days * 86_400_000;
    push("anamnesis", "Güncel ve hekimce onaylı anamnez", !!(v && v.reviewed && fresh), "Hazır",
      !v ? "Anamnez kaydı yok" : !fresh ? `Son anamnez ${r.max_age_days} günden eski` : "Son anamnez hekim onayı bekliyor");
  }

  // Kabul edilmiş planda kalan işlemler (bu ziyarette yapılabilecekler) için gerekli belgeler.
  const remaining = (await c.query(
    `select distinct pi.procedure_id, pi.procedure_code
       from plan_items pi join plan_versions pv on pv.id = pi.plan_version_id join treatment_plans tp on tp.id = pv.plan_id
      where tp.patient_id = $1 and pv.status = 'accepted'
        and pi.quantity > coalesce((select sum(pp.quantity) from performed_procedures pp where pp.plan_item_id = pi.id and pp.status = 'completed'), 0)`,
    [a.patient_id])).rows;
  for (const r of rules.filter((x) => x.kind === "document_for_procedure")) {
    const proc = remaining.find((p) => p.procedure_id === r.procedure_id);
    if (!proc) continue;
    const doc = (await c.query(
      `select d.id, cr.status as req_status from patient_documents d left join consent_requests cr on cr.patient_document_id = d.id
        where d.patient_id = $1 and d.document_type_id = $2 and d.status = 'issued' order by d.issued_at desc`,
      [a.patient_id, r.document_type_id])).rows;
    const ok = doc.some((d) => (r.requires_acceptance ? d.req_status === "accepted" : true));
    const pending = doc.find((d) => d.req_status && d.req_status !== "accepted");
    push(`document:${r.document_type_id}`, `${r.doc_name} (${proc.procedure_code})`, ok, "Hazır",
      doc.length === 0 ? "Belge hazırlanmamış" : pending ? "Belge hazırlandı; hasta kararı kaydedilmedi" : "Geçerli belge yok");
  }
  return items;
}

const OPEN = "('open','in_progress','blocked')";

/** VİA Akış'a eklenen Görev 4 kuralları: kontrol bağlama/görevi, VİA Hazır eksikleri, karantina görevi kapanışı. */
export async function refreshGorev4(c: pg.PoolClient, tenantId: string, tz: string, now: Date): Promise<{ created: number; closed: number }> {
  let created = 0, closed = 0;
  // Kontrol ↔ randevu bağlama: kontrol kaydından sonra verilen ilk (iptal/gelmedi olmayan) randevu bağlanır; gerçekleşince kontrol yapıldı.
  await c.query(
    `update follow_ups f set status = 'scheduled', appointment_id = x.aid
       from (select f2.id as fid, (select a.id from appointments a where a.patient_id = f2.patient_id and a.created_at >= f2.created_at
                                     and a.status in ('planned','confirmed','checked_in','in_progress','completed') order by a.starts_at limit 1) as aid
               from follow_ups f2 where f2.tenant_id = $1 and f2.status = 'open') x
      where f.id = x.fid and x.aid is not null`, [tenantId]);
  await c.query(
    `update follow_ups f set status = 'open', appointment_id = null
       from appointments a where f.tenant_id = $1 and f.status = 'scheduled' and a.id = f.appointment_id and a.status in ('cancelled','no_show')`, [tenantId]);
  await c.query(
    `update follow_ups f set status = 'done', closed_at = now()
       from appointments a where f.tenant_id = $1 and f.status = 'scheduled' and a.id = f.appointment_id and a.status = 'completed'`, [tenantId]);

  created += (await c.query(
    `insert into tasks(tenant_id, kind, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select f.tenant_id, 'follow_up', 'follow_up', f.id, f.patient_id, 'follow_up:' || f.id, 'Kontrol randevusu',
            'Hekim ' || to_char(f.due_date, 'DD.MM.YYYY') || ' için kontrol istedi: ' || f.reason,
            'Hastanın iletişim tercihine uygun kanaldan ulaşıp kontrol randevusu verin.', 'secretary',
            (f.due_date::timestamp at time zone $3)
       from follow_ups f
      where f.tenant_id = $1 and f.status = 'open' and f.due_date <= (($2::timestamptz at time zone $3)::date + 14)
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`, [tenantId, now, tz])).rowCount ?? 0;
  closed += (await c.query(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(),
            closed_reason = case f.status when 'scheduled' then 'Kontrol randevusu verildi' when 'done' then 'Kontrol yapıldı' else 'Kontrol iptal edildi' end
       from follow_ups f where t.tenant_id = $1 and t.kind = 'follow_up' and t.status in ${OPEN} and f.id = t.source_id and f.status <> 'open'`, [tenantId])).rowCount ?? 0;

  // VİA Hazır: yarınki randevularda eksik hazırlık.
  const tomorrow = await c.query(
    `select a.id, a.patient_id, a.starts_at from appointments a
      where a.tenant_id = $1 and a.status in ('planned','confirmed')
        and (a.starts_at at time zone $3)::date = (($2::timestamptz at time zone $3)::date + 1) order by a.starts_at limit 500`, [tenantId, now, tz]);
  for (const a of tomorrow.rows) {
    const items = (await readinessFor(c, a.id)) ?? [];
    const missing = items.filter((i) => i.status === "missing");
    if (missing.length) {
      created += (await c.query(
        `insert into tasks(tenant_id, kind, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
         values ($1,'readiness_missing','appointment',$2::uuid,$3,'readiness_missing:' || $2::text,'Ziyaret hazırlığı eksik',$4,
                 'Eksik belgeyi hazırlayın veya hekimden gerekçeli istisna isteyin. Tıbbi uygunluk kararı hekimindir.','secretary',$5)
         on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`,
        [tenantId, a.id, a.patient_id, `Yarınki randevu için eksik: ${missing.map((m) => m.label).join("; ")}`.slice(0, 500), a.starts_at])).rowCount ?? 0;
    }
  }
  const openReady = await c.query(`select t.id, t.source_id from tasks t where t.tenant_id = $1 and t.kind = 'readiness_missing' and t.status in ${OPEN}`, [tenantId]);
  for (const t of openReady.rows) {
    const a = (await c.query("select status from appointments where id = $1", [t.source_id])).rows[0];
    const items = a && ["planned", "confirmed"].includes(a.status) ? (await readinessFor(c, t.source_id)) ?? [] : [];
    if (!a || !["planned", "confirmed"].includes(a.status) || !items.some((i) => i.status === "missing")) {
      closed += (await c.query("update tasks set status = 'done', closed_at = now(), updated_at = now(), closed_reason = $2 where id = $1",
        [t.id, !a || !["planned", "confirmed"].includes(a.status) ? "Randevu durumu değişti" : "Hazırlık tamamlandı veya istisna kaydedildi"])).rowCount ?? 0;
    }
  }
  closed += (await c.query(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(), closed_reason = 'Dosya gerekçeyle silindi'
       from file_assets f where t.tenant_id = $1 and t.kind = 'file_quarantined' and t.status in ${OPEN} and f.id = t.source_id and f.status = 'deleted'`, [tenantId])).rowCount ?? 0;
  return { created, closed };
}

/**
 * Süre aşımları (worker): sağlayıcıdan teslim yanıtı gelmeyen mesaj → unknown (asla delivered uydurulmaz, AT-12);
 * süresi geçen yüz yüze onay isteği → expired (kanıt olayıyla).
 */
export async function documentsMaintenance(c: pg.PoolClient, tenantId: string, now: Date, messageTimeoutHours = 24): Promise<{ unknown: number; expired: number }> {
  const m = await c.query(
    `update messages set status = 'unknown', status_reason = 'Sağlayıcıdan ' || $3::int::text || ' saat içinde teslim bilgisi gelmedi', status_at = $2
      where tenant_id = $1 and status = 'submitted' and submitted_at < $2::timestamptz - make_interval(hours => $3::int) returning id`,
    [tenantId, now, messageTimeoutHours]);
  for (const r of m.rows) {
    await c.query("insert into delivery_events(tenant_id, message_id, status, source, detail) values ($1,$2,'unknown','timeout','Teslim yanıtı gelmedi; yeniden gönderme yerine durum sorgusu gerekir')", [tenantId, r.id]);
  }
  const e = await c.query(
    `update consent_requests set status = 'expired' where tenant_id = $1 and status in ('issued','delivered','viewed') and expires_at < $2
      returning patient_document_id`, [tenantId, now]);
  for (const r of e.rows) {
    await c.query(
      `insert into evidence_events(tenant_id, patient_document_id, kind, document_hash, note)
       select tenant_id, id, 'expired', content_hash, 'Karar süresi doldu' from patient_documents where id = $1`, [r.patient_document_id]);
  }
  return { unknown: m.rowCount ?? 0, expired: e.rowCount ?? 0 };
}
