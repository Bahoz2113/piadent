'use strict';
const fs = require('node:fs');
const path = require('node:path');
function decide(r, base, plan, revision) {
  const root = fs.realpathSync(base) + path.sep;
  function proof(ref) {
    if (typeof ref !== 'string' || !ref || path.isAbsolute(ref)) return false;
    try {
      const f = fs.realpathSync(path.resolve(root,ref));
      return f.startsWith(root) && fs.statSync(f).isFile() && fs.statSync(f).size > 0;
    } catch { return false; }
  }
  if (!Array.isArray(r?.requiredIds) || !r.requiredIds.length ||
      !Array.isArray(r.cases) || !Array.isArray(r.bugs) ||
      !r.revision || !r.runId || !Array.isArray(r.profiles) || !r.profiles.length)
    throw Error('Eksik koşu veya kapsam');

  if (!revision || r.revision !== revision || !Array.isArray(plan?.requiredIds) ||
      !Array.isArray(plan.profiles) || !plan.profiles.length)
    throw Error('Sürüm veya kilitli plan eksik');
  const same = (left,right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  const matchesPlan = same(r.requiredIds,plan.requiredIds) &&
    same(r.profiles.map(p=>p.name),plan.profiles.map(p=>p.name)) &&
    plan.profiles.every(p => typeof p.required === 'boolean' &&
      (!p.required || r.profiles.find(x=>x.name===p.name)?.status==='PASS'));
  const ids = new Set(r.requiredIds);
  if (ids.size !== r.requiredIds.length || [...ids].some(x => typeof x !== 'string' || !x.trim()))
    throw Error('Geçersiz zorunlu kimlik');
  const observed = new Map();
  for (const t of r.cases) {
    if (!t.id || observed.has(t.id) ||
        !['PASS','FAIL','BLOCKED','NOT_RUN','FLAKY','NA'].includes(t.status))
      throw Error('Geçersiz/tekrar vaka');
    observed.set(t.id,t);
  }
  if (r.bugs.some(b => !b.id || !['S0','S1','S2','S3'].includes(b.severity) ||
      !['OPEN','REOPENED','FIX_READY','VERIFIED'].includes(b.state)))
    throw Error('Geçersiz bulgu');
  const open = r.bugs.filter(b => b.state !== 'VERIFIED');
  if (open.some(b => ['S0','S1'].includes(b.severity))) return 'DURDUR';
  const blocked = !matchesPlan || open.length || r.inventoryComplete !== true || r.fullRegression !== true ||
      r.profiles.some(p => !p.name || !(p.status === 'PASS' && proof(p.evidence) ||
                                       p.status === 'NA' && p.reason)) ||
      [...ids].some(id => observed.get(id)?.status !== 'PASS') ||
      r.cases.some(t => t.status === 'NA' ? !t.reason : t.status !== 'PASS' || !proof(t.evidence)) ||
      r.bugs.some(b => b.state === 'VERIFIED' && !proof(b.retestEvidence));
  return blocked ? 'BEKLET' : 'TESLİME ADAY';
}
module.exports = {decide};
if (require.main === module) {
  try {
    const result = decide(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), path.dirname(process.argv[2]), JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), process.argv[4]);
    console.log(result);
    process.exitCode = result === 'TESLİME ADAY' ? 0 : result === 'DURDUR' ? 2 : 3;
  } catch (error) { console.error('BEKLET:', error.message); process.exitCode = 3; }
}
