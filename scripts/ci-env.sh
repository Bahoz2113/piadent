#!/bin/sh
# CI için .env üretir: .env.example'dan, her parola rastgele (yalnız bu koşu için; hiçbir yere yazdırılmaz).
# Kullanım: ADMIN_PW=<postgres servis parolası> sh scripts/ci-env.sh > .env
set -eu
rnd() { node -e "process.stdout.write(require('crypto').randomBytes(18).toString('base64url'))"; }
APP=$(rnd); OWNER=$(rnd); WORKER=$(rnd); BACKUP=$(rnd)
KEY=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")
sed -e "s#CHANGE_ME_APP#$APP#g" -e "s#CHANGE_ME_OWNER#$OWNER#g" -e "s#CHANGE_ME_WORKER#$WORKER#g" -e "s#CHANGE_ME_BACKUP#$BACKUP#g" \
    -e "s#CHANGE_ME_ADMIN#${ADMIN_PW:?ADMIN_PW gerekli}#g" \
    -e "s#^VIADENT_SECRET_KEY=.*#VIADENT_SECRET_KEY=$KEY#" \
    -e "s#^VIADENT_BACKUP_DB_PASSWORD=.*#VIADENT_BACKUP_DB_PASSWORD=$BACKUP#" \
    -e "s#^BACKUP_ENCRYPTION_PASSPHRASE=.*#BACKUP_ENCRYPTION_PASSPHRASE=$(rnd)$(rnd)#" \
    -e "s#^VIADENT_DEMO_PASSWORD=.*#VIADENT_DEMO_PASSWORD=$(rnd)#" \
    .env.example
