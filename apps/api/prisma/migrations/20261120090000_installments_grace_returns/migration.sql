-- ======================================================================
-- Migrasi installments_grace_returns (perubahan STRUKTUR + satu baris DATA).
--   1. partners.mtpp_grace_days        = masa tenggang pembayaran per pelanggan (hari);
--                                         kosong = memakai bawaan di Pengaturan → Penagihan.
--   2. sales_orders.mtpp_release_*     = izin Pimpinan untuk tetap mengirim walau pelanggan
--                                         punya tagihan lewat masa tenggang.
--   3. invoice_installments            = jadwal cicilan invoice pelanggan lama.
--   4. sales_returns, sales_return_lines = retur / keluhan barang bermasalah dari pelanggan.
--   5. Akun 4-1100 Retur Penjualan (hanya bila bagan akun sudah ada; database baru
--      mendapatkannya dari seed).
-- ======================================================================

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "mtpp_grace_days" INTEGER;

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "mtpp_release_date" TIMESTAMP(6),
ADD COLUMN     "mtpp_release_note" TEXT,
ADD COLUMN     "mtpp_release_uid" INTEGER;

-- CreateTable
CREATE TABLE "invoice_installments" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "date_due" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "note" TEXT,
    "approve_uid" INTEGER,
    "approve_date" TIMESTAMP(6),
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_returns" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "sale_id" INTEGER NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "picking_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "resolution" VARCHAR(20) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "note" TEXT,
    "refund_entry_id" INTEGER,
    "amount_untaxed" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_lines" (
    "id" SERIAL NOT NULL,
    "return_id" INTEGER NOT NULL,
    "move_id" INTEGER NOT NULL,
    "sale_line_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "price_unit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_installments_invoice_id_idx" ON "invoice_installments"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_installment_uq" ON "invoice_installments"("invoice_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_name_unique" ON "sales_returns"("name");

-- CreateIndex
CREATE INDEX "sales_returns_sale_id_idx" ON "sales_returns"("sale_id");

-- CreateIndex
CREATE INDEX "sales_returns_partner_id_idx" ON "sales_returns"("partner_id");

-- CreateIndex
CREATE INDEX "sales_returns_picking_id_idx" ON "sales_returns"("picking_id");

-- CreateIndex
CREATE INDEX "sales_returns_refund_entry_id_idx" ON "sales_returns"("refund_entry_id");

-- CreateIndex
CREATE INDEX "sales_return_lines_return_id_idx" ON "sales_return_lines"("return_id");

-- CreateIndex
CREATE INDEX "sales_return_lines_move_id_idx" ON "sales_return_lines"("move_id");

-- CreateIndex
CREATE INDEX "sales_return_lines_sale_line_id_idx" ON "sales_return_lines"("sale_line_id");

-- CreateIndex
CREATE INDEX "sales_return_lines_product_id_idx" ON "sales_return_lines"("product_id");

-- AddForeignKey
ALTER TABLE "invoice_installments" ADD CONSTRAINT "invoice_installments_invoice_id_journal_entries_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_sale_id_sales_orders_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_picking_id_stock_transfers_id_fk" FOREIGN KEY ("picking_id") REFERENCES "stock_transfers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_refund_entry_id_journal_entries_id_fk" FOREIGN KEY ("refund_entry_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_return_id_sales_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_move_id_stock_moves_id_fk" FOREIGN KEY ("move_id") REFERENCES "stock_moves"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_sale_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "sales_order_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- Akun retur penjualan (kontra pendapatan) untuk nota kredit retur
INSERT INTO "accounts" ("code_store", "name", "account_type")
SELECT '4-1100', 'Retur Penjualan', 'income'
WHERE EXISTS (SELECT 1 FROM "accounts")
  AND NOT EXISTS (SELECT 1 FROM "accounts" WHERE "code_store" = '4-1100');
