#!/bin/bash
# CEZERİ — tam tur: temiz seed + tüm HTTP/tarayıcı vakaları + sondalar. Ürün kodunu değiştirmez.
# Kullanım: qa-runs/.scripts/round.sh <run-dizini> <tur-adı>
set -u
cd /home/claude/viadent
RUN=$1; TUR=$2; OUT=$RUN/evidence/$TUR; mkdir -p $OUT
set -a; . ./.env >/dev/null 2>&1; set +a
(pnpm db:reset && pnpm --filter @viadent/db migrate && pnpm db:seed) > $OUT/seed.log 2>&1 || { echo SEED_FAIL; exit 1; }
sed -i 's/[A-Za-z0-9+/=]\{24,\}/‹gizli›/g' $OUT/seed.log
export PASSWORD="$(grep -oP 'parola\s*=\s*\K\S+' .demo-credentials)" BASE=http://127.0.0.1:4000 OWNER_URL="$MIGRATION_DATABASE_URL" OUT PW_CHROMIUM_PATH=/opt/pw-browsers/chromium
node qa-runs/.scripts/http-cases.mjs > $OUT/http.log 2>&1
node qa-runs/.scripts/n-cases.mjs > $OUT/n.log 2>&1
for p in file-sensitivity-probe file-trace-probe evidence-file-probe quarantine-task-probe linked-file-probe readiness-clinical-probe; do node qa-runs/.scripts/$p.mjs > $OUT/$p.log 2>&1; done
node qa-runs/.scripts/f-cases.mjs > $OUT/f.log 2>&1
cd apps/web
for s in browser-cases browser-n browser-f; do cp ../../qa-runs/.scripts/$s.mjs ./.qa-$s.mjs; done
W=../../$OUT
BASE=http://127.0.0.1:3000 SUMMARY=$W/http-summary.json OUT=$W node ./.qa-browser-cases.mjs 2>&1 | grep -v "pid=" > $W/browser.log
BASE=http://127.0.0.1:3000 OUT=$W TUR=$TUR node ./.qa-browser-n.mjs 2>&1 | grep -v "pid=" > $W/browser-n.log
BASE=http://127.0.0.1:3000 SUMMARY=$W/f-summary.json OUT=$W node ./.qa-browser-f.mjs 2>&1 | grep -v "pid=" > $W/browser-f.log
rm -f ./.qa-browser-cases.mjs ./.qa-browser-n.mjs ./.qa-browser-f.mjs ./.qa-esc.mjs ./.qa-dbg.mjs
echo ROUND_DONE
