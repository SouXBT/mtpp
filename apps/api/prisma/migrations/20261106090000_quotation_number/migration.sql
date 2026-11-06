-- Nomor penawaran (PN/...) tetap tersimpan setelah penawaran mendapat nomor SO. Data lama tidak diisi.
ALTER TABLE "sales_orders" ADD COLUMN "mtpp_quotation_number" VARCHAR(40);
CREATE UNIQUE INDEX "sales_orders_quotation_number_unique" ON "sales_orders"("mtpp_quotation_number");
