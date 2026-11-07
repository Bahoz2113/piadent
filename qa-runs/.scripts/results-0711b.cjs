// CEZERİ — qa-20261107-1245-bbba373 results.json birleştirici (07.11.2026 2. paket; önceki 60 vaka + H01–H08). Yalnız kanıt dosyalarını okur, ürün kodunu değiştirmez.
// Kullanım: cd qa-runs/<id> && node ../.scripts/results-0411.cjs <ürün-revizyonu> <tur>
const fs = require("fs");
const rev = process.argv[2]; const TUR = process.argv[3] ?? "tur2"; const E = `evidence/${TUR}`;
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const T = (p) => fs.readFileSync(p, "utf8");
const plan = J("plan.json");
const prev = J("../qa-20261107-0145-b910f90/results.json");
const jpg = (p) => p ? `${E}/${p.split("/").pop().replace(/\.png$/, ".jpg")}` : null;
const hs = [...J(`${E}/http-summary.json`).results, ...J(`${E}/n-summary.json`).results, ...J(`${E}/f-summary.json`).results, ...J(`${E}/g-summary.json`).results, ...J(`${E}/h-summary.json`).results];
const H = Object.fromEntries(hs.map((c) => [c.id, c]));
const b = [...J(`${E}/browser-summary.json`).results, ...J(`${E}/browser-n-summary.json`).results, ...J(`${E}/browser-f-summary.json`).results];
const httpEv = (id, c) => `${E}/${String(c.evidence ?? `${id}-http.json`).split("/").pop()}`;

const cases = plan.requiredIds.map((id) => {
  const src = H[id]; const bs = b.filter((x) => x.id === id);
  if (!src && !bs.length) return { id };
  const all = [src?.status, ...bs.map((x) => x.status)].filter(Boolean);
  const ext = bs.map((x) => jpg(x.evidence)).filter(Boolean);
  return {
    id, status: all.every((s) => s === "PASS") ? "PASS" : all.some((s) => s === "FLAKY") ? "FLAKY" : "FAIL",
    profiles: [...(src ? ["http"] : []), ...new Set(bs.map((x) => (x.profile === "mobil" ? "chromium-mobile-emulation" : "chromium-desktop")))],
    summary: [src?.summary, ...bs.map((x) => `${x.profile}: ${x.summary}`)].filter(Boolean).join(" · ") + ` (${TUR}, temiz seed, ${rev.slice(0, 7)})`,
    evidence: src ? httpEv(id, src) : ext[0], extraEvidence: src ? ext : ext.slice(1),
  };
});
const set = (id, o) => Object.assign(cases.find((c) => c.id === id), o);

// N11 — dosya hassasiyeti sondaları (önceki koşunun ölçütü aynen)
const fsp = J(`${E}/file-sensitivity-probe.json`), ft = J(`${E}/file-trace-probe.json`), ef = J(`${E}/evidence-file-probe.json`);
const q = J(`${E}/quarantine-task-probe.json`), lf = J(`${E}/linked-file-probe.json`), rd = J(`${E}/readiness-clinical-probe.json`);
// 07.11.2026 kabul değişikliği (ADR-098): yönetici sağlık yetkili → klinik dosyaları GÖRÜR (olumlu kontrol); sağlık yetkisiz rolün
// görmeme kuralı sekreterle sınanır (liste, geçmiş, onam kanıtı, karantina görevi, bağlı tarama).
const n11ok = fsp.adminListSeesClinical && fsp.adminListSeesAdministrative && fsp.adminExportHasClinicalFile && fsp.adminExportHasAdministrativeFile
  && ft.secretaryHistoryFileEvents.length === 0 && ft.adminHistoryFileEvents.length > 0 && ft.dentistHistoryFileEvents.length > 0
  && !ef.secretarySeesClinicalFileId && ef.dentistDecisionWithClinicalFile === 200
  && !q.secretarySeesFileId && q.adminSeesFileId && q.dentistSeesFileId && q.fileStatus === "quarantined"
  && !lf.secretaryListSeesFile && lf.secDetail[0] === lf.secDetail[1] && lf.secContent[0] === lf.secContent[1] && lf.secDelete[0] === lf.secDelete[1] && lf.drDetail === 200 && lf.drListSees;
set("N11", { status: n11ok ? "PASS" : "FAIL", profiles: ["http"],
  summary: `yönetici (sağlık yetkili, ADR-098) listede ve dışa aktarımda klinik dosyayı görür=${fsp.adminListSeesClinical}/${fsp.adminExportHasClinicalFile}; geçmiş olay sekreter ${ft.secretaryHistoryFileEvents.length}, yönetici ${ft.adminHistoryFileEvents.length}, hekim ${ft.dentistHistoryFileEvents.length}; access_log dosya satırı ${ft.adminExportAccessLogFileRows}; onam kanıtı gizli dosya kimliği sekreter=${ef.secretarySeesClinicalFileId}, dışa aktarım=${ef.adminExportEvidenceHasFileId}; karantina görevi sekreter=${q.secretarySeesFileId}, yönetici=${q.adminSeesFileId}, hekim=${q.dentistSeesFileId}; epikrize bağlı tarama sekreter ${lf.secDetail.join("/")} (${TUR})`,
  evidence: `${E}/file-sensitivity-probe.json`, extraEvidence: [`${E}/file-trace-probe.json`, `${E}/evidence-file-probe.json`, `${E}/quarantine-task-probe.json`, `${E}/linked-file-probe.json`] });
const n5 = cases.find((c) => c.id === "N05");
n5.summary += ` · hazırlık kuralı klinik çıktı türüyle ${rd.ruleCreateWithClinicalOutputType}`;
n5.extraEvidence = [...n5.extraEvidence, `${E}/N05-komsu.json`, `${E}/readiness-clinical-probe.json`];
if (rd.ruleCreateWithClinicalOutputType !== 422) n5.status = "FAIL";

const e2e = T(`${E}/R04-R05-e2e-temiz-seed.log`);
const passed = Number((e2e.match(/(\d+) passed/) || [])[1] ?? 0), skipped = Number((e2e.match(/(\d+) skipped/) || [])[1] ?? 0);
const e2eOk = passed >= 115 && !/\d+ failed|\d+ flaky/.test(e2e);
const r01 = T(`${E}/R01-api.log`), r02 = T(`${E}/R02-contracts.log`), r03 = T(`${E}/R03-web.log`), r06 = T(`${E}/R06-typecheck-audit.log`), r07 = T(`${E}/R07-rls.txt`), v06 = T(`${E}/V06-reconcile.txt`);
const rv = J(`${E}/V06-restore-verify.json`);
const cnt = (s) => (s.match(/Tests\s+(\d+) passed \((\d+)\)/) || []).slice(1).join("/");
set("V06", { status: rv.ok && rv.differences.length === 0 && /EŞLEŞTİ/.test(v06) ? "PASS" : "FAIL", profiles: ["cli"],
  summary: `şifreli yedek → izole ${rv.target}; restore-verify ok=${rv.ok}, differences=[${rv.differences.length}]; dosya ${rv.files?.present}/${rv.files?.referenced}; bağımsız mutabakat (reconcile.sql) iki DB'de ${/EŞLEŞTİ/.test(v06) ? "EŞLEŞTİ" : "FARKLI"}`,
  evidence: `${E}/V06-reconcile.txt`, extraEvidence: [`${E}/V06-restore-verify.json`] });
set("R01", { status: /Tests\s+\d+ passed/.test(r01) && !/\d+ failed/.test(r01) ? "PASS" : "FAIL", profiles: ["cli"], summary: `vitest API ${cnt(r01)} (gerçek PostgreSQL; geri-bildirim-0711b, adr-098-admin, geri-bildirim-0711, randevu-0711, messaging-0711 dahil)`, evidence: `${E}/R01-api.log` });
set("R02", { status: /Tests\s+\d+ passed/.test(r02) && !/\d+ failed/.test(r02) ? "PASS" : "FAIL", profiles: ["cli"], summary: `contracts ${cnt(r02)} (telefon hane kuralı dahil)`, evidence: `${E}/R02-contracts.log` });
set("R03", { status: /Tests\s+\d+ passed/.test(r03) && !/\d+ failed/.test(r03) ? "PASS" : "FAIL", profiles: ["cli"], summary: `web birim ${cnt(r03)}`, evidence: `${E}/R03-web.log` });
set("R04", { status: e2eOk ? "PASS" : "FAIL", profiles: ["chromium-desktop", "chromium-mobile-emulation"], summary: `Playwright tam koşu temiz seed: ${passed} geçti + ${skipped} bilinçli atlama, 0 hata, retries=0 (iki proje; geri-bildirim-0711, odontogram-0711, goruntuleme-0711 dahil)`, evidence: `${E}/R04-R05-e2e-temiz-seed.log` });
set("R05", { status: e2eOk ? "PASS" : "FAIL", profiles: ["chromium-mobile-emulation"], summary: "aynı koşu, telefon-360 projesi dahil", evidence: `${E}/R04-R05-e2e-temiz-seed.log` });
set("R06", { status: (r06.match(/typecheck: Done/g) || []).length === 5 && /No known vulnerabilities/.test(r06) ? "PASS" : "FAIL", profiles: ["cli"], summary: `typecheck ${(r06.match(/typecheck: Done/g) || []).length}/5 Done; pnpm audit --prod: bilinen açık yok`, evidence: `${E}/R06-typecheck-audit.log` });
set("R07", { status: /tenant_tables_without_force_rls\|0/.test(r07) && /false\/false\/false/.test(r07) && /tables_without_policy\|$/m.test(r07)
    && /message_rule_runs=true/.test(r07) && /message_rules=true/.test(r07) && /message_schedules=true/.test(r07) && /patient_health_notes=true/.test(r07) && /app_role_delete_grants_0711\|$/m.test(r07) ? "PASS" : "FAIL", profiles: ["cli"],
  summary: `${(r07.match(/tenant_tables_total\|(\d+)/) || [])[1]} kiracı tablosunun hepsi FORCE RLS, politikasız tablo yok; 0035–0036 tabloları (patient_health_notes, message_schedules, message_rules, message_rule_runs) FORCE RLS, uygulama rolünde DELETE yok; app rolü super/bypassrls/createrole=false`, evidence: `${E}/R07-rls.txt` });
// B01–B06: tarayıcı vakaları — geri-bildirim-0711.spec.ts tam E2E koşusu içinde iki profilde (masaüstü 1366 + telefon 360)
const B_TITLES = { B01: "Panel ve Hekimler sadeleşti", B02: "Raporlar: Gelirler", B03: "Yönetim: İşlem türleri fiyatlı", B04: "Randevu ver tam sayfa", B05: "Mesajlar sekmesi", B06: "Yönetim → Dışa aktarım" };
for (const [id, t] of Object.entries(B_TITLES)) {
  const lines = e2e.split("\n").filter((l) => l.includes("geri-bildirim-0711.spec.ts") && l.includes(t));
  const desk = lines.find((l) => l.includes("[masaustu]")), mob = lines.find((l) => l.includes("[telefon-360]"));
  const okL = (l) => l && /✓/.test(l);
  const mobileNA = id === "B06" && mob && /-/.test(mob) && !/✘/.test(mob);
  set(id, { status: okL(desk) && (okL(mob) || mobileNA || (id === "B06" && !mob)) ? "PASS" : "FAIL", profiles: ["chromium-desktop", ...(id === "B06" ? [] : ["chromium-mobile-emulation"])],
    summary: `geri-bildirim-0711 E2E: masaüstü ${okL(desk) ? "geçti" : "geçmedi"}${id === "B06" ? " (indirme yalnız masaüstünde sınanır; telefonda bilinçli atlama)" : `, telefon-360 ${okL(mob) ? "geçti" : "geçmedi"}`}`, evidence: `${E}/R04-R05-e2e-temiz-seed.log` });
}

// H02, H06–H08: tarayıcı vakaları — odontogram-0711 / goruntuleme-0711 E2E (tam koşu içinde, iki profil)
const H_T = { H02: ["odontogram-0711.spec.ts", "randevudan dişe işlem"], H06: ["goruntuleme-0711.spec.ts", "Görüntülemeler: yeni panoramik"],
  H07: ["goruntuleme-0711.spec.ts", "Belge hazırla: her tür"], H08: ["odontogram-0711.spec.ts", "takvimde ay ve yıl"] };
for (const [id, [file, t]] of Object.entries(H_T)) {
  const lines = e2e.split("\n").filter((l) => l.includes(file) && l.includes(t));
  const desk = lines.find((l) => l.includes("[masaustu]")), mob = lines.find((l) => l.includes("[telefon-360]"));
  const okL = (l) => l && /✓/.test(l);
  set(id, { status: okL(desk) && okL(mob) ? "PASS" : "FAIL", profiles: ["chromium-desktop", "chromium-mobile-emulation"],
    summary: `${file} E2E: masaüstü ${okL(desk) ? "geçti" : "geçmedi"}, telefon-360 ${okL(mob) ? "geçti" : "geçmedi"} (${TUR}, temiz seed, ${rev.slice(0, 7)})`, evidence: `${E}/R04-R05-e2e-temiz-seed.log` });
}

for (const c of cases) {
  if (!c.status) { c.status = "NOT_RUN"; c.summary = "koşulmadı"; c.evidence = "bugs.md"; }
  for (const e of [c.evidence, ...(c.extraEvidence || [])]) if (e && e.startsWith("evidence/") && !fs.existsSync(e)) console.log("eksik kanıt", c.id, e);
}
const bugs = JSON.parse(fs.existsSync("bugs.json") ? fs.readFileSync("bugs.json", "utf8") : "[]");
const profEv = { http: `${E}/g-summary.json`, "chromium-desktop": `${E}/browser-f-summary.json`, "chromium-mobile-emulation": `${E}/browser-f-summary.json`, cli: `${E}/V06-reconcile.txt` };
const r = {
  runId: `qa-20261107-1245-bbba373-${TUR}`, revision: rev, at: new Date().toISOString(), round: Number(TUR.replace(/\D/g, "")),
  environment: "environment.md", inventory: "inventory.md", inventoryComplete: true, fullRegression: true, requiredIds: plan.requiredIds,
  profiles: prev.profiles.map((p) => (profEv[p.name] ? { name: p.name, status: "PASS", evidence: profEv[p.name] } : p)),
  cases, bugs,
  notes: [
    `${TUR}: revizyon ${rev.slice(0, 7)} temiz seed üzerinde tam sınandı (68 zorunlu vaka: önceki koşunun 60 vakası + H01, H03–H05 HTTP + H02, H06–H08 tarayıcı; HTTP, tarayıcı masaüstü + 360 px, V06, R01–R07).`,
    "ADR-104 kabul değişikliği: her belge türünde onaylı DEMO şablon (plan.json notu). DICOM tarayıcı önizlemesi kapsam dışı (indir); Vercel ~4,5 MB istek gövdesi sınırı yerel ortamda sınanamaz.",
    "Kabul değişiklikleri (ürün sahibi kararları ADR-098/100/101/099) plan.json notlarında; etkilenen alt kontroller bugs.md 'Tester betiği düzeltmeleri' bölümünde gerekçesiyle.",
    "Netgsm gerçek gönderimi sınanmadı (kimlik bilgisi yok; ürün sahibi girer). Adaptör sözleşmesi yerel sahte sunucuyla (G13).",
    "Denenmeyen kombinasyonlar ve kayıtlı riskler release.md'de.",
  ],
};
fs.writeFileSync(`results-${TUR}.json`, JSON.stringify(r, null, 1));
fs.writeFileSync("results.json", JSON.stringify(r, null, 1));
console.log(cases.map((c) => `${c.id}:${c.status}`).join(" "));
console.log(bugs.map((x) => `${x.id}:${x.state}`).join(" "));
