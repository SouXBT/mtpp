-- ======================================================================
-- Migrasi proforma_due_date (perubahan STRUKTUR).
--   1. sales_orders.mtpp_proforma_due_date = batas bayar proforma invoice: tanggal proforma ditambah
--                                            masa tenggang (bawaan 7 hari, paling sedikit 7 hari, boleh lebih lama).
-- Proforma lama diberi batas bayar 7 hari setelah tanggal proformanya.
-- ======================================================================

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "mtpp_proforma_due_date" DATE;

UPDATE "sales_orders" SET "mtpp_proforma_due_date" = "mtpp_proforma_date" + 7
WHERE "mtpp_proforma_date" IS NOT NULL AND "mtpp_proforma_due_date" IS NULL;
