-- ======================================================================
-- Migrasi payment_proof_settle_purchase_returns (perubahan STRUKTUR).
--   1. sales_orders.mtpp_settle_date         = tanggal pelunasan yang disepakati pelanggan baru
--                                               setelah membayar uang muka.
--   2. sales_returns.replacement_picking_id  = surat jalan pengganti yang dibuat otomatis
--                                               saat retur "kirim pengganti" diproses.
--   3. purchase_returns, purchase_return_lines = retur barang rusak ke principal
--                                               (barang pengganti atau nota kredit).
-- Bukti transfer pembayaran memakai tabel attachments yang sudah ada (res_model = 'payments').
-- ======================================================================

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "mtpp_settle_date" DATE;

-- AlterTable
ALTER TABLE "sales_returns" ADD COLUMN     "replacement_picking_id" INTEGER;

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "resolution" VARCHAR(20) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "note" TEXT,
    "refund_entry_id" INTEGER,
    "receipt_id" INTEGER,
    "amount_untaxed" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_lines" (
    "id" SERIAL NOT NULL,
    "return_id" INTEGER NOT NULL,
    "purchase_line_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "price_unit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_name_unique" ON "purchase_returns"("name");

-- CreateIndex
CREATE INDEX "purchase_returns_purchase_id_idx" ON "purchase_returns"("purchase_id");

-- CreateIndex
CREATE INDEX "purchase_returns_partner_id_idx" ON "purchase_returns"("partner_id");

-- CreateIndex
CREATE INDEX "purchase_returns_warehouse_id_idx" ON "purchase_returns"("warehouse_id");

-- CreateIndex
CREATE INDEX "purchase_returns_refund_entry_id_idx" ON "purchase_returns"("refund_entry_id");

-- CreateIndex
CREATE INDEX "purchase_returns_receipt_id_idx" ON "purchase_returns"("receipt_id");

-- CreateIndex
CREATE INDEX "purchase_return_lines_return_id_idx" ON "purchase_return_lines"("return_id");

-- CreateIndex
CREATE INDEX "purchase_return_lines_purchase_line_id_idx" ON "purchase_return_lines"("purchase_line_id");

-- CreateIndex
CREATE INDEX "purchase_return_lines_product_id_idx" ON "purchase_return_lines"("product_id");

-- CreateIndex
CREATE INDEX "sales_returns_replacement_picking_id_idx" ON "sales_returns"("replacement_picking_id");

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchase_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "purchase_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_refund_entry_id_journal_entries_id_fk" FOREIGN KEY ("refund_entry_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_receipt_id_stock_transfers_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "stock_transfers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_return_id_purchase_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_purchase_line_id_fk" FOREIGN KEY ("purchase_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_replacement_picking_id_fk" FOREIGN KEY ("replacement_picking_id") REFERENCES "stock_transfers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

