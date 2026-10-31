/**
 * Basit Prometheus metrikleri (Görev 8, ADR-055): istek sayısı (yöntem × durum sınıfı), süre histogramı, havuz durumu,
 * çalışma süresi. Etiketlerde yol/kimlik/kişisel veri YOK (yüksek kardinalite ve sızıntı riski). Uç yalnız METRICS_TOKEN ile.
 */
const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const counts = new Map<string, number>();
const hist = BUCKETS.map(() => 0);
let histCount = 0, histSum = 0;
const started = Date.now();

export function observe(method: string, status: number, seconds: number) {
  const k = `${method}|${Math.floor(status / 100)}xx`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
  histCount++; histSum += seconds;
  BUCKETS.forEach((b, i) => { if (seconds <= b) hist[i]!++; });
}

export interface OpsRow { metric: string; label: string; value: string | number }
/** İşletim uyarı metrikleri (ADR-068): app.ops_metrics() satırları Prometheus gauge'larına çevrilir. Etiket yalnız durum/sebep. */
const OPS_HELP: Record<string, string> = {
  outbox_events: "İç iş kuyruğu (pending/processing/dead)",
  outbox_oldest_pending_seconds: "En eski bekleyen iç işin yaşı (sn) — worker durdu mu?",
  integration_jobs: "Dış iş kuyruğu (held/queued/sending/unknown/dead)",
  integration_jobs_pending_approval: "Dört göz onayı bekleyen dış iş",
  webhook_rejections_1h: "Son 1 saatte reddedilen webhook (sebep)",
  auth_locked_keys: "Giriş kilidi etkin anahtar (e-posta+IP / hesap)",
  file_assets: "Karantinada/reddedilmiş, imha edilmemiş dosya",
  file_assets_purge_due: "İmha süresi 15 günden fazla geçmiş silinmiş dosya — imha işi çalışmıyor",
  import_batches_pending: "7 günden eski onaylanmamış içe aktarma ön kontrolü",
  memberships_support_active: "Etkin destek erişimi",
};
export function renderOps(rows: OpsRow[]): string {
  const L: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const name = `viadent_${r.metric.replace(/[^a-z0-9_]/g, "")}`;
    if (!seen.has(name)) { seen.add(name); L.push(`# HELP ${name} ${OPS_HELP[r.metric] ?? ""}`, `# TYPE ${name} gauge`); }
    const label = r.label ? `{state="${String(r.label).replace(/[^\w-]/g, "")}"}` : "";
    L.push(`${name}${label} ${Number(r.value)}`);
  }
  return L.length ? `${L.join("\n")}\n` : "";
}

export function render(pool: { totalCount: number; idleCount: number; waitingCount: number }, version: string, ops: OpsRow[] = []): string {
  const L: string[] = [];
  L.push("# HELP viadent_http_requests_total HTTP istekleri", "# TYPE viadent_http_requests_total counter");
  for (const [k, v] of counts) { const [m, c] = k.split("|"); L.push(`viadent_http_requests_total{method="${m}",status="${c}"} ${v}`); }
  L.push("# HELP viadent_http_request_duration_seconds İstek süresi", "# TYPE viadent_http_request_duration_seconds histogram");
  BUCKETS.forEach((b, i) => L.push(`viadent_http_request_duration_seconds_bucket{le="${b}"} ${hist[i]}`));
  L.push(`viadent_http_request_duration_seconds_bucket{le="+Inf"} ${histCount}`, `viadent_http_request_duration_seconds_sum ${histSum.toFixed(6)}`,
    `viadent_http_request_duration_seconds_count ${histCount}`);
  L.push("# TYPE viadent_db_pool_connections gauge", `viadent_db_pool_connections{state="total"} ${pool.totalCount}`,
    `viadent_db_pool_connections{state="idle"} ${pool.idleCount}`, `viadent_db_pool_connections{state="waiting"} ${pool.waitingCount}`);
  L.push("# TYPE viadent_uptime_seconds gauge", `viadent_uptime_seconds ${Math.round((Date.now() - started) / 1000)}`);
  L.push("# TYPE viadent_build_info gauge", `viadent_build_info{version="${version.replace(/[^\w.-]/g, "")}"} 1`);
  return `${L.join("\n")}\n${renderOps(ops)}`;
}
