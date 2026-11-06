# Sistem Distribusi Berbasis Web — PT Mentari Timur Prima Perkasa

Prototipe aplikasi capstone (224117136 · 224117139 · 222117029 · 222117008).
Stack: **NestJS 10 (Node.js + TypeScript, Express)** · **React 18 + TypeScript (Vite, Ant Design)** · **PostgreSQL 16** · **Prisma ORM** · **Nginx** · **Docker** · **Brevo Email API** · Google Cloud Compute Engine (asia-southeast2, Jakarta).

> Catatan: akses database memakai **Prisma ORM 7** dengan driver adapter `pg`. Skema ada di `apps/api/prisma/schema.prisma`, migrasi di `apps/api/prisma/migrations/`. CDM dan PDM di Lampiran C buku Revisi 16 digambar dari struktur tabel yang sama.

Panduan langkah demi langkah, termasuk cadangan dan penanganan masalah: [`CARA-MENJALANKAN.txt`](CARA-MENJALANKAN.txt).

## Alur kerja

```
Sales        Buat penawaran (PN/...) -> isi PO Pelanggan -> Konfirmasi (SO/...)
                                                                |
             stok kurang ----------- pelanggan baru ----------- stok tersedia
                  |                        |                        |
Finance      Buat PO Principal       Terima pembayaran              |
             -> kirim, konfirmasi          | wajib lunas            |
                  |                        v                        v
Operasional  Validasi penerimaan ------> Buat surat jalan -> Validasi surat jalan
                  |                                                 |
Finance      Catat tagihan,                                         v
             bayar principal     Buat invoice -> Posting -> Catat pembayaran
```

Satu sales order bisa menempuh beberapa jalur sekaligus. Keterangan **Berikutnya** di detail sales order menyebut langkah yang menunggu.

## Menjalankan dengan Docker (cara paling mudah)

```bash
cp .env.example .env            # ganti password dan rahasia
docker compose up -d --build    # db + api + web
# buka http://localhost:8080
```

Saat pertama kali menyala, backend menjalankan migrasi database lalu mengisi data awal (grup, hak akses, bagan akun, jurnal) beserta data contoh dasar (3 principal + gudang, 8 produk, 4 pelanggan, stok awal). Set `SEED_DEMO=false` untuk database kosong.

Data disimpan di Docker volume `mtpp_dbdata` (database) dan `mtpp_storage` (lampiran), bukan di folder proyek.

| Akun contoh | Grup |
| --- | --- |
| pimpinan@mtpp.co.id | Pimpinan |
| admin@mtpp.co.id | Admin |
| sales@mtpp.co.id | Sales |
| operasional@mtpp.co.id | Operasional |
| finance@mtpp.co.id | Finance |

Kata sandi semua akun contoh: `mtpp12345` (ganti setelah login lewat menu Profil).

### Data contoh katalog MTPP

Mengisi 49 produk dari katalog website MTPP, dengan harga, stok, kontak principal, dan transaksi contoh. Harga dan stoknya bukan data sungguhan. Produk dan principal contoh dasar diarsipkan. Skrip menolak berjalan dua kali pada database yang sama.

```bash
API=http://localhost:8080/api node apps/api/scripts/seed/mock-data.mjs
```

## Pengujian

Skrip yang menulis data dijalankan pada lingkungan uji terpisah di port 8081, bukan pada database utama:

```bash
# nyalakan lingkungan uji dengan database bersih
docker compose -p mtpp-nav -f docker-compose.yml -f infra/compose/test.yml up -d --build

# uji alur lewat API, berurutan pada database bersih
API=http://localhost:8081/api node tests/flows/demo-flow.mjs
API=http://localhost:8081/api node tests/flows/edge-flow.mjs

# uji aturan menu dan langkah berikutnya
cd apps/web && node --test src/app/nav.test.ts src/features/sales/nextSteps.test.ts && cd ../..

# uji lewat browser (sekali: cd tests/e2e && npm install)
node tests/e2e/nav-audit.mjs
node tests/e2e/alur-po-pelanggan.mjs
node tests/e2e/alur-surat-jalan.mjs
node tests/e2e/alur-berikutnya.mjs

# matikan dan hapus lingkungan uji
docker compose -p mtpp-nav -f docker-compose.yml -f infra/compose/test.yml down -v
```

`nav-audit.mjs` hanya membuka halaman, sehingga boleh dijalankan pada instance utama dengan `BASE=http://localhost:8080`.

## Menjalankan tanpa Docker (pengembangan)

Butuh Node.js 22+ dan PostgreSQL 16.

```bash
# backend
cd apps/api
cp .env.example .env            # isi DATABASE_URL
npm install
npm run build                   # prisma generate + nest build
npx prisma migrate deploy       # terapkan migrasi
npm start                       # http://localhost:3000/api  (data awal otomatis bila kosong)
# atau mode pengembangan: npm run dev

# frontend (terminal lain)
cd apps/web
npm install
npm run dev                     # http://localhost:5173  (proxy /api → :3000)
```

Perubahan skema: ubah `apps/api/prisma/schema.prisma`, lalu `npm run db:migrate` (membuat migrasi baru di `apps/api/prisma/migrations/`). Dengan Docker, `prisma migrate deploy` dijalankan otomatis setiap backend dinyalakan.

## Email (Brevo)

Tanpa `BREVO_API_KEY`, email berjalan dalam **mode simulasi**: log email dibuat dan status `simulasi`, sehingga alur dapat diuji tanpa mengirim email sungguhan.
Dengan kunci Brevo, atur webhook transactional di Brevo ke `https://<domain>/api/email/webhook/<WEBHOOK_TOKEN>` untuk event *delivered, hard bounce, soft bounce, blocked, invalid, error*. Status masuk ke menu **Pengaturan → Email Keluar** dan tampil pada setiap dokumen.

## Perintah

| Keperluan | Perintah |
| --- | --- |
| Menjalankan di komputer sendiri | `docker compose up -d --build` lalu buka http://localhost:8080 |
| Pemeriksaan cepat: format, lint, tipe, uji unit | `npm install && npm run check` |
| Pemeriksaan penuh di lingkungan uji port 8081 | `tests/run-check.sh` |
| Menjalankan produksi | isi `COMPOSE_FILE=docker-compose.yml:infra/compose/production.yml` di `.env`, lalu `docker compose up -d --build` |

Produksi menolak berjalan bila `DB_PASSWORD`, `JWT_SECRET`, atau `WEBHOOK_TOKEN` kosong atau masih bawaan, tidak mengisi data contoh, dan aplikasinya hanya bisa diakses lewat Nginx di VM.

`tests/run-check.sh` membandingkan hasil dengan rekaman di `tests/baseline/expected` bila folder itu ada. Rekaman tidak disimpan di git dan bergantung pada tanggal, jadi buat dulu sebelum mengubah kode, pada hari yang sama: `tests/baseline/fresh-run.sh tests/baseline/expected /tmp/log`.

Setelah mengubah skema, jalankan `npm run db:gen-columns` di `apps/api`.

## Struktur proyek

```
apps/api        backend NestJS
  src/db          koneksi Prisma + penyesuai tipe, seed
  src/shared      auth & hak akses (group_permissions), penomoran, PPN, PDF, catatan/riwayat, file
  src/modules     auth, users, master, sales, purchasing, stock, billing, accounting,
                  email, records, settings, reports, dashboard, importer, public-api, documents
  prisma          schema dan migrasi SQL
  scripts         seed/mock-data.mjs (data contoh), examples/api-client.mjs (contoh REST API)
apps/web        frontend React (warna website MTPP: merah #90241D, kuning, putih; logo matahari MTPP; Inter)
  src/app         titik masuk, Shell, login, menu, gaya
  src/features    satu folder per bagian: home, sales, purchasing, billing, stock, accounting, master, settings, reports, documents
  src/shared      komponen dan fungsi bersama: ui, Crud, Chart, Chatter, hooks, lib
infra           nginx/ (HTTPS di VM), backup/ (harian ke Cloud Storage), compose/ (test, production)
docs            restore.md (prosedur pemulihan), specs, plans, reports, screenshots
tests           flows/ (uji alur API), e2e/ (uji browser), baseline/ (rekaman pembanding)
```

## Modul dan penanggung jawab

Sama dengan bagian "Modul dan pemilik" di rencana build (berdasarkan Tabel 1.1 buku).

| Modul NestJS | Isi | Folder backend | Halaman frontend | PJ |
| --- | --- | --- | --- | --- |
| auth, users | Login, 5 grup, hak akses CRUD, profil dan kata sandi, tanda tangan | auth, users | Home (login, profil), Settings (pengguna, grup) | Marco |
| master | Pelanggan, alamat kirim, principal, gudang, produk, kategori, satuan, term of payment, pricelist jual, data perusahaan, impor data awal | master, importer, settings | Master, Settings (perusahaan, dokumen, impor) | Marco |
| sales | Penawaran, sales order, margin, salin, masa berlaku, pembatalan, proforma | sales | Sales | Marco |
| shared | Penomoran, PDF, lampiran, catatan, riwayat perubahan, aktivitas | shared, records | shared (Chatter, Crud, ui) | Marco dan Brivio |
| purchasing | PO Principal dari SO, pricelist principal, penerimaan dan susulan, dropship | purchasing | Purchasing | Brivio |
| stock | Stok per gudang, mutasi, stok minimum | stock (stock.service) | Stock (stok, minimum, mutasi) | Brivio |
| delivery | Surat jalan 3 lembar, pengiriman bertahap, jadwal kirim, blokir pelanggan baru belum lunas | stock (transfers.service) | Stock (surat jalan) | Shannon |
| email, REST API | Email API Brevo, webhook, email keluar, kirim ulang, API key | email, public-api | Settings (email keluar, API key) | Shannon |
| billing | Invoice, pembayaran, uang muka, tagihan dan pembayaran principal, status bayar PO | billing | Billing | Bryant |
| accounting | Bagan akun, jurnal otomatis dan penyesuaian, buku besar, neraca saldo, kas, rekonsiliasi bank | accounting | Accounting | Bryant |
| reports, dashboard | 12 laporan (3 per anggota) dan beranda per peran | reports, dashboard | Reports, Home | Semua |
| infra | Docker, Nginx HTTPS, deploy VM, cadangan harian | docker-compose.yml, infra, docs | – | Shannon |

## Pemetaan 60 fitur

**Seluruh peran** — Login dan akses menurut grup (`/login`, AuthGuard + `group_permissions`) · Dashboard per peran (`/`) · Dokumen berurutan (penawaran → SO → PO → penerimaan → surat jalan → invoice; PDF dwibahasa + tanda tangan) · Laporan dan filter (`/laporan`, 12 laporan; jumlah mengikuti grup: Pimpinan 12, Finance 7, Sales 5, Operasional 3, Admin 3) · Ekspor laporan (spreadsheet/PDF) · Pencarian dan filter favorit (bilah cari + ★ Favorit) · Catatan internal · Lampiran · Aktivitas terjadwal (lonceng di bilah atas) · Profil dan kata sandi (`/profil`).

**Pimpinan** — Term of payment pelanggan (data pelanggan) · Riwayat perubahan (tab Catatan dan Riwayat) · Pricelist penjualan · Laporan penjualan per periode/pelanggan/produk · margin · piutang jatuh tempo (belum JT, 1–30, 31–60, 61–90, >90) · pembelian dan utang principal · stok per gudang · kas · buku besar dan neraca saldo.

**Admin** — Laporan pesanan belum diterima, stok per gudang, dan pengiriman · Akun dan grup (matriks Baca/Buat/Ubah/Hapus) · Master pelanggan + alamat kirim · Master principal + gudang otomatis · Master produk · Arsip master (hapus ditolak bila sudah dipakai) · Pengaturan PPN, syarat, dan penomoran `<kode>/MTPP/<tahun>/<bulan>/<urut>` · Pencadangan (`infra/backup/backup.sh`, `docs/restore.md`) · Kategori dan satuan · Data perusahaan, logo, tanda tangan · Impor data awal (pelanggan, alamat, principal, produk, pricelist principal, stok awal, saldo awal akun, invoice & tagihan terbuka).

**Sales** — Surat penawaran · Margin (hanya Pimpinan/Sales/Finance, tidak tercetak) · Kirim email · Konfirmasi menjadi SO · Salin · Masa berlaku & tanda kedaluwarsa · Cetak PDF · Batal & kembali ke draf · Riwayat transaksi pelanggan · Status terkirim/tertagih per baris · PO Pelanggan dicatat di penawaran dan SO · teks Pembayaran bawaan penawaran baru: "DP 30% saat PO diterima, 70% sebelum barang dikirim" (tercetak saja, bukan tagihan DP; Sales dapat mengubahnya per penawaran) · keterangan "Berikutnya" di detail SO menunjukkan langkah yang menunggu (PO Principal, pembayaran, surat jalan, invoice).

**Operasional** — Pemantauan PO Principal & penerimaan terlambat · Barang masuk + bukti penerimaan · Stok fisik/terikat/bebas + mutasi · Surat jalan 3 lembar & pengiriman bertahap · Penerimaan susulan · Dropship · Stok minimum · Jadwal pengiriman & filter terlambat · Alamat kirim · Laporan stok & pengiriman · Buat Surat Jalan dari detail SO atau daftar Siap Dikirim · Operasional melihat harga beli di PO Principal; harga pokok dan margin di halaman SO tetap tersembunyi.

**Finance** — Pricelist & diskon principal · PO dari SO terkonfirmasi (kekurangan stok, satu PO per principal, dropship dipisah) · Tagihan & pembayaran principal (status: menunggu barang → lunas) · Proforma invoice (persen ⇄ nominal, tanpa jurnal) · Invoice (DPP, PPN 12% × 11/12, terbilang, jatuh tempo) · Pembayaran & umur piutang (uang muka pelanggan baru dipakai otomatis) · Kas · Bagan akun & jurnal otomatis seimbang · Jurnal penyesuaian, pembalik, buku besar · Rekonsiliasi bank (impor CSV, cocok otomatis).

## Pembuat dokumen (menu Surat & Berita Acara)

Tata letak semua PDF mengikuti MTPP Docs, dengan warna merah `#90241D`: kop dengan kontak rata kanan, judul besar dwibahasa, tabel bergaris tipis, deskripsi bertingkat (baris pertama tebal, berikutnya spesifikasi), terbilang Indonesia dan Inggris, kotak meterai otomatis pada kuitansi di atas Rp5.000.000.

Empat dokumen di luar alur transaksi dibuat lewat formulir dengan pratinjau PDF langsung: **Surat Resmi** (`SP`), **Berita Acara Serah Terima** (`BA`), **Berita Acara Commissioning** (`BC`), **Laporan Pemeliharaan** (`LM`). Tersedia pilih pelanggan, ambil dari sales order, katalog barang, duplikat, dan "Buat dari ini" yang membawa data ke jenis dokumen lain. Dokumen ini tidak memengaruhi stok maupun jurnal.

Penawaran, invoice, surat jalan, PO, proforma, dan kuitansi tetap dibuat dari transaksinya supaya stok, PPN, dan jurnal tetap benar. Profil perusahaan ada di **Pengaturan → Perusahaan**; syarat cetak di **Pengaturan → Format Cetak**.

## Aturan bisnis utama

- Pelanggan baru (ditetapkan Admin atau Pimpinan) wajib melunasi seluruh nilai SO sebelum surat jalan dapat dibuat atau divalidasi; penanda berakhir otomatis saat SO pertama terkirim seluruhnya dan lunas; pembayaran sebelum invoice dicatat sebagai **Uang Muka Pelanggan** dan otomatis dipakai saat invoice diposting.
- PO Principal hanya dibuat dari SO yang sudah dikonfirmasi: kekurangan = sisa kirim − stok bebas − yang sudah dipesan.
- Stok bebas = stok fisik − stok terikat (sisa kirim SO berstatus Sales Order); stok tidak boleh minus. Surat jalan dibatasi stok bebas: SO yang lebih dulu dikonfirmasi berhak atas stok lebih dulu, dan surat jalan tetap di gudang tempat stoknya terikat. Persediaan periodik: mutasi stok tidak membuat jurnal.
- Harga pokok = harga principal yang berlaku (tanggal mulai terbaru, kuantitas minimum terbesar); harga pokok dan margin disaring di server untuk grup Admin dan Operasional.
- Jurnal yang sudah diposting tidak dapat diubah; pembatalan melalui jurnal pembalik. Pembayaran dibatalkan dari menu Penagihan supaya sisa tagihan ikut kembali.
- SO tidak dapat dibatalkan selama PO Principal masih berjalan atau uang muka belum dikembalikan (**Kembalikan Uang Muka**).
- **Tutup sisa PO**: bila principal tidak mengirim sisanya, kuantitas PO menjadi sebesar yang diterima dan sisanya dapat dipesan ulang.
- Retur barang dan stock opname berada di luar cakupan sistem.

## REST API untuk aplikasi lain

Buat kunci di **Pengaturan → API Key**, lalu:

```bash
curl -H "X-API-Key: mtpp_xxx" http://localhost:8080/api/v1/sales-orders?state=sale
curl -H "X-API-Key: mtpp_xxx" http://localhost:8080/api/v1/invoices?paymentState=not_paid
curl -H "X-API-Key: mtpp_xxx" http://localhost:8080/api/v1/stock
```

Contoh klien Node.js: `apps/api/scripts/examples/api-client.mjs`.

## Produksi di Google Cloud

1. VM Compute Engine (e2-medium, Ubuntu 24.04, region asia-southeast2) dengan Docker + Docker Compose.
2. `git clone` ke `/opt/mtpp`, isi `.env` (`COMPOSE_FILE=docker-compose.yml:infra/compose/production.yml`, `JWT_SECRET` panjang dan acak, `SEED_DEMO=false`), `docker compose up -d --build`. Dengan `APP_ENV=production` backend menolak berjalan bila `JWT_SECRET` kosong atau masih bawaan; `SEED_DEMO=false` menyembunyikan akun contoh pada halaman login.
3. Nginx di VM untuk HTTPS: `infra/nginx/nginx-https.conf` + `certbot --nginx -d <domain>`.
4. Backup harian: buat bucket `gs://mtpp-backup`, beri service account VM akses tulis, lalu `crontab -e`:
   `15 1 * * * /opt/mtpp/infra/backup/backup.sh >> /var/log/mtpp-backup.log 2>&1`. Pemulihan: `docs/restore.md`.
