#!/bin/sh
# Konteyner içi yedek zamanlayıcısı (infra/compose.prod.yml → backup). Saatlik yedek; her gün 00 UTC (03:00 TSİ) saatinde izole geri yükleme doğrulaması.
# Bir adım başarısız olursa satır "YEDEK-HATA" ile günlüğe yazılır (izleme bu kalıba alarm kurar) ve döngü sürer.
set -u
cd "$(dirname "$0")"
last_verify_day=""
while true; do
  if node dist/backup-cli.js backup; then echo "YEDEK-OK $(date -u +%FT%TZ)"; else echo "YEDEK-HATA yedek $(date -u +%FT%TZ)"; fi
  day=$(date -u +%F); hour=$(date -u +%H)
  if [ "$hour" = "00" ] && [ "$day" != "$last_verify_day" ]; then
    if node dist/backup-cli.js restore-verify; then echo "YEDEK-OK dogrulama $(date -u +%FT%TZ)"; else echo "YEDEK-HATA dogrulama $(date -u +%FT%TZ)"; fi
    last_verify_day=$day
  fi
  sleep 3600
done
