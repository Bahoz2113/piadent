-- Görev 12 (ADR-068): işletim uyarı metrikleri. Platform geneli sayaçlar RLS altında kiracı bağlamı olmadan okunamaz;
-- bu dar SECURITY DEFINER fonksiyon (sahibi viadent_owner) yalnız toplam sayıları döner (kiracı, kimlik, içerik yok). /metrics ucu METRICS_TOKEN ile korunur.
-- FORCE RLS sahibe de uygulanır; sayım yalnız bu fonksiyonun işaretlediği transaction içinde (app.ops_metrics=1) ve yalnız sahip rolüyle açılır —
-- uygulama/worker rolleri bu politikadan yararlanamaz, sahip rolüyle normal sorgular (bayrak yokken) etkilenmez.
do $$ declare t text; begin
  foreach t in array array['outbox_events','integration_jobs','webhook_rejections','file_assets','import_batches','memberships'] loop
    execute format('create policy owner_ops_metrics on %I for select to viadent_owner using (current_setting(''app.ops_metrics'', true) = ''1'')', t);
  end loop;
end $$;

create or replace function app.ops_metrics() returns table(metric text, label text, value numeric)
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform set_config('app.ops_metrics', '1', true);
  return query

  select 'outbox_events', status, count(*)::numeric from outbox_events where status in ('pending','processing','dead') group by status
  union all select 'outbox_oldest_pending_seconds', '', coalesce(extract(epoch from now() - min(available_at)), 0)::numeric
    from outbox_events where status = 'pending' and available_at <= now()
  union all select 'integration_jobs', transport_status, count(*)::numeric from integration_jobs
    where transport_status in ('held','queued','sending','unknown','dead') group by transport_status
  union all select 'integration_jobs_pending_approval', '', count(*)::numeric from integration_jobs where approval_status = 'pending'
  union all select 'webhook_rejections_1h', reason, count(*)::numeric from webhook_rejections where received_at > now() - interval '1 hour' group by reason
  union all select 'auth_locked_keys', '', count(*)::numeric from auth_throttle where fail_count >= 5 and first_at > now() - interval '15 minutes'
  union all select 'file_assets', status, count(*)::numeric from file_assets where status in ('quarantined','rejected') and purged_at is null group by status
  union all select 'file_assets_purge_due', '', count(*)::numeric from file_assets where purged_at is null and status = 'deleted' and deleted_at < now() - interval '45 days'
  union all select 'import_batches_pending', '', count(*)::numeric from import_batches where status = 'dry_run' and created_at < now() - interval '7 days'
  union all select 'memberships_support_active', '', count(*)::numeric from memberships where role = 'support' and status = 'active' and expires_at > now()
  ;
end $$;
revoke all on function app.ops_metrics() from public;
grant execute on function app.ops_metrics() to viadent_app;
