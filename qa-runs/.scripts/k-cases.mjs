// CEZERİ teslim testi — ADR-109 POS Faz 0 HTTP/DB vakaları K01–K06. Ürün kodunu değiştirmez; yalnız sentetik veri.
// Kullanım: BASE=http://127.0.0.1:4000 PASSWORD=<güvenli ortam> OWNER_URL=<yerel> ADMIN_URL=<yerel> OUT=<evidence> tsx qa-runs/.scripts/k-cases.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const pg = require("pg");

const BASE = process.env.BASE ?? "http://127.0.0.1:4000";
const PASSWORD = process.env.PASSWORD; const OUT = process.env.OUT ?? "evidence"; const OWNER_URL = process.env.OWNER_URL; const ADMIN_URL = process.env.ADMIN_URL;
if (!PASSWORD || !OWNER_URL || !ADMIN_URL) { console.error("PASSWORD, OWNER_URL ve ADMIN_URL gerekli"); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36).slice(-5);
const TEST_PAN = ["4111", "1111", "1111", "1111"].join(""); // sentetik test numarası; kanıtta maskelenir
const mask = (s) => String(s).split(TEST_PAN).join("‹PAN›");
const results = [];
const rec = (id, c, extra = "") => { const status = c.length && c.every((x) => x.pass) ? "PASS" : "FAIL";
  results.push({ id, status, summary: mask(`${c.filter((x) => x.pass).length}/${c.length} kontrol${extra}: ${c.filter((x) => !x.pass).map((x) => x.check).join("; ") || "hepsi geçti"}`), at: new Date().toISOString(), evidence: `${id}-http.json` });
  writeFileSync(`${OUT}/${id}-http.json`, mask(JSON.stringify({ checks: c }, null, 1))); console.log(`${status.padEnd(6)} ${id} ${results.at(-1).summary}`); };
const ok = (cond, label, list) => { list.push({ check: label, pass: !!cond }); return !!cond; };
const pool = new pg.Pool({ connectionString: OWNER_URL, max: 2 });
const adminDb = new URL(ADMIN_URL); adminDb.pathname = "/viadent";
const admin = new pg.Pool({ connectionString: adminDb.toString(), max: 1 });
let TENANT = null;
const q = async (sql, args = [], tenant = TENANT) => { const c = await pool.connect();
  try { await c.query("begin"); await c.query("select set_config('app.tenant_id', $1, true)", [tenant]); const r = await c.query(sql, args); await c.query("commit"); return r.rows; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } };
async function api(s, method, path, body, k) {
  const h = { "content-type": "application/json", "x-viadent-request": "1", ...(k ? { "idempotency-key": k } : {}) };
  if (s?.cookie) h.cookie = s.cookie; if (s?.ctx) h["x-viadent-context"] = s.ctx;
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j, replayed: r.headers.get("idempotent-replayed") };
}
async function login(email) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-viadent-request": "1" }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (r.status !== 200) { console.error("giriş", email.split("@")[0], r.status); process.exit(2); }
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const s = await (await fetch(`${BASE}/api/v1/session`, { headers: { cookie } })).json();
  return { cookie, ctx: s.activeMembership.id, tenantId: s.activeMembership.tenantId };
}
const key = () => "qa-" + randomUUID();
const TZ = "Europe/Istanbul";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const day = (n) => { const [y, m, d] = today().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const cents = (v) => Math.round(Number(v) * 100);

const A = { admin: await login("yonetici@demo-yesil.test"), dentist: await login("elif.aras@demo-yesil.test"), sec: await login("sekreter@demo-yesil.test"),
  asst: await login("asistan@demo-yesil.test"), fin: await login("finans@demo-yesil.test") };
const B = { admin: await login("yonetici@demo-mavi.test") };
TENANT = A.admin.tenantId;

const accts = (await api(A.admin, "GET", "/cash-accounts")).body.items;
const posAcct = accts.find((a) => a.kind === "pos_manual").id, cashAcct = accts.find((a) => a.kind === "cash").id;
const pat = (await api(A.sec, "POST", "/patients", { firstName: "QaPos", lastName: `K${RUN}`, birthDate: "1984-02-03", acknowledgeDuplicates: true })).body.patient.id;
const pat2 = (await api(A.sec, "POST", "/patients", { firstName: "QaPosİki", lastName: `K${RUN}`, birthDate: "1985-02-03", acknowledgeDuplicates: true })).body.patient.id;
const mkTerm = async (driver, label) => (await api(A.admin, "POST", "/pos/terminals", { name: `QA ${driver} ${label} ${RUN}`, driver, cashAccountId: posAcct })).body.id;
const dev = (t, amount = "100.00", extra = {}) => api(A.sec, "POST", "/pos/intents", { terminalId: t, patientId: pat, amount, mode: "device", ...extra }, key());

// K01 — terminal tanımı ve yetki matrisi
{ const c = [];
  const t = await api(A.admin, "POST", "/pos/terminals", { name: `QA Ön Büro Çağrı – şube ${RUN}`, driver: "manual", cashAccountId: posAcct, bankName: "Sentetik Bankası", terminalRef: "TID 0042" });
  ok(t.status === 201, `yönetici Unicode adla tanımlar ${t.status}`, c);
  const f = await api(A.fin, "POST", "/pos/terminals", { name: `QA finans ${RUN}`, driver: "mock", cashAccountId: posAcct });
  ok(f.status === 201, `finans tanımlar ${f.status}`, c);
  for (const [who, s] of [["sekreter", A.sec], ["asistan", A.asst], ["hekim", A.dentist]]) {
    const x = await api(s, "POST", "/pos/terminals", { name: `QA ${who} ${RUN}`, driver: "manual", cashAccountId: posAcct });
    ok(x.status === 403, `${who} tanımlayamaz ${x.status}`, c);
  }
  const cash = await api(A.admin, "POST", "/pos/terminals", { name: `QA nakit ${RUN}`, driver: "manual", cashAccountId: cashAcct });
  ok(cash.status === 422 && cash.body.field_errors?.cashAccountId, `nakit kasaya bağlanmaz ${cash.status}`, c);
  const dup = await api(A.admin, "POST", "/pos/terminals", { name: `qa ön büro çağrı – şube ${RUN}`.replace("qa", "QA"), driver: "manual", cashAccountId: posAcct });
  ok(dup.status === 422, `yinelenen ad ${dup.status}`, c);
  for (const [lbl, b] of [["terminal no özel karakter", { terminalRef: "T<script>" }], ["bilinmeyen sürücü", { driver: "ingenico" }], ["boş ad", { name: " " }], ["kasa kimliği bozuk", { cashAccountId: "x" }]]) {
    const x = await api(A.admin, "POST", "/pos/terminals", { name: `QA doğrulama ${lbl} ${RUN}`, driver: "manual", cashAccountId: posAcct, ...b });
    ok(x.status === 422, `${lbl} → ${x.status}`, c);
  }
  const ch = await api(A.admin, "PATCH", `/pos/terminals/${t.body.id}`, { name: `QA Ön Büro Çağrı – şube ${RUN}`, driver: "mock", cashAccountId: posAcct });
  ok(ch.status === 409, `sürücü değişmez ${ch.status}`, c);
  const up = await api(A.admin, "PATCH", `/pos/terminals/${t.body.id}`, { name: `QA Ön Büro Çağrı – şube ${RUN}`, driver: "manual", cashAccountId: posAcct, active: false });
  ok(up.status === 200, `pasifleştirme ${up.status}`, c);
  const pasif = await api(A.sec, "POST", "/pos/intents", { terminalId: t.body.id, patientId: pat, amount: "1.00", mode: "manual", authCode: "AB1234", cardLast4: "1234" }, key());
  ok(pasif.status === 422, `pasif terminale çekim ${pasif.status}`, c);
  const ls = await api(A.sec, "GET", "/pos/terminals");
  ok(ls.status === 200 && ls.body.items.some((x) => x.id === t.body.id && x.active === false && x.terminalRef === "TID 0042"), "sekreter listeler", c);
  ok((await api(A.fin, "GET", "/pos/terminals")).status === 200, "finans listeler", c);
  ok((await api(A.dentist, "GET", "/pos/terminals")).status === 403, "hekim göremez", c);
  ok((await api(A.asst, "GET", "/pos/terminals")).status === 403, "asistan göremez", c);
  const bl = await api(B.admin, "GET", "/pos/terminals");
  ok(bl.status === 200 && !bl.body.items.some((x) => x.name.includes(RUN)), "B kiracısı görmez", c);
  ok((await api(B.admin, "PATCH", `/pos/terminals/${t.body.id}`, { name: "B kiracısı deneme", driver: "manual", cashAccountId: posAcct })).status === 404, "B kiracısı güncelleyemez (404)", c);
  const au = await q("select action from audit_events where entity_type = 'pos_terminal' and entity_id = $1", [t.body.id]);
  ok(au.length === 2, `audit ${au.map((x) => x.action).join(",")}`, c);
  rec("K01", c);
}

// K02 — elle eşleştirme sınır değerleri ve tahsilat doğurma
{ const c = [];
  const t = await mkTerm("manual", "elle");
  const base = { terminalId: t, patientId: pat, mode: "manual", authCode: "QA1234", cardLast4: "5678" };
  const bad = [["tutar 0", { amount: "0.00" }], ["tutar negatif", { amount: "-5.00" }], ["tutar 3 ondalık", { amount: "1.234" }], ["tutar metin", { amount: "on lira" }],
    ["taksit 0", { amount: "1.00", installments: 0 }], ["taksit 13", { amount: "1.00", installments: 13 }], ["taksit metin", { amount: "1.00", installments: "üç" }],
    ["onay kodu 3", { amount: "1.00", authCode: "A12" }], ["onay kodu 13", { amount: "1.00", authCode: "A123456789012" }], ["onay kodu Unicode", { amount: "1.00", authCode: "ÇÖ1234" }],
    ["onay kodu boşluk", { amount: "1.00", authCode: "12 34" }], ["son4 3 hane", { amount: "1.00", cardLast4: "123" }], ["son4 5 hane", { amount: "1.00", cardLast4: "12345" }],
    ["son4 tam kart no", { amount: "1.00", cardLast4: TEST_PAN }], ["son4 harf", { amount: "1.00", cardLast4: "12a4" }], ["onay kodu yok", { amount: "1.00", authCode: undefined }],
    ["son4 yok", { amount: "1.00", cardLast4: undefined }], ["hasta kimliği bozuk", { amount: "1.00", patientId: "x" }], ["mod bilinmeyen", { amount: "1.00", mode: "nfc" }]];
  for (const [lbl, b] of bad) {
    const x = await api(A.sec, "POST", "/pos/intents", { ...base, ...b }, key());
    ok(x.status === 422, `${lbl} → ${x.status}`, c);
  }
  ok((await api(A.sec, "POST", "/pos/intents", { ...base, amount: "1.00" })).status === 428, "Idempotency-Key yok → 428", c);
  const dv = await api(A.sec, "POST", "/pos/intents", { terminalId: t, patientId: pat, amount: "1.00", mode: "device" }, key());
  ok(dv.status === 422 && dv.body.code === "POS_DRIVER_NO_DEVICE", `banka POS'una cihaz modu ${dv.status}/${dv.body.code}`, c);
  const rcv = (await api(A.fin, "POST", "/receivables", { patientId: pat, description: `QA POS alacak ${RUN}`, amount: "400.00" }, key())).body.id;
  const rcv2 = (await api(A.fin, "POST", "/receivables", { patientId: pat2, description: `QA POS başka ${RUN}`, amount: "50.00" }, key())).body.id;
  const over = await api(A.sec, "POST", "/pos/intents", { ...base, amount: "100.00", allocations: [{ receivableId: rcv, amount: "150.00" }] }, key());
  ok(over.status === 422, `dağıtım tutarı aşar ${over.status}`, c);
  const other = await api(A.sec, "POST", "/pos/intents", { ...base, amount: "100.00", allocations: [{ receivableId: rcv2, amount: "50.00" }] }, key());
  ok(other.status === 422, `başka hastanın alacağı ${other.status}`, c);
  ok((await q("select count(*)::int as n from pos_intents where terminal_id = $1", [t]))[0].n === 0, "reddedilen istekler niyet yazmadı (transaction geri alındı)", c);
  for (const [amt, inst] of [["0.01", 1], ["99999.99", 12]]) {
    const x = await api(A.sec, "POST", "/pos/intents", { ...base, amount: amt, installments: inst, authCode: `B${inst}C${RUN}`.slice(0, 12) }, key());
    ok(x.status === 201 && x.body.status === "approved" && x.body.amount === amt && x.body.installments === inst, `sınır ${amt}/${inst} → ${x.status}`, c);
  }
  const k = key();
  const body = { ...base, amount: "650.00", installments: 6, authCode: "qa9z87", allocations: [{ receivableId: rcv, amount: "400.00" }] };
  const r = await api(A.sec, "POST", "/pos/intents", body, k);
  ok(r.status === 201 && r.body.status === "approved" && r.body.authCode === "QA9Z87" && r.body.cardMasked === "•••• 5678", `onay ${r.status} ${r.body.authCode} ${r.body.cardMasked}`, c);
  const pay = (await q("select method, cash_account_id, amount::text, pos_intent_id, patient_id from payments where id = $1", [r.body.paymentId]))[0];
  ok(pay && pay.method === "card_manual" && pay.cash_account_id === posAcct && pay.amount === "650.00" && pay.pos_intent_id === r.body.id && pay.patient_id === pat, "tahsilat: kart, POS kasası, tutar, niyet bağı", c);
  const mv = await q("select amount::text from cash_movements where source = 'payment' and source_id = $1 and cash_account_id = $2", [r.body.paymentId, posAcct]);
  ok(mv.length === 1 && mv[0].amount === "650.00", "POS kasasına tek hareket", c);
  const rc = await q("select receipt_no from receipts where kind = 'payment' and payment_id = $1", [r.body.paymentId]);
  ok(rc.length === 1 && r.body.receiptNo === rc[0].receipt_no, `makbuz ${r.body.receiptNo}`, c);
  const al = await q("select amount::text from allocations where payment_id = $1 and receivable_id = $2", [r.body.paymentId, rcv]);
  ok(al.length === 1 && al[0].amount === "400.00", "dağıtım 400.00", c);
  const acc = (await api(A.sec, "GET", `/patients/${pat}/account`)).body;
  const p = acc.payments.find((x) => x.id === r.body.paymentId);
  ok(acc.reconciled === true && p?.available === "250.00" && p?.posIntentId === r.body.id && /6 taksit/.test(p?.note ?? ""), `hesap mutabık, avans ${p?.available}, not taksitli`, c);
  const again = await api(A.sec, "POST", "/pos/intents", body, k);
  ok(again.status === 201 && again.replayed === "true" && again.body.id === r.body.id, "aynı anahtar tekrar → aynı yanıt", c);
  const diff = await api(A.sec, "POST", "/pos/intents", { ...body, amount: "651.00" }, k);
  ok(diff.status === 409 && diff.body.code === "IDEMPOTENCY_KEY_REUSED", `aynı anahtar farklı içerik ${diff.status}`, c);
  ok((await q("select count(*)::int as n from payments where pos_intent_id = $1", [r.body.id]))[0].n === 1, "tek tahsilat", c);
  rec("K02", c);
}

// K03 — DENEME cihazı durum makinesi
{ const c = [];
  const t = await mkTerm("mock", "durum");
  const a = await dev(t, "120.00", { installments: 3 });
  ok(a.status === 201 && a.body.status === "awaiting_card" && /^DENEME-\d{6}$/.test(a.body.providerRef ?? "") && !a.body.paymentId, `gönder ${a.status} ${a.body.status}`, c);
  const busy = await dev(t, "1.00");
  ok(busy.status === 409 && busy.body.code === "POS_TERMINAL_BUSY" && busy.body.details?.intentId === a.body.id, `çift çekim koruması ${busy.status}`, c);
  const ls = (await api(A.sec, "GET", "/pos/terminals")).body.items.find((x) => x.id === t);
  ok(ls?.openIntentId === a.body.id, "terminal listesinde açık işlem", c);
  ok((await q("select count(*)::int as n from payments where pos_intent_id = $1", [a.body.id]))[0].n === 0, "onay öncesi tahsilat yok", c);
  const ap = await api(A.sec, "POST", `/pos/intents/${a.body.id}/simulate`, { outcome: "approved" });
  ok(ap.status === 200 && ap.body.status === "approved" && /^•••• \d{4}$/.test(ap.body.cardMasked ?? "") && ap.body.paymentId, `onay ${ap.status}`, c);
  ok((await q("select amount::text from payments where id = $1", [ap.body.paymentId]))[0]?.amount === "120.00", "tahsilat 120.00", c);
  for (const [lbl, path, b] of [["onaylıya benzetim", "simulate", { outcome: "declined" }], ["onaylıyı iptal", "cancel", { reason: "Hasta vazgeçti" }]]) {
    const x = await api(A.sec, "POST", `/pos/intents/${a.body.id}/${path}`, b);
    ok(x.status === 409, `${lbl} ${x.status}`, c);
  }
  const rs = await api(A.sec, "POST", `/pos/intents/${a.body.id}/resolve`, { outcome: "declined", reason: "deneme" }, key());
  ok(rs.status === 409, `onaylıyı çözme ${rs.status}`, c);
  const d = await dev(t, "80.00");
  const dc = await api(A.sec, "POST", `/pos/intents/${d.body.id}/simulate`, { outcome: "declined" });
  ok(dc.status === 200 && dc.body.status === "declined" && !dc.body.paymentId, "ret → tahsilat yok", c);
  const u = await dev(t, "60.00");
  ok((await api(A.sec, "POST", `/pos/intents/${u.body.id}/simulate`, { outcome: "bilmem" })).status === 422, "bilinmeyen benzetim sonucu 422", c);
  const nr = await api(A.sec, "POST", `/pos/intents/${u.body.id}/simulate`, { outcome: "no_response" });
  ok(nr.body.status === "unknown", `yanıt yok → ${nr.body.status}`, c);
  const cx = await api(A.sec, "POST", `/pos/intents/${u.body.id}/cancel`, { reason: "Hasta gitti" });
  ok(cx.status === 409 && cx.body.code === "POS_INTENT_UNKNOWN", `sonuç bilinmiyor iptal edilemez ${cx.status}`, c);
  ok((await dev(t, "1.00")).status === 409, "sonuç bilinmiyorken yeni çekim 409", c);
  ok((await api(A.sec, "POST", `/pos/intents/${u.body.id}/resolve`, { outcome: "approved", authCode: "778899" }, key())).status === 422, "onay çözümü son 4 hanesiz 422", c);
  ok((await api(A.sec, "POST", `/pos/intents/${u.body.id}/resolve`, { outcome: "declined", reason: "x" }, key())).status === 422, "ret çözümü kısa gerekçe 422", c);
  ok((await api(A.dentist, "POST", `/pos/intents/${u.body.id}/resolve`, { outcome: "declined", reason: "Fişte yok" }, key())).status === 403, "hekim çözemez 403", c);
  const ra = await api(A.sec, "POST", `/pos/intents/${u.body.id}/resolve`, { outcome: "approved", authCode: "778899", cardLast4: "0001", installments: 2 }, key());
  ok(ra.status === 201 && ra.body.status === "approved" && ra.body.cardMasked === "•••• 0001", `fişe göre onay ${ra.status}`, c);
  const note = (await q("select note from payments where id = $1", [ra.body.paymentId]))[0]?.note ?? "";
  ok(/onay 778899/.test(note) && /2 taksit/.test(note), "fişteki taksit tahsilat notunda", c);
  const x2 = await dev(t, "30.00");
  await api(A.sec, "POST", `/pos/intents/${x2.body.id}/simulate`, { outcome: "no_response" });
  const rd = await api(A.sec, "POST", `/pos/intents/${x2.body.id}/resolve`, { outcome: "declined", reason: "Fişte çekim yok" }, key());
  ok(rd.status === 201 && rd.body.status === "declined" && !rd.body.paymentId, "fişe göre ret", c);
  const to = await dev(t, "40.00");
  await q("update pos_intents set sent_at = now() - interval '4 minutes' where id = $1", [to.body.id]);
  const g = await api(A.sec, "GET", `/pos/intents/${to.body.id}`);
  ok(g.body.status === "unknown" && (await q("select count(*)::int as n from audit_events where action = 'pos_intent.unknown' and entity_id = $1", [to.body.id]))[0].n === 1, `süre aşımı → ${g.body.status}, denetimli`, c);
  const sm = await api(A.sec, "POST", `/pos/intents/${to.body.id}/simulate`, { outcome: "approved" });
  ok(sm.status === 409, `süresi dolana benzetim ${sm.status}`, c);
  await api(A.sec, "POST", `/pos/intents/${to.body.id}/resolve`, { outcome: "declined", reason: "Fişte çekim yok" }, key());
  const cn = await dev(t, "20.00");
  ok((await api(A.sec, "POST", `/pos/intents/${cn.body.id}/cancel`, { reason: "Nakit ödeyecek" })).body.status === "cancelled", "kart bekleniyorken iptal", c);
  const mt = await mkTerm("manual", "benzetim");
  const mi = await api(A.sec, "POST", "/pos/intents", { terminalId: mt, patientId: pat, amount: "5.00", mode: "manual", authCode: "MM1234", cardLast4: "4321" }, key());
  const ms = await api(A.sec, "POST", `/pos/intents/${mi.body.id}/simulate`, { outcome: "approved" });
  ok(ms.status === 409 && ms.body.code === "POS_NOT_SIMULATED", `banka POS'unda benzetim ${ms.status}`, c);
  const acts = (await q("select action from audit_events where entity_id = $1", [u.body.id])).map((x) => x.action);
  ok(["pos_intent.create", "pos_intent.send", "pos_intent.unknown", "pos_intent.resolve", "pos_intent.approve"].every((x) => acts.includes(x)), `audit izi ${acts.join(",")}`, c);
  ok((await api(B.admin, "GET", `/pos/intents/${u.body.id}`)).status === 404, "B kiracısı işlemi göremez", c);
  rec("K03", c);
}

// K04 — eşzamanlılık
{ const c = [];
  const t = await mkTerm("mock", "eşzamanlı");
  const rs = await Promise.all([dev(t, "11.00"), dev(t, "12.00"), dev(t, "13.00")]);
  const created = rs.filter((x) => x.status === 201), busy = rs.filter((x) => x.status === 409);
  ok(created.length === 1 && busy.length === 2, `3 eşzamanlı → ${rs.map((x) => x.status).join("/")}`, c);
  ok((await q("select count(*)::int as n from pos_intents where terminal_id = $1", [t]))[0].n === 1, "tek niyet yazıldı", c);
  const id = created[0]?.body.id;
  const sims = await Promise.all([1, 2].map(() => api(A.sec, "POST", `/pos/intents/${id}/simulate`, { outcome: "approved" })));
  ok(sims.filter((x) => x.status === 200).length === 1 && sims.filter((x) => x.status === 409).length === 1, `eşzamanlı iki onay → ${sims.map((x) => x.status).join("/")}`, c);
  ok((await q("select count(*)::int as n from payments where pos_intent_id = $1", [id]))[0].n === 1, "tek tahsilat", c);
  const mt = await mkTerm("manual", "eşzamanlı");
  const k = key();
  const body = { terminalId: mt, patientId: pat, amount: "33.30", mode: "manual", authCode: "CC1234", cardLast4: "3333" };
  const same = await Promise.all([1, 2, 3].map(() => api(A.sec, "POST", "/pos/intents", body, k)));
  const ids = new Set(same.filter((x) => x.status === 201).map((x) => x.body.id));
  ok(same.every((x) => x.status === 201) && ids.size === 1, `aynı anahtar eşzamanlı → ${same.map((x) => x.status).join("/")}, ${ids.size} kimlik`, c);
  ok((await q("select count(*)::int as n from pos_intents where terminal_id = $1", [mt]))[0].n === 1 && (await q("select count(*)::int as n from payments p join pos_intents i on i.id = p.pos_intent_id where i.terminal_id = $1", [mt]))[0].n === 1, "tek niyet, tek tahsilat", c);
  rec("K04", c);
}

// K05 — gün sonu mutabakatı
{ const c = [];
  const t = await mkTerm("mock", "gün sonu");
  for (const amt of ["150.25", "49.75", "300.00"]) { const a = await dev(t, amt); await api(A.sec, "POST", `/pos/intents/${a.body.id}/simulate`, { outcome: "approved" }); }
  const dcl = await dev(t, "999.00"); await api(A.sec, "POST", `/pos/intents/${dcl.body.id}/simulate`, { outcome: "declined" });
  const open = await dev(t, "10.00");
  const dayR = await api(A.sec, "GET", `/pos/day?date=${today()}`);
  const row = dayR.body.items?.find((x) => x.terminalId === t);
  const ind = (await q(`select count(*)::int as n, coalesce(sum(amount),0)::text as s from pos_intents where terminal_id = $1 and status = 'approved'
     and (completed_at at time zone $2)::date = $3::date`, [t, TZ, today()]))[0];
  ok(row && row.approvedCount === ind.n && cents(row.approvedTotal) === cents(ind.s) && ind.n === 3 && cents(ind.s) === 50000, `sistem ${row?.approvedCount}/${row?.approvedTotal} = DB ${ind.n}/${ind.s}`, c);
  ok(row?.openCount === 1 && row?.intents.length === 5, `açık ${row?.openCount}, işlem ${row?.intents.length}`, c);
  const bl = await api(A.sec, "POST", "/pos/settlements", { terminalId: t, date: today(), slipCount: 3, slipTotal: "500.00" }, key());
  ok(bl.status === 409 && bl.body.code === "POS_OPEN_INTENTS", `açık işlemle kapanmaz ${bl.status}`, c);
  await api(A.sec, "POST", `/pos/intents/${open.body.id}/cancel`, { reason: "Gün sonu öncesi" });
  for (const [lbl, b, st] of [["fark açıklamasız (tutar)", { slipCount: 3, slipTotal: "499.99" }, 422], ["fark açıklamasız (adet)", { slipCount: 4, slipTotal: "500.00" }, 422],
    ["ileri tarih", { date: day(1), slipCount: 0, slipTotal: "0.00" }, 422], ["32 gün önce", { date: day(-32), slipCount: 0, slipTotal: "0.00" }, 422],
    ["adet negatif", { slipCount: -1, slipTotal: "0.00" }, 422], ["tutar biçimi", { slipCount: 3, slipTotal: "500,00" }, 422], ["tarih biçimi", { date: "09.11.2026", slipCount: 3, slipTotal: "500.00" }, 422]]) {
    const x = await api(A.sec, "POST", "/pos/settlements", { terminalId: t, date: today(), ...b }, key());
    ok(x.status === st, `${lbl} → ${x.status}`, c);
  }
  ok((await api(A.dentist, "POST", "/pos/settlements", { terminalId: t, date: today(), slipCount: 3, slipTotal: "500.00" }, key())).status === 403, "hekim kapatamaz", c);
  ok((await api(A.dentist, "GET", `/pos/day?date=${today()}`)).status === 403, "hekim gün sonunu göremez", c);
  ok((await api(A.sec, "GET", `/pos/day?date=${day(1)}`)).status === 422, "ileri gün sorgusu 422", c);
  const s = await api(A.sec, "POST", "/pos/settlements", { terminalId: t, date: today(), slipCount: 3, slipTotal: "500.00" }, key());
  ok(s.status === 201 && s.body.matched === true && s.body.systemCount === 3, `sekreter eşleşen gün sonu ${s.status}`, c);
  const again = await api(A.sec, "POST", "/pos/settlements", { terminalId: t, date: today(), slipCount: 3, slipTotal: "500.00" }, key());
  ok(again.status === 409 && again.body.code === "POS_DAY_CLOSED", `ikinci kez ${again.status}`, c);
  const late = await dev(t, "1.00");
  ok(late.status === 409 && late.body.code === "POS_DAY_CLOSED", `kapalı güne çekim ${late.status}`, c);
  const t2 = await mkTerm("mock", "farklı");
  const a2 = await dev(t2, "70.00"); await api(A.sec, "POST", `/pos/intents/${a2.body.id}/simulate`, { outcome: "approved" });
  const s2 = await api(A.fin, "POST", "/pos/settlements", { terminalId: t2, date: today(), slipCount: 2, slipTotal: "140.00", note: "Fişte sisteme girilmemiş bir çekim var" }, key());
  ok(s2.status === 201 && s2.body.matched === false, "açıklamalı fark kapanır, eşleşmedi", c);
  const r2 = (await api(A.fin, "GET", `/pos/day?date=${today()}`)).body.items.find((x) => x.terminalId === t2);
  ok(r2?.settlement?.matched === false && r2.settlement.slipTotal === "140.00" && r2.settlement.systemTotal === "70.00", "gün listesinde fark görünür", c);
  let immut = false; try { await q("update pos_settlements set slip_total = 70 where terminal_id = $1", [t2]); } catch { immut = true; }
  const appUpd = await q(`select count(*)::int as n from information_schema.column_privileges where grantee = 'viadent_app' and table_name = 'pos_settlements' and privilege_type = 'UPDATE'`, [], null);
  ok(appUpd[0].n === 0, `uygulama rolünün gün sonunda güncelleme yetkisi yok (${appUpd[0].n}); sahip güncellemesi ${immut ? "reddedildi" : "yapılabilir (yalnız sahip rolü)"}`, c);
  rec("K05", c);
}

// K06 — kart verisi gizliliği, audit etiketleri, dışa aktarım
{ const c = [];
  const scan = await admin.query(`
    select 'pos_intents' t, count(*)::int n from pos_intents where concat_ws('|', auth_code, card_last4, note, provider_ref, failure_reason, allocations::text) like '%' || $1 || '%'
    union all select 'payments', count(*)::int from payments where coalesce(note,'') like '%' || $1 || '%'
    union all select 'audit_events', count(*)::int from audit_events where changes::text like '%' || $1 || '%'
    union all select 'idempotency_keys', count(*)::int from idempotency_keys where coalesce(response::text,'') like '%' || $1 || '%'
    union all select 'outbox_events', count(*)::int from outbox_events where payload::text like '%' || $1 || '%'
    union all select 'pos_settlements', count(*)::int from pos_settlements where coalesce(note,'') like '%' || $1 || '%'`, [TEST_PAN]);
  ok(scan.rows.every((r) => r.n === 0), `test kart numarası hiçbir yerde yok: ${scan.rows.map((r) => `${r.t}=${r.n}`).join(",")}`, c);
  const long = await admin.query(`select count(*)::int n from pos_intents where card_last4 !~ '^[0-9]{4}$'`);
  ok(long.rows[0].n === 0, "card_last4 hep 4 rakam", c);
  const resp = await api(A.sec, "GET", `/pos/day?date=${today()}`);
  const txt = JSON.stringify(resp.body);
  ok(!/"cardLast4"|"card_last4"/.test(txt) && /•••• \d{4}/.test(txt), "API kart özetini yalnız maskeli döner", c);
  const acts = (await q("select distinct action from audit_events where action like 'pos_%'")).map((x) => x.action);
  const labels = await import("../../packages/contracts/src/audit.ts").catch(() => null);
  const L = labels?.AUDIT_ACTION_LABELS ?? labels?.ACTION_LABELS ?? null;
  ok(acts.length >= 7 && (!L || acts.every((a) => L[a])), `POS audit eylemleri ${acts.length}${L ? " Türkçe etiketli" : " (etiket tablosu okunamadı)"}`, c);
  const ex = await api(A.admin, "POST", "/exports/clinic", { reason: "QA POS dışa aktarım denetimi" });
  const counts = ex.body?.counts ?? ex.body?.manifest?.counts ?? {};
  ok(ex.status === 200 && ["pos_terminals", "pos_intents", "pos_settlements"].every((k) => typeof counts[k] === "number" && counts[k] > 0), `dışa aktarım ${ex.status} ${["pos_terminals", "pos_intents", "pos_settlements"].map((k) => `${k}=${counts[k]}`).join(",")}`, c);
  rec("K06", c);
}

writeFileSync(`${OUT}/k-summary.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
await pool.end(); await admin.end();
