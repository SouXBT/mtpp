-- Syarat penyerahan dan standar pada penawaran. Data lama dibiarkan kosong (tidak dicetak).
ALTER TABLE "sales_orders" ADD COLUMN "mtpp_term_handover" TEXT;
ALTER TABLE "sales_orders" ADD COLUMN "mtpp_term_standard" TEXT;
