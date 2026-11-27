-- ======================================================================
-- Migrasi drop_returns (perubahan STRUKTUR).
-- Fitur retur pelanggan dan retur ke principal dihapus, jadi tabelnya ikut dihapus:
--   sales_returns, sales_return_lines, purchase_returns, purchase_return_lines.
-- Jurnal (nota kredit) dan mutasi stok yang pernah dibuat retur tetap tersimpan sebagai riwayat.
-- Akun 4-1100 dan lokasi Barang Rusak tidak dihapus karena bisa sudah dipakai jurnal atau mutasi lama.
-- ======================================================================

-- DropTable (baris ikut terhapus lebih dulu karena merujuk kepalanya)
DROP TABLE IF EXISTS "sales_return_lines";
DROP TABLE IF EXISTS "purchase_return_lines";
DROP TABLE IF EXISTS "sales_returns";
DROP TABLE IF EXISTS "purchase_returns";
