/**
 * VİA Akış görev üreticisi (API ve worker ortak kullanır). Tenant bağlamı açık bir
 * transaction içinde çağrılmalıdır. Kurallar:
 *  - Aynı olay için aynı türde yalnız bir açık görev (kısmi tekil indeks).
 *  - Kaynak durum çözülünce görev otomatik kapanır (closed_reason ile).
 *  - Görev başlığı hasta adı içermez; ad okuma anında yetkiyle birleştirilir.
 */
import type pg from "pg";
import { refreshGorev4 } from "./readiness.js";

export interface AkisResult { created: number; closed: number }

const OPEN = "('open','in_progress','blocked')";

export async function refreshViaAkis(c: pg.PoolClient, tenantId: string, now: Date = new Date()): Promise<AkisResult> {
  const t = await c.query("select timezone from tenants where id = $1", [tenantId]);
  if (!t.rowCount) return { created: 0, closed: 0 };
  const tz: string = t.rows[0].timezone;
  let created = 0;
  let closed = 0;

  // 1) Geciken geliş: bugünkü planlı/teyitli randevunun saati 10 dk'dan fazla geçti.
  created += (await c.query(
    `insert into tasks(tenant_id, kind, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select a.tenant_id, 'overdue_checkin', 'appointment', a.id, a.patient_id, 'overdue_checkin:' || a.id,
            'Geciken randevu',
            'Randevu saati ' || to_char(a.starts_at at time zone $2, 'HH24:MI') || ' geçti; geliş kaydı yok.',
            'Hastayı arayın; geldiyse "Geldi", gelmediyse "Gelmedi" olarak işaretleyin.',
            'secretary', a.starts_at
       from appointments a
      where a.tenant_id = $1 and a.status in ('planned','confirmed')
        and a.starts_at < $3::timestamptz - interval '10 minutes'
        and (a.starts_at at time zone $2)::date = ($3::timestamptz at time zone $2)::date
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`,
    [tenantId, tz, now],
  )).rowCount ?? 0;

  // 2) Yarınki randevular için iletişim bekleyen teyit.
  created += (await c.query(
    `insert into tasks(tenant_id, kind, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select a.tenant_id, 'contact_pending', 'appointment', a.id, a.patient_id, 'contact_pending:' || a.id,
            'Yarınki randevu teyidi',
            'Yarın ' || to_char(a.starts_at at time zone $2, 'HH24:MI') || ' randevusu için hastayla iletişim kurulmadı.',
            'Hastayı bilgilendirip iletişim sonucunu kaydedin.',
            'secretary', ((($3::timestamptz at time zone $2)::date + 1)::timestamp at time zone $2)
       from appointments a
      where a.tenant_id = $1 and a.status = 'planned' and a.contact_outcome = 'not_contacted'
        and (a.starts_at at time zone $2)::date = ($3::timestamptz at time zone $2)::date + 1
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`,
    [tenantId, tz, now],
  )).rowCount ?? 0;

  // 3) Önümüzdeki 7 günde randevusu olan ama telefon ve e-postası olmayan hasta.
  created += (await c.query(
    `insert into tasks(tenant_id, kind, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select p.tenant_id, 'missing_contact', 'patient', p.id, p.id, 'missing_contact:' || p.id,
            'İletişim bilgisi eksik',
            'Yaklaşan randevusu olan hastanın telefonu ve e-postası kayıtlı değil.',
            'Hasta kartına en az bir iletişim bilgisi ekleyin.',
            'secretary', min(a.starts_at)
       from patients p join appointments a on a.patient_id = p.id
      where p.tenant_id = $1 and p.status = 'active' and p.phone_e164 is null and p.email is null
        and a.status in ('planned','confirmed') and a.starts_at >= $2::timestamptz and a.starts_at < $2::timestamptz + interval '7 days'
      group by p.tenant_id, p.id
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`,
    [tenantId, now],
  )).rowCount ?? 0;

  // 4) Kapatmayla çakışan gelecek randevu (kapatma randevuyu silmez/taşımaz; insan karar verir).
  created += (await c.query(
    `insert into tasks(tenant_id, kind, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select distinct on (a.id) a.tenant_id, 'closure_conflict', 'appointment', a.id, a.patient_id, 'closure_conflict:' || a.id,
            'Kapatmayla çakışan randevu',
            to_char(a.starts_at at time zone $2, 'DD.MM.YYYY HH24:MI') || ' randevusu kapatma ile çakışıyor: ' || cl.reason,
            'Hastayı arayıp randevuyu taşıyın veya gerekçeyle iptal edin.',
            'secretary', a.starts_at
       from appointments a
       join closures cl on cl.cancelled_at is null
        and tstzrange(cl.starts_at, cl.ends_at, '[)') && tstzrange(a.starts_at, a.ends_at, '[)')
        and (cl.scope = 'clinic' or cl.practitioner_id = a.practitioner_id or cl.chair_id = a.chair_id)
      where a.tenant_id = $1 and a.status in ('planned','confirmed') and a.starts_at >= $3::timestamptz
      order by a.id, cl.starts_at
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`,
    [tenantId, tz, now],
  )).rowCount ?? 0;

  // 5) Hekim onayı bekleyen son anamnez sürümü (klinik görev; yalnız sağlık yetkili roller görür).
  created += (await c.query(
    `insert into tasks(tenant_id, kind, sensitivity, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select v.tenant_id, 'anamnesis_review', 'clinical', 'anamnesis', v.id, v.patient_id, 'anamnesis_review:' || v.id,
            'Anamnez hekim onayı bekliyor',
            'Sürüm ' || v.version || ' hekim onayı olmadan kaydedildi' ||
              case when cardinality(v.critical_flags) > 0 then '; kritik işaret var.' else '.' end,
            'Hasta kartında Sağlık sekmesinden yanıtları gözden geçirip onaylayın.',
            'dentist', v.created_at
       from anamnesis_versions v
      where v.tenant_id = $1
        and v.version = (select max(v2.version) from anamnesis_versions v2 where v2.patient_id = v.patient_id)
        and not exists (select 1 from anamnesis_reviews r where r.anamnesis_id = v.id)
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`,
    [tenantId],
  )).rowCount ?? 0;

  // 6) Kabul edilmiş, tamamlanmamış plan; hastanın gelecekte randevusu yok (R04 önerisi).
  created += (await c.query(
    `insert into tasks(tenant_id, kind, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select pv.tenant_id, 'plan_unscheduled', 'plan_version', pv.id, tp.patient_id, 'plan_unscheduled:' || pv.id,
            'Kabul edilen planın randevusu yok',
            'Kabul edilmiş tedavi planında tamamlanmamış işlem var; ileri tarihli randevu bulunmuyor.',
            'Hastayı arayıp bir sonraki seans için randevu verin.',
            'secretary', pv.decided_at + interval '2 days'
       from plan_versions pv join treatment_plans tp on tp.id = pv.plan_id
      where pv.tenant_id = $1 and pv.status = 'accepted'
        and exists (select 1 from plan_items pi where pi.plan_version_id = pv.id
                     and pi.quantity > coalesce((select sum(pp.quantity) from performed_procedures pp where pp.plan_item_id = pi.id and pp.status = 'completed'), 0))
        and not exists (select 1 from appointments a where a.patient_id = tp.patient_id and a.status in ('planned','confirmed') and a.starts_at > $2::timestamptz)
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`,
    [tenantId, now],
  )).rowCount ?? 0;

  // 7) 3 günden uzun süredir yanıt bekleyen teklif.
  created += (await c.query(
    `insert into tasks(tenant_id, kind, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select pv.tenant_id, 'plan_decision_pending', 'plan_version', pv.id, tp.patient_id, 'plan_decision_pending:' || pv.id,
            'Teklif yanıtı bekleniyor',
            'Tedavi teklifi ' || to_char(pv.proposed_at at time zone $3, 'DD.MM.YYYY') || ' tarihinde sunuldu; kabul veya ret kaydı yok.',
            'Hastayla görüşüp kararını (kabul / ret / kararsız) kaydedin.',
            'secretary', pv.proposed_at + interval '3 days'
       from plan_versions pv join treatment_plans tp on tp.id = pv.plan_id
      where pv.tenant_id = $1 and pv.status = 'proposed' and pv.proposed_at < $2::timestamptz - interval '3 days'
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`,
    [tenantId, now, tz],
  )).rowCount ?? 0;

  // Otomatik kapanış: kaynak koşul artık geçerli değil.
  closed += (await c.query(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(),
            closed_reason = case when pv.status <> 'accepted' then 'Plan sürümü durumu: ' || pv.status else 'Randevu verildi veya plan tamamlandı' end
       from plan_versions pv join treatment_plans tp on tp.id = pv.plan_id
      where t.tenant_id = $1 and t.kind = 'plan_unscheduled' and t.status in ${OPEN} and pv.id = t.source_id
        and (pv.status <> 'accepted'
             or exists (select 1 from appointments a where a.patient_id = tp.patient_id and a.status in ('planned','confirmed') and a.starts_at > $2::timestamptz)
             or not exists (select 1 from plan_items pi where pi.plan_version_id = pv.id
                             and pi.quantity > coalesce((select sum(pp.quantity) from performed_procedures pp where pp.plan_item_id = pi.id and pp.status = 'completed'), 0)))`,
    [tenantId, now],
  )).rowCount ?? 0;
  closed += (await c.query(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(), closed_reason = 'Teklif durumu: ' || pv.status
       from plan_versions pv
      where t.tenant_id = $1 and t.kind = 'plan_decision_pending' and t.status in ${OPEN} and pv.id = t.source_id and pv.status <> 'proposed'`,
    [tenantId],
  )).rowCount ?? 0;
  closed += (await c.query(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(), closed_reason = 'Çakışma giderildi'
       from appointments a
      where t.tenant_id = $1 and t.kind = 'closure_conflict' and t.status in ${OPEN} and a.id = t.source_id
        and (a.status not in ('planned','confirmed') or not exists (
              select 1 from closures cl where cl.cancelled_at is null
                 and tstzrange(cl.starts_at, cl.ends_at, '[)') && tstzrange(a.starts_at, a.ends_at, '[)')
                 and (cl.scope = 'clinic' or cl.practitioner_id = a.practitioner_id or cl.chair_id = a.chair_id)))`,
    [tenantId],
  )).rowCount ?? 0;
  closed += (await c.query(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(),
            closed_reason = case when exists (select 1 from anamnesis_reviews r where r.anamnesis_id = t.source_id)
                                 then 'Hekim onayladı' else 'Daha yeni anamnez sürümü kaydedildi' end
      where t.tenant_id = $1 and t.kind = 'anamnesis_review' and t.status in ${OPEN}
        and (exists (select 1 from anamnesis_reviews r where r.anamnesis_id = t.source_id)
             or exists (select 1 from anamnesis_versions v join anamnesis_versions v2 on v2.patient_id = v.patient_id and v2.version > v.version
                         where v.id = t.source_id))`,
    [tenantId],
  )).rowCount ?? 0;
  closed += (await c.query(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(),
            closed_reason = 'Kaynak güncellendi: randevu durumu ' || a.status
       from appointments a
      where t.tenant_id = $1 and t.kind = 'overdue_checkin' and t.status in ${OPEN}
        and a.id = t.source_id and a.status not in ('planned','confirmed')`,
    [tenantId],
  )).rowCount ?? 0;
  closed += (await c.query(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(),
            closed_reason = case when a.status <> 'planned' then 'Kaynak güncellendi: randevu durumu ' || a.status
                                 else 'İletişim sonucu kaydedildi: ' || a.contact_outcome end
       from appointments a
      where t.tenant_id = $1 and t.kind = 'contact_pending' and t.status in ${OPEN}
        and a.id = t.source_id and (a.contact_outcome <> 'not_contacted' or a.status <> 'planned')`,
    [tenantId],
  )).rowCount ?? 0;
  closed += (await c.query(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(), closed_reason = 'İletişim bilgisi eklendi'
       from patients p
      where t.tenant_id = $1 and t.kind = 'missing_contact' and t.status in ${OPEN}
        and p.id = t.source_id and (p.phone_e164 is not null or p.email is not null)`,
    [tenantId],
  )).rowCount ?? 0;

  const g4 = await refreshGorev4(c, tenantId, tz, now);
  created += g4.created;
  closed += g4.closed;
  return { created, closed };
}
