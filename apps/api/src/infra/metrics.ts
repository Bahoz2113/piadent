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

export function render(pool: { totalCount: number; idleCount: number; waitingCount: number }, version: string): string {
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
  return `${L.join("\n")}\n`;
}
