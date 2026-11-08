-- ======================================================================
-- Migrasi quotation_number (perubahan STRUKTUR).
-- Menambah kolom sales_orders.mtpp_quotation_number (nomor PN/...).
-- Unique index menjamin satu nomor penawaran hanya dipakai satu order.
-- Nilai NULL boleh berulang, jadi order lama yang kosong tetap valid.
-- ======================================================================

-- Nomor penawaran (PN/...) tetap tersimpan setelah penawaran mendapat nomor SO. Data lama tidak diisi.
ALTER TABLE "sales_orders" ADD COLUMN "mtpp_quotation_number" VARCHAR(40);
CREATE UNIQUE INDEX "sales_orders_quotation_number_unique" ON "sales_orders"("mtpp_quotation_number");
