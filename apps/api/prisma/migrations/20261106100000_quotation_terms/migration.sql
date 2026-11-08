-- ======================================================================
-- Migrasi quotation_terms (perubahan STRUKTUR).
-- Menambah dua kolom teks di sales_orders untuk dokumen penawaran:
--   mtpp_term_handover = syarat penyerahan barang
--   mtpp_term_standard = standar / spesifikasi yang berlaku
-- Keduanya nullable; bila kosong, bagian itu tidak dicetak.
-- ======================================================================

-- Syarat penyerahan dan standar pada penawaran. Data lama dibiarkan kosong (tidak dicetak).
ALTER TABLE "sales_orders" ADD COLUMN "mtpp_term_handover" TEXT;
ALTER TABLE "sales_orders" ADD COLUMN "mtpp_term_standard" TEXT;
