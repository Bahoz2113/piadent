/**
 * VİA Akış görev üreticisi (API ve worker ortak kullanır). Tenant bağlamı açık bir
 * transaction içinde çağrılmalıdır. Kurallar:
 *  - Aynı olay için aynı türde yalnız bir açık görev (kısmi tekil indeks).
 *  - Kaynak durum çözülünce görev otomatik kapanır (closed_reason ile).
 *  - Görev başlığı hasta adı içermez; ad okuma anında yetkiyle birleştirilir.
 */
import type pg from "pg";

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

  // Otomatik kapanış: kaynak koşul artık geçerli değil.
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

  return { created, closed };
}
