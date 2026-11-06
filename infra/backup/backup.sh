#!/usr/bin/env bash
# Pencadangan harian: database + lampiran → Cloud Storage. Salinan disimpan 30 hari.
# Jadwal (crontab -e pada VM):  15 1 * * * /opt/mtpp/infra/backup/backup.sh >> /var/log/mtpp-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/../.."
source .env 2>/dev/null || true
BUCKET="${GCS_BUCKET:-gs://mtpp-backup}"
STAMP="$(TZ=Asia/Jakarta date +%Y%m%d-%H%M)"
TMP="$(mktemp -d)"
echo "[$STAMP] mulai pencadangan"
docker compose exec -T db pg_dump -U mtpp -d mtpp -Fc > "$TMP/mtpp-$STAMP.dump"
docker compose run --rm --no-deps -v "$TMP:/out" --entrypoint sh api -c "tar czf /out/storage-$STAMP.tgz -C /app storage"
gsutil -q cp "$TMP/mtpp-$STAMP.dump" "$TMP/storage-$STAMP.tgz" "$BUCKET/$STAMP/"
rm -rf "$TMP"
# hapus salinan lebih dari 30 hari (atau pakai lifecycle rule bucket, lihat docs/restore.md)
CUTOFF="$(date -d '30 days ago' +%Y%m%d)"
for d in $(gsutil ls "$BUCKET/" | sed -E 's#.*/([0-9]{8})-[0-9]{4}/$#\1#' | grep -E '^[0-9]{8}$' | sort -u); do
  if [ "$d" -lt "$CUTOFF" ]; then gsutil -q -m rm -r "$BUCKET/${d}-*" || true; fi
done
echo "[$STAMP] selesai → $BUCKET/$STAMP/"
