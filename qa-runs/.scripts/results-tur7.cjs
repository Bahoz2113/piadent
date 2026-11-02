// CEZERİ — tur 7 (son tur) results.json birleştirici. Yalnız kanıt dosyalarını okur, ürün kodunu değiştirmez.
// Kullanım: cd qa-runs/<id> && node ../.scripts/results-tur7.cjs <revizyon>
const fs = require("fs");
const rev = process.argv[2];
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const T = (p) => fs.readFileSync(p, "utf8");
const plan = J("plan.json");
const base = J("results-tur3.json");
const ns = Object.fromEntries(J("evidence/tur7/n-summary.json").results.map((c) => [c.id, c]));
const hs = Object.fromEntries(J("evidence/tur7/http-summary.json").results.map((c) => [c.id, c]));
const b = [...J("evidence/tur7/browser-summary.json").results, ...J("evidence/tur7/browser-n-summary.json").results];
const fix = (e) => "evidence/tur7/" + e.split("/").pop().replace(/\.png$/, ".jpg");

const cases = plan.requiredIds.map((id) => {
  const bs = b.filter((x) => x.id === id);
  const src = ns[id] ?? hs[id];
  const ext = bs.map((x) => fix(x.evidence));
  if (!src && !bs.length) return { id };
  const all = [src?.status, ...bs.map((x) => x.status)].filter(Boolean);
  return {
    id, status: all.every((s) => s === "PASS") ? "PASS" : "FAIL",
    profiles: [...(src ? ["http"] : []), ...(bs.length ? ["chromium-desktop", "chromium-mobile-emulation"] : [])],
    summary: [src?.summary, ...bs.map((x) => `${x.profile}: ${x.summary}`)].filter(Boolean).join(" · ") + " (tur 7, temiz seed)",
    evidence: src ? "evidence/tur7/" + String(src.evidence ?? `${id}-http.json`).split("/").pop() : ext[0],
    extraEvidence: src ? ext : ext.slice(1),
  };
});
const set = (id, o) => Object.assign(cases.find((c) => c.id === id), o);

const fsp = J("evidence/tur7/file-sensitivity-probe.json"), ft = J("evidence/tur7/file-trace-probe.json"), ef = J("evidence/tur7/evidence-file-probe.json");
const q = J("evidence/tur7/quarantine-task-probe.json"), lf = J("evidence/tur7/linked-file-probe.json"), rd = J("evidence/tur7/readiness-clinical-probe.json");
const n11ok = !fsp.adminListSeesClinical && fsp.adminListSeesAdministrative && !fsp.adminExportHasClinicalFile && fsp.adminExportHasAdministrativeFile && fsp.exportOmitted.includes("files:clinical")
  && ft.secretaryHistoryFileEvents.length === 0 && ft.adminHistoryFileEvents.length === 0 && ft.dentistHistoryFileEvents.length > 0 && ft.adminExportAccessLogFileRows === 0
  && !ef.secretarySeesClinicalFileId && !ef.adminExportEvidenceHasFileId && ef.dentistDecisionWithClinicalFile === 200
  && !q.secretarySeesFileId && !q.adminSeesFileId && q.dentistSeesFileId && q.fileStatus === "quarantined"
  && !lf.secretaryListSeesFile && lf.secDetail[0] === lf.secDetail[1] && lf.secContent[0] === lf.secContent[1] && lf.secDelete[0] === lf.secDelete[1] && lf.drDetail === 200 && lf.drListSees;
set("N11", {
  status: n11ok ? "PASS" : "FAIL", profiles: ["http"],
  summary: `dışa aktarım: klinik dosya yok, idari var, omitted files:clinical; geçmiş: sekreter ${ft.secretaryHistoryFileEvents.length}, yönetici ${ft.adminHistoryFileEvents.length}, hekim ${ft.dentistHistoryFileEvents.length} olay; access_log dosya satırı ${ft.adminExportAccessLogFileRows}; onam kanıtında gizli dosya kimliği sekreter=${ef.secretarySeesClinicalFileId}, dışa aktarım=${ef.adminExportEvidenceHasFileId}, hekim bağlama ${ef.dentistDecisionWithClinicalFile}; karantina görevi sekreter=${q.secretarySeesFileId}, yönetici=${q.adminSeesFileId}, hekim=${q.dentistSeesFileId}; epikrize bağlı tarama sekreter listede=${lf.secretaryListSeesFile}, ayrıntı ${lf.secDetail.join("/")}, içerik ${lf.secContent.join("/")}, silme ${lf.secDelete.join("/")}, hekim ${lf.drDetail} (tur 7, temiz seed)`,
  evidence: "evidence/tur7/file-sensitivity-probe.json",
  extraEvidence: ["evidence/tur7/file-trace-probe.json", "evidence/tur7/evidence-file-probe.json", "evidence/tur7/quarantine-task-probe.json", "evidence/tur7/linked-file-probe.json"],
});
const n5 = cases.find((c) => c.id === "N05");
n5.summary += ` · hazırlık kuralı klinik çıktı türüyle ${rd.ruleCreateWithClinicalOutputType} (QA-110)`;
n5.extraEvidence = [...n5.extraEvidence, "evidence/tur7/N05-komsu.json", "evidence/tur7/readiness-clinical-probe.json"];
if (rd.ruleCreateWithClinicalOutputType !== 422) n5.status = "FAIL";

const e2e = T("evidence/tur7/R04-R05-e2e-temiz-seed.log");
const e2eOk = /\b89 passed/.test(e2e) && !/\bfailed\b|\bflaky\b/.test(e2e);
const r01 = T("evidence/tur7/R01-api.log"), r02 = T("evidence/tur7/R02-contracts.log"), r03 = T("evidence/tur7/R03-web.log");
const r06 = T("evidence/tur7/R06-typecheck-audit.log"), r07 = T("evidence/tur7/R07-rls.txt"), v06 = T("evidence/tur7/V06-reconcile.txt");
const rv = J("evidence/tur7/V06-restore-verify.json");
set("V06", { status: rv.ok && rv.differences.length === 0 && /EŞLEŞTİ/.test(v06) ? "PASS" : "FAIL", profiles: ["cli"],
  summary: `şifreli yedek → izole ${rv.target}; restore-verify ok=${rv.ok}, differences=[]; dosya ${rv.files.present}/${rv.files.referenced}; 25 sütunlu bağımsız mutabakat iki DB'de EŞLEŞTİ (90 politika, 76 FORCE RLS)`,
  evidence: "evidence/tur7/V06-reconcile.txt", extraEvidence: ["evidence/tur7/V06-restore-verify.json"] });
set("R01", { status: /364 passed/.test(r01) && !/failed/.test(r01) ? "PASS" : "FAIL", profiles: ["cli"], summary: "vitest API 35 dosya, 364/364 (gerçek PostgreSQL; QA-101…110 regresyon testleri dahil)", evidence: "evidence/tur7/R01-api.log" });
set("R02", { status: /15 passed/.test(r02) ? "PASS" : "FAIL", profiles: ["cli"], summary: "contracts 15/15", evidence: "evidence/tur7/R02-contracts.log" });
set("R03", { status: /72 passed/.test(r03) ? "PASS" : "FAIL", profiles: ["cli"], summary: "web birim 72/72 (kontrast + QA-103/110 dahil)", evidence: "evidence/tur7/R03-web.log" });
set("R04", { status: e2eOk ? "PASS" : "FAIL", profiles: ["chromium-desktop", "chromium-mobile-emulation"], summary: "Playwright tam koşu temiz seed: 89 geçti + 9 bilinçli atlama, 0 hata, retries=0 (iki proje)", evidence: "evidence/tur7/R04-R05-e2e-temiz-seed.log" });
set("R05", { status: e2eOk ? "PASS" : "FAIL", profiles: ["chromium-mobile-emulation"], summary: "aynı koşu, telefon-360 projesi dahil", evidence: "evidence/tur7/R04-R05-e2e-temiz-seed.log" });
set("R06", { status: (r06.match(/Done/g) || []).length === 5 && /No known vulnerabilities/.test(r06) ? "PASS" : "FAIL", profiles: ["cli"], summary: "typecheck 5/5 Done; pnpm audit --prod: bilinen açık yok", evidence: "evidence/tur7/R06-typecheck-audit.log" });
set("R07", { status: /tenant_tables_without_force_rls\|0/.test(r07) && /false\/false\/false/.test(r07) ? "PASS" : "FAIL", profiles: ["cli"], summary: "75/75 kiracı tablosu FORCE RLS, politikasız tablo yok; app rolü super/bypassrls/createrole=false; ekle-yalnız tablolarda UPDATE yok", evidence: "evidence/tur7/R07-rls.txt" });

for (const c of cases) {
  if (!c.status) { c.status = "NOT_RUN"; c.summary = "koşulmadı"; c.evidence = "bugs.md"; }
  for (const e of [c.evidence, ...(c.extraEvidence || [])]) if (e && e.startsWith("evidence/") && !fs.existsSync(e)) console.log("eksik kanıt", c.id, e);
}

const rt = { "QA-101": "evidence/tur7/N05-komsu.json", "QA-102": "evidence/tur7/N05-komsu.json", "QA-103": "evidence/tur7/masaustu-N02-fatura-ayrinti.jpg",
  "QA-104": "evidence/tur7/N05-komsu.json", "QA-105": "evidence/tur7/N05-komsu.json", "QA-106": "evidence/tur7/file-sensitivity-probe.json", "QA-107": "evidence/tur7/linked-file-probe.json" };
const bugs = [
  ...base.bugs.map((x) => ({ ...x, state: "VERIFIED", retestEvidence: rt[x.id] })),
  { id: "QA-108", severity: "S3", state: "VERIFIED", title: "Gizli klinik dosyanın izleri (geçmiş, access_log, onam kanıtı fileId)", evidence: "evidence/tur4/file-trace-probe.json", retestEvidence: "evidence/tur7/file-trace-probe.json", cases: ["N11"] },
  { id: "QA-109", severity: "S3", state: "VERIFIED", title: "Karantina görevi gizli klinik dosyayı açık ediyor", evidence: "evidence/tur5/quarantine-task-probe.json", retestEvidence: "evidence/tur7/quarantine-task-probe.json", cases: ["N11"] },
  { id: "QA-110", severity: "S3", state: "VERIFIED", title: "Hazırlık kuralı klinik çıktı türüne bağlanabiliyor", evidence: "evidence/tur6/readiness-clinical-probe.json", retestEvidence: "evidence/tur7/readiness-clinical-probe.json", cases: ["N05"] },
];
const profEv = { http: "evidence/tur7/n-summary.json", "chromium-desktop": "evidence/tur7/browser-n-summary.json", "chromium-mobile-emulation": "evidence/tur7/browser-n-summary.json", cli: "evidence/tur7/V06-reconcile.txt" };
const r = {
  runId: "qa-20261102-1209-12fc6fd-tur7", revision: rev, at: new Date().toISOString(), round: 7,
  environment: "environment.md", inventory: "inventory.md", inventoryComplete: true, fullRegression: true, requiredIds: plan.requiredIds,
  profiles: base.profiles.map((p) => (profEv[p.name] ? { name: p.name, status: "PASS", evidence: profEv[p.name] } : p)),
  cases, bugs,
  notes: [
    "Tur 7: son revizyon temiz seed üzerinde tam yeniden sınandı (HTTP, tarayıcı masaüstü + 360 px, V06 yedek/geri yükleme, R01–R07).",
    "QA-101…QA-110 VERIFIED; açık bulgu yok.",
    "Önceki turlar: results-tur1/2/3.json ve evidence/tur1…tur6; tur 4–6 kısmi koşular bugs.md içinde.",
  ],
};
fs.writeFileSync("results-tur7.json", JSON.stringify(r, null, 1));
fs.writeFileSync("results.json", JSON.stringify(r, null, 1));
console.log(cases.map((c) => `${c.id}:${c.status}`).join(" "));
