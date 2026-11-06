# Alur Lanjutan dan Syarat Penawaran: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat PO pelanggan mudah ditemukan, Siap Dikirim punya tombol, detail SO menyebut langkah berikutnya, dan penawaran memuat syarat sesuai contoh pemilik.

**Architecture:** Menambah ke halaman dan API yang ada. Aturan langkah berikutnya menjadi fungsi murni yang diuji dengan `node --test`; syarat baru disimpan di dua kolom teks mengikuti pola `mtpp_term_*`.

**Tech Stack:** React, Ant Design, NestJS, Prisma 7, PostgreSQL, Docker Compose, Node 24 (`node --test`), Playwright 1.58.2 di `e2e/node_modules`.

**Spec:** `docs/superpowers/specs/2026-11-05-alur-lanjutan-design.md`

## Global Constraints

- Proyek ini bukan repositori git dan tidak boleh di-`git init`. Ganti langkah commit dengan mencatat file yang berubah.
- Skrip yang menulis data hanya berjalan pada proyek compose `mtpp-nav` di port 8081, dari database bersih (`down -v`, `up -d --build`, `demo-flow`, `edge-flow`). Instance utama port 8080 tidak boleh disentuh.
- `@Perm`, matriks hak akses, dan warna tidak berubah. Palet tetap merah `#90241D`, kuning, putih.
- Tagihan, jatuh tempo invoice, stok, PPN, dan jurnal tidak berubah.
- Di luar lingkup: tagihan DP, halaman atau file PO pelanggan, Beranda per peran, bawaan waktu kirim, masa berlaku, dan garansi.
- Audit `node e2e/nav-audit.mjs`, `node --test src/nav.test.ts` di `apps/web`, dan `tsc --noEmit` di `apps/web` dan `apps/api` tetap bersih di akhir tiap task.

## Review Focus

- Dokumen lama tanpa Penyerahan dan Standar: PDF mencetak tanpa baris itu, bukan baris kosong atau "null" (Task 1).
- Pengaturan `terms` yang sudah tersimpan tanpa kunci baru: penawaran baru tetap mendapat bawaan Penyerahan dan Standar (Task 1).
- PO Pelanggan dikosongkan di dialog konfirmasi saat sebelumnya terisi: nilai menjadi kosong; simpan yang gagal tetap menghentikan konfirmasi (Task 2).
- Klik ganda atau tab basi pada **Buat Surat Jalan**: tidak ada dokumen ganda, ada pesan jelas, daftar diperbarui (Task 3).
- Pelanggan baru belum lunas dengan stok tersedia: yang tampil langkah pembayaran, bukan surat jalan (Task 4).

---

### Task 1: Syarat penawaran

**Files:**
- Create: `apps/api/prisma/migrations/20261106100000_quotation_terms/migration.sql`
- Modify: `apps/api/prisma/schema.prisma:379`, `apps/api/src/common/settings.service.ts:8`, `apps/api/src/modules/sales/sales.service.ts:19,87,222,326-327`, `apps/web/src/pages/Sales.tsx:71,124,232`, `apps/web/src/pages/Settings.tsx:170`, `apps/api/scripts/edge-flow.mjs`

**Interfaces:**
- Produces: kolom `SalesOrders.mtppTermHandover` (`mtpp_term_handover` text, boleh kosong) dan `SalesOrders.mtppTermStandard` (`mtpp_term_standard` text, boleh kosong); kunci `terms.handover` dan `terms.standard`.

- [ ] **Step 1: Tambahkan tes di `edge-flow.mjs`**

Assertion, memakai pembantu pembaca PDF yang sudah ada di T7:

```js
const q = await call(S, 'POST', '/sales-orders', quoteBody);
ok(q.mtppTermPayment === 'DP 30% saat PO diterima, 70% sebelum barang dikirim', 'DP 30/70 bawaan');
ok(q.mtppTermHandover === 'Franco On Truck Surabaya' && q.mtppTermStandard === 'IEC / SPLN / SLI / ANSI', 'bawaan penyerahan dan standar');
// PDF penawaran: memuat "Franco On Truck Surabaya", "IEC / SPLN / SLI / ANSI", dan tidak memuat "Term of payment"
// PDF order setelah konfirmasi: masih memuat "Term of payment"
// Salin penawaran: kedua nilai ikut
// PATCH kedua nilai oleh Sales tersimpan; teks Pembayaran per penawaran bisa diubah dan tercetak
// Dokumen lama: UPDATE lewat psqlNav membuat kedua kolom NULL; PDF penawaran 200 dan tidak memuat "Penyerahan" maupun "Standar" maupun "null"
// PUT setting terms tanpa kunci handover dan standard: penawaran baru tetap mendapat bawaan; pulihkan setting sesudahnya
// Invoice: jatuh tempo tetap mengikuti jumlah hari Term of Payment pelanggan
```

Bagian berkomentar ditulis sebagai assertion sungguhan.

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `API=http://localhost:8081/api node apps/api/scripts/edge-flow.mjs` setelah database bersih dan `demo-flow`.
Expected: FAIL pada `DP 30/70 bawaan`.

- [ ] **Step 3: Implementasikan**

- `terms.payment`: `DP 30% saat PO diterima, 70% sebelum barang dikirim`; `terms.handover`: `Franco On Truck Surabaya`; `terms.standard`: `IEC / SPLN / SLI / ANSI`.
- Baca `terms` dengan bawaan digabung lebih dulu, sehingga kunci yang tidak ada di pengaturan tersimpan tetap terisi.
- `HEAD_FIELDS`, `create`, dan salin menyertakan kedua kolom.
- PDF kind `quotation`: tambah baris `Penyerahan / Delivery term` dan `Standar / Standard` hanya bila terisi; hapus `Term of payment` dari `infoRight`. Kind `order` tidak berubah.
- Web: tab Syarat Penawaran dan Pengaturan → Format Cetak mendapat kolom Penyerahan dan Standar.

- [ ] **Step 4: Jalankan dari database bersih dan pastikan lulus**

Expected: `demo-flow` lulus, `edge-flow` 0 gagal. Periksa satu PDF penawaran secara visual.

- [ ] **Step 5: Catat file yang berubah**

### Task 2: PO pelanggan mudah ditemukan

**Files:**
- Modify: `apps/web/src/pages/Sales.tsx:15-28,134,161`, `apps/api/scripts/edge-flow.mjs`
- Create: `e2e/alur-po-pelanggan.mjs`

- [ ] **Step 1: Tambahkan tes**

`edge-flow.mjs`: `confirm` dengan `clientOrderRef: 'PO-A'` menyimpan nilai; tanpa field mempertahankan nilai lama; dengan `''` mengosongkan nilai menjadi `null`.

`e2e/alur-po-pelanggan.mjs`, dengan klik sungguhan sebagai Sales: halaman Penawaran menampilkan teks petunjuk; dialog konfirmasi punya kolom PO Pelanggan berisi nilai saat ini; mengisi lalu menekan Konfirmasi menyimpan nilainya; nomor penawaran ganda yang belum tersimpan menghentikan konfirmasi dan nilai PO tidak tersimpan; Tab Sales Order tidak menampilkan petunjuk.

- [ ] **Step 2: Jalankan dan pastikan gagal**

Expected: FAIL pada `''` dan pada teks petunjuk.

- [ ] **Step 3: Implementasikan**

- `PageHead.sub` tab Penawaran: `PO dari pelanggan dicatat di sini: buka atau buat penawaran, isi PO Pelanggan, lalu konfirmasi.`
- Dialog `Modal.confirm` memuat `Input` berlabel PO Pelanggan dengan nilai awal `o.clientOrderRef`. Nilai yang telah di-`trim` dikirim ke `confirm` sebagai `clientOrderRef`.
- `act(action, message, body?)` meneruskan `body`.
- `confirm` di `sales.service.ts`: `''` disimpan sebagai `null`, dan field yang tidak dikirim tidak mengubah nilai.

- [ ] **Step 4: Jalankan dan pastikan lulus, lalu catat file yang berubah**

### Task 3: Buat Surat Jalan di Siap Dikirim

**Files:**
- Create: `apps/web/src/pages/createDelivery.tsx`, `e2e/alur-surat-jalan.mjs`
- Modify: `apps/web/src/pages/Stock.tsx:82-95`, `apps/web/src/pages/Sales.tsx:163`

**Interfaces:**
- Produces: `useCreateDelivery(onDone: () => void): { create(soId: number): void; isCreating(soId: number): boolean }`, mengikuti pola `useCreatePO` di `createPO.tsx`.

- [ ] **Step 1: Tulis `e2e/alur-surat-jalan.mjs`**

Dengan klik sungguhan pada SO dari `demo-flow`:
- Operasional melihat tombol **Buat Surat Jalan** dan satu klik membuka surat jalan yang terbentuk.
- Klik ganda: tepat satu POST dan satu dokumen.
- Tab basi (SO sudah dibuatkan surat jalan lewat API setelah daftar dimuat): pesan server tampil, daftar diperbarui, tidak ada dokumen ganda.
- Sales melihat daftar tanpa tombol.

- [ ] **Step 2: Jalankan dan pastikan gagal**

Expected: FAIL, tombol belum ada.

- [ ] **Step 3: Implementasikan**

Kolom tombol pada `ReadyToShipList`, hanya bila `can('gudang', 'create')`. Hook memanggil `POST /transfers/from-sale/:id`: satu dokumen membuka `/stok/dok/:id`, lebih dari satu menampilkan `${n} surat jalan dibuat` lalu `onDone`, gagal memanggil `onDone`. Tombol di detail SO memakai hook yang sama, dengan `canDeliver` tetap berlaku. Teks sub: `Sales order yang stok bebasnya tersedia dan belum dibuatkan surat jalan. Pelanggan baru tampil setelah lunas.`

- [ ] **Step 4: Jalankan dan pastikan lulus, lalu catat file yang berubah**

### Task 4: Langkah berikutnya di detail SO

**Files:**
- Create: `apps/web/src/pages/nextSteps.ts`, `apps/web/src/pages/nextSteps.test.ts`
- Modify: `apps/api/src/modules/sales/sales.service.ts:92-113,250-260`, `apps/web/src/pages/Sales.tsx`, `apps/api/scripts/edge-flow.mjs`, `README.md`

**Interfaces:**
- Produces: `GET /sales-orders/:id` mendapat `readyItems: number`, memakai perhitungan yang sama dengan `readyToShip()`.
- Produces: `nextSteps(o: { state: string; shortage?: { shortage: number }[]; partner?: { mtppIsNewCustomer?: boolean }; payment?: { paidFull?: boolean }; readyItems?: number; canDeliver?: boolean; invoiceStatus?: string }): string[]`.

- [ ] **Step 1: Tulis tes yang gagal di `nextSteps.test.ts`**

```ts
const PO = 'Berikutnya: Finance membuat PO Principal.';
const BAYAR = 'Berikutnya: Finance mencatat pembayaran pelanggan.';
const KIRIM = 'Berikutnya: Operasional membuat surat jalan.';
const TAGIH = 'Berikutnya: Finance membuat invoice.';
assert.deepEqual(nextSteps({ state: 'draft', shortage: [{ shortage: 1 }] }), []);
assert.deepEqual(nextSteps({ state: 'cancel', readyItems: 1, canDeliver: true }), []);
assert.deepEqual(nextSteps({ state: 'sale', shortage: [{ shortage: 2 }] }), [PO]);
assert.deepEqual(nextSteps({ state: 'sale', partner: { mtppIsNewCustomer: true }, payment: { paidFull: false }, readyItems: 1, canDeliver: false }), [BAYAR]);
assert.deepEqual(nextSteps({ state: 'sale', readyItems: 1, canDeliver: true }), [KIRIM]);
assert.deepEqual(nextSteps({ state: 'sale', readyItems: 0, canDeliver: true }), []);
assert.deepEqual(nextSteps({ state: 'done', invoiceStatus: 'to_invoice' }), [TAGIH]);
assert.deepEqual(nextSteps({ state: 'sale', shortage: [{ shortage: 1 }], readyItems: 1, canDeliver: true, invoiceStatus: 'to_invoice' }), [PO, KIRIM, TAGIH]);
assert.deepEqual(nextSteps({ state: 'done', invoiceStatus: 'invoiced' }), []);
```

Di `edge-flow.mjs`: `readyItems` pada detail SO sama dengan kolom `items` baris SO itu di `worklist/ready`, dan 0 bila SO tidak ada di daftar.

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `cd apps/web && node --test src/pages/nextSteps.test.ts`
Expected: FAIL, modul belum ada.

- [ ] **Step 3: Implementasikan**

`readyToShip()` dan `get` memakai satu pembantu privat di `sales.service.ts`. `SalesDetail` merender daftar `nextSteps(o)` sebagai satu keterangan di atas formulir, memakai komponen dan warna yang ada, hanya bila daftar berisi. Tanpa warna biru: pastikan `Alert` tipe `info` tidak dipakai bila warnanya bawaan biru.

- [ ] **Step 4: Jalankan dan pastikan lulus**

Run: `cd apps/web && node --test src/pages/nextSteps.test.ts`, lalu `edge-flow` dari database bersih.
Expected: PASS.

- [ ] **Step 5: Perbaiki README**

Tulis: Operasional melihat harga beli di PO; harga pokok dan margin di halaman SO tetap tersembunyi. Sebutkan juga PO pelanggan, Buat Surat Jalan, dan teks bawaan DP. Catat file yang berubah.

### Task 5: Pemeriksaan akhir

**Files:** tidak ada perubahan produk.

- [ ] **Step 1: Jalankan semua pemeriksaan dari database bersih**

Run pada `mtpp-nav`: `demo-flow`, `edge-flow`, `node --test src/nav.test.ts src/pages/nextSteps.test.ts` di `apps/web`, `tsc --noEmit` di `apps/web` dan `apps/api`, `node e2e/nav-audit.mjs`, `node e2e/alur-po-pelanggan.mjs`, `node e2e/alur-surat-jalan.mjs`.
Expected: semua exit 0.

- [ ] **Step 2: Klik alur lengkap dari Beranda, tanpa alamat langsung**

Sales: buat penawaran dengan PO Pelanggan, konfirmasi. Operasional: buat surat jalan dari Siap Dikirim, validasi. Finance: buat invoice dari Siap Ditagih, posting, cetak. Pastikan langkah berikutnya benar di detail SO tiap tahap. Ambil tangkapan layar dan laporkan langkah yang masih harus ditebak.

- [ ] **Step 3: Berhenti untuk persetujuan pemilik**

Penerapan ke `:8080` mengikuti Task 8 langkah 3-6 di `docs/superpowers/plans/2026-11-05-navigasi.md`, dengan `_prisma_migrations` berisi 5 baris selesai. Jangan menerapkan tanpa persetujuan.
