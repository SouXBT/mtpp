# Rancangan Perbaikan Navigasi MTPP Distribusi

Tanggal: 2026-11-05. Status: disetujui pemilik. Rencana kerja: `docs/superpowers/plans/2026-11-05-navigasi.md`.

## Tujuan dan alasan

Pemilik menilai software "sangat membingungkan untuk dinavigasi" dan tidak menemukan cara membuat PO. Review desain menemukan tiga akar masalah: menu berubah bentuk dan menampilkan halaman terlarang, halaman kerja tidak menyediakan tindakan, dan istilah tumpang tindih.

Sasaran: pengguna baru bisa menjawab "saya di mana, apa yang bisa saya lakukan, langkah berikutnya apa" tanpa dipandu.

## Sasaran terukur

Pengguna yang belum pernah memakai sistem dapat menyelesaikan tanpa bantuan:

1. Mencatat PO pelanggan pada penawaran dan menjadikannya sales order.
2. Membuat PO ke principal dari sales order yang stoknya kurang.
3. Mencetak invoice.

Tidak ada peran yang menerima error "Anda tidak memiliki akses" hanya karena mengeklik menu.

## Bukan sasaran

Ditangani terpisah, jangan dicampur ke pekerjaan ini:

- Term of payment DP 30% / 70% sebagai tagihan sungguhan, dan penyamaan syarat penawaran dengan MTPP Docs.
- Harga beli yang terlihat oleh Operasional lewat detail dan PDF PO.
- Halaman, tanggal, atau file khusus untuk PO pelanggan.
- Perubahan hak akses grup.
- Perubahan warna, termasuk judul tabel merah. Palet merah, kuning, putih tetap berlaku.
- Tampilan khusus per peran di Beranda.

## Yang tidak boleh terjadi

- Hak akses backend melemah. Menyembunyikan menu hanya tampilan; `@Perm` tetap menjadi penjaga.
- Alamat halaman lama yang sudah ada menjadi 404.
- Alur stok, PPN, atau jurnal berubah karena pekerjaan navigasi.
- Data uji ditulis ke database utama.

## Pendekatan

| Pilihan | Untung | Rugi |
|---|---|---|
| **A. Menu atas dua baris (dipilih pemilik)** | Perubahan paling kecil, tetap mengikuti desain menu atas yang ada | Layar sempit perlu penanganan khusus |
| B. Menu samping | Semua menu terlihat, mudah ditambah | Tata letak semua halaman berubah, area tabel menyempit |
| C. Menu berdasarkan tugas per peran | Paling mudah bagi pemula | Pekerjaan terbesar, perlu kesepakatan tugas tiap peran |

## Keputusan pemilik

- Struktur menu memakai pilihan A.
- Tahap ini hanya perencanaan; implementasi menunggu persetujuan dokumen ini.

## Rancangan (diusulkan Claude, disetujui pemilik)

### Tahap 1: Menu

**Baris pertama** selalu tampil dan sama di semua halaman: logo (kembali ke Beranda), semua modul yang boleh diakses peran itu, lonceng, akun. Modul aktif ditandai garis bawah merah.

**Baris kedua** berisi submenu modul aktif dan hanya muncul bila modul punya submenu. Kedua baris tetap menempel di atas saat halaman digulir.

Aturan:

- `Shell.tsx` memakai daftar hasil `useModules()`, bukan `MODULES` mentah, sehingga submenu terlarang tidak tampil. Penyebab bug ada di `moduleOf`, yang membaca `MODULES`.
- Klik modul membuka submenu pertama yang boleh diakses peran itu. Penjualan membuka `/penjualan?tab=quote`, dan Pengaturan untuk Sales tidak lagi membuka Pengguna.
- Modul yang punya submenu, tetapi tidak satu pun boleh diakses peran itu, tidak ditampilkan. Beranda dan Laporan memang tanpa submenu dan mengikuti aturan yang ada.
- Submenu aktif tetap ditandai di halaman detail dan halaman baru, misalnya `/pengadaan/:id` menandai PO Principal.
- Halaman penjualan: `/penjualan/baru` menandai Penawaran; detail mengikuti status dokumen (draf atau terkirim menandai Penawaran, selebihnya Sales Order).
- Submenu Laporan di dalam modul dihapus. Laporan cukup di baris pertama.
- Di halaman penjualan, pilihan Penawaran dan Sales Order pada filter dihapus karena sudah ada di submenu. Batal dan Semua tetap sebagai filter.
- Rute lama yang tidak ada di menu (`/penjualan/pelanggan`, `/penjualan/pricelist`, `/pengadaan/principal`) tetap berfungsi.
- Logo menjadi tautan dan pemilih modul menjadi tombol, sehingga bisa dipakai lewat keyboard dan terlihat fokusnya.

**Layar sempit.** Bila modul tidak muat (patokan awal di bawah 1240px, dipastikan dengan pengukuran), baris pertama menampilkan tombol pemilih modul berisi nama modul aktif. Baris kedua bisa digeser, punya penanda masih ada isi di samping, dan submenu aktif otomatis terlihat.

### Tahap 2: Alur kerja

- **Perlu Pesanan Principal:** tombol **Buat PO** di setiap baris, hanya untuk yang punya izin `pengadaan` create. Perilakunya sama dengan tombol di detail SO, termasuk peringatan pelanggan baru yang belum membayar. Data baris dari `worklist/need-po` perlu ditambah informasi pembayaran. Setelah berhasil, satu PO langsung dibuka; lebih dari satu PO tetap di daftar dengan pesan jumlahnya.
- **Daftar PO Principal:** penjelasan diberi tautan ke Perlu Pesanan Principal, ditampilkan sebagai tombol bagi yang boleh membuat PO, dengan jumlah antrean bila ada.
- **Pesan kosong:** halaman kerja utama menyebut langkah berikutnya, bukan hanya "Tidak ada data". Daftar halaman ditentukan saat perencanaan.
- **Tombol nonaktif:** menyebut alasan yang terlihat. "Tambah baris" menjadi "Pilih pelanggan dulu". Term of payment yang terkunci menyebut asalnya, yaitu data pelanggan.
- **Kirim penawaran:** `send` di `sales.service.ts` menolak penawaran tanpa baris produk atau dengan total Rp 0, dengan pesan yang jelas. Tombol di layar mengikuti. Sekarang `confirm` memeriksa baris, tetapi `send` tidak.

### Tahap 3: Istilah

Hanya mengubah label layar. Nama tabel, rute, dan API tetap.

| Sekarang | Usulan |
|---|---|
| Pesanan Principal, Pesanan kepada Principal | PO Principal |
| Perlu Pesanan Principal | Perlu PO Principal |
| Nomor PO pelanggan, PO pelanggan | PO Pelanggan |
| Menu Dokumen | Surat & Berita Acara |
| Pengaturan → Dokumen | Pengaturan → Format Cetak |

Judul PDF "Pesanan Principal / Purchase Order" tidak berubah karena sudah menyebut keduanya dan dilihat pihak luar.

### Nomor penawaran (perlu keputusan pemilik)

**Diputuskan 2026-11-05:** dua nomor. Pemilik menjawab "ok" atas saran ini. Penawaran bernomor `PN/MTPP/...` dan mendapat nomor `SO/MTPP/...` saat dikonfirmasi. Nomor penawaran tetap tersimpan, bisa dicari, dan tetap dipakai saat mencetak penawaran. Penawaran lama yang sudah bernomor `SO/...` tidak diubah.

## Batasan teknis

- Frontend: React, Ant Design, `apps/web/src/Shell.tsx`, `nav.ts`, `styles.css`.
- `apps/web` tidak punya test runner. Pemeriksaan memakai build dan skrip browser.
- Proyek bukan repositori git, jadi cadangkan folder sebelum mengubah dan laporkan file yang berubah.
- `scripts/demo-flow.mjs` dan `edge-flow.mjs` hanya dijalankan pada proyek compose sementara (`-p`, port lain), tidak pada database utama.

## Cara memeriksa

1. Skrip browser login sebagai lima peran, mengeklik semua modul dan submenu: tidak ada respons 403 atau pesan "Anda tidak memiliki akses".
2. Modul dan submenu aktif benar di halaman daftar, detail, dan baru.
3. Lebar 1440, 1024, dan 390: menu bisa dipakai dan halaman tidak bergeser ke samping.
4. Navigasi dengan keyboard: logo, modul, dan submenu bisa difokus dan dibuka.
5. Pada database sementara: alur PO dari tombol baru, termasuk pelanggan baru belum membayar dan PO ganda. `demo-flow` dan `edge-flow` tetap lulus.
6. Uji tiga tugas pada "Sasaran terukur" dengan orang yang belum pernah memakainya.

## Diserahkan ke pelaksana

- Tinggi baris, jarak, dan titik pasti perubahan layar sempit.
- Cara halaman detail penjualan memberi tahu menu status dokumennya.
- Teks akhir pesan kosong, selama menyebut langkah berikutnya.
