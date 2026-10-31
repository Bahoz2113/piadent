#!/usr/bin/env bash
# PİA-DENT — WAL arşivleme + zaman noktasına geri yükleme (PITR) tatbikatı (Görev 12, ADR-071).
# Ne yapar: (1) kümede archive_mode açık mı denetler (değilse nasıl açılacağını yazar ve durur),
# (2) pg_basebackup ile temel yedek alır, (3) bir "işaret" satırı yazar ve zamanı not eder, (4) sonra bir "hatalı" satır yazar,
# (5) temel yedeği ayrı bir dizine/porta, recovery_target_time = işaret zamanı ile geri yükler, (6) işaret var / hatalı yok doğrular, süreleri ölçer.
# Üretim verisine DOKUNMAZ: tatbikat tablosu pitr_drill yalnız bu betiğin kendi şemasındadır (ops şeması), geri yükleme ayrı kümeye yapılır.
# Kullanım (postgres işletim kullanıcısıyla):  PGPORT=5432 WORK=/var/tmp/viadent-pitr scripts/pitr-drill.sh
set -euo pipefail
PGPORT="${PGPORT:-5432}"
WORK="${WORK:-/var/tmp/viadent-pitr}"
RESTORE_PORT="${RESTORE_PORT:-5499}"
DB="${PGDATABASE:-postgres}"
BIN="${PGBIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}"
psqlc() { psql -p "$PGPORT" -d "$DB" -Atq -v ON_ERROR_STOP=1 "$@"; }
t0=$(date +%s)

echo "== 1/6 Arşivleme denetimi"
mode=$(psqlc -c "show archive_mode"); cmd=$(psqlc -c "show archive_command"); lvl=$(psqlc -c "show wal_level")
if [ "$mode" != "on" ] || [ "$lvl" = "minimal" ] || [ -z "$cmd" ] || [ "$cmd" = "(disabled)" ]; then
  cat <<EOF
archive_mode=$mode wal_level=$lvl archive_command='$cmd' → PITR için WAL arşivi yok.
Açmak için (yeniden başlatma gerekir):
  alter system set wal_level = 'replica';
  alter system set archive_mode = 'on';
  alter system set archive_command = 'test ! -f $WORK/wal/%f && cp %p $WORK/wal/%f';   -- üretimde: ikinci konuma kopyalayan, başarısızlıkta ≠0 dönen komut
  alter system set archive_timeout = '300';   -- en geç 5 dk'da bir WAL parçası (RPO sınırı)
Sonra: systemctl restart postgresql  ve bu betiği yeniden çalıştırın.
EOF
  exit 2
fi
mkdir -p "$WORK/wal" "$WORK/base"; rm -rf "$WORK/base"/* "$WORK/restore"
echo "archive_mode=on, archive_command='$cmd'"

echo "== 2/6 Temel yedek (pg_basebackup)"
tb=$(date +%s)
"$BIN/pg_basebackup" -p "$PGPORT" -D "$WORK/base" -Ft -z -Xnone -c fast --no-password
echo "temel yedek: $(du -sh "$WORK/base" | cut -f1), $(( $(date +%s) - tb )) sn"

echo "== 3/6 İşaret satırı"
psqlc -c "create schema if not exists ops; drop table if exists ops.pitr_drill; create table ops.pitr_drill(id serial primary key, kind text, at timestamptz default clock_timestamp())"
psqlc -c "insert into ops.pitr_drill(kind) values ('isaret')"
sleep 2
TARGET=$(psqlc -c "select to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.US TZ')")
sleep 2
echo "== 4/6 'Hatalı' satır (geri yüklemede OLMAMALI) ve WAL döndürme"
psqlc -c "insert into ops.pitr_drill(kind) values ('hatali')"
psqlc -c "select pg_switch_wal()" >/dev/null
# arşivleyicinin son parçayı yazmasını bekle
for i in $(seq 1 30); do
  last=$(psqlc -c "select coalesce(last_archived_wal,'') from pg_stat_archiver")
  [ -n "$last" ] && [ -f "$WORK/wal/$last" ] && break; sleep 1
done
echo "arşivde $(ls "$WORK/wal" | wc -l) WAL parçası; hedef zaman: $TARGET"

echo "== 5/6 Ayrı kümeye geri yükleme (port $RESTORE_PORT, hedef = işaret zamanı)"
tr0=$(date +%s)
mkdir -p "$WORK/restore"; chmod 700 "$WORK/restore"
tar -xzf "$WORK/base/base.tar.gz" -C "$WORK/restore"
rm -rf "$WORK/restore/pg_wal"/* 2>/dev/null || true; mkdir -p "$WORK/restore/pg_wal"
# Debian/Ubuntu paketlerinde yapılandırma dosyaları veri dizini DIŞINDADIR (/etc/postgresql/...): temel yedekte yoktur, kopyalanır ve yollar ezilir.
for f in config_file hba_file ident_file; do
  src=$(psqlc -c "show $f"); dst="$WORK/restore/$(basename "$src")"
  [ -f "$dst" ] || cp "$src" "$dst"
done
# Kopyalanan postgresql.conf'taki mutlak yollar ÜRETİM kümesini gösterir (data_directory!): bu satırlar etkisizleştirilir, pg_ctl -D dizini geçerli olur.
sed -i -E "s#^[[:space:]]*(data_directory|hba_file|ident_file|external_pid_file|include_dir|include|cluster_name|port|ssl_cert_file|ssl_key_file)[[:space:]]*=.*#\# (tatbikatta kapatıldı) &#" "$WORK/restore/postgresql.conf"
cat >> "$WORK/restore/postgresql.auto.conf" <<EOF
hba_file = '$WORK/restore/pg_hba.conf'
ident_file = '$WORK/restore/pg_ident.conf'
external_pid_file = ''
cluster_name = 'viadent-pitr-drill'
ssl = off
port = $RESTORE_PORT
archive_mode = off
restore_command = 'cp $WORK/wal/%f %p'
recovery_target_time = '$TARGET'
recovery_target_action = 'promote'
listen_addresses = '127.0.0.1'
unix_socket_directories = '$WORK'
EOF
touch "$WORK/restore/recovery.signal"
"$BIN/pg_ctl" -D "$WORK/restore" -l "$WORK/restore.log" -w -t 120 start >/dev/null
for i in $(seq 1 60); do
  if psql -h "$WORK" -p "$RESTORE_PORT" -d "$DB" -Atqc "select not pg_is_in_recovery()" 2>/dev/null | grep -q t; then break; fi; sleep 1
done
echo "geri yükleme + kurtarma: $(( $(date +%s) - tr0 )) sn"

echo "== 6/6 Doğrulama"
got=$(psql -h "$WORK" -p "$RESTORE_PORT" -d "$DB" -Atqc "select string_agg(kind, ',' order by id) from ops.pitr_drill")
"$BIN/pg_ctl" -D "$WORK/restore" -m fast -w stop >/dev/null
psqlc -c "drop table ops.pitr_drill" >/dev/null
if [ "$got" = "isaret" ]; then
  echo "SONUÇ: BAŞARILI — işaret satırı var, hatalı satır yok (zaman noktası doğru). Toplam $(( $(date +%s) - t0 )) sn."
else
  echo "SONUÇ: BAŞARISIZ — geri yüklenen kümedeki satırlar: '$got' (beklenen: 'isaret')"; exit 1
fi
