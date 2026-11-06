// CEZERİ teslim testi — PİA-DENT ürün sahibi geri bildirimi 07.11.2026 HTTP vakaları (G01–G15). Ürün kodunu değiştirmez.
// Yalnız sentetik veri; Netgsm'e gerçek istek atılmaz (G13 yerel sahte sunucu). Üretime dokunulmaz.
// Kullanım: BASE=http://127.0.0.1:4000 PASSWORD=<güvenli ortam> OWNER_URL=<yerel> WORKER_URL=<yerel> OUT=<evidence> node qa-runs/.scripts/g-cases.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const pg = require("pg");

const BASE = process.env.BASE ?? "http://127.0.0.1:4000";
const PASSWORD = process.env.PASSWORD; const OUT = process.env.OUT ?? "evidence"; const OWNER_URL = process.env.OWNER_URL; const WORKER_URL = process.env.WORKER_URL;
if (!PASSWORD || !OWNER_URL || !WORKER_URL) { console.error("PASSWORD, OWNER_URL ve WORKER_URL gerekli"); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36).slice(-5);
const results = [];
const rec = (id, c, extra = "") => { const status = c.length && c.every((x) => x.pass) ? "PASS" : "FAIL";
  results.push({ id, status, summary: `${c.filter((x) => x.pass).length}/${c.length} kontrol${extra}: ${c.filter((x) => !x.pass).map((x) => x.check).join("; ") || "hepsi geçti"}`, at: new Date().toISOString(), evidence: `${id}-http.json` });
  writeFileSync(`${OUT}/${id}-http.json`, JSON.stringify({ checks: c }, null, 1)); console.log(`${status.padEnd(6)} ${id} ${results.at(-1).summary}`); };
const ok = (cond, label, list) => { list.push({ check: label, pass: !!cond }); return !!cond; };
const pool = new pg.Pool({ connectionString: OWNER_URL, max: 2 });
let TENANT = null;
const q = async (sql, args = [], tenant = TENANT) => { const c = await pool.connect();
  try { await c.query("begin"); await c.query("select set_config('app.tenant_id', $1, true)", [tenant]); const r = await c.query(sql, args); await c.query("commit"); return r.rows; } finally { c.release(); } };
async function api(s, method, path, body, headers = {}) {
  const h = { "content-type": "application/json", "x-viadent-request": "1", ...headers };
  if (s?.cookie) h.cookie = s.cookie; if (s?.ctx) h["x-viadent-context"] = s.ctx;
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j, headers: Object.fromEntries(r.headers), text: t };
}
async function login(email) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-viadent-request": "1" }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (r.status !== 200) { console.error("giriş", email.split("@")[0], r.status); process.exit(2); }
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const s = await (await fetch(`${BASE}/api/v1/session`, { headers: { cookie } })).json();
  return { cookie, ctx: s.activeMembership.id, tenantId: s.activeMembership.tenantId, permissions: s.activeMembership.permissions ?? s.permissions };
}
const key = () => "qa-" + randomUUID();
const TZ = "Europe/Istanbul";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const day = (n) => { const [y, m, d] = today().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const cents = (v) => Math.round(Number(v) * 100);
const sum = (rows, k) => rows.reduce((n, r) => n + cents(r[k]), 0);

const A = { admin: await login("yonetici@demo-yesil.test"), dentist: await login("elif.aras@demo-yesil.test"), sec: await login("sekreter@demo-yesil.test"),
  asst: await login("asistan@demo-yesil.test"), fin: await login("finans@demo-yesil.test") };
const B = { admin: await login("yonetici@demo-mavi.test") };
TENANT = A.admin.tenantId;
const newPatient = async (tag, extra = {}) => (await api(A.sec, "POST", "/patients", { firstName: "Sınama", lastName: `${tag}${RUN}`, phone: "0555 222 33 44", acknowledgeDuplicates: true, ...extra })).body.patient.id;
const pracId = (await api(A.admin, "POST", "/practitioners", { displayName: `Dt. Sınama ${RUN}` })).body.id;
await api(A.admin, "PUT", `/practitioners/${pracId}/schedule`, { blocks: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "13:00" })) });

// G01 — yönetici her şeyi görür ve yapar; sağlık görüntülemesi izlenir
{ const c = []; const pid = await newPatient("Yon");
  await api(A.dentist, "POST", `/patients/${pid}/clinical-notes`, { body: "Sentetik QA notu" });
  for (const p of [`/patients/${pid}/chart`, `/patients/${pid}/clinical-notes`, `/patients/${pid}/health-notes`]) { const r = await api(A.admin, "GET", p); ok(r.status === 200, `yönetici ${p.split("/").pop()} ${r.status}`, c); }
  const w = await api(A.admin, "POST", `/patients/${pid}/clinical-notes`, { body: "Yönetici QA notu" }); ok(w.status === 201, `yönetici klinik not yazar ${w.status}`, c);
  const cash = (await api(A.admin, "GET", "/cash-accounts")).body.items.find((x) => x.kind === "cash").id;
  const pay = await api(A.admin, "POST", "/payments", { patientId: pid, amount: "10.00", method: "cash", cashAccountId: cash, allocations: [] }, { "idempotency-key": key() }); ok(pay.status === 201, `yönetici tahsilat ${pay.status}`, c);
  const v = await q("select changes->>'section' as s from audit_events where action = 'patient.health_view' and patient_id = $1", [pid]);
  ok(v.length >= 3 && ["Diş şeması", "Klinik notlar", "Hasta kartı sağlık özeti"].every((s) => v.some((x) => x.s === s)), `sağlık görüntüleme izi (${v.length})`, c);
  rec("G01", c); }

// G02 — diğer roller rol bazlı kaldı
{ const c = []; const pid = await newPatient("Rol");
  for (const [n, s] of [["sekreter", A.sec], ["finans", A.fin]]) { const r = await api(s, "GET", `/patients/${pid}/chart`); ok(r.status === 403, `${n} diş şeması ${r.status}`, c); }
  ok((await api(A.dentist, "GET", "/reports/gelirler")).status === 403, "hekim gelir raporu 403", c);
  ok((await api(A.asst, "POST", "/messaging/send", { patientIds: [pid], body: "x y" }, { "idempotency-key": key() })).status === 403, "asistan mesaj 403", c);
  ok((await api(A.sec, "POST", "/integrations/connections/netgsm", {})).status === 403, "sekreter Netgsm bağlantısı 403", c);
  rec("G02", c); }

// G03 — rapor kataloğu: kaldırılan kartlar gizli, sekmeler var; Gelirler toplamları
{ const c = []; const cat = (await api(A.fin, "GET", "/reports")).body.reports;
  const hidden = cat.filter((r) => r.hidden).map((r) => r.id).sort();
  ok(JSON.stringify(hidden) === JSON.stringify(["hekim-hasta", "kontrol", "mesaj", "online-odeme", "plan", "prim", "tedavi"].filter((x) => cat.some((r) => r.id === x))), `gizli kartlar ${hidden}`, c);
  ok(["gelirler", "giderler", "tedarikci"].every((t) => cat.some((r) => r.tab === t)), "sekme raporları", c);
  const pid = await newPatient("Gelir"); const cash = (await api(A.fin, "GET", "/cash-accounts")).body.items.find((x) => x.kind === "cash").id;
  const pay = (await api(A.fin, "POST", "/payments", { patientId: pid, amount: "300.00", method: "card_manual", cashAccountId: cash, allocations: [] }, { "idempotency-key": key() })).body;
  await api(A.fin, "POST", `/payments/${pay.id}/refunds`, { amount: "40.00", method: "cash", cashAccountId: cash, reason: "QA iade" }, { "idempotency-key": key() });
  const r = (await api(A.fin, "GET", `/reports/gelirler?from=${today()}&to=${today()}`)).body;
  const mine = r.rows.find((x) => x.receiptNo === pay.receiptNo);
  ok(mine && mine.amount === "300.00" && mine.refunded === "40.00" && mine.net === "260.00" && mine.method === "Kart (POS)", "satır alınan/iade/net/yöntem", c);
  ok(sum(r.rows, "amount") === cents(r.totals.amount) && sum(r.rows, "net") === cents(r.totals.net), "satır toplamı = toplam", c);
  rec("G03", c); }

// G04 — Giderler başlıkları; malzeme kullanım maliyeti; özet = başlıklar
{ const c = [];
  const cash = (await api(A.fin, "GET", "/cash-accounts")).body.items.find((x) => x.kind === "cash").id;
  for (const [cat, amt] of [["Kira", "15000.00"], ["Aidat", "1200.00"], ["Fatura (elektrik/su/internet)", "830.40"], ["Personel", "5000.00"]])
    ok((await api(A.fin, "POST", "/expenses", { category: cat, description: `QA ${cat} ${RUN}`, amount: amt, cashAccountId: cash }, { "idempotency-key": key() })).status === 201, `gider ${cat}`, c);
  const item = (await api(A.admin, "POST", "/stock/items", { code: `QA-${RUN}`, name: `QA sarf ${RUN}`, unit: "adet", minLevel: "0" })).body.id;
  await api(A.admin, "POST", "/stock/receipts", { itemId: item, quantity: "20", unitCost: "12.50" }, { "idempotency-key": key() });
  await api(A.asst, "POST", "/stock/usages", { itemId: item, quantity: "4" }, { "idempotency-key": key() });
  const g = async (k) => (await api(A.fin, "GET", `/reports/giderler?from=${today()}&to=${today()}${k ? `&kalem=${k}` : ""}`)).body;
  const kira = await g("kira"), aidat = await g("aidat"), fat = await g("fatura"), maas = await g("maas"), mal = await g("malzeme"), oz = await g("");
  ok(kira.rows.some((x) => x.label === `QA Kira ${RUN}` && x.amount === "15000.00"), "Kira", c);
  ok(aidat.rows.some((x) => x.label === `QA Aidat ${RUN}`) && !kira.rows.some((x) => x.label.includes("Aidat")), "Aidat ayrı", c);
  ok(fat.rows.some((x) => x.amount === "830.40"), "Faturalar", c);
  ok(maas.rows.some((x) => x.label === `QA Personel ${RUN}`), "Personel → Maaşlar", c);
  ok(mal.rows.some((x) => x.label.startsWith(`QA sarf ${RUN}`) && x.amount === "50.00"), "kullanım 4 × 12,50 = 50,00 Malzemeler'de", c);
  ok(JSON.stringify(oz.rows.map((x) => x.head)) === JSON.stringify(["Maaşlar", "Malzemeler", "Kira", "Aidat", "Faturalar", "Diğer giderler"]), "özet başlıkları", c);
  ok(sum(oz.rows, "amount") === cents(oz.totals.amount), "özet toplamı = başlıklar", c);
  for (const [k, r] of [["kira", kira], ["malzeme", mal]]) ok(oz.rows.find((x) => x._drill?.params?.kalem === k)?.amount === r.totals.amount, `özet ${k} = detay toplamı`, c);
  rec("G04", c); }

// G05 — Tedarikçi: alınan ürün, ödenen, kalan
{ const c = []; const sup = (await api(A.admin, "POST", "/suppliers", { kind: "medical", name: `QA Medikal ${RUN}` })).body.id;
  const item = (await api(A.admin, "POST", "/stock/items", { code: `QT-${RUN}`, name: `QA kompozit ${RUN}`, unit: "adet", minLevel: "0" })).body.id;
  ok((await api(A.admin, "POST", "/stock/receipts", { itemId: item, quantity: "8", unitCost: "250.00", supplierId: sup, createBill: true, documentNo: `F-${RUN}` }, { "idempotency-key": key() })).status === 201, "alım + fatura", c);
  const cash = (await api(A.fin, "GET", "/cash-accounts")).body.items.find((x) => x.kind === "cash").id;
  ok((await api(A.fin, "POST", "/supplier-payments", { supplierId: sup, amount: "750.00", cashAccountId: cash }, { "idempotency-key": key() })).status === 201, "ödeme", c);
  const all = (await api(A.fin, "GET", `/reports/tedarikci?from=${today()}&to=${today()}`)).body;
  const row = all.rows.find((x) => x.name === `QA Medikal ${RUN}`);
  ok(row && row.items === 1 && row.billed === "2000.00" && row.paid === "750.00" && row.remaining === "1250.00", `özet satır ${JSON.stringify(row && { i: row.items, b: row.billed, p: row.paid, r: row.remaining })}`, c);
  ok(["billed", "paid", "remaining"].every((k) => sum(all.rows, k) === cents(all.totals[k])), "özet toplamları", c);
  const one = (await api(A.fin, "GET", `/reports/tedarikci?from=${today()}&to=${today()}&supplierId=${sup}`)).body;
  ok(one.rows.some((x) => x.kind === "Alım" && x.product.includes(`QA kompozit ${RUN}`) && x.docNo === `F-${RUN}`), "ürün satırı", c);
  ok(one.totals.remaining === "1250.00", "kalan", c);
  rec("G05", c); }

// G06 — İşlem kayıtları sorgulama Türkçe
{ const c = []; const r = (await api(A.admin, "GET", `/reports/log?from=${today()}&to=${today()}`)).body;
  ok(r.rows.length > 0, `satır ${r.rows.length}`, c);
  ok(r.rows.every((x) => !/^[a-z_]+\.[a-z_.]+$/.test(x.action)), "işlem Türkçe", c);
  ok(r.rows.every((x) => !/^[a-z]+_[a-z_]+/.test(x.entity)), "kayıt türü Türkçe", c);
  ok(r.rows.every((x) => !/\b[a-z]+_[a-z_]+\b/.test(x.fields)), "alan adları Türkçe", c);
  const s = (await api(A.admin, "GET", `/reports/log?from=${today()}&to=${today()}&q=gider`)).body;
  ok(s.rows.length > 0 && s.rows.every((x) => x.actionCode.startsWith("expense.")), "Türkçe arama", c);
  const def = (await api(A.admin, "GET", "/reports")).body.reports.find((x) => x.id === "log");
  ok(def.title === "İşlem kayıtları sorgulama" && def.filters.find((f) => f.key === "entityType").kind === "select", "başlık + seçim süzgeci", c);
  rec("G06", c); }

// G07 — İşlem türleri = tüm işlemler fiyatıyla; randevuda tek işlem
{ const c = []; const p = (await api(A.sec, "GET", "/procedures")).body.items;
  ok(p.length >= 55, `işlem sayısı ${p.length}`, c);
  ok(p.filter((x) => x.price).length >= 55, `fiyatlı ${p.filter((x) => x.price).length}`, c);
  ok(p.every((x) => x.price === null || /^\d+\.\d{2}$/.test(x.price)), "fiyat biçimi", c);
  rec("G07", c); }

// G08 — izin / rapor / resmî tatil
{ const c = []; const d = day(5);
  const mk = (s, b) => api(s, "POST", "/closures", { startDate: d, startTime: "00:00", endDate: d, endTime: "24:00", reason: "QA kapalı gün", ...b });
  ok((await mk(A.admin, { kind: "sick_leave", scope: "practitioner", practitionerId: pracId })).status === 201, "rapor", c);
  const av = (await api(A.sec, "GET", `/availability?practitionerId=${pracId}&date=${d}&minutes=30`)).body;
  ok(av.slots.length === 0 && av.closedAllDay?.kind === "sick_leave", "rapor günü boş saat yok", c);
  ok((await mk(A.admin, { kind: "public_holiday", scope: "practitioner", practitionerId: pracId })).status === 422, "resmî tatil hekim kapsamında 422", c);
  ok((await mk(A.admin, { kind: "leave", scope: "clinic" })).status === 422, "izin klinik kapsamında 422", c);
  ok((await mk(A.sec, { kind: "leave", scope: "practitioner", practitionerId: pracId })).status === 403, "sekreter 403", c);
  const l = (await api(A.sec, "GET", "/closures")).body.items.find((x) => x.practitionerId === pracId);
  ok(l?.kindLabel === "Rapor", "liste türü Türkçe", c);
  rec("G08", c); }

// G09 — sağlık özeti
{ const c = []; const pid = await newPatient("Saglik");
  ok((await api(A.sec, "PUT", `/patients/${pid}/health-notes`, { allergies: "x" })).status === 403, "sekreter yazamaz", c);
  ok((await api(A.dentist, "PUT", `/patients/${pid}/health-notes`, { chronicConditions: "QA-DİYABET", regularMedications: "QA-İLAÇ" })).status === 200, "hekim yazar", c);
  const s = (await api(A.sec, "GET", `/patients/${pid}/health-notes`)).body;
  ok(s.exists === true && s.restricted === true && !JSON.stringify(s).includes("QA-"), "sekreter yalnız işaret", c);
  const f = (await api(A.fin, "GET", `/patients/${pid}/health-notes`)).body; ok(f.restricted === true, "finans yalnız işaret", c);
  const d = (await api(A.asst, "GET", `/patients/${pid}/health-notes`)).body; ok(d.chronicConditions === "QA-DİYABET", "asistan okur", c);
  const aud = await q("select changes::text t from audit_events where action = 'health_notes.update' and patient_id = $1", [pid]);
  ok(aud.length === 1 && !aud[0].t.includes("QA-"), "denetimde içerik yok", c);
  ok(!JSON.stringify((await api(A.sec, "GET", `/patients/${pid}/history`)).body).includes("health_notes"), "sekreter geçmişinde yok", c);
  const ex = await api(A.sec, "POST", `/patients/${pid}/export`, { reason: "QA KVKK talebi" });
  ok(ex.status === 403 || (ex.status === 200 && !ex.text.includes("QA-DİYABET")), `sağlık yetkisiz dışa aktarım içerik yok (${ex.status})`, c);
  rec("G09", c); }

// G10 — uygun boş saatler
{ const c = []; const d = day(6); const pid = await newPatient("Slot");
  let av = (await api(A.sec, "GET", `/availability?practitionerId=${pracId}&date=${d}&minutes=30`)).body;
  ok(av.slots[0] === "09:00" && av.slots.at(-1) === "12:30" && av.slots.length === 15, `başlangıç listesi ${av.slots.length}`, c);
  await api(A.sec, "POST", "/appointments", { patientId: pid, practitionerId: pracId, date: d, startTime: "11:00", durationMinutes: 45 });
  av = (await api(A.sec, "GET", `/availability?practitionerId=${pracId}&date=${d}&minutes=30`)).body;
  ok(!["10:45", "11:00", "11:15", "11:30"].some((t) => av.slots.includes(t)) && av.slots.includes("10:30") && av.slots.includes("11:45"), "dolu aralık çıkarıldı", c);
  const B1 = (await api(B.admin, "GET", `/availability?practitionerId=${pracId}&date=${d}&minutes=30`)); ok(B1.status === 422, `B kliniği A hekimi ${B1.status}`, c);
  rec("G10", c); }

// G11 — randevu ödeme planı → gerçek tahsilat; hasta hesabı toplamları
{ const c = []; const pid = await newPatient("Odeme"); const procs = (await api(A.sec, "GET", "/procedures")).body.items; const kan = procs.find((x) => x.code === "KAN-01");
  const a = (await api(A.sec, "POST", "/appointments", { patientId: pid, practitionerId: pracId, procedureId: kan.id, date: day(7), startTime: "09:00", durationMinutes: 60 })).body;
  const cash = (await api(A.sec, "GET", "/cash-accounts")).body.items.find((x) => x.kind === "cash").id;
  const k = key();
  const p1 = await api(A.sec, "POST", "/payments", { patientId: pid, amount: "1000.00", method: "cash", cashAccountId: cash, appointmentId: a.id, allocations: [] }, { "idempotency-key": k });
  const p2 = await api(A.sec, "POST", "/payments", { patientId: pid, amount: "1000.00", method: "cash", cashAccountId: cash, appointmentId: a.id, allocations: [] }, { "idempotency-key": k });
  ok(p1.status === 201 && p2.body.id === p1.body.id, "kısmi ödeme tekil (aynı anahtar)", c);
  ok((await q("select appointment_id from payments where id = $1", [p1.body.id]))[0]?.appointment_id === a.id, "randevuya bağlı", c);
  const acc = (await api(A.sec, "GET", `/patients/${pid}/account`)).body.totals;
  ok(acc.paid === "1000.00" && acc.advance === "1000.00" && acc.openDebt === "0.00" && acc.receivable === "0.00", "toplam ödeme / avans / kalan", c);
  rec("G11", c); }

// G12 — mesajlar: izin kapısı, zamanlama, kural bir kez, DENEME etiketi, sır yok
{ const c = []; const { processMessageRules, processMessageSchedules } = await import("../../packages/db/src/messaging.ts").catch(() => ({}));
  const st = (await api(A.dentist, "GET", "/messaging/status")).body;
  ok(st.realSending === false && /DENEME/.test(st.label), "Netgsm hazır değil → DENEME", c);
  ok(!/"(password|usercode)"/.test(JSON.stringify(st)), "durumda sır yok", c);
  const yes = await newPatient("Izinli"); const no = await newPatient("Izinsiz");
  await api(A.sec, "POST", `/patients/${yes}/communication-preferences`, { purpose: "treatment_followup", channel: "sms", status: "granted", source: "in_person" });
  await api(A.sec, "POST", `/patients/${yes}/communication-preferences`, { purpose: "appointment_reminder", channel: "sms", status: "granted", source: "in_person" });
  const s = (await api(A.dentist, "POST", "/messaging/send", { patientIds: [yes, no], purpose: "treatment_followup", body: "QA bilgi mesajı" }, { "idempotency-key": key() })).body;
  ok(s.queued === 1 && s.skipped === 1, `gönder ${s.queued}/${s.skipped}`, c);
  const sc = await api(A.sec, "POST", "/messaging/schedules", { patientIds: [yes], purpose: "appointment_reminder", body: "QA alarm", sendAt: new Date(Date.now() + 120_000).toISOString() }, { "idempotency-key": key() });
  ok(sc.status === 201, "zamanla", c);
  ok((await api(A.admin, "PUT", "/messaging/rules/before_appointment", { hours: 72, body: "Sayın {hasta}, {tarih} {saat}", active: true })).status === 200, "kural", c);
  const appt = (await api(A.sec, "POST", "/appointments", { patientId: yes, practitionerId: pracId, date: day(2), startTime: "12:00", durationMinutes: 30 })).body;
  if (processMessageRules) {
    const wp = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
    try { await processMessageSchedules(wp, new Date(Date.now() + 300_000)); await processMessageRules(wp); await processMessageRules(wp); } finally { await wp.end(); }
    ok((await q("select status from message_schedules where id = $1", [sc.body.ids[0]]))[0]?.status === "queued", "zamanı gelen alarm kuyrukta", c);
    ok((await q("select count(*)::int n from message_rule_runs where appointment_id = $1", [appt.id]))[0].n === 1, "kural bir kez", c);
    ok((await q("select count(*)::int n from messages where patient_id = $1 and source = 'rule' and body like 'Sayın Sınama, %'", [yes]))[0].n === 1, "şablon doldu", c);
  } else ok(false, "worker modülü yüklenemedi", c);
  await api(A.admin, "PUT", "/messaging/rules/before_appointment", { hours: 72, body: "Sayın {hasta}, {tarih} {saat}", active: false });
  ok((await q("select count(*)::int n from messages where patient_id = $1", [no]))[0].n === 0, "izinsize mesaj yok", c);
  ok((await q("select distinct provider from messages where patient_id = $1", [yes])).every((x) => x.provider === "mock"), "sağlayıcı DENEME", c);
  rec("G12", c); }

// G13 — Netgsm adaptörü sözleşmesi (yerel sahte sunucu; gerçek Netgsm'e istek yok)
{ const c = []; const seen = [];
  const srv = createServer((req, res) => { let b = ""; req.on("data", (x) => (b += x)); req.on("end", () => { seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b || "{}") });
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(req.url.endsWith("/send") ? (seen.length === 1 ? { code: "00", jobid: "QAJOB1" } : { code: "40" }) : { code: "00", jobs: [{ jobid: "QAJOB1", status: 1 }] })); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { NetgsmSmsAdapter } = await import("../../packages/db/src/netgsm.ts");
  const a = new NetgsmSmsAdapter({ usercode: "QAUSER", password: "QAPASS", msgheader: "QABASLIK", appname: "PIA-DENT", baseUrl: `http://127.0.0.1:${srv.address().port}` });
  const r1 = await a.submit("sms.send", { to: "+905552223344", body: "QA mesaj" });
  ok(r1.outcome === "accepted" && r1.providerRef === "QAJOB1", "kabul + jobid", c);
  ok(seen[0]?.url === "/sms/rest/v2/send" && seen[0].auth === `Basic ${Buffer.from("QAUSER:QAPASS").toString("base64")}`, "uç + Basic yetki", c);
  ok(seen[0]?.body.msgheader === "QABASLIK" && seen[0].body.encoding === "TR" && seen[0].body.iysfilter === "0" && seen[0].body.messages?.[0]?.no === "905552223344", "gövde biçimi", c);
  const r2 = await a.submit("sms.send", { to: "+905552223344", body: "QA mesaj" });
  ok(r2.outcome === "rejected" && /Gönderen adı/.test(r2.message), "ret kodu Türkçe", c);
  const rep = await a.report(["QAJOB1"]); ok(rep[0]?.status === 1, "teslim raporu", c);
  srv.close(); rec("G13", c); }

// G14 — klinik dışa aktarımı: attachment, yeni tablolar, sır yok
{ const c = []; const r = await api(A.admin, "POST", "/exports/clinic", { reason: "QA dışa aktarım sınaması" });
  ok(r.status === 200 && /attachment; filename="viadent-klinik-disa-aktarim-\d{4}-\d{2}-\d{2}\.json"/.test(r.headers["content-disposition"] ?? ""), `200 + dosya adı (${r.status})`, c);
  const d = r.status === 200 ? JSON.parse(r.text) : { tables: {} };
  for (const t of ["invoices", "receipts", "salary_payments", "supplier_prices", "patient_health_notes", "message_rules", "message_schedules"]) ok(t in d.tables, `tablo ${t}`, c);
  ok(!/password_hash|token_hash|webhook_secret_enc|NETGSM/.test(r.text), "sır yok", c);
  ok(Object.entries(d.tables).every(([t, rows]) => d.counts[t] === rows.length), "sayılar tutarlı", c);
  ok((await api(A.fin, "POST", "/exports/clinic", { reason: "QA yetkisiz" })).status === 403, "finans 403", c);
  rec("G14", c); }

// G15 — tamamlanan randevuda kullanılan malzeme → Giderler / Malzemeler
{ const c = []; const pid = await newPatient("Malzeme");
  const a = (await api(A.admin, "POST", "/appointments", { patientId: pid, practitionerId: pracId, date: day(-1), startTime: "10:00", durationMinutes: 30, backdateReason: "QA geriye dönük ziyaret" })).body;
  let v = (await api(A.sec, "POST", `/appointments/${a.id}/status`, { version: a.version, status: "checked_in" })).body.version;
  v = (await api(A.sec, "POST", `/appointments/${a.id}/status`, { version: v, status: "in_progress" })).body.version;
  await api(A.dentist, "POST", `/appointments/${a.id}/status`, { version: v, status: "completed" });
  const item = (await api(A.admin, "POST", "/stock/items", { code: `QM-${RUN}`, name: `QA malzeme ${RUN}`, unit: "adet", minLevel: "0" })).body.id;
  await api(A.admin, "POST", "/stock/receipts", { itemId: item, quantity: "10", unitCost: "33.30" }, { "idempotency-key": key() });
  const m = await api(A.asst, "POST", `/appointments/${a.id}/materials`, { items: [{ itemId: item, quantity: "3" }] }, { "idempotency-key": key() });
  ok(m.status === 201, `malzeme girişi ${m.status}`, c);
  const mal = (await api(A.fin, "GET", `/reports/giderler?from=${today()}&to=${today()}&kalem=malzeme`)).body;
  ok(mal.rows.some((x) => x.kind === "Randevuda kullanılan malzeme" && x.label.startsWith(`QA malzeme ${RUN}`) && x.amount === "99.90"), "Malzemeler'de 3 × 33,30 = 99,90", c);
  rec("G15", c); }

writeFileSync(`${OUT}/g-summary.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
await pool.end();
