#!/bin/bash
# CEZERİ — son tur: tam vaka turu + V06 yedek/geri yükleme + R01–R06 + tam E2E (temiz seed). Ürün kodunu değiştirmez.
set -u
cd /home/claude/viadent
RUN=$1; TUR=$2; OUT=$RUN/evidence/$TUR
qa-runs/.scripts/round.sh $RUN $TUR || { echo ROUND_FAIL; exit 1; }
set -a; . ./.env >/dev/null 2>&1; set +a
# V06 — sakin DB üzerinde
{ echo "# $(date -Iseconds) — sürüm $(git rev-parse --short HEAD), vaka turu sonrası sakin DB. Bağımsız sorgu: qa-runs/.scripts/reconcile.sql"; } > $OUT/V06-reconcile.txt
pnpm db:backup > $OUT/V06-backup.log 2>&1
B=$(ls -td .backups/viadent-* | head -1)
pnpm db:restore-verify $B --keep --target viadent_qa_restore_${TUR} > $OUT/V06-restore-verify.raw 2>&1
sed -n '/^{/,/^}/p' $OUT/V06-restore-verify.raw > $OUT/V06-restore-verify.json
U=$(node -e "const u=new URL(process.env.ADMIN_DATABASE_URL); console.log(u.toString())")
R=$(node -e "const u=new URL(process.env.ADMIN_DATABASE_URL); u.pathname='/viadent_qa_restore_${TUR}'; console.log(u.toString())")
M=$(node -e "const u=new URL(process.env.ADMIN_DATABASE_URL); u.pathname='/viadent'; console.log(u.toString())")
A=$(psql "$M" -At -f qa-runs/.scripts/reconcile.sql); Bq=$(psql "$R" -At -f qa-runs/.scripts/reconcile.sql)
{ echo "## viadent"; echo "$A"; echo "## viadent_qa_restore_${TUR}"; echo "$Bq"; [ "$A" = "$Bq" ] && echo EŞLEŞTİ || echo FARKLI; } >> $OUT/V06-reconcile.txt
psql "$U" -q -c "drop database if exists viadent_qa_restore_${TUR}" >/dev/null 2>&1
# R07
psql "$MIGRATION_DATABASE_URL" -At -f qa-runs/.scripts/rls-0711.sql > $OUT/R07-rls.txt 2>&1
# R01–R03, R06
(cd apps/api && npx vitest run) > $OUT/R01-api.log 2>&1
(cd packages/contracts && npx vitest run) > $OUT/R02-contracts.log 2>&1
(cd apps/web && npx vitest run) > $OUT/R03-web.log 2>&1
{ pnpm typecheck 2>&1 | tail -15; echo "== pnpm audit --prod"; pnpm audit --prod 2>&1 | tail -5; } > $OUT/R06-typecheck-audit.log 2>&1
# R04–R05: temiz seed + tam E2E
(pnpm db:reset && pnpm --filter @viadent/db migrate && pnpm db:seed) > /dev/null 2>&1
(cd apps/web && E2E_PASSWORD="$(grep -oP 'parola\s*=\s*\K\S+' ../../.demo-credentials)" PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test 2>&1 | grep -v "pid=") > $OUT/R04-R05-e2e-temiz-seed.log
echo FINAL_DONE
