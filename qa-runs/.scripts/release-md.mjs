// results.json + plan.json + gate kararından release.md üretir. Kullanım: node qa-runs/.scripts/release-md.mjs qa-runs/<id> "<karar>"
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [dir, decision] = process.argv.slice(2);
const r = JSON.parse(readFileSync(`${dir}/results.json`, "utf8"));
const plan = JSON.parse(readFileSync(`${dir}/plan.json`, "utf8"));
const envText = readFileSync(`${dir}/environment.md`, "utf8");
const lastEnv = envText.lastIndexOf("\n## Tur ");
const env = (lastEnv >= 0 ? envText.slice(lastEnv) : envText).split("\n").filter((l) => l.startsWith("- ")).slice(0, 6).join("\n");
const st = (s) => ({ PASS: "✅ PASS", FAIL: "❌ FAIL", FLAKY: "⚠️ FLAKY", BLOCKED: "⛔ BLOCKED", NOT_RUN: "⏸ NOT_RUN", NA: "— NA" }[s] ?? s);
const rounds = Array.from({ length: 12 }, (_, i) => `tur${i + 1}`).filter((t) => existsSync(`${dir}/results-${t}.json`)).map((t) => JSON.parse(readFileSync(`${dir}/results-${t}.json`, "utf8")));
const md = `# Sürüm raporu — ${r.runId}

**Karar: ${decision}** · Sürüm: \`${r.revision}\` · ${new Date(r.at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · Tur ${r.round}
Kapı: \`node qa/cezeri/gate.cjs ${dir}/results.json ${dir}/plan.json ${r.revision}\`

> Bu rapor yalnız **sentetik demo verisiyle, yerel test ortamında** çalıştırılan testleri kapsar. Gerçek klinik verisi, gerçek sağlayıcı (SMS/ödeme/e-Nabız/e-Fatura), fiziksel cihaz ve insan kabulü kapsam dışıdır. "Satışa hazır", "tam uyumlu", "Bakanlık onaylı" iddiası yoktur (bkz. docs/release-gates.md).

## Ortam
${env}

## Zorunlu vakalar (${plan.requiredIds.length})
| ID | Durum | Profil | Özet | Kanıt |
|---|---|---|---|---|
${r.cases.map((c) => `| ${c.id} | ${st(c.status)} | ${(c.profiles ?? []).join(", ")} | ${(c.summary ?? "").replace(/\|/g, "/")} | ${[c.evidence, ...(c.extraEvidence ?? [])].filter(Boolean).map((e) => `\`${e}\``).join(", ")} |`).join("\n")}

## Profiller
| Profil | Durum | Kanıt / gerekçe |
|---|---|---|
${r.profiles.map((p) => `| ${p.name} | ${st(p.status)} | ${p.evidence ? `\`${p.evidence}\`` : p.reason ?? ""} |`).join("\n")}

## Bulgular
| ID | Önem | Durum | Başlık | Kanıt | Yeniden test |
|---|---|---|---|---|---|
${r.bugs.map((b) => `| ${b.id} | ${b.severity} | ${b.state} | ${b.title} | \`${b.evidence}\` | ${b.retestEvidence ? `\`${b.retestEvidence}\`` : "—"} |`).join("\n")}

## Turlar
${rounds.map((x) => `- **Tur ${x.round}** (\`${x.revision.slice(0, 7)}\`): ${x.cases.filter((c) => c.status === "PASS").length} PASS / ${x.cases.filter((c) => c.status === "FAIL").length} FAIL / ${x.cases.filter((c) => c.status === "FLAKY").length} FLAKY / ${x.cases.filter((c) => c.status === "NOT_RUN").length} NOT_RUN · açık bulgu: ${x.bugs.filter((b) => b.state !== "VERIFIED").map((b) => `${b.id}(${b.severity})`).join(", ") || "yok"}`).join("\n")}

## Kapsam, denenmeyen kombinasyonlar, engeller
- Envanter: \`inventory.md\` (32 controller / 229 uç, 6 rol, 2 tenant). Rol × ekran kombinasyonlarının tamamı değil, risk temelli seçim: tenant sınırı (V01), sağlık yetkisi sınırı (V05, N05, N11, P03), finans yazma sınırı (P01, P03, N01–N03). Diğer rol × uç kombinasyonları API test paketinde (R01).\n- Yeni kapsam (N01–N11): makbuz, fatura taslağı + MOCK e-belge, mali müşavir dökümü, anamnez şablonu, klinik çıktı belgeleri ve komşu yüzeyleri (dışa aktarım, onam raporu, dosyalar, geçmiş, kanıt, karantina görevi, hazırlık kuralı), görünüm, SLA yükseltme, XLSX, mobil kart, sarf reçetesi. Tester sondaları: \`qa-runs/.scripts/*-probe.mjs\`.
- Parametre kapsamı: tahsilat tutarı 14 değer + dağıtım/anahtar kuralları (P01); randevu 28 deneme — tarih/saat/süre sınırları, 8 durum geçişi, iyimser kilit, 7 filtre (P02). Denenmeyen: Unicode normalizasyon uç durumları form alanlarında (ad/soyad Türkçe İ/ı aramaları R01'de var), çok para birimi (ürün yalnız TRY).
- Eşzamanlılık: randevu yarışı 2 oturum (V03), aynı idempotency anahtarı 2 eşzamanlı + 1 sıralı (V04). Denenmeyen: >2 eşzamanlı yazar, ağ kesintisi simülasyonu (worker retry/backoff R01'de birim düzeyinde).
- Performans: bu koşuda ölçülmedi (eşik tanımlı değil); önceki ölçümler \`docs/performance.md\` (100k hasta / 1M randevu, p95 ≤ 300 ms raporlar) — bu sürümde yeniden ölçülmedi, karar için kullanılmadı.
- Erişilebilirlik: axe WCAG 2.1 A/AA otomatik (R04); ekran okuyucuyla elle test **yok**.
- Fiziksel mobil cihaz, iOS/Android, VS Code: NA (web ürünü; cihaz yok). Pilot klinikte gerçek telefonla doğrulama **insan** adımı.
- Dış servisler yalnız MOCK; gerçek sağlayıcı sözleşmesi/test ortamı yok (🔒 docs/release-gates.md §3).

## Nihai insan onayı (gerekli)
Bu karar teknik teslim adaylığı içindir. Klinik kabulü (UAT imzası), KVKK/hukuk, mali müşavir, barındırma ve bağımsız sızma testi kapıları açık (docs/release-gates.md). Teslim kararı ürün sahibinindir.
`;
writeFileSync(`${dir}/release.md`, md);
console.log("release.md yazıldı:", decision);
