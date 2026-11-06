# Prosedur Pemulihan Database dan Lampiran

Salinan dibuat setiap hari pukul 01.15 WIB oleh `infra/backup/backup.sh` dan disimpan di Cloud Storage
(`gs://mtpp-backup/<tanggal-jam>/`), berisi `mtpp-<stamp>.dump` (database) dan `storage-<stamp>.tgz` (lampiran, PDF, logo, tanda tangan).

## 1. Pilih salinan
```bash
gsutil ls gs://mtpp-backup/
gsutil cp gs://mtpp-backup/20261104-0115/* /tmp/restore/
```

## 2. Hentikan backend agar tidak ada transaksi baru
```bash
cd /opt/mtpp
docker compose stop api web
```

## 3. Pulihkan database
```bash
docker compose exec -T db psql -U mtpp -d postgres -c "DROP DATABASE mtpp WITH (FORCE);" -c "CREATE DATABASE mtpp;"
docker compose exec -T db pg_restore -U mtpp -d mtpp --no-owner < /tmp/restore/mtpp-20261104-0115.dump
```

## 4. Pulihkan lampiran
```bash
docker compose run --rm --no-deps -v /tmp/restore:/in --entrypoint sh api -c "rm -rf /app/storage/* && tar xzf /in/storage-20261104-0115.tgz -C /app"
```

## 5. Nyalakan kembali dan periksa
```bash
docker compose up -d
docker compose logs -f api   # tunggu "API berjalan"
```
Login sebagai Admin, buka beberapa dokumen terakhir dan unduh satu lampiran untuk memastikan data utuh.

## Retensi 30 hari (opsional, di sisi bucket)
```bash
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > lifecycle.json
gsutil lifecycle set lifecycle.json gs://mtpp-backup
```
