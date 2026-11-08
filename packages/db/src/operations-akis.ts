/**
 * Görev 6 PİA Akış kuralları: laboratuvar gecikmesi / teslim kararı / randevu hazırlığı, stok en az seviye ve SKT; geciken malzeme siparişi (ADR-108).
 * Görev başlıkları hasta adı içermez; kaynak çözülünce görev otomatik kapanır.
 */
import type pg from "pg";

const OPEN = "('open','in_progress','blocked')";

export async function refreshGorev6(c: pg.PoolClient, tenantId: string, tz: string, now: Date): Promise<{ created: number; closed: number }> {
  let created = 0;
  let closed = 0;
  const run = async (sql: string, args: unknown[]) => (await c.query(sql, args)).rowCount ?? 0;
  const today = `($2::timestamptz at time zone $3)::date`;

  // 1) Geciken laboratuvar işi: hedef teslim geçti, iş hâlâ laboratuvarda.
  created += await run(
    `insert into tasks(tenant_id, kind, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select lo.tenant_id, 'lab_overdue', 'lab_order', lo.id, lo.patient_id, 'lab_overdue:' || lo.id, 'Geciken laboratuvar işi',
            'İş emri ' || lo.order_no || ' (' || s.name || ') hedef teslim ' || to_char(lo.target_date, 'DD.MM.YYYY') || ' geçti.',
            'Laboratuvarı arayıp yeni teslim tarihini iş emrine yazın; gerekirse randevuyu taşıyın.',
            'secretary', (lo.target_date::timestamp at time zone $3)
       from lab_orders lo join suppliers s on s.id = lo.supplier_id
      where lo.tenant_id = $1 and lo.status in ('sent','in_production','revision') and lo.target_date < ${today}
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`, [tenantId, now, tz]);
  closed += await run(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(),
            closed_reason = case when lo.status in ('sent','in_production','revision') then 'Hedef teslim tarihi güncellendi' else 'İş emri aşaması: ' || lo.status end
       from lab_orders lo
      where t.tenant_id = $1 and t.kind = 'lab_overdue' and t.status in ${OPEN} and lo.id = t.source_id
        and (lo.status not in ('sent','in_production','revision') or lo.target_date >= ${today})`, [tenantId, now, tz]);

  // 2) Teslim alınan iş hekim kararı bekliyor (kabul / revizyon).
  created += await run(
    `insert into tasks(tenant_id, kind, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, assignee_membership_id, due_at)
     select lo.tenant_id, 'lab_review', 'lab_order', lo.id, lo.patient_id, 'lab_review:' || lo.id, 'Laboratuvar işi kabul bekliyor',
            'İş emri ' || lo.order_no || ' (' || lo.work_type || ') klinikte teslim alındı.',
            'Prova/kontrol sonrası iş emrinde “Kabul et” veya gerekçeli “Revizyona gönder”.',
            'dentist', pr.membership_id, coalesce(a.starts_at, lo.received_at)
       from lab_orders lo join practitioners pr on pr.id = lo.practitioner_id left join appointments a on a.id = lo.appointment_id
      where lo.tenant_id = $1 and lo.status = 'received'
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`, [tenantId]);
  closed += await run(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(), closed_reason = 'İş emri aşaması: ' || lo.status
       from lab_orders lo where t.tenant_id = $1 and t.kind = 'lab_review' and t.status in ${OPEN} and lo.id = t.source_id and lo.status <> 'received'`, [tenantId]);

  // 3) Yarına kadar olan prova/teslim randevusu için laboratuvar işi henüz klinikte değil.
  created += await run(
    `insert into tasks(tenant_id, kind, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select lo.tenant_id, 'lab_not_ready', 'lab_order', lo.id, lo.patient_id, 'lab_not_ready:' || lo.id || ':' || a.id, 'Randevu için laboratuvar işi hazır değil',
            to_char(a.starts_at at time zone $3, 'DD.MM.YYYY HH24:MI') || ' randevusu için iş emri ' || lo.order_no || ' henüz klinikte değil.',
            'Laboratuvardan teslim durumunu öğrenin; gelmeyecekse hastayı arayıp randevuyu taşıyın.',
            'secretary', a.starts_at
       from lab_orders lo join appointments a on a.id = lo.appointment_id
      where lo.tenant_id = $1 and lo.status in ('draft','sent','in_production','revision')
        and a.status in ('planned','confirmed') and a.starts_at >= $2::timestamptz
        and (a.starts_at at time zone $3)::date <= ${today} + 1
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`, [tenantId, now, tz]);
  closed += await run(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(),
            closed_reason = case when lo.status in ('received','accepted') then 'İş klinikte' when lo.status = 'cancelled' then 'İş emri iptal'
                                 else 'Randevu değişti' end
       from lab_orders lo left join appointments a on a.id = lo.appointment_id
      where t.tenant_id = $1 and t.kind = 'lab_not_ready' and t.status in ${OPEN} and lo.id = t.source_id
        and (lo.status in ('received','accepted','cancelled') or a.id is null or a.status not in ('planned','confirmed')
             or t.dedupe_key <> 'lab_not_ready:' || lo.id || ':' || a.id)`, [tenantId]);

  // 4) Stok en az seviyede veya altında.
  created += await run(
    `insert into tasks(tenant_id, kind, source_type, source_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select i.tenant_id, 'stock_low', 'stock_item', i.id, 'stock_low:' || i.id, 'Stok en az seviyede',
            i.name || ': bakiye ' || trim(to_char(b.bal, 'FM999999990.###')) || ' ' || i.unit || ' (en az ' || trim(to_char(i.min_level, 'FM999999990.###')) || ').',
            'Sipariş verin; gelince stok girişi kaydedin.', 'assistant', $2::timestamptz
       from stock_items i cross join lateral (select coalesce(sum(m.quantity), 0) as bal from stock_movements m where m.item_id = i.id) b
      where i.tenant_id = $1 and i.active and i.min_level > 0 and b.bal <= i.min_level
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`, [tenantId, now]);
  closed += await run(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(), closed_reason = 'Stok en az seviyenin üstüne çıktı veya kalem pasif'
       from stock_items i
      where t.tenant_id = $1 and t.kind = 'stock_low' and t.status in ${OPEN} and i.id = t.source_id
        and (not i.active or i.min_level = 0 or (select coalesce(sum(m.quantity), 0) from stock_movements m where m.item_id = i.id) > i.min_level)`, [tenantId]);

  // 5) Bakiyesi olan lotun son kullanma tarihi 30 gün içinde (veya geçmiş).
  created += await run(
    `insert into tasks(tenant_id, kind, source_type, source_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select l.tenant_id, 'lot_expiring', 'stock_lot', l.id, 'lot_expiring:' || l.id,
            case when l.expiry_date < ${today} then 'Son kullanma tarihi geçmiş lot' else 'Son kullanma tarihi yaklaşan lot' end,
            i.name || ' · lot ' || l.lot_no || ' · SKT ' || to_char(l.expiry_date, 'DD.MM.YYYY') || ' · kalan ' || trim(to_char(b.bal, 'FM999999990.###')) || ' ' || i.unit || '.',
            case when l.expiry_date < ${today} then 'Hastada kullanmayın; fire/imha veya tedarikçiye iade olarak kaydedin.'
                 else 'Önce bu lotu kullanın; kullanılamayacaksa iade/imha planlayın.' end,
            'assistant', (l.expiry_date::timestamp at time zone $3)
       from stock_lots l join stock_items i on i.id = l.item_id
       cross join lateral (select coalesce(sum(m.quantity), 0) as bal from stock_movements m where m.lot_id = l.id) b
      where l.tenant_id = $1 and l.expiry_date is not null and l.expiry_date <= ${today} + 30 and b.bal > 0
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`, [tenantId, now, tz]);
  closed += await run(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(), closed_reason = 'Lotta bakiye kalmadı'
       from stock_lots l
      where t.tenant_id = $1 and t.kind = 'lot_expiring' and t.status in ${OPEN} and l.id = t.source_id
        and (select coalesce(sum(m.quantity), 0) from stock_movements m where m.lot_id = l.id) <= 0`, [tenantId]);

  // 6) ADR-108: geciken malzeme siparişi — gönderilmiş/kısmi sipariş beklenen teslim tarihini geçti.
  created += await run(
    `insert into tasks(tenant_id, kind, source_type, source_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     select po.tenant_id, 'purchase_overdue', 'purchase_order', po.id, 'purchase_overdue:' || po.id, 'Geciken malzeme siparişi',
            'Sipariş ' || po.order_no || ' (' || s.name || ') beklenen teslim ' || to_char(po.expected_date, 'DD.MM.YYYY') || ' geçti.',
            'Tedarikçiyi arayın; gelen malzemeyi Laboratuvar → Malzeme siparişleri bölümünden teslim alın.',
            'assistant', (po.expected_date::timestamp at time zone $3)
       from purchase_orders po join suppliers s on s.id = po.supplier_id
      where po.tenant_id = $1 and po.status in ('sent','partial') and po.expected_date < ${today}
     on conflict (tenant_id, dedupe_key) where status in ${OPEN} do nothing`, [tenantId, now, tz]);
  closed += await run(
    `update tasks t set status = 'done', closed_at = now(), updated_at = now(),
            closed_reason = case when po.status in ('sent','partial') then 'Beklenen teslim tarihi güncellendi' else 'Sipariş durumu: ' || po.status end
       from purchase_orders po
      where t.tenant_id = $1 and t.kind = 'purchase_overdue' and t.status in ${OPEN} and po.id = t.source_id
        and (po.status not in ('sent','partial') or po.expected_date >= ${today})`, [tenantId, now, tz]);

  return { created, closed };
}
