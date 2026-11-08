// CEZERİ teslim testi — ADR-108 Laboratuvar (ölçü/malzeme, malzeme siparişi) HTTP/DB vakaları J01–J04. Ürün kodunu değiştirmez; yalnız sentetik veri.
// Kullanım: BASE=http://127.0.0.1:4000 PASSWORD=<güvenli ortam> OWNER_URL=<yerel> WORKER_URL=<yerel> OUT=<evidence> tsx qa-runs/.scripts/j-cases.mjs
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
  try { await c.query("begin"); await c.query("select set_config('app.tenant_id', $1, true)", [tenant]); const r = await c.query(sql, args); await c.query("commit"); return r.rows; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } };
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
const post = async (cl, path, body, k) => {
  const r = await fetch(`${BASE}/api/v1${path}`, { method: "POST", headers: { "content-type": "application/json", cookie: cl.cookie, "x-viadent-context": cl.ctx, "x-viadent-request": "1", ...(k ? { "idempotency-key": k } : {}) }, body: JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b, replayed: r.headers.get("idempotent-replayed") };
};
const pr = (await api(A.sec, "GET", "/resources")).body.practitioners[0].id;
const labSup = (await api(A.admin, "POST", "/suppliers", { kind: "lab", name: `QA Lab ${RUN}` })).body.id;
const medSup = (await api(A.admin, "POST", "/suppliers", { kind: "medical", name: `QA Medikal ${RUN}` })).body.id;
const gz = (await api(A.admin, "POST", "/stock/items", { code: `QAG-${RUN.toUpperCase()}`, name: `QA gazlı bez ${RUN}`, unit: "paket", trackLots: false, minLevel: "0" })).body.id;
const im = (await api(A.admin, "POST", "/stock/items", { code: `QAI-${RUN.toUpperCase()}`, name: `QA implant ${RUN}`, unit: "adet", trackLots: true, minLevel: "0" })).body.id;
const pat = (await api(A.sec, "POST", "/patients", { firstName: "QaÖlçü", lastName: `J${RUN}`, birthDate: "1980-01-02", acknowledgeDuplicates: true })).body.patient.id;
const bal = async (item) => Number((await q("select coalesce(sum(quantity),0)::text as b from stock_movements where item_id = $1", [item]))[0].b);

// J01 — iş emri: ölçü türü/tarihi ve istenen malzeme; föy; doğrulama; gönderilince kilit
{ const c = [];
  const r = await api(A.sec, "POST", "/lab-orders", { patientId: pat, supplierId: labSup, practitionerId: pr, workType: "QA köprü", teeth: ["35", "36", "37"],
    impressionType: "silicone", impressionTakenOn: day(-1), material: "pfm" });
  ok(r.status === 201, `oluştur ${r.status}`, c);
  const d = (await api(A.sec, "GET", `/lab-orders/${r.body.id}`)).body;
  ok(d.impressionType === "silicone" && d.impressionTakenOn === day(-1) && d.material === "pfm", `ayrıntı ${d.impressionType}/${d.impressionTakenOn}/${d.material}`, c);
  const ws = (await api(A.sec, "GET", `/lab-orders/${r.body.id}/work-sheet`)).body;
  ok(ws.impressionType === "silicone" && ws.material === "pfm" && !JSON.stringify(ws).includes("QaÖlçü"), "föyde ölçü+malzeme, hasta adı yok", c);
  for (const [lbl, extra, st] of [["ileri tarih", { impressionType: "alginate", impressionTakenOn: day(2) }, 422], ["türsüz tarih", { impressionTakenOn: day(0) }, 422],
    ["bilinmeyen tür", { impressionType: "lazer" }, 422], ["bilinmeyen malzeme", { material: "altin" }, 422], ["tarih biçimi", { impressionType: "silicone", impressionTakenOn: "01.11.2026" }, 422]]) {
    const x = await api(A.sec, "POST", "/lab-orders", { patientId: pat, supplierId: labSup, practitionerId: pr, workType: "QA doğrulama", ...extra });
    ok(x.status === st, `${lbl} → ${x.status}`, c);
  }
  const u = await api(A.sec, "PATCH", `/lab-orders/${r.body.id}`, { expectedVersion: d.version, material: "zirconia" });
  ok(u.status === 200, `taslakta malzeme değişir ${u.status}`, c);
  await api(A.sec, "POST", `/lab-orders/${r.body.id}/transition`, { action: "send", targetDate: day(6) });
  const d2 = (await api(A.sec, "GET", `/lab-orders/${r.body.id}`)).body;
  const lk = await api(A.sec, "PATCH", `/lab-orders/${r.body.id}`, { expectedVersion: d2.version, impressionType: "digital_scan" });
  ok(lk.status === 409 && lk.body?.code === "LAB_SPEC_LOCKED", `gönderilmiş işte ölçü kilitli ${lk.status}`, c);
  const fin = await api(A.fin, "POST", "/lab-orders", { patientId: pat, supplierId: labSup, practitionerId: pr, workType: "Finans denemesi" });
  ok(fin.status === 403, `finans iş emri açamaz ${fin.status}`, c);
  rec("J01", c);
}

// J02 — malzeme siparişi: oluştur (idempotent) → gönder → kısmi teslim (stok) → fazla teslim 422 (yazım yok) → kalan + cari borç (kesin kuruş) → kapanır
{ const c = [];
  const k = key();
  const body = { supplierId: medSup, expectedDate: day(4), lines: [{ itemId: gz, quantity: "7", unitPrice: "3.33" }, { itemId: im, quantity: "2", unitPrice: "999.99" }] };
  const p1 = await post(A.asst, "/purchase-orders", body, k);
  const p2 = await post(A.asst, "/purchase-orders", body, k);
  ok(p1.status === 201 && p2.status === 201 && p2.replayed === "true" && p2.body.id === p1.body.id, `idempotent oluştur ${p1.status}/${p2.replayed}`, c);
  ok((await q("select count(*)::int as n from purchase_orders where supplier_id = $1", [medSup]))[0].n === 1, "tek sipariş", c);
  const id = p1.body.id;
  let d = (await api(A.asst, "GET", `/purchase-orders/${id}`)).body;
  ok(d.status === "draft" && d.total === "2023.29", `taslak toplam ${d.total}`, c); // 7×3,33 + 2×999,99
  ok((await post(A.asst, `/purchase-orders/${id}/receive`, { expectedVersion: d.version, lines: [{ lineId: d.lines[0].id, quantity: "1" }] }, key())).status === 409, "taslak teslim alınamaz", c);
  ok((await api(A.asst, "POST", `/purchase-orders/${id}/transition`, { action: "send", expectedVersion: d.version })).status === 200, "gönder", c);
  ok((await api(A.asst, "POST", `/purchase-orders/${id}/transition`, { action: "send", expectedVersion: d.version })).status === 409, "eski sürüm 409", c);
  d = (await api(A.asst, "GET", `/purchase-orders/${id}`)).body;
  const g0 = await bal(gz), i0 = await bal(im);
  const over = await post(A.asst, `/purchase-orders/${id}/receive`, { expectedVersion: d.version, lines: [{ lineId: d.lines[0].id, quantity: "3" }, { lineId: d.lines[1].id, quantity: "3", lotNo: "QA-L" }] }, key());
  ok(over.status === 422 && (await bal(gz)) === g0 && (await bal(im)) === i0, `fazla teslim 422, stok değişmedi (${over.status})`, c);
  const nolot = await post(A.asst, `/purchase-orders/${id}/receive`, { expectedVersion: d.version, lines: [{ lineId: d.lines[1].id, quantity: "1" }] }, key());
  ok(nolot.status === 422, `lotsuz implant 422 (${nolot.status})`, c);
  const noperm = await post(A.asst, `/purchase-orders/${id}/receive`, { expectedVersion: d.version, createBill: true, lines: [{ lineId: d.lines[0].id, quantity: "1" }] }, key());
  ok(noperm.status === 403, `asistan cari borç yazamaz ${noperm.status}`, c);
  const rk = key();
  const part = await post(A.asst, `/purchase-orders/${id}/receive`, { expectedVersion: d.version, lines: [{ lineId: d.lines[0].id, quantity: "2.5" }] }, rk);
  const partAgain = await post(A.asst, `/purchase-orders/${id}/receive`, { expectedVersion: d.version, lines: [{ lineId: d.lines[0].id, quantity: "2.5" }] }, rk);
  ok(part.status === 201 && part.body.status === "partial" && partAgain.replayed === "true", `kısmi teslim ${part.status}/${part.body?.status}; tekrar ${partAgain.replayed}`, c);
  ok((await bal(gz)) - g0 === 2.5, `stok +2,5 (tekrar çift yazmadı): ${(await bal(gz)) - g0}`, c);
  d = (await api(A.admin, "GET", `/purchase-orders/${id}`)).body;
  const full = await post(A.admin, `/purchase-orders/${id}/receive`, { expectedVersion: d.version, createBill: true, documentNo: `QA-${RUN}`,
    lines: [{ lineId: d.lines[0].id, quantity: "4.5" }, { lineId: d.lines[1].id, quantity: "2", lotNo: `QA-${RUN}`, expiryDate: day(500) }] }, key());
  ok(full.status === 201 && full.body.status === "received" && !!full.body.billId, `kalan + borç ${full.status}`, c);
  const bill = (await q("select amount::text, source from supplier_entries where id = $1", [full.body.billId]))[0];
  ok(bill?.amount === "2014.97" && bill?.source === "purchase_receipt", `borç ${bill?.amount} = 4,5×3,33 + 2×999,99 = 2014,97 (yuvarlama satır başına)`, c);
  const mv = await q("select m.unit_cost::text as uc from stock_movements m join purchase_receipts r on r.movement_id = m.id join purchase_order_lines l on l.id = r.line_id where l.order_id = $1 order by m.created_at", [id]);
  ok(mv.length === 3 && mv.every((x) => ["3.33", "999.99"].includes(x.uc)), `hareket birim maliyetleri ${mv.map((x) => x.uc)}`, c);
  const au = await q("select action from audit_events where entity_id = $1 order by created_at", [id]);
  ok(JSON.stringify(au.map((x) => x.action)) === '["purchase_order.create","purchase_order.send","purchase_order.receive","purchase_order.receive"]', `denetim ${au.map((x) => x.action)}`, c);
  d = (await api(A.admin, "GET", `/purchase-orders/${id}`)).body;
  ok((await api(A.admin, "POST", `/purchase-orders/${id}/transition`, { action: "cancel", expectedVersion: d.version, reason: "QA iptal" })).status === 409, "teslim alınan iptal edilemez", c);
  rec("J02", c);
}

// J03 — yetki ve yalıtım: sekreter 403; B kiracısı göremez; uygulama rolü satır miktarı/fiyatı güncelleyemez, silemez; teslim azalamaz
{ const c = [];
  ok((await api(A.sec, "GET", "/purchase-orders")).status === 403, "sekreter liste 403", c);
  ok((await post(A.sec, "/purchase-orders", { supplierId: medSup, lines: [{ itemId: gz, quantity: "1" }] }, key())).status === 403, "sekreter oluştur 403", c);
  const bl = await api(B.admin, "GET", "/purchase-orders?status=all");
  ok(bl.status === 200 && !bl.body.items.some((x) => x.supplier.includes(RUN)), "B listesinde A siparişi yok", c);
  ok((await q("select count(*)::int as n from purchase_orders where tenant_id = $1", [TENANT], B.admin.tenantId))[0].n === 0, "B bağlamında A satırı yok (RLS)", c);
  const g = (await pool.query("select column_name from information_schema.column_privileges where grantee = 'viadent_app' and table_name = 'purchase_order_lines' and privilege_type = 'UPDATE'")).rows.map((r) => r.column_name);
  ok(JSON.stringify(g) === '["received_qty"]', `UPDATE yalnız received_qty (${g})`, c);
  const del = (await pool.query("select count(*)::int as n from information_schema.role_table_grants where grantee = 'viadent_app' and table_name like 'purchase_%' and privilege_type in ('DELETE','TRUNCATE')")).rows[0].n;
  ok(del === 0, "silme/truncate yetkisi yok", c);
  const line = (await q("select l.id from purchase_order_lines l join purchase_orders po on po.id = l.order_id where po.supplier_id = $1 and l.received_qty > 0 limit 1", [medSup]))[0]?.id;
  let dec = null; try { await q("update purchase_order_lines set received_qty = received_qty - 1 where id = $1", [line]); } catch (e) { dec = e.message; }
  ok(/PURCHASE_RECEIVED_DECREASE/.test(dec ?? ""), `teslim azalamaz (${dec?.slice(0, 40)})`, c);
  rec("J03", c);
}

// J04 — geciken sipariş: PİA Akış görevi açılır, gecikmiş süzgeçte görünür, teslimle kapanır
{ const c = [];
  const p = await post(A.asst, "/purchase-orders", { supplierId: medSup, expectedDate: day(2), lines: [{ itemId: gz, quantity: "1" }] }, key());
  let d = (await api(A.asst, "GET", `/purchase-orders/${p.body.id}`)).body;
  await api(A.asst, "POST", `/purchase-orders/${p.body.id}/transition`, { action: "send", expectedVersion: d.version });
  await q("update purchase_orders set expected_date = $2 where id = $1", [p.body.id, day(-3)]);
  await api(A.asst, "POST", "/via-akis/refresh", {});
  const t = (await q("select status, assignee_role, title from tasks where kind = 'purchase_overdue' and source_id = $1", [p.body.id]))[0];
  ok(t?.status === "open" && t?.assignee_role === "assistant", `görev açık (${t?.status}, ${t?.assignee_role})`, c);
  const ov = (await api(A.asst, "GET", "/purchase-orders?status=overdue")).body.items.find((x) => x.id === p.body.id);
  ok(ov?.overdue === true, "gecikmiş süzgeç", c);
  const tasks = (await api(A.asst, "GET", "/tasks")).body.items.find((x) => x.kind === "purchase_overdue" && x.sourceId === p.body.id);
  ok(!!tasks && !/QaÖlçü/.test(JSON.stringify(tasks)), "asistan görevi görür; hasta adı yok", c);
  d = (await api(A.asst, "GET", `/purchase-orders/${p.body.id}`)).body;
  await post(A.asst, `/purchase-orders/${p.body.id}/receive`, { expectedVersion: d.version, lines: [{ lineId: d.lines[0].id, quantity: "1" }] }, key());
  await api(A.asst, "POST", "/via-akis/refresh", {});
  ok((await q("select status from tasks where kind = 'purchase_overdue' and source_id = $1", [p.body.id]))[0]?.status === "done", "teslimle kapandı", c);
  rec("J04", c);
}

writeFileSync(`${OUT}/j-summary.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
await pool.end();
