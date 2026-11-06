# Rancangan Lanjutan: Alur Kerja dan Syarat Penawaran

Tanggal: 2026-11-05. Status: menunggu persetujuan pemilik. Melanjutkan `2026-11-05-navigasi-design.md`, yang belum diterapkan ke `:8080`. Ukuran: perubahan kecil.

## Alasan

Menu sudah jelas, tetapi tiga hal masih membingungkan: PO pelanggan sulit ditemukan, Siap Dikirim tidak punya tombol, dan setelah SO dikonfirmasi tidak ada petunjuk langkah berikutnya. Penawaran juga belum memuat syarat seperti contoh dari pemilik.

## Keputusan pemilik

- PO pelanggan cukup nomornya saja.
- DP 30/70 cukup tercetak di penawaran, dan menjadi teks bawaan penawaran baru yang tetap bisa diubah Sales per penawaran.
- Operasional boleh melihat harga beli di detail dan PDF PO.

## Rancangan (usulan Claude, disetujui pemilik dalam percakapan, kecuali yang ditandai)

1. **PO pelanggan.** Halaman Penawaran diberi petunjuk: "PO dari pelanggan dicatat di sini: buka atau buat penawaran, isi PO Pelanggan, lalu konfirmasi." Dialog konfirmasi punya kolom PO Pelanggan yang boleh dikosongkan; nilainya dikirim lewat `clientOrderRef`, yang sudah diterima `confirm`.
2. **Siap Dikirim.** Tombol **Buat Surat Jalan** per baris, hanya bagi yang punya izin `gudang` create. Memakai `POST /transfers/from-sale/:id`, lalu membuka surat jalan yang terbentuk. Bila gagal, tampilkan pesan dan muat ulang daftar. Klik ganda tidak boleh membuat dokumen ganda. Teks penjelasan tidak lagi menyuruh membuka sales order.
3. **Langkah berikutnya di detail SO.** Satu keterangan di atas formulir, disusun dari data yang sudah ada, dan menampilkan semua yang berlaku:
   - Stok kurang: "Berikutnya: Finance membuat PO Principal."
   - Pelanggan baru belum lunas: "Berikutnya: Finance mencatat pembayaran pelanggan."
   - Bisa dikirim: "Berikutnya: Operasional membuat surat jalan."
   - Bisa ditagih: "Berikutnya: Finance membuat invoice."
   - Tidak ada yang berlaku: keterangan tidak tampil.
4. **Syarat penawaran.**
   - Teks bawaan Pembayaran: `DP 30% saat PO diterima, 70% sebelum barang dikirim`.
   - Kolom baru **Penyerahan** (bawaan `Franco On Truck Surabaya`) dan **Standar** (bawaan `IEC / SPLN / SLI / ANSI`), di tab Syarat Penawaran, PDF penawaran, Salin penawaran, dan Pengaturan → Format Cetak.
   - PDF penawaran tidak lagi mencetak baris Term of payment. PDF SO dan invoice tidak berubah.
5. **README.** Diperbaiki: Operasional melihat harga beli di PO; harga pokok dan margin di halaman SO tetap tersembunyi.

## Bukan sasaran

- Tagihan DP sungguhan. Jatuh tempo invoice tetap mengikuti jumlah hari Term of Payment.
- Halaman, tanggal, atau file PO pelanggan.
- Mengubah hak akses, atau membuka harga pokok dan margin di SO bagi Operasional.
- Mengubah bawaan waktu kirim, masa berlaku, dan garansi. Ketiganya tetap bisa diatur di Format Cetak.

## Pendekatan

Hanya satu cara yang masuk akal: menambahkannya ke halaman dan alur yang sudah ada.

- Modul PO pelanggan terpisah ditolak karena hanya menyimpan nomor.
- Tagihan DP sungguhan ditolak karena pemilik memilih tercetak saja.
- Beranda per peran ditunda: lebih besar, dan keterangan di detail SO sudah menjawab keluhan ini.

## Batasan dan pemeriksaan

- Batasan rancangan navigasi tetap berlaku, termasuk uji hanya di `mtpp-nav` dan warna merah, kuning, putih.
- Migrasi hanya menambah dua kolom teks yang boleh kosong. Dokumen lama tidak diisi ulang dan dicetak tanpa baris itu.
- Pemeriksaan: `demo-flow`, `edge-flow`, tes menu, `tsc`, audit menu, dan klik sungguhan dari Beranda untuk alur SO → surat jalan → invoice, yang belum pernah diklik.
- Uji dengan orang yang belum pernah memakai sistem tetap dibutuhkan sebelum sasaran "tanpa dipandu" dianggap tercapai.
- Penerapan ke `:8080` tetap menunggu persetujuan terpisah, bersama hasil pekerjaan navigasi.

## Diserahkan ke pelaksana

Letak dan gaya keterangan langkah berikutnya, serta nama kolom baru, selama mengikuti pola `mtpp_term_*`.
