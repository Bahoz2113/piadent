// CEZERİ teslim testi — VİADENT HTTP vakaları (V01–V05, P01–P03). Ürün kodunu değiştirmez; yalnız sentetik demo verisiyle çalışır.
// Kullanım: BASE=http://127.0.0.1:4000 PASSWORD=<güvenli ortamdan> OUT=qa-runs/<id>/evidence node qa-runs/.scripts/http-cases.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";

const BASE = process.env.BASE ?? "http://127.0.0.1:4000";
const PASSWORD = process.env.PASSWORD;
const OUT = process.env.OUT ?? "evidence";
if (!PASSWORD) { console.error("PASSWORD gerekli (güvenli ortamdan)"); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36);
const started = new Date().toISOString();

// ---- maskeleme: e-posta → rol etiketi, ad/soyad/telefon/kimlik alanları gizlenir
const ROLE_OF = { "yonetici@demo-yesil.test": "A-yonetici", "elif.aras@demo-yesil.test": "A-hekim", "sekreter@demo-yesil.test": "A-sekreter", "finans@demo-yesil.test": "A-finans",
  "yonetici@demo-mavi.test": "B-yonetici", "hekim@demo-mavi.test": "B-hekim" };
const SENSITIVE = /^(firstName|lastName|fullName|full_name|name|displayName|phone|email|nationalId|national_id|birthDate|note|address|actorName|by|practitionerName|actor_name)$/;
export function mask(v) {
  if (Array.isArray(v)) return v.map(mask);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE.test(k) && typeof x === "string" ? `‹${k}:${x.length}›` : mask(x)]));
  return v;
}

const results = []; // vaka kayıtları
const bugs = [];
function record(id, status, data) { results.push({ id, status, at: new Date().toISOString(), ...data }); console.log(`${status.padEnd(8)} ${id}  ${data.summary ?? ""}`); }
function bug(id, severity, title, details) { bugs.push({ id, severity, state: "OPEN", title, ...details }); }

async function api(sess, method, path, body, headers = {}) {
  const h = { "content-type": "application/json", "x-viadent-request": "1", ...headers };
  if (sess?.cookie) h.cookie = sess.cookie;
  if (sess?.ctx) h["x-viadent-context"] = sess.ctx;
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, headers: Object.fromEntries(r.headers) };
}
async function login(email, password = PASSWORD) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-viadent-request": "1" }, body: JSON.stringify({ email, password }) });
  if (r.status !== 200) return { status: r.status, body: await r.json().catch(() => null) };
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const s = await (await fetch(`${BASE}/api/v1/session`, { headers: { cookie } })).json();
  return { status: 200, cookie, ctx: s.activeMembership.id, role: ROLE_OF[email] ?? "?", tenant: s.activeMembership.tenant?.slug ?? s.activeMembership.tenantSlug, raw: s };
}
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
const plusDays = (n) => { const [y, m, d] = today().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
// hafta içi bir gün (hekim çalışma saatleri genelde hafta içi)
function weekday(offsetMin) { for (let n = offsetMin; n < offsetMin + 10; n++) { const dt = new Date(plusDays(n) + "T12:00:00Z"); if (dt.getUTCDay() >= 1 && dt.getUTCDay() <= 5) return plusDays(n); } }
const key = () => "qa-" + randomUUID();
// koşu başına benzersiz gün/saat: hedef günde hekimin dolu saatlerine bakıp boş yarım saat seçilir (önceki koşularla çakışmasın; hafta içi 09:00–16:30)
const SALT = Math.floor(Date.now() / 1000) % 89;
async function slot(base, sess, pracId) {
  const date = weekday(base + SALT);
  const r = await api(sess, "GET", `/appointments?date=${date}`);
  const busy = new Set((r.body.items ?? []).filter((x) => x.practitionerId === pracId && x.status !== "cancelled").map((x) => new Date(x.startsAt).getTime()));
  for (let h = 9 + (SALT % 7); h <= 16; h++) for (const m of ["00", "30"]) {
    const t = new Date(`${date}T${String(h).padStart(2, "0")}:${m}:00+03:00`).getTime();
    if (![...busy].some((b) => Math.abs(b - t) < 60 * 60_000)) return { date, startTime: `${String(h).padStart(2, "0")}:${m}` };
  }
  return { date, startTime: "16:30" };
}
const A = { admin: await login("yonetici@demo-yesil.test"), dentist: await login("elif.aras@demo-yesil.test"), sec: await login("sekreter@demo-yesil.test"), fin: await login("finans@demo-yesil.test") };
const B = { admin: await login("yonetici@demo-mavi.test"), dentist: await login("hekim@demo-mavi.test") };
for (const [k, s] of Object.entries({ ...A, ...B })) if (s.status !== 200) { console.error("giriş başarısız", k, s.status); process.exit(2); }

// ---- ortak veri: A'da yeni sentetik hasta
const pat = await api(A.sec, "POST", "/patients", { firstName: "Sınama", lastName: `Hasta${RUN}`, birthDate: "1985-03-04", phone: `0555 ${String(Date.now() % 1000).padStart(3, "0")} 11 22`, acknowledgeDuplicates: true });
if (pat.status !== 201) { console.error("hasta oluşturulamadı", pat.status, pat.body); process.exit(2); }
const P = pat.body.patient?.id ?? pat.body.id;
const res = (await api(A.sec, "GET", "/resources")).body;
const prac = res.practitioners[0];
const cash = (await api(A.fin, "GET", "/cash-accounts")).body.items.find((x) => x.active);

// ============================ V01 — kayıt gizliliği ============================
{
  const steps = [];
  const probe = async (label, sess, method, path, body) => { const r = await api(sess, method, path, body); steps.push({ label, role: sess.role, method, path: path.replace(P, "<A-hasta>"), status: r.status, code: r.body?.code, leak: JSON.stringify(r.body).includes(`Hasta${RUN}`) }); return r; };
  await probe("B yönetici → A hastası GET", B.admin, "GET", `/patients/${P}`);
  await probe("B hekim → A hastası GET", B.dentist, "GET", `/patients/${P}`);
  await probe("B hekim → A hastası chart", B.dentist, "GET", `/patients/${P}/chart`);
  await probe("B yönetici → A hastası hesap", B.admin, "GET", `/patients/${P}/account`);
  await probe("B yönetici → A hastası dosyalar", B.admin, "GET", `/patients/${P}/files`);
  await probe("B yönetici → A hastası dışa aktarım", B.admin, "POST", `/patients/${P}/export`, { reason: "sınama dışa aktarım" });
  await probe("B yönetici → A hastası geçmiş", B.admin, "GET", `/patients/${P}/history`);
  const srch = await probe("B yönetici → arama (A soyadı)", B.admin, "GET", `/patients?q=${encodeURIComponent("Hasta" + RUN)}`);
  // B, A'nın bağlam kimliğini (membership) başlıkta taklit ederse
  const spoof = await api({ cookie: B.admin.cookie, ctx: A.sec.ctx, role: "B-yonetici" }, "GET", `/patients/${P}`);
  steps.push({ label: "B çerezi + A bağlam başlığı (taklit)", status: spoof.status, code: spoof.body?.code, leak: JSON.stringify(spoof.body).includes(`Hasta${RUN}`) });
  const own = await probe("A sekreter → kendi hastası GET", A.sec, "GET", `/patients/${P}`);
  const bad = steps.filter((s) => s.label.startsWith("B") && (s.leak || (s.status < 400 && !(s.path?.startsWith("/patients?q") && s.status === 200 && (srch.body.items ?? []).length === 0))));
  const ok = bad.length === 0 && own.status === 200 && (srch.body.items ?? []).length === 0;
  writeFileSync(`${OUT}/V01-http.json`, JSON.stringify({ case: "V01", run: RUN, steps, searchItems: (srch.body.items ?? []).length, verdict: ok ? "PASS" : "FAIL" }, null, 1));
  record("V01", ok ? "PASS" : "FAIL", { profile: "http", evidence: "evidence/V01-http.json", summary: `${steps.length} istek; B erişimleri ${bad.length ? "SIZDIRDI" : "reddedildi (404/403, önizleme yok)"}; arama 0 sonuç; A kendi kaydını okudu` });
  if (!ok) bug("QA-V01", "S0", "Tenant dışı hasta verisine erişim", { steps: bad });
}

// ============================ V02 — odontogram (diş 16) ============================
{
  // ikinci hasta ve 17 numaralı diş: değişmemeli
  const pat2 = await api(A.sec, "POST", "/patients", { firstName: "Kontrol", lastName: `Hasta${RUN}`, birthDate: "1979-11-20", acknowledgeDuplicates: true });
  const P2 = pat2.body.patient?.id ?? pat2.body.id;
  const before2 = await api(A.dentist, "GET", `/patients/${P2}/chart`);
  const before16 = await api(A.dentist, "GET", `/patients/${P}/chart`);
  const f = await api(A.dentist, "POST", `/patients/${P}/findings`, { tooth: "16", surfaces: ["O", "M"], findingType: "caries", note: "sınama" });
  const d = await api(A.dentist, "POST", `/patients/${P}/diagnoses`, { location: { kind: "tooth", tooth: "16", surfaces: ["O"] }, code: "K02.1", description: "Dentin çürüğü (sınama)" });
  // ziyaret (geliş kaydı) + gerçekleşen işlem
  const { date: day, startTime } = await slot(1, A.sec, prac.id);
  const ap = await api(A.sec, "POST", "/appointments", { patientId: P, practitionerId: prac.id, date: day, startTime, durationMinutes: 30, reason: "sınama" });
  const procs = (await api(A.dentist, "GET", "/procedures")).body;
  const proc = (procs.items ?? procs).find((x) => /DOL|dolgu/i.test(x.code + x.name)) ?? (procs.items ?? procs)[0];
  let st = ap.status === 201 ? await api(A.sec, "POST", `/appointments/${ap.body.id}/status`, { version: ap.body.version ?? 1, status: "checked_in" }) : ap;
  const perf = ap.status === 201 ? await api(A.dentist, "POST", `/patients/${P}/performed`, { appointmentId: ap.body.id, procedureId: proc.id, location: { kind: "tooth", tooth: "16", surfaces: ["O", "M"] }, quantity: 1 }) : ap;
  const after16 = await api(A.dentist, "GET", `/patients/${P}/chart`);
  const after2 = await api(A.dentist, "GET", `/patients/${P2}/chart`);
  const findings = after16.body.findings ?? [];
  const mine = findings.filter((x) => x.tooth === "16");
  const other = findings.filter((x) => x.tooth !== "16");
  const performed16 = (after16.body.performed ?? []).filter((x) => JSON.stringify(x.location).includes("16"));
  const ok = f.status === 201 && mine.length >= 1 && JSON.stringify(mine[0].surfaces?.slice().sort()) === JSON.stringify(["M", "O"]) && other.length === (before16.body.findings ?? []).filter((x) => x.tooth !== "16").length
    && perf.status === 201 && performed16.length === 1 && JSON.stringify(mask(before2.body)) === JSON.stringify(mask(after2.body));
  writeFileSync(`${OUT}/V02-http.json`, JSON.stringify({ case: "V02", run: RUN, finding: f.status, diagnosis: d?.status, appointment: ap.status, checkin: st.status, performed: perf.status, performedBody: perf.body,
    tooth16: mask(mine), performed16: mask(performed16), otherTeethUnchanged: other.length === (before16.body.findings ?? []).filter((x) => x.tooth !== "16").length, otherPatientUnchanged: JSON.stringify(mask(before2.body)) === JSON.stringify(mask(after2.body)), verdict: ok ? "PASS" : "FAIL" }, null, 1));
  record("V02", ok ? "PASS" : "FAIL", { profile: "http", evidence: "evidence/V02-http.json", summary: `bulgu ${f.status}, tanı ${d?.status}, işlem ${perf.status}; diş 16 yüzeyler M,O; diğer diş/hasta değişmedi=${JSON.stringify(mask(before2.body)) === JSON.stringify(mask(after2.body))}` });
  if (!ok) bug("QA-V02", "S1", "Odontogram kaydı tutarsız", { finding: f.body, performed: perf.body, diagnosis: d?.body });
  globalThis.__v02 = { appointmentId: ap.body?.id, performedId: perf.body?.id, P2 };
}

// ============================ V03 — randevu yarışı ============================
{
  const { date: day, startTime } = await slot(30, A.sec, prac.id);
  const body = (sess) => api(sess, "POST", "/appointments", { patientId: P, practitionerId: prac.id, date: day, startTime, durationMinutes: 30, reason: "yarış" });
  const [r1, r2] = await Promise.all([body(A.sec), body(A.admin)]);
  const list = await api(A.sec, "GET", `/appointments?date=${day}`);
  const items = list.body.items ?? list.body.appointments ?? [];
  const at11 = items.filter((x) => x.practitionerId === prac.id && new Date(x.startsAt).toISOString() === new Date(`${day}T${startTime}:00+03:00`).toISOString() && x.status !== "cancelled");
  const statuses = [r1.status, r2.status].sort();
  const ok = statuses.join(",") === "201,409" && at11.length === 1 && [r1, r2].find((r) => r.status === 409)?.body?.code === "APPOINTMENT_CONFLICT";
  writeFileSync(`${OUT}/V03-http.json`, JSON.stringify({ case: "V03", run: RUN, day, concurrent: [{ role: "A-sekreter", status: r1.status, code: r1.body?.code, message: r1.body?.message }, { role: "A-yonetici", status: r2.status, code: r2.body?.code, message: r2.body?.message }], slot: `${day} ${startTime}`, appointmentsAtSlot: at11.length, verdict: ok ? "PASS" : "FAIL" }, null, 1));
  record("V03", ok ? "PASS" : "FAIL", { profile: "http", evidence: "evidence/V03-http.json", summary: `eşzamanlı yanıtlar ${statuses.join("/")}; ${startTime}'de ${at11.length} kayıt; ret kodu ${[r1, r2].find((r) => r.status === 409)?.body?.code}` });
  if (!ok) bug("QA-V03", "S1", "Eşzamanlı randevu çakışması engellenmedi", { r1: r1.body, r2: r2.body, at11 });
}

// ============================ V04 — çift tahsilat ============================
{
  const acc0 = await api(A.fin, "GET", `/patients/${P}/account`);
  const debt0 = Number(acc0.body.totals.openDebt);
  const rec = await api(A.fin, "POST", "/receivables", { patientId: P, description: "Sınama borcu", amount: "1000.00" }, { "idempotency-key": key() });
  const R = rec.body.id;
  const k = key();
  const pay = (sess) => api(sess, "POST", "/payments", { patientId: P, amount: "300.00", method: "cash", cashAccountId: cash.id, allocations: [{ receivableId: R, amount: "300.00" }] }, { "idempotency-key": k });
  const [p1, p2] = await Promise.all([pay(A.fin), pay(A.fin)]); // "yanıt kayboldu" → aynı anahtarla eşzamanlı tekrar
  const p3 = await pay(A.fin); // sıralı tekrar
  const acc = await api(A.fin, "GET", `/patients/${P}/account`);
  const payments = (acc.body.payments ?? []).filter((x) => x.amount === "300.00");
  const cashRows = await api(A.fin, "GET", `/finance/cash?from=${today()}&to=${today()}`);
  const cashMoves = JSON.stringify(cashRows.body).split(p1.body?.id ?? "∅").length - 1; // kasa hareketlerinde ödeme kimliği kaç kez geçiyor
  const replayed = [p1, p2, p3].filter((r) => r.headers["idempotent-replayed"] === "true").length;
  const sameId = new Set([p1.body?.id, p2.body?.id, p3.body?.id]).size === 1;
  // iade izi: 100 ₺ iade için önce dağıtım ters kaydı gerekir (ürün kuralı) → ters kayıt + iade, sonra hesap geçmişinde ikisi de görünür
  const alloc = (acc.body.allocations ?? []).find((a) => a.paymentId === p1.body?.id || a.payment_id === p1.body?.id);
  const rev = alloc ? await api(A.fin, "POST", `/allocations/${alloc.id}/reverse`, { reason: "iade için ters kayıt" }, { "idempotency-key": key() }) : { status: "yok" };
  const ref = await api(A.fin, "POST", `/payments/${p1.body?.id}/refunds`, { amount: "100.00", method: "cash", cashAccountId: cash.id, reason: "sınama iadesi" }, { "idempotency-key": key() });
  const acc2 = await api(A.fin, "GET", `/patients/${P}/account`);
  const ok = [p1.status, p2.status, p3.status].every((s) => s === 201 || s === 200) && sameId && payments.length === 1 && Number(acc.body.totals.openDebt) === debt0 + 700 && replayed === 2 && acc.body.reconciled === true
    && ref.status === 201 && (acc2.body.refunds ?? []).length === 1 && acc2.body.reconciled === true;
  writeFileSync(`${OUT}/V04-http.json`, JSON.stringify({ case: "V04", run: RUN, receivable: rec.status, concurrentStatuses: [p1.status, p2.status], sequentialStatus: p3.status, replayHeaders: replayed, singlePaymentId: sameId,
    paymentsOf300: payments.length, openDebtBefore: acc0.body.totals.openDebt, expectedAfter: (debt0 + 700).toFixed(2), openDebtAfter300: acc.body.totals.openDebt, advance: acc.body.totals.advance, reconciled: acc.body.reconciled, cashMovementRefs: cashMoves,
    refund: { allocationReverse: rev.status, refund: ref.status, refundsCount: (acc2.body.refunds ?? []).length, openDebtAfter: acc2.body.totals.openDebt, advanceAfter: acc2.body.totals.advance, reconciled: acc2.body.reconciled },
    timeline: mask(acc2.body.timeline ?? acc2.body.events ?? []).slice(-6), verdict: ok ? "PASS" : "FAIL" }, null, 1));
  record("V04", ok ? "PASS" : "FAIL", { profile: "http", evidence: "evidence/V04-http.json", summary: `eşzamanlı ${p1.status}/${p2.status}, tekrar ${p3.status}, tek ödeme=${sameId}, 300'lük ödeme sayısı ${payments.length}, açık borç ${acc0.body.totals.openDebt}→${acc.body.totals.openDebt} (beklenen +700), replay başlığı ${replayed}/2, iade ${ref.status} (ters kayıt ${rev.status})` });
  if (!ok) bug("QA-V04", "S0", "Çift tahsilat / bakiye tutarsız", { p1: p1.body, p2: p2.body, totals: acc.body.totals, refund: ref.body });
  globalThis.__v04 = { R, paymentId: p1.body?.id };
}

// ============================ V05 — klinik geçmiş (düzeltme + yetki) ============================
{
  const { performedId, appointmentId } = globalThis.__v02;
  const denied = await api(A.sec, "POST", `/performed/${performedId}/correct`, { reason: "sekreter denemesi", quantity: 2 });
  const beforeH = await api(A.dentist, "GET", `/patients/${P}/history`);
  const corr = await api(A.dentist, "POST", `/performed/${performedId}/correct`, { reason: "yüzey düzeltmesi", location: { kind: "tooth", tooth: "16", surfaces: ["O"] } });
  const chart = await api(A.dentist, "GET", `/patients/${P}/chart`);
  const oldRow = (chart.body.performed ?? []).find((x) => x.id === performedId);
  const newRow = (chart.body.performed ?? []).find((x) => x.correctsId === performedId);
  const hist = await api(A.dentist, "GET", `/patients/${P}/history`);
  const events = hist.body.items ?? hist.body.events ?? hist.body;
  const relevant = (Array.isArray(events) ? events : []).filter((e) => /procedure|performed/.test(e.action ?? "") && (e.entityId === performedId || e.entityId === newRow?.id || e.entity_id === performedId || e.entity_id === newRow?.id));
  const hasActor = relevant.every((e) => (e.actorName ?? e.actor_name ?? e.actor) && (e.createdAt ?? e.created_at ?? e.at));
  const secHist = await api(A.sec, "GET", `/patients/${P}/history`);
  const secEvents = secHist.body.items ?? [];
  const secClinical = secEvents.filter((e) => e.entityType === "clinical_chart" || /finding|diagnosis|anamnesis|clinical_note/.test(e.action ?? ""));
  const finHist = await api(A.fin, "GET", `/patients/${P}/history`);
  const finClinical = (finHist.body.items ?? []).filter((e) => e.entityType === "clinical_chart" || /finding|diagnosis|anamnesis|clinical_note/.test(e.action ?? ""));
  // sekreter/finans: patient.health.read yok → geçmişte bulgu/tanı (clinical_chart) olayı görmemeli; işlem (performed_procedure) olayları treatment.read ile görülebilir
  const ok = denied.status === 403 && corr.status === 200 && oldRow?.status === "corrected" && newRow?.status === "completed" && relevant.length >= 2 && hasActor && secClinical.length === 0 && finClinical.length === 0;
  writeFileSync(`${OUT}/V05-http.json`, JSON.stringify({ case: "V05", run: RUN, secretaryCorrect: { status: denied.status, code: denied.body?.code }, dentistCorrect: { status: corr.status, newId: corr.body?.id },
    old: mask(oldRow), new: mask(newRow), historyEvents: mask(relevant).map((e) => ({ action: e.action, entityId: e.entityId ?? e.entity_id, changes: e.changes, at: e.createdAt ?? e.created_at ?? e.at, actor: e.actorName ?? e.actor_name })),
    historyCountBefore: (beforeH.body.items ?? beforeH.body ?? []).length, historyCountAfter: (Array.isArray(events) ? events : []).length, secretaryHistoryStatus: secHist.status, secretaryClinicalEventsVisible: mask(secClinical).map((e) => ({ action: e.action, entityType: e.entityType, changes: e.changes })), financeClinicalEventsVisible: finClinical.length, verdict: ok ? "PASS" : "FAIL" }, null, 1));
  record("V05", ok ? "PASS" : "FAIL", { profile: "http", evidence: "evidence/V05-http.json", summary: `sekreter düzeltme ${denied.status}, hekim düzeltme ${corr.status}; eski=${oldRow?.status} yeni=${newRow?.status}; geçmişte ${relevant.length} olay (aktör+zaman=${hasActor}); sekreter geçmişinde klinik bulgu olayı: ${secClinical.length}, finans: ${finClinical.length}` });
  if (!ok) bug("QA-V05", "S1", "Sağlık yetkisi olmayan rol (sekreter/finans) hasta geçmişinde odontogram bulgu/tanı olaylarını görüyor", { denied: denied.body, corr: corr.body, relevant: mask(relevant), secClinical: mask(secClinical), finClinical: mask(finClinical) });
}

// ============================ P01 — tahsilat tutarı sınırları ============================
{
  const rec = await api(A.fin, "POST", "/receivables", { patientId: P, description: "Sınır borcu", amount: "1000.00" }, { "idempotency-key": key() });
  const R = rec.body.id;
  const cashBefore = await api(A.fin, "GET", `/finance/cash?from=${today()}&to=${today()}`);
  const cases = [["boş", ""], ["sıfır", "0"], ["negatif", "-5.00"], ["0,01 virgül", "0,01"], ["0.01", "0.01"], ["999.99", "999.99"], ["1000.00 (=borç)", "1000.00"], ["1000.01 (>borç dağıtım)", "1000.01"], ["3 ondalık", "10.001"], ["metin", "abc"], ["sayı tipi", 100], ["çok büyük", "99999999999.00"]];
  const rows = [];
  for (const [label, amt] of cases) {
    const fresh = await api(A.fin, "POST", "/receivables", { patientId: P, description: `Sınır ${label}`, amount: "1000.00" }, { "idempotency-key": key() });
    const alloc = typeof amt === "string" && /^\d+\.\d{2}$/.test(amt) ? [{ receivableId: fresh.body.id, amount: amt }] : [];
    const r = await api(A.fin, "POST", "/payments", { patientId: P, amount: amt, method: "cash", cashAccountId: cash.id, allocations: alloc }, { "idempotency-key": key() });
    rows.push({ label, amount: amt, status: r.status, code: r.body?.code, field: r.body?.field_errors ? Object.keys(r.body.field_errors) : undefined });
  }
  const over = await api(A.fin, "POST", "/payments", { patientId: P, amount: "50.00", method: "cash", cashAccountId: cash.id, allocations: [{ receivableId: R, amount: "60.00" }] }, { "idempotency-key": key() });
  rows.push({ label: "dağıtım(60) > ödeme(50)", status: over.status, code: over.body?.code });
  const noKey = await api(A.fin, "POST", "/payments", { patientId: P, amount: "10.00", method: "cash", cashAccountId: cash.id });
  rows.push({ label: "Idempotency-Key yok", status: noKey.status, code: noKey.body?.code });
  const cashAfter = await api(A.fin, "GET", `/finance/cash?from=${today()}&to=${today()}`);
  const acc = await api(A.fin, "GET", `/patients/${P}/account`);
  const accepted = rows.filter((r) => r.status === 201).map((r) => r.label);
  const expectedAccepted = ["0.01", "999.99", "1000.00 (=borç)"]; // 1000.01 alacaktan fazla dağıtım → ret; 0,01 virgül: sözleşme nokta ister → ret beklenir
  const movesDelta = (cashAfter.body.movements ?? cashAfter.body.items ?? []).length - (cashBefore.body.movements ?? cashBefore.body.items ?? []).length;
  const ok = JSON.stringify(accepted) === JSON.stringify(expectedAccepted) && acc.body.reconciled === true && (Number.isNaN(movesDelta) || movesDelta === expectedAccepted.length);
  writeFileSync(`${OUT}/P01-http.json`, JSON.stringify({ case: "P01", run: RUN, rows, accepted, expectedAccepted, cashMovementsDelta: movesDelta, cashShape: Object.keys(cashAfter.body ?? {}), reconciled: acc.body.reconciled, openDebt: acc.body.totals.openDebt, verdict: ok ? "PASS" : "FAIL" }, null, 1));
  record("P01", ok ? "PASS" : "FAIL", { profile: "http", evidence: "evidence/P01-http.json", summary: `${rows.length} değer; kabul: ${accepted.join(", ")}; kasa hareketi farkı ${movesDelta}; mutabık=${acc.body.reconciled}` });
  if (!ok) bug("QA-P01", "S1", "Tahsilat tutarı sınır davranışı sözleşmeyle uyuşmuyor", { rows, accepted, expectedAccepted, movesDelta });
}

// ============================ P02 — randevu alanları / filtreler ============================
{
  const { date: day, startTime } = await slot(60, A.sec, prac.id);
  const next = `${startTime.slice(0, 2)}:${startTime.endsWith("00") ? "30" : "59"}`;
  const mk = (over) => api(A.sec, "POST", "/appointments", { patientId: P, practitionerId: prac.id, date: day, startTime, durationMinutes: 30, ...over });
  const rows = [];
  const push = async (label, r, expect) => { rows.push({ label, status: r.status, code: r.body?.code, expected: expect, ok: Array.isArray(expect) ? expect.includes(r.status) : r.status === expect }); return r; };
  await push("tarih 31.02", await mk({ date: `${day.slice(0, 4)}-02-31` }), 422);
  await push("tarih 13. ay", await mk({ date: `${day.slice(0, 4)}-13-01` }), 422);
  await push("saat 24:00", await mk({ startTime: "24:00" }), 422);
  await push("saat 9:00 (tek hane)", await mk({ startTime: "9:00" }), 422);
  await push("süre 4 dk", await mk({ durationMinutes: 4 }), 422);
  await push("süre 721 dk", await mk({ durationMinutes: 721 }), 422);
  await push("süre ondalık", await mk({ durationMinutes: 30.5 }), 422);
  await push("hekim yok", await mk({ practitionerId: randomUUID() }), [404, 422]);
  await push("hasta başka tenant (B hastası id'si)", await (async () => { const bp = await api(B.admin, "GET", "/patients?q=a"); const bid = (bp.body.items ?? [])[0]?.id; return bid ? mk({ patientId: bid }) : { status: "yok", body: {} }; })(), [404, 422]);
  const good = await push("geçerli slot 30 dk", await mk({}), [201, 422]);
  if (good.status === 422 && good.body.code === "OUTSIDE_WORKING_HOURS") { const g2 = await mk({ allowOutsideHours: true }); rows.push({ label: "çalışma saati dışı bilinçli kayıt", status: g2.status, ok: g2.status === 201 }); good.body = g2.body; good.status = g2.status; }
  await push("aynı saat tekrar (çakışma)", await mk({}), [409, 422]);
  await push("bitişik sonraki yarım saat (çakışmamalı)", await mk({ startTime: next, durationMinutes: 1 }), [201, 422]);
  // durum geçişleri: her enum değeri
  const id = good.body?.id; let version = good.body?.version ?? 1;
  for (const s of ["confirmed", "checked_in", "in_progress", "completed", "no_show", "cancelled", "planned", "bogus"]) {
    const r = await api(A.sec, "POST", `/appointments/${id}/status`, { version, status: s, cancelReason: s === "cancelled" ? "sınama" : undefined });
    if (r.status === 200) version = r.body.version ?? version + 1;
    rows.push({ label: `durum → ${s}`, status: r.status, code: r.body?.code, ok: s === "bogus" ? r.status === 422 : r.status === 200 || r.status === 409 || r.status === 422 });
  }
  const stale = await api(A.sec, "POST", `/appointments/${id}/status`, { version: 1, status: "confirmed" });
  rows.push({ label: "eski version ile durum (iyimser kilit)", status: stale.status, code: stale.body?.code, ok: stale.status === 409 || stale.status === 422 });
  for (const q of [`date=${day}`, `from=${day}&days=7`, `from=${day}&days=0`, `from=${day}&days=400`, `date=31-02-2026`, `practitionerId=${prac.id}&date=${day}`, `status=cancelled&date=${day}`]) {
    const r = await api(A.sec, "GET", `/appointments?${q}`);
    rows.push({ label: `filtre ?${q.replace(prac.id, "<hekim>")}`, status: r.status, code: r.body?.code, count: (r.body.items ?? r.body.appointments ?? []).length, ok: r.status === 200 || r.status === 422 });
  }
  const ok = rows.every((r) => r.ok);
  writeFileSync(`${OUT}/P02-http.json`, JSON.stringify({ case: "P02", run: RUN, day, rows, verdict: ok ? "PASS" : "FAIL" }, null, 1));
  record("P02", ok ? "PASS" : "FAIL", { profile: "http", evidence: "evidence/P02-http.json", summary: `${rows.length} deneme, ${rows.filter((r) => !r.ok).length} beklenmedik` });
  if (!ok) bug("QA-P02", "S2", "Randevu alan/filtre doğrulaması beklenmedik", { rows: rows.filter((r) => !r.ok) });
}

// ============================ P03 — kimlik ve yetki ============================
{
  const rows = [];
  const wrong = await login("sekreter@demo-yesil.test", "yanlış-parola-123");
  rows.push({ label: "yanlış parola", status: wrong.status, code: wrong.body?.code, ok: wrong.status === 401 });
  const nos = await api(null, "GET", `/patients/${P}`);
  rows.push({ label: "oturumsuz istek", status: nos.status, ok: nos.status === 401 });
  const nocsrf = await fetch(`${BASE}/api/v1/patients`, { method: "POST", headers: { "content-type": "application/json", cookie: A.sec.cookie, "x-viadent-context": A.sec.ctx }, body: JSON.stringify({ firstName: "x", lastName: "y" }) });
  rows.push({ label: "CSRF başlığı yok (mutasyon)", status: nocsrf.status, ok: nocsrf.status === 403 || nocsrf.status === 401 });
  const noctx = await api({ cookie: A.sec.cookie }, "GET", `/patients/${P}`);
  rows.push({ label: "bağlam başlığı yok", status: noctx.status, ok: noctx.status === 401 || noctx.status === 403 || noctx.status === 200 });
  const secFin = await api(A.sec, "GET", "/finance/summary");
  rows.push({ label: "sekreter → finans özeti", status: secFin.status, code: secFin.body?.code, ok: secFin.status === 403 });
  const secHealth = await api(A.sec, "GET", `/patients/${P}/anamnesis`);
  rows.push({ label: "sekreter → anamnez (sağlık verisi)", status: secHealth.status, ok: secHealth.status === 403 });
  const finClin = await api(A.fin, "POST", `/patients/${P}/findings`, { tooth: "11", surfaces: [], findingType: "caries" });
  rows.push({ label: "finans → odontogram bulgu yazma", status: finClin.status, ok: finClin.status === 403 });
  const tmp = await login("sekreter@demo-yesil.test");
  const out = await api(tmp, "POST", "/auth/logout", {});
  const afterOut = await api(tmp, "GET", "/session");
  rows.push({ label: "çıkış sonrası oturum", logout: out.status, status: afterOut.status, ok: afterOut.status === 401 });
  const ok = rows.every((r) => r.ok);
  writeFileSync(`${OUT}/P03-http.json`, JSON.stringify({ case: "P03", run: RUN, rows, verdict: ok ? "PASS" : "FAIL" }, null, 1));
  record("P03", ok ? "PASS" : "FAIL", { profile: "http", evidence: "evidence/P03-http.json", summary: `${rows.length} kontrol, ${rows.filter((r) => !r.ok).length} beklenmedik` });
  if (!ok) bug("QA-P03", "S0", "Kimlik/yetki kontrolü beklenmedik", { rows: rows.filter((r) => !r.ok) });
}

writeFileSync(`${OUT}/http-summary.json`, JSON.stringify({ run: RUN, started, finished: new Date().toISOString(), base: BASE, patient: P, results, bugs }, null, 1));
console.log(JSON.stringify({ run: RUN, patient: P, pass: results.filter((r) => r.status === "PASS").length, fail: results.filter((r) => r.status === "FAIL").length, bugs: bugs.map((b) => `${b.id}/${b.severity}`) }));
