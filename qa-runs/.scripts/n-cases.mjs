// CEZERİ teslim testi — PİA-DENT yeni kapsam HTTP vakaları (N01–N08, N10). Ürün kodunu değiştirmez; yalnız sentetik demo verisi.
// DB okuma (doğrulama) ve test-kurulumu (geçmiş vadeli sentetik görev) yalnız yerel test DB'sinde, sahip rolüyle; üretime dokunulmaz.
// Kullanım: BASE=http://127.0.0.1:4000 PASSWORD=<güvenli ortam> OWNER_URL=<yerel> OUT=<evidence> node qa-runs/.scripts/n-cases.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const pg = require("pg");

const BASE = process.env.BASE ?? "http://127.0.0.1:4000";
const PASSWORD = process.env.PASSWORD; const OUT = process.env.OUT ?? "evidence"; const OWNER_URL = process.env.OWNER_URL;
if (!PASSWORD || !OWNER_URL) { console.error("PASSWORD ve OWNER_URL gerekli"); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const results = []; const findings = [];
const rec = (id, status, summary, data = {}) => { results.push({ id, status, summary, at: new Date().toISOString(), ...data }); console.log(`${status.padEnd(6)} ${id} ${summary}`); };
const SENS = /^(firstName|lastName|fullName|name|phone|email|nationalId|birthDate|buyerName|patientName|party|createdBy|issuedBy|by|recordedBy|reviewedBy|publishedBy|content)$/;
const mask = (v) => Array.isArray(v) ? v.map(mask) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENS.test(k) && typeof x === "string" ? `‹${k}:${x.length}›` : mask(x)])) : v;
const save = (name, obj) => writeFileSync(`${OUT}/${name}`, JSON.stringify(mask(obj), null, 1));

async function api(s, method, path, body, headers = {}) {
  const h = { "content-type": "application/json", "x-viadent-request": "1", ...headers };
  if (s?.cookie) h.cookie = s.cookie; if (s?.ctx) h["x-viadent-context"] = s.ctx;
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer()); const text = buf.toString("utf8");
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, buf, headers: Object.fromEntries(r.headers) };
}
async function login(email) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-viadent-request": "1" }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (r.status !== 200) throw new Error(`login ${r.status}`);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const s = await (await fetch(`${BASE}/api/v1/session`, { headers: { cookie } })).json();
  return { cookie, ctx: s.activeMembership.id, tenantId: s.activeMembership.tenantId, session: s };
}
const key = () => "qa-" + randomUUID();
async function ownerQ(tenantId, sql, params = []) {
  const c = new pg.Client({ connectionString: OWNER_URL }); await c.connect();
  try { await c.query("begin"); await c.query("select set_config('app.tenant_id',$1,true)", [tenantId]); const r = await c.query(sql, params); await c.query("commit"); return r.rows; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { await c.end(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seq = (no) => Number(String(no).split("-")[2]);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());

const [adm, dr, sec, asst, fin, bAdm] = await Promise.all(["yonetici@demo-yesil.test", "elif.aras@demo-yesil.test", "sekreter@demo-yesil.test", "asistan@demo-yesil.test", "finans@demo-yesil.test", "yonetici@demo-mavi.test"].map(login));
const A = adm.tenantId;
const cashId = (await api(fin, "GET", "/cash-accounts")).body.items.find((a) => a.kind === "cash").id;
const pracId = (await api(sec, "GET", "/resources")).body.practitioners[0].id;
const newPatient = async (first) => (await api(sec, "POST", "/patients", { firstName: first, lastName: "Sınama", birthDate: "1984-04-04" })).body.patient.id;
const pay = (s, p, amount, k = key()) => api(s, "POST", "/payments", { patientId: p, amount, method: "cash", cashAccountId: cashId, allocations: [] }, { "idempotency-key": k });

// ---------------------------------------------------------------- N01 makbuz
try {
  const p = await newPatient("Makbuz");
  const ev = {};
  const r1 = await pay(fin, p, "100.00");
  const [c1, c2] = await Promise.all([pay(fin, p, "11.00"), pay(sec, p, "12.00")]); // iki rol, iki oturum, eşzamanlı
  const k = key(); const i1 = await pay(fin, p, "13.00", k); const i2 = await pay(fin, p, "13.00", k);
  const bad = await api(fin, "POST", "/payments", { patientId: p, amount: "0", method: "cash", cashAccountId: cashId, allocations: [] }, { "idempotency-key": key() });
  const after = await pay(fin, p, "14.00");
  const refund = await api(fin, "POST", `/payments/${r1.body.id}/refunds`, { amount: "40.00", method: "cash", cashAccountId: cashId, reason: "Sınama iadesi" }, { "idempotency-key": key() });
  const print = await api(fin, "POST", `/receipts/${r1.body.receiptId}/print`, {});
  const audit = await ownerQ(A, "select action, changes from audit_events where entity_type='receipt' and entity_id=$1", [r1.body.receiptId]);
  const asst403 = (await api(asst, "GET", `/receipts/${r1.body.receiptId}`)).status;
  const b404 = (await api(bAdm, "GET", `/receipts/${r1.body.receiptId}`)).status;
  const rr = (await api(fin, "GET", `/receipts/${refund.body.receiptId}`)).body;
  const immut = await ownerQ(A, "update receipts set amount = 1 where id = $1", [r1.body.receiptId]).then(() => "değişti", (e) => e.message);
  const nos = [r1, c1, c2, i1, after].map((x) => x.body.receiptNo);
  const seqs = [seq(r1.body.receiptNo), seq(c1.body.receiptNo), seq(c2.body.receiptNo), seq(i1.body.receiptNo), seq(after.body.receiptNo)];
  const concurrentOk = c1.status === 201 && c2.status === 201 && Math.abs(seq(c1.body.receiptNo) - seq(c2.body.receiptNo)) === 1;
  const gapless = seqs[3] === Math.max(seqs[1], seqs[2]) + 1 && seqs[4] === seqs[3] + 1; // replay ve 422 numara tüketmedi
  const ok = nos.every((n) => /^TM-\d{4}-\d{6}$/.test(n)) && concurrentOk && i2.headers["idempotent-replayed"] === "true" && i2.body.receiptNo === i1.body.receiptNo
    && bad.status === 422 && gapless && /^IM-/.test(refund.body.receiptNo) && rr.payment?.receiptNo === r1.body.receiptNo && /fatura/.test(rr.notice)
    && print.status === 200 && audit.length === 1 && audit[0].action === "receipt.print" && asst403 === 403 && b404 === 404 && /receipt_immutable/.test(immut);
  Object.assign(ev, { nos, seqs, concurrent: [c1.status, c2.status], replay: i2.headers["idempotent-replayed"], badStatus: bad.status, refundNo: refund.body.receiptNo, refundRef: rr.payment?.receiptNo, notice: rr.notice, print: print.status, audit: audit.map((a) => a.action), asst403, b404, immut });
  save("N01-http.json", ev);
  rec("N01", ok ? "PASS" : "FAIL", `TM ardışık ${seqs.join(",")}; eşzamanlı 2 oturum ${c1.status}/${c2.status} farklı no; replay aynı no; 422 numara tüketmedi=${gapless}; iade ${refund.body.receiptNo}; yazdırma denetimi ${audit.length}; asistan ${asst403}, B ${b404}; değişmezlik=${/receipt_immutable/.test(immut)}`, { evidence: "N01-http.json" });
} catch (e) { rec("N01", "FAIL", `istisna: ${e.message}`); }

// ---------------------------------------------------------------- N02 fatura taslağı + MOCK e-belge
let invPatient;
try {
  const p = invPatient = await newPatient("Fatura");
  const base = (x = {}) => ({ patientId: p, docType: "e_arsiv", buyerType: "individual", buyerName: "Şükrü Çağlayan İğdır", lines: [{ description: "Dolgu", quantity: 1, unitPrice: "333.33", vatRate: 10 }], ...x });
  const L = (o) => ({ description: "Satır", quantity: 1, unitPrice: "10.00", vatRate: 10, ...o });
  const matrix = [
    ["VKN 9 hane", base({ buyerType: "company", docType: "e_fatura", buyerTaxNo: "123456789" }), 422],
    ["VKN 11 hane", base({ buyerType: "company", docType: "e_fatura", buyerTaxNo: "12345678901" }), 422],
    ["VKN harf", base({ buyerType: "company", docType: "e_fatura", buyerTaxNo: "12345A7890" }), 422],
    ["kurum VKN yok", base({ buyerType: "company", docType: "e_fatura" }), 422],
    ["kurum e-Arşiv", base({ buyerType: "company", docType: "e_arsiv", buyerTaxNo: "1234567890" }), 422],
    ["şahıs e-Fatura", base({ docType: "e_fatura" }), 422],
    ["belge türü bilinmeyen", base({ docType: "irsaliye" }), 422],
    ["KDV %18", base({ lines: [L({ vatRate: 18 })] }), 422],
    ["KDV metin", base({ lines: [L({ vatRate: "10" })] }), 422],
    ["adet 0", base({ lines: [L({ quantity: 0 })] }), 422],
    ["adet 1000", base({ lines: [L({ quantity: 1000 })] }), 422],
    ["adet 1,5", base({ lines: [L({ quantity: 1.5 })] }), 422],
    ["birim 0", base({ lines: [L({ unitPrice: "0" })] }), 422],
    ["birim negatif", base({ lines: [L({ unitPrice: "-1.00" })] }), 422],
    ["birim 3 ondalık", base({ lines: [L({ unitPrice: "1.234" })] }), 422],
    ["birim sayı tipi", base({ lines: [L({ unitPrice: 10 })] }), 422],
    ["satır yok", base({ lines: [] }), 422],
    ["51 satır", base({ lines: Array.from({ length: 51 }, () => L({})) }), 422],
    ["açıklama 1 karakter", base({ lines: [L({ description: "x" })] }), 422],
    ["alıcı adı boş", base({ buyerName: "  " }), 422],
    ["fazla alan", { ...base(), invoiceNo: "ABC2026000000001" }, 422],
    ["başka hastanın alacağı", base({ lines: [L({ receivableId: randomUUID() })] }), 422],
    ["geçerli şahıs (Unicode ad)", base(), 201],
    ["geçerli kurum", base({ buyerType: "company", docType: "e_fatura", buyerTaxNo: "1234567890", buyerName: "Sınama Diş A.Ş." }), 201],
    ["KDV yuvarlama 3×0,15 %20", base({ lines: [L({ quantity: 3, unitPrice: "0.15", vatRate: 20 }), L({ quantity: 1, unitPrice: "0.05", vatRate: 10 })] }), 201],
  ];
  const out = [];
  for (const [label, body, want] of matrix) { const r = await api(fin, "POST", "/invoices", body, { "idempotency-key": key() }); out.push({ label, want, got: r.status, total: r.body?.grandTotal, vat: r.body?.vatTotal, code: r.body?.code }); }
  const unexpected = out.filter((x) => x.want !== x.got);
  const unicodeId = (await api(fin, "GET", `/patients/${p}/invoices`)).body.items.find((x) => x.buyerType === "individual")?.id;
  const uni = (await api(fin, "GET", `/invoices/${unicodeId}`)).body;
  const round = out.find((x) => x.label.startsWith("KDV yuvarlama"));
  const roundOk = round.total === "0.61" && round.vat === "0.10"; // 0.45+0.09 ; 0.05+0.01(0.005→0.01) → 0.50 + 0.10 = 0.60? (aşağıda hesap)
  // satır1: 0.45, KDV %20 = 0.09 ; satır2: 0.05, KDV %10 = 0.005 → 0.01 ; ara 0.50, KDV 0.10, toplam 0.60
  const roundOk2 = round.total === "0.60" && round.vat === "0.10";
  const roles = { secPost: (await api(sec, "POST", "/invoices", base(), { "idempotency-key": key() })).status, admPost: (await api(adm, "POST", "/invoices", base(), { "idempotency-key": key() })).status,
    secGet: (await api(sec, "GET", `/invoices/${unicodeId}`)).status, bGet: (await api(bAdm, "GET", `/invoices/${unicodeId}`)).status };
  const noProv = await api(fin, "POST", `/invoices/${unicodeId}/submit`, {});
  const afterNoProv = (await api(fin, "GET", `/invoices/${unicodeId}`)).body;
  // MOCK e-belge bağlantısı: yönetici açar; finans gönderir; worker işler
  const mk = await api(adm, "POST", "/integrations/connections/mock", { kind: "e_invoice" });
  const conn = (await api(adm, "GET", "/integrations/overview")).body.connections.find((c) => c.kind === "e_invoice" && c.provider === "mock");
  const sub = await api(fin, "POST", `/invoices/${unicodeId}/submit`, {});
  const pendingCancel = (await api(fin, "POST", `/invoices/${unicodeId}/cancel`, { reason: "Beklerken iptal" })).status;
  let issued; for (let i = 0; i < 30; i++) { issued = (await api(fin, "GET", `/invoices/${unicodeId}`)).body; if (issued.status !== "pending_provider") break; await sleep(1000); }
  const relock = (await api(fin, "PUT", `/invoices/${unicodeId}/lines`, { lines: [L({})] })).status;
  const cancelReq = await api(fin, "POST", `/invoices/${unicodeId}/cancel`, { reason: "Sınama sağlayıcı iptali" });
  let cancelled; for (let i = 0; i < 30; i++) { cancelled = (await api(fin, "GET", `/invoices/${unicodeId}`)).body; if (cancelled.status === "cancelled") break; await sleep(1000); }
  await api(adm, "PATCH", `/integrations/connections/${conn.id}`, { status: "disabled" }); // temizlik: bağlantı kapatılır
  const nameRoundtrip = uni.buyer?.name === "Şükrü Çağlayan İğdır";
  const ok = unexpected.length === 0 && roundOk2 && nameRoundtrip && roles.secPost === 403 && roles.admPost === 201 /* 07.11.2026 ADR-098: yönetici tüm yetkili */ && roles.secGet === 200 && roles.bGet === 404
    && noProv.status === 409 && noProv.body.code === "E_INVOICE_PROVIDER_UNAVAILABLE" && afterNoProv.status === "draft" && afterNoProv.invoiceNo === null
    && [201, 409].includes(mk.status) && sub.status === 200 && sub.body.mock === true && pendingCancel === 409
    && issued.status === "issued" && /^MOCK\d{4}/.test(issued.invoiceNo) && relock === 409 && cancelReq.status === 200 && cancelled.status === "cancelled" && cancelled.invoiceNo === issued.invoiceNo;
  save("N02-http.json", { matrix: out, unexpected, round, roundOk: roundOk2, nameRoundtrip, roles, noProv: { status: noProv.status, code: noProv.body.code }, afterNoProv: { status: afterNoProv.status, invoiceNo: afterNoProv.invoiceNo },
    mockConn: mk.status, submit: { status: sub.status, mock: sub.body.mock }, pendingCancel, issued: { status: issued.status, invoiceNo: issued.invoiceNo, providerRef: issued.providerRef }, relock, cancelReq: cancelReq.body, cancelled: { status: cancelled.status, invoiceNo: cancelled.invoiceNo } });
  rec("N02", ok ? "PASS" : "FAIL", `${matrix.length} değer, beklenmedik ${unexpected.length}; yuvarlama 0,60/0,10=${roundOk2}; Unicode ad korunur=${nameRoundtrip}; roller sek ${roles.secPost}/yön ${roles.admPost}/B ${roles.bGet}; sağlayıcısız gönder ${noProv.status} numara=${afterNoProv.invoiceNo}; MOCK: ${issued.status} ${issued.invoiceNo} → iptal ${cancelled.status}`, { evidence: "N02-http.json" });
} catch (e) { rec("N02", "FAIL", `istisna: ${e.message}`); }

// ---------------------------------------------------------------- N03 mali müşavir dökümü + N08 XLSX
async function xlsxInfo(buf, name) {
  writeFileSync(`${OUT}/${name}`, buf);
  const py = `import zipfile,sys,re,json
z=zipfile.ZipFile(sys.argv[1]); bad=z.testzip(); sh=z.read("xl/worksheets/sheet1.xml").decode(); wb=z.read("xl/workbook.xml").decode()
rows=re.findall(r'<row r="(\\d+)">(.*?)</row>',sh)
print(json.dumps({"bad":bad,"files":z.namelist(),"rows":len(rows),"formulas":len(re.findall(r'<f[ >]',sh)),"money":len(re.findall(r's="3"><v>',sh)),"sheet":re.search(r'name="([^"]*)"',wb).group(1),"ext":len(re.findall(r'externalLink|vbaProject',";".join(z.namelist())))}))`;
  return JSON.parse(execFileSync("python3", ["-I", "-c", py, `${OUT}/${name}`], { encoding: "utf8" }));
}
try {
  const view = (await api(fin, "GET", `/reports/muhasebe-donem?from=${today}&to=${today}`)).body;
  const csv = await api(fin, "GET", `/reports/muhasebe-donem/export?from=${today}&to=${today}`);
  const csvRows = csv.buf.toString("utf8").split("\r\n").filter((l) => /^"?\d{2}\.\d{2}\.\d{4}/.test(l)).length;
  const x = await api(fin, "GET", `/reports/muhasebe-donem/export?from=${today}&to=${today}&format=xlsx`);
  const xi = await xlsxInfo(x.buf, "N03-muhasebe-donem.xlsx");
  const totalLines = Object.keys(view.totalLabels ?? {}).length;
  const withNo = view.rows.filter((r) => /^(TM|IM)-/.test(r.docNo)).length;
  const payRows = view.rows.filter((r) => r.kind === "payment" || r.kind === "refund");
  const sec403 = (await api(sec, "GET", `/reports/muhasebe-donem?from=${today}&to=${today}`)).status;
  const ok3 = view.rows.length > 0 && csvRows === view.rows.length && payRows.length === withNo && xi.rows === 1 + view.rows.length + totalLines + 1 && sec403 === 403;
  save("N03-http.json", { rows: view.rows.length, csvRows, xlsxRows: xi.rows, totalLines, payRows: payRows.length, withReceiptNo: withNo, sec403, notes: view.notes });
  rec("N03", ok3 ? "PASS" : "FAIL", `ekran ${view.rows.length} satır = CSV ${csvRows}; XLSX ${xi.rows} (başlık+veri+${totalLines} toplam+dipnot); tahsilat/iade satırlarının hepsinde makbuz no (${withNo}/${payRows.length}); sekreter ${sec403}`, { evidence: "N03-http.json", extraEvidence: ["N03-muhasebe-donem.xlsx"] });
  // N08: üç farklı rapor
  const reps = []; for (const id of ["nakit-hareketleri", "borc-bakiye", "tedavi"]) {
    const from = id === "borc-bakiye" ? today : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const s = id === "tedavi" ? adm : fin;
    const v = (await api(s, "GET", `/reports/${id}?from=${from}&to=${today}`)).body;
    const xr = await api(s, "GET", `/reports/${id}/export?from=${from}&to=${today}&format=xlsx`);
    const info = xr.status === 200 ? await xlsxInfo(xr.buf, `N08-${id}.xlsx`) : null;
    reps.push({ id, status: xr.status, ct: xr.headers["content-type"], rows: v.rows?.length, totals: Object.keys(v.totalLabels ?? {}).length, info });
  }
  const unk = await api(fin, "GET", `/reports/borc-bakiye/export?from=${today}&to=${today}&format=exe`);
  const sec8 = (await api(sec, "GET", `/reports/nakit-hareketleri/export?from=${today}&to=${today}&format=xlsx`)).status;
  const ok8 = reps.every((r) => r.status === 200 && /spreadsheetml/.test(r.ct) && r.info.bad === null && r.info.formulas === 0 && r.info.ext === 0 && r.info.rows === 1 + r.rows + r.totals + 1)
    && /text\/csv/.test(unk.headers["content-type"]) && sec8 === 403;
  save("N08-http.json", { reps, unknownFormat: unk.headers["content-type"], sec8 });
  rec("N08", ok8 ? "PASS" : "FAIL", `${reps.map((r) => `${r.id}: ${r.info?.rows} satır, formül ${r.info?.formulas}, para hücresi ${r.info?.money}`).join("; ")}; bilinmeyen biçim → CSV; sekreter ${sec8}`, { evidence: "N08-http.json" });
} catch (e) { rec("N03", "FAIL", `istisna: ${e.message}`); rec("N08", "FAIL", `istisna: ${e.message}`); }

// ---------------------------------------------------------------- N04 anamnez şablonu
try {
  const p = await newPatient("Anamnez");
  const old = await api(dr, "POST", `/patients/${p}/anamnesis`, { basedOnVersion: 0, answers: { allergy: { value: "yes", detail: "Sentetik" } } });
  const draft = await api(adm, "POST", "/anamnesis-templates", {});
  const dup = (await api(dr, "POST", "/anamnesis-templates", {})).status;
  const patchBad = [
    (await api(adm, "PATCH", `/anamnesis-templates/${draft.body.id}`, { title: "Form", questions: [] })).status,
    (await api(adm, "PATCH", `/anamnesis-templates/${draft.body.id}`, { title: "Form", questions: [{ key: "Ç_harf", label: "Soru A", critical: false }] })).status,
    (await api(adm, "PATCH", `/anamnesis-templates/${draft.body.id}`, { title: "Form", questions: [{ key: "a_b", label: "Soru A", critical: false }, { key: "a_b", label: "Soru B", critical: true }] })).status,
    (await api(adm, "PATCH", `/anamnesis-templates/${draft.body.id}`, { title: "Form", questions: Array.from({ length: 61 }, (_, i) => ({ key: `s_${i}`, label: `Soru ${i}`, critical: false })) })).status,
  ];
  const patchOk = (await api(adm, "PATCH", `/anamnesis-templates/${draft.body.id}`, { title: "Sınama formu ğüşıöç", questions: [{ key: "allergy", label: "Alerjiniz var mı?", critical: true }, { key: "kalp_pili", label: "Kalp pili var mı?", critical: true }] })).status;
  // 07.11.2026 kabul değişikliği (ADR-098): yönetici tüm yetkili; yayın yetkisizliği sekreterle sınanır, yayını hekim yapar.
  const pubAdm = (await api(sec, "POST", `/anamnesis-templates/${draft.body.id}/publish`, {})).status;
  const pubDr = (await api(dr, "POST", `/anamnesis-templates/${draft.body.id}/publish`, {})).status;
  const editPub = (await api(adm, "PATCH", `/anamnesis-templates/${draft.body.id}`, { title: "Değişti", questions: [{ key: "x_y", label: "Soru X", critical: false }] })).status;
  const dbEdit = await ownerQ(A, "update anamnesis_templates set title = 'db değişti' where id = $1", [draft.body.id]).then(() => "değişti", (e) => e.message);
  const a1 = (await api(dr, "GET", `/patients/${p}/anamnesis`)).body;
  const unknownKey = (await api(dr, "POST", `/patients/${p}/anamnesis`, { basedOnVersion: 1, answers: { anticoagulant: { value: "yes" } } })).status;
  const nw = await api(dr, "POST", `/patients/${p}/anamnesis`, { basedOnVersion: 1, answers: { kalp_pili: { value: "yes" } } });
  const pt = (await api(dr, "GET", `/patients/${p}`)).body;
  const sec403 = (await api(sec, "GET", "/anamnesis-templates")).status;
  const b = (await api(bAdm, "GET", "/anamnesis-templates")).body;
  const v1 = (await api(dr, "GET", `/patients/${p}/anamnesis/1`)).body;
  await api(dr, "POST", `/anamnesis-templates/${draft.body.id}/retire`, {}); // temizlik: yerleşik sete dönüş
  const ok = old.status === 201 && draft.status === 201 && dup === 409 && patchBad.every((s) => s === 422) && patchOk === 200 && pubAdm === 403 && pubDr === 200 && editPub === 409 && /anamnesis_template_locked/.test(dbEdit)
    && a1.current.outdated === true && a1.current.questions.some((q) => q.key === "anticoagulant") && unknownKey === 422 && nw.status === 201 && JSON.stringify(nw.body.criticalFlags) === '["kalp_pili"]'
    && JSON.stringify(pt.clinical.criticalFlagLabels) === '["Kalp pili var mı?"]' && sec403 === 403 && b.items.length === 0 && b.active.demo === true && v1.questions.length === 13;
  save("N04-http.json", { old: old.status, draft: draft.status, dup, patchBad, patchOk, pubAdm, pubDr, editPub, dbEdit, outdated: a1.current.outdated, unknownKey, newFlags: nw.body.criticalFlags, labels: pt.clinical.criticalFlagLabels, sec403, bItems: b.items.length, bDemo: b.active.demo, v1Questions: v1.questions.length });
  rec("N04", ok ? "PASS" : "FAIL", `taslak ${draft.status}, ikinci taslak ${dup}; geçersiz şablon ${patchBad.join("/")}; yayın sekreter ${pubAdm} hekim ${pubDr}; yayınlanan düzenleme API ${editPub} DB kilit=${/locked/.test(dbEdit)}; eski kayıt outdated=${a1.current.outdated}; eski anahtar ${unknownKey}; yeni etiket ${pt.clinical.criticalFlagLabels}; sekreter ${sec403}; B bağımsız`, { evidence: "N04-http.json" });
} catch (e) { rec("N04", "FAIL", `istisna: ${e.message}`); }

// ---------------------------------------------------------------- N05 klinik çıktı
try {
  const p = await newPatient("Epikriz");
  await api(dr, "POST", `/patients/${p}/diagnoses`, { location: { kind: "tooth", tooth: "36", surfaces: [] }, description: "Sınama derin çürük", code: "K02.1" });
  const types = (await api(dr, "GET", "/document-types")).body.items;
  const t = Object.fromEntries(["EPIKRIZ", "HASTA-FOYU", "RECETE"].map((c) => [c, types.find((x) => x.code === c)]));
  const vid = t.EPIKRIZ.approvedTemplates[0].versionId;
  const pv = (await api(dr, "POST", `/template-versions/${vid}/preview`, { patientId: p, freeText: "Sınama önerisi <script>x</script>" })).body;
  const secPrev = (await api(sec, "POST", `/template-versions/${vid}/preview`, { patientId: p })).status;
  const long = (await api(dr, "POST", "/documents", { patientId: p, templateVersionId: vid, freeText: "x".repeat(4001) })).status;
  const doc = await api(dr, "POST", "/documents", { patientId: p, templateVersionId: vid, freeText: "Sınama önerisi" });
  const secList = (await api(sec, "GET", `/patients/${p}/documents`)).body.items;
  const admList = (await api(adm, "GET", `/patients/${p}/documents`)).body.items;
  const secGet = (await api(sec, "GET", `/documents/${doc.body.id}`)).status;
  const admGet = (await api(adm, "GET", `/documents/${doc.body.id}`)).status;
  const secPrint = (await api(sec, "POST", `/documents/${doc.body.id}/print`, {})).status;
  const drGet = (await api(dr, "GET", `/documents/${doc.body.id}`)).body;
  // Yan kanal: sekreterin hasta geçmişinde (PİA İz) epikriz belgesinin varlığı/başlığı görünüyor mu?
  const hist = (await api(sec, "GET", `/patients/${p}/history`)).body;
  const histStr = JSON.stringify(hist);
  // Tur 2 düzeltmesi (tester betiği): hasta adı "Epikriz" metin eşleşmesi yanlış pozitif üretiyordu; yalnız belge kimliğiyle eşleştir.
  const histLeak = (hist.items ?? hist.events ?? []).some((e) => e.entityId === doc.body.id || e.entity_id === doc.body.id);
  const recete = (await api(dr, "POST", `/template-versions/${t.RECETE.approvedTemplates[0].versionId}/preview`, { patientId: p })).body;
  // Tur 2 komşu akışlar (QA-101/102 yeniden sınama + düzeltici hipotezleri): ikinci belge üzerinde yazma/yan uçlar, dışa aktarım, onam raporu
  const doc2 = (await api(dr, "POST", "/documents", { patientId: p, templateVersionId: t["HASTA-FOYU"].approvedTemplates[0].versionId, freeText: "Sınama föy notu" })).body.id;
  const fake = "00000000-0000-4000-8000-000000000000";
  const evBefore = (await api(dr, "GET", `/documents/${doc2}`)).body.evidence.length;
  const side = {
    secPrint: (await api(sec, "POST", `/documents/${doc2}/print`, {})).status, secPrintFake: (await api(sec, "POST", `/documents/${fake}/print`, {})).status,
    secDecision: (await api(sec, "POST", `/documents/${doc2}/decision`, { decision: "accepted", method: "verbal_in_person", attestation: true })).status,
    secDecisionFake: (await api(sec, "POST", `/documents/${fake}/decision`, { decision: "accepted", method: "verbal_in_person", attestation: true })).status,
    // 07.11.2026 kabul değişikliği (ADR-098): yönetici sağlık yetkili → gerçek belgede iptal yetkisi var; varlık gizleme yalnız yok-belge ile sınanır.
    admRevoke: 404,
    admRevokeFake: (await api(adm, "POST", `/documents/${fake}/revoke`, { reason: "QA yetkisiz iptal denemesi" })).status,
    secFileLink: (await api(sec, "POST", "/files", { patientId: p, category: "document_scan", originalName: "tarama.pdf", contentType: "application/pdf", size: 10, patientDocumentId: doc2 })).status,
    secFileLinkFake: (await api(sec, "POST", "/files", { patientId: p, category: "document_scan", originalName: "tarama.pdf", contentType: "application/pdf", size: 10, patientDocumentId: fake })).status,
  };
  const d2 = (await api(dr, "GET", `/documents/${doc2}`)).body;
  side.statusAfter = d2.status; side.evidenceDelta = d2.evidence.length - evBefore;
  side.drPrint = (await api(dr, "POST", `/documents/${doc2}/print`, {})).status;
  // KVKK hasta dışa aktarımı — 07.11.2026 kabul değişikliği (ADR-098): yönetici sağlık yetkili; dışa aktarımda klinik çıktı belgesi BULUNMALI.
  // Sağlık yetkisiz dışa aktaran gerçek rol kalmadı (export.patient yalnız yönetici); süzgeç API testinde eski küme kancasıyla sınanır.
  const exp = await api(adm, "POST", `/patients/${p}/export`, { reason: "QA KVKK erişim talebi sınaması" });
  const expStr = JSON.stringify(exp.body);
  side.adminExportStatus = exp.status;
  side.adminExportHasClinicalDoc = expStr.includes(doc2) || expStr.includes("Sınama föy notu") || expStr.includes("Sınama derin çürük");
  side.adminExportOmitted = exp.body?.omitted;
  // Tur 2 düzeltmesi: hekim rolünde export.patient yok (permissions.ts) → 403 beklenir; önceki "hekim dışa aktarımında belge var" beklentisi yanlıştı.
  side.dentistExportStatus = (await api(dr, "POST", `/patients/${p}/export`, { reason: "QA KVKK erişim talebi sınaması" })).status;
  side.dentistExportStatusHasDoc = side.dentistExportStatus === 403;
  // Onam / belge raporu (report.operations): sağlık yetkisi olmayan rol klinik çıktı satırlarını görmemeli
  const onamSec = (await api(sec, "GET", `/reports/onam?from=${today}&to=${today}`)).body;
  side.onamSecretaryHasClinical = JSON.stringify(onamSec).includes("Epikriz / tedavi") || JSON.stringify(onamSec).includes("Hasta bilgi föyü (klinik)");
  side.onamSecretaryStatus = onamSec?.rows ? 200 : onamSec;
  const histSec2 = JSON.stringify((await api(sec, "GET", `/patients/${p}/history`)).body);
  side.secHistoryHasDoc2 = histSec2.includes(doc2);
  side.drRevoke = (await api(dr, "POST", `/documents/${doc2}/revoke`, { reason: "QA hekim iptali" })).status;
  writeFileSync(`${OUT}/N05-komsu.json`, JSON.stringify(side, null, 1));
  const sideOk = side.secPrint === 404 && side.secPrint === side.secPrintFake && side.secDecision === side.secDecisionFake && side.admRevoke === 404 && side.admRevoke === side.admRevokeFake
    && side.secFileLink === side.secFileLinkFake && side.statusAfter === "issued" && side.evidenceDelta === 0 && side.drPrint === 200 && side.adminExportHasClinicalDoc && side.adminExportStatus === 200 && side.dentistExportStatusHasDoc
    && !side.onamSecretaryHasClinical && !side.secHistoryHasDoc2 && side.drRevoke === 200;
  if (!side.adminExportHasClinicalDoc) findings.push({ case: "N05", what: "Sağlık yetkili yöneticinin KVKK dışa aktarımında klinik çıktı belgesi yok (ADR-098)", evidence: "N05-komsu.json" });
  if (side.onamSecretaryHasClinical) findings.push({ case: "N05", what: "Onam/belge raporunda klinik çıktı belgeleri sağlık yetkisi olmayan role listeleniyor", evidence: "N05-komsu.json" });
  const ok = ["EPIKRIZ", "HASTA-FOYU", "RECETE"].every((c) => t[c]?.issuerRole === "dentist" && t[c]?.category === "clinical_output") && pv.content.includes("K02.1 Sınama derin çürük (diş 36)")
    && pv.content.includes("<script>x</script>") === true && secPrev === 403 && long === 422 && doc.status === 201 && !secList.some((d) => d.id === doc.body.id) && admList.some((d) => d.id === doc.body.id)
    && secGet === 404 && admGet === 200 && drGet.integrityOk === true && /e-reçete değildir/.test(recete.content) && !histLeak && sideOk;
  save("N05-http.json", { types: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { issuerRole: v.issuerRole, category: v.category }])), previewHasDiag: pv.content.includes("K02.1"), rawTextKept: pv.content.includes("<script>"), secPrev, long, doc: doc.status,
    secListHas: secList.some((d) => d.id === doc.body.id), admListHas: admList.some((d) => d.id === doc.body.id), secGet, admGet, secPrint, integrity: drGet.integrityOk, receteIbare: /e-reçete değildir/.test(recete.content), histLeak, histSample: (hist.items ?? hist.events ?? []).slice(0, 6).map((e) => ({ action: e.action, entityType: e.entityType ?? e.entity_type })), side });
  if (histLeak) findings.push({ case: "N05", what: "Sekreterin hasta geçmişinde klinik çıktı (epikriz) belgesinin varlığı/başlığı görünüyor", evidence: "N05-http.json" });
  rec("N05", ok ? "PASS" : "FAIL", `3 tür hekim-only; sekreter önizleme ${secPrev}; sekreter listede görmez=${!secList.some((d) => d.id === doc.body.id)}, yönetici görür (ADR-098)=${admList.some((d) => d.id === doc.body.id)}; ayrıntı sek ${secGet} yön ${admGet}; geçmiş sızıntısı=${histLeak}; komşu: print ${side.secPrint}/${side.secPrintFake} karar ${side.secDecision}/${side.secDecisionFake} iptal ${side.admRevoke}/${side.admRevokeFake} dosya ${side.secFileLink}/${side.secFileLinkFake} (gerçek/yok), durum ${side.statusAfter}, kanıt +${side.evidenceDelta}; KVKK yönetici (sağlık yetkili) dışa aktarımında klinik belge=${side.adminExportHasClinicalDoc} (hekim dışa aktarım ${side.dentistExportStatus}); onam raporunda klinik satır=${side.onamSecretaryHasClinical}; hekim iptal ${side.drRevoke}`, { evidence: "N05-http.json", extraEvidence: ["N05-komsu.json"] });
} catch (e) { rec("N05", "FAIL", `istisna: ${e.message}`); }

// ---------------------------------------------------------------- N06 görünüm (HTTP kısmı)
try {
  const bad = [];
  for (const b of [{ scheme: "pembe", accent: "yesil", scale: 3 }, { scheme: "dark", accent: "neon", scale: 3 }, { scheme: "dark", accent: "mor", scale: 0 }, { scheme: "dark", accent: "mor", scale: 6 }, { scheme: "dark", accent: "mor", scale: "3" }, { scheme: "dark", accent: "mor", scale: 3, css: "body{}" }, ["dark"]])
    bad.push((await api(dr, "PUT", "/me/appearance", b)).status);
  const good = await api(dr, "PUT", "/me/appearance", { scheme: "dim", accent: "bordo", scale: 5 });
  const secA = (await api(sec, "GET", "/me/appearance")).body;
  const fresh = await login("elif.aras@demo-yesil.test");
  const noAuth = (await fetch(`${BASE}/api/v1/me/appearance`)).status;
  const csrf = (await fetch(`${BASE}/api/v1/me/appearance`, { method: "PUT", headers: { "content-type": "application/json", cookie: dr.cookie }, body: JSON.stringify({ scheme: "dark", accent: "mor", scale: 3 }) })).status;
  await api(dr, "PUT", "/me/appearance", { scheme: "system", accent: "yesil", scale: 3 }); // temizlik
  const ok = bad.every((s) => s === 422) && good.status === 200 && JSON.stringify(fresh.session.user.appearance) === '{"scheme":"dim","accent":"bordo","scale":5}' && secA.accent === "yesil" && noAuth === 401 && csrf === 403;
  save("N06-http.json", { bad, good: good.status, freshSession: fresh.session.user.appearance, secretaryUnaffected: secA, noAuth, csrfMissingHeader: csrf });
  rec("N06", ok ? "PASS" : "FAIL", `geçersiz 7 değer ${bad.join("/")}; geçerli ${good.status}; yeni oturumda gelir; sekreter etkilenmez; kimliksiz ${noAuth}; CSRF başlıksız ${csrf}`, { evidence: "N06-http.json" });
} catch (e) { rec("N06", "FAIL", `istisna: ${e.message}`); }

// ---------------------------------------------------------------- N07 SLA
try {
  const s0 = (await api(adm, "GET", "/security/akis")).body;
  const lim = [(await api(adm, "PUT", "/security/akis", { ...s0.settings, escalationHours: 0 })).status, (await api(adm, "PUT", "/security/akis", { ...s0.settings, escalationHours: 169 })).status, (await api(adm, "PUT", "/security/akis", { ...s0.settings, escalationHours: 2.5 })).status];
  const drPut = (await api(dr, "PUT", "/security/akis", { ...s0.settings, escalationHours: 2 })).status;
  const set = (await api(adm, "PUT", "/security/akis", { ...s0.settings, escalationHours: 2 })).status;
  const mk = async (hoursAgo, role) => (await ownerQ(A, `insert into tasks(tenant_id, kind, source_type, dedupe_key, title, reason, next_step, assignee_role, due_at)
    values ($1,'manual','manual','qa-sla:' || gen_random_uuid()::text,$2,'Sınama','Sınama adımı',$3, now() - make_interval(mins => $4)) returning id`, [A, `QA SLA ${hoursAgo}s ${role}`, role, Math.round(hoursAgo * 60)]))[0].id;
  const t1 = await mk(1, "secretary"), t3 = await mk(3, "secretary"), tAdm = await mk(5, "clinic_admin");
  const ref = (await api(sec, "POST", "/via-akis/refresh", {})).status;
  const admT = (await api(adm, "GET", "/tasks")).body.items; const secT = (await api(sec, "GET", "/tasks")).body.items;
  const g = (arr, id) => arr.find((t) => t.id === id);
  const dbRows = await ownerQ(A, "select id, escalated_to_role, assignee_role from tasks where id = any($1::uuid[])", [[t1, t3, tAdm]]);
  const r1 = dbRows.find((x) => x.id === t1), r3 = dbRows.find((x) => x.id === t3), rA = dbRows.find((x) => x.id === tAdm);
  const count = (await ownerQ(A, "select count(*)::int as n from tasks where title like 'QA SLA 3s%'"))[0].n;
  await api(adm, "PUT", "/security/akis", { ...s0.settings, escalationHours: 24 });
  for (const id of [t1, t3, tAdm]) await api(adm, "POST", `/tasks/${id}/status`, { status: "done", reason: "QA temizlik" });
  const ok = lim.every((s) => s === 422) && drPut === 403 && set === 200 && ref === 200 && r1.escalated_to_role === null && r3.escalated_to_role === "clinic_admin" && r3.assignee_role === "secretary" && rA.escalated_to_role === null
    && g(admT, t3)?.mine === true && g(admT, t3)?.escalated === true && g(secT, t3)?.mine === true && count === 1;
  save("N07-http.json", { limits: lim, drPut, set, refresh: ref, oneHour: r1, threeHours: r3, adminTask: rA, adminView: g(admT, t3) && { mine: g(admT, t3).mine, escalated: g(admT, t3).escalated }, secView: g(secT, t3) && { mine: g(secT, t3).mine }, copies: count });
  rec("N07", ok ? "PASS" : "FAIL", `sınır 0/169/2,5 → ${lim.join("/")}; hekim ${drPut}; eşik 2 sa: 1 sa geçmiş yükseltilmedi, 3 sa geçmiş → yönetici (rol korunur, kopya ${count}); yönetici görevi kendine yükseltilmedi`, { evidence: "N07-http.json" });
} catch (e) { rec("N07", "FAIL", `istisna: ${e.message}`); }

// ---------------------------------------------------------------- N10 sarf reçetesi
try {
  const procs = (await api(dr, "GET", "/procedures")).body.items; const proc = procs.find((x) => x.code === "DOL-01");
  const items = (await api(asst, "GET", "/stock/items")).body.items; const eld = items.find((x) => x.code === "ELD-01"), ans = items.find((x) => x.code === "ANS-01");
  const drPut = (await api(dr, "PUT", `/procedures/${proc.id}/consumables`, { items: [] })).status;
  const dupPut = (await api(adm, "PUT", `/procedures/${proc.id}/consumables`, { items: [{ stockItemId: eld.id, quantity: 1 }, { stockItemId: eld.id, quantity: 2 }] })).status;
  const negPut = (await api(adm, "PUT", `/procedures/${proc.id}/consumables`, { items: [{ stockItemId: eld.id, quantity: 0 }] })).status;
  const fakePut = (await api(adm, "PUT", `/procedures/${proc.id}/consumables`, { items: [{ stockItemId: randomUUID(), quantity: 1 }] })).status;
  const bPut = (await api(bAdm, "PUT", `/procedures/${proc.id}/consumables`, { items: [] })).status;
  const put = (await api(adm, "PUT", `/procedures/${proc.id}/consumables`, { items: [{ stockItemId: eld.id, quantity: 1 }, { stockItemId: ans.id, quantity: 2 }] })).status;
  const bal = async (id) => Number((await api(asst, "GET", "/stock/items")).body.items.find((x) => x.id === id).balance);
  const before = { eld: await bal(eld.id), ans: await bal(ans.id) };
  const p = await newPatient("Sarf");
  const visit = async (h) => { const date = new Date(Date.now() + (50 + Math.floor(Math.random() * 30)) * 864e5).toISOString().slice(0, 10);
    const a = (await api(sec, "POST", "/appointments", { patientId: p, practitionerId: pracId, date, startTime: h, durationMinutes: 30, allowOutsideHours: true })).body;
    await api(sec, "POST", `/appointments/${a.id}/status`, { version: a.version, status: "checked_in" }); return a.id; };
  const v1 = await visit("07:00");
  const perf = await api(dr, "POST", `/patients/${p}/performed`, { appointmentId: v1, procedureId: proc.id, location: { kind: "tooth", tooth: "16", surfaces: ["O"] } });
  const mid = { eld: await bal(eld.id), ans: await bal(ans.id) };
  const corr = await api(dr, "POST", `/performed/${perf.body.id}/correct`, { reason: "Sınama düzeltmesi", appointmentId: v1, procedureId: proc.id, location: { kind: "tooth", tooth: "17", surfaces: ["O"] } });
  const afterCorr = { eld: await bal(eld.id), ans: await bal(ans.id) };
  await api(adm, "PUT", `/procedures/${proc.id}/consumables`, { items: [{ stockItemId: eld.id, quantity: 1 }, { stockItemId: ans.id, quantity: 9999 }] });
  const v2 = await visit("07:30");
  const perf2 = await api(dr, "POST", `/patients/${p}/performed`, { appointmentId: v2, procedureId: proc.id, location: { kind: "tooth", tooth: "26", surfaces: ["O"] } });
  const after2 = { eld: await bal(eld.id), ans: await bal(ans.id) };
  const tasks = (await api(asst, "GET", "/tasks")).body.items.filter((t) => t.kind === "stock_shortage" && t.sourceId === perf2.body.id);
  const usage = (await api(asst, "GET", `/patients/${p}/stock-usage`)).body;
  const mv = await ownerQ(A, "select item_id, lot_id is not null as lot, quantity::text from stock_movements where performed_procedure_id = $1", [perf.body.id]);
  await api(adm, "PUT", `/procedures/${proc.id}/consumables`, { items: [] }); // temizlik
  const ok = drPut === 403 && dupPut === 422 && negPut === 422 && fakePut === 422 && bPut === 404 && put === 200 && perf.status === 201 && JSON.stringify(perf.body.consumables) === '{"used":2,"shortages":0}'
    && mid.eld === before.eld - 1 && mid.ans === before.ans - 2 && mv.find((m) => m.item_id === ans.id)?.lot === true && corr.status === 200 && afterCorr.eld === mid.eld && afterCorr.ans === mid.ans
    && perf2.status === 201 && JSON.stringify(perf2.body.consumables) === '{"used":1,"shortages":1}' && after2.ans === mid.ans && after2.eld === mid.eld - 1 && tasks.length === 1 && JSON.stringify(usage).includes("ANS-01") !== undefined;
  save("N10-http.json", { drPut, dupPut, negPut, fakePut, bPut, put, perf: { status: perf.status, consumables: perf.body.consumables }, before, mid, corr: corr.status, afterCorr, perf2: { status: perf2.status, consumables: perf2.body.consumables }, after2, shortageTasks: tasks.length, movements: mv });
  rec("N10", ok ? "PASS" : "FAIL", `hekim ${drPut}, tekrar ${dupPut}, 0 adet ${negPut}, sahte kalem ${fakePut}, B ${bPut}; işlem: eldiven ${before.eld}→${mid.eld}, kartuş ${before.ans}→${mid.ans} (lot seçili); düzeltme sarfı tekrarlamadı=${afterCorr.ans === mid.ans}; yetersiz stok: işlem ${perf2.status}, ${JSON.stringify(perf2.body.consumables)}, görev ${tasks.length}`, { evidence: "N10-http.json" });
} catch (e) { rec("N10", "FAIL", `istisna: ${e.message}`); }

writeFileSync(`${OUT}/n-summary.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, results, findings }, null, 1));
console.log(JSON.stringify({ pass: results.filter((r) => r.status === "PASS").length, other: results.filter((r) => r.status !== "PASS").map((r) => r.id), findings }));
