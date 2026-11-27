-- ======================================================================
-- Migrasi purchase_down_payment (perubahan STRUKTUR).
--   1. payments.mtpp_purchase_order_id   = uang muka (DP) kepada principal atas PO, dibayar sebelum
--                                           PO dikonfirmasi; dipakai otomatis saat tagihan principal diposting.
--   2. purchase_orders.mtpp_dp_waive_note = alasan PO dikonfirmasi tanpa uang muka (pengecualian Pimpinan).
-- ======================================================================

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "mtpp_purchase_order_id" INTEGER;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "mtpp_dp_waive_note" TEXT;

-- CreateIndex
CREATE INDEX "payments_mtpp_purchase_order_id_idx" ON "payments"("mtpp_purchase_order_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_mtpp_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("mtpp_purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
