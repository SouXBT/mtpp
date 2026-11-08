-- ======================================================================
-- Migrasi 0_init: struktur awal database MTPP Distribusi.
-- Membuat 40 tabel, index unik, dan foreign key utama.
-- Dijalankan sekali saat database masih kosong; migrasi berikutnya
-- hanya menambah atau mengubah dari titik ini.
-- ======================================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- ---- AUTH: pengguna, grup, dan hak akses ---------------------------
-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "login" VARCHAR(120) NOT NULL,
    "password" VARCHAR(200) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "login_date" TIMESTAMP(6),
    "signature_attachment_id" INTEGER,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "comment" TEXT,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_users" (
    "id" SERIAL NOT NULL,
    "gid" INTEGER NOT NULL,
    "uid" INTEGER NOT NULL,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_permissions" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "menu" VARCHAR(60) NOT NULL,
    "perm_read" BOOLEAN NOT NULL DEFAULT false,
    "perm_create" BOOLEAN NOT NULL DEFAULT false,
    "perm_write" BOOLEAN NOT NULL DEFAULT false,
    "perm_delete" BOOLEAN NOT NULL DEFAULT false,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_permissions_pkey" PRIMARY KEY ("id")
);

-- ---- BASE: chatter, log perubahan, log email, lampiran -------------
-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "author_id" INTEGER,
    "model" VARCHAR(60) NOT NULL,
    "res_id" INTEGER NOT NULL,
    "message_type" VARCHAR(20) NOT NULL DEFAULT 'note',
    "body" TEXT NOT NULL,
    "date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_logs" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "field_id" VARCHAR(60) NOT NULL,
    "old_value_char" TEXT,
    "new_value_char" TEXT,
    "old_value_float" DECIMAL(18,2),
    "new_value_float" DECIMAL(18,2),
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" SERIAL NOT NULL,
    "model" VARCHAR(60) NOT NULL,
    "res_id" INTEGER NOT NULL,
    "document_name" VARCHAR(60) NOT NULL,
    "email_to" VARCHAR(200) NOT NULL,
    "subject" VARCHAR(250) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'diproses',
    "failure_reason" TEXT,
    "mtpp_provider_ref" VARCHAR(200),
    "mtpp_delivery_status" VARCHAR(40),
    "attachment_id" INTEGER,
    "sent_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status_at" TIMESTAMP(6),
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(250) NOT NULL,
    "res_model" VARCHAR(60) NOT NULL,
    "res_id" INTEGER NOT NULL,
    "mimetype" VARCHAR(120) NOT NULL,
    "store_fname" VARCHAR(250) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- ---- MASTER: termin, pricelist, partner, satuan, produk, harga supplier ----
-- CreateTable
CREATE TABLE "payment_terms" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_pricelists" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sales_pricelists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" SERIAL NOT NULL,
    "parent_id" INTEGER,
    "type" VARCHAR(20) NOT NULL DEFAULT 'company',
    "name" VARCHAR(200) NOT NULL,
    "vat" VARCHAR(40),
    "email" VARCHAR(200),
    "phone" VARCHAR(60),
    "street" TEXT,
    "city" VARCHAR(80),
    "customer_rank" INTEGER NOT NULL DEFAULT 0,
    "supplier_rank" INTEGER NOT NULL DEFAULT 0,
    "property_payment_term_id" INTEGER,
    "category" VARCHAR(80),
    "mtpp_supplier_note" TEXT,
    "mtpp_is_new_customer" BOOLEAN NOT NULL DEFAULT false,
    "sales_pricelist_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "relative_factor" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_templates" (
    "id" SERIAL NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "category_id" INTEGER,
    "main_supplier_id" INTEGER,
    "name" VARCHAR(200) NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'product',
    "list_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description_sale" TEXT,
    "mtpp_route" VARCHAR(20) NOT NULL DEFAULT 'stock',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "product_tmpl_id" INTEGER NOT NULL,
    "default_code" VARCHAR(40) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_prices" (
    "id" SERIAL NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "product_tmpl_id" INTEGER NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "min_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "date_start" DATE,
    "date_end" DATE,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_prices_pkey" PRIMARY KEY ("id")
);

-- ---- STOCK: gudang dan lokasi --------------------------------------
-- CreateTable
CREATE TABLE "warehouses" (
    "id" SERIAL NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" SERIAL NOT NULL,
    "warehouse_id" INTEGER,
    "name" VARCHAR(120) NOT NULL,
    "complete_name" VARCHAR(200) NOT NULL,
    "usage" VARCHAR(20) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- ---- SALES: penawaran / sales order dan barisnya -------------------
-- CreateTable
CREATE TABLE "sales_orders" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "partner_shipping_id" INTEGER,
    "user_id" INTEGER,
    "payment_term_id" INTEGER,
    "date_order" DATE NOT NULL,
    "date_confirm" DATE,
    "validity_date" DATE,
    "commitment_date" DATE,
    "state" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "client_order_ref" VARCHAR(80),
    "amount_untaxed" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "invoice_status" VARCHAR(20) NOT NULL DEFAULT 'no',
    "mtpp_proforma_number" VARCHAR(40),
    "mtpp_proforma_date" DATE,
    "mtpp_proforma_note" TEXT,
    "mtpp_dp_mode" VARCHAR(10),
    "mtpp_dp_percent" DECIMAL(6,2),
    "mtpp_dp_amount" DECIMAL(18,2),
    "mtpp_term_payment" TEXT,
    "mtpp_term_delivery" TEXT,
    "mtpp_term_validity" TEXT,
    "mtpp_term_warranty" TEXT,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "product_uom_qty" DECIMAL(12,2) NOT NULL,
    "qty_delivered" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "qty_invoiced" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "price_unit" DECIMAL(18,2) NOT NULL,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "price_subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "purchase_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "margin" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "mtpp_warehouse_id" INTEGER,
    "mtpp_is_dropship" BOOLEAN NOT NULL DEFAULT false,
    "sequence" INTEGER NOT NULL DEFAULT 10,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- ---- PURCHASING: purchase order dan barisnya -----------------------
-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER,
    "mtpp_sale_order_id" INTEGER,
    "dest_address_id" INTEGER,
    "mtpp_is_dropship" BOOLEAN NOT NULL DEFAULT false,
    "date_order" DATE NOT NULL,
    "date_planned" DATE,
    "state" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "amount_untaxed" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "mtpp_payment_state" VARCHAR(40) NOT NULL DEFAULT 'menunggu barang',
    "mtpp_amount_due" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "product_qty" DECIMAL(12,2) NOT NULL,
    "qty_received" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "qty_invoiced" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "price_unit" DECIMAL(18,2) NOT NULL,
    "price_subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "date_planned" DATE,
    "mtpp_sale_line_id" INTEGER,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- ---- STOCK: jenis transfer, transfer, pergerakan, dan saldo stok ----
-- CreateTable
CREATE TABLE "transfer_types" (
    "id" SERIAL NOT NULL,
    "warehouse_id" INTEGER,
    "name" VARCHAR(80) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "sequence_code" VARCHAR(10) NOT NULL,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "picking_type_id" INTEGER NOT NULL,
    "partner_id" INTEGER,
    "sale_id" INTEGER,
    "purchase_id" INTEGER,
    "location_id" INTEGER NOT NULL,
    "location_dest_id" INTEGER NOT NULL,
    "backorder_id" INTEGER,
    "origin" VARCHAR(80),
    "scheduled_date" DATE,
    "date_done" TIMESTAMP(6),
    "state" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "note" TEXT,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_moves" (
    "id" SERIAL NOT NULL,
    "picking_id" INTEGER,
    "product_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "location_dest_id" INTEGER NOT NULL,
    "sale_line_id" INTEGER,
    "purchase_line_id" INTEGER,
    "product_uom_qty" DECIMAL(12,2) NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "state" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reserved_quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "in_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- ---- ACCOUNTING: akun, jurnal, entri jurnal, pembayaran, mutasi bank ----
-- CreateTable
CREATE TABLE "accounts" (
    "id" SERIAL NOT NULL,
    "code_store" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "account_type" VARCHAR(20) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journals" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "default_account_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mtpp_legacy" BOOLEAN NOT NULL DEFAULT false,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "journal_id" INTEGER NOT NULL,
    "partner_id" INTEGER,
    "move_type" VARCHAR(20) NOT NULL DEFAULT 'entry',
    "date" DATE NOT NULL,
    "invoice_date" DATE,
    "invoice_date_due" DATE,
    "state" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "payment_state" VARCHAR(20) NOT NULL DEFAULT 'not_paid',
    "amount_untaxed" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_residual" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reversed_entry_id" INTEGER,
    "mtpp_sale_order_id" INTEGER,
    "mtpp_purchase_order_id" INTEGER,
    "invoice_origin" VARCHAR(80),
    "ref" VARCHAR(120),
    "narration" TEXT,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_lines" (
    "id" SERIAL NOT NULL,
    "move_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "partner_id" INTEGER,
    "product_id" INTEGER,
    "name" TEXT,
    "display_type" VARCHAR(20) NOT NULL DEFAULT 'line',
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "price_unit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "date" DATE NOT NULL,
    "date_maturity" DATE,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "sale_line_id" INTEGER,
    "purchase_line_id" INTEGER,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "move_id" INTEGER,
    "journal_id" INTEGER NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "invoice_id" INTEGER,
    "mtpp_sale_order_id" INTEGER,
    "amount" DECIMAL(18,2) NOT NULL,
    "mtpp_amount_applied" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "date" DATE NOT NULL,
    "payment_type" VARCHAR(20) NOT NULL,
    "partner_type" VARCHAR(20) NOT NULL,
    "memo" TEXT,
    "state" VARCHAR(20) NOT NULL DEFAULT 'posted',
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" SERIAL NOT NULL,
    "journal_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "payment_ref" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "partner_id" INTEGER,
    "is_reconciled" BOOLEAN NOT NULL DEFAULT false,
    "payment_id" INTEGER,
    "import_batch" VARCHAR(60),
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- ---- MASTER: item pricelist penjualan ------------------------------
-- CreateTable
CREATE TABLE "sales_pricelist_items" (
    "id" SERIAL NOT NULL,
    "pricelist_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "fixed_price" DECIMAL(18,2),
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "min_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "date_start" DATE,
    "date_end" DATE,

    CONSTRAINT "sales_pricelist_items_pkey" PRIMARY KEY ("id")
);

-- ---- STOCK: aturan stok minimum ------------------------------------
-- CreateTable
CREATE TABLE "stock_rules" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "min_qty" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "stock_rules_pkey" PRIMARY KEY ("id")
);

-- ---- BASE: aktivitas / tugas ---------------------------------------
-- CreateTable
CREATE TABLE "activities" (
    "id" SERIAL NOT NULL,
    "res_model" VARCHAR(60) NOT NULL,
    "res_id" INTEGER NOT NULL,
    "res_name" VARCHAR(80),
    "activity_type" VARCHAR(30) NOT NULL,
    "summary" VARCHAR(200) NOT NULL,
    "note" TEXT,
    "date_deadline" DATE NOT NULL,
    "user_id" INTEGER NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- ---- SYSTEM: pengaturan, penomoran dokumen, filter tersimpan, API key ----
-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_filters" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "resource" VARCHAR(60) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "filter" JSONB NOT NULL,

    CONSTRAINT "saved_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "key_hash" VARCHAR(128) NOT NULL,
    "prefix" VARCHAR(12) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_used" TIMESTAMP(6),
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- ---- SYSTEM: dokumen -----------------------------------------------
-- CreateTable
CREATE TABLE "documents" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "number" VARCHAR(60) NOT NULL,
    "date" DATE NOT NULL,
    "partner_id" INTEGER,
    "sale_order_id" INTEGER,
    "title" VARCHAR(250),
    "data" JSONB NOT NULL,
    "create_uid" INTEGER,
    "create_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "write_uid" INTEGER,
    "write_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- ---- INDEX UNIK (dibuat setelah semua tabel ada) -------------------
-- CreateIndex
CREATE UNIQUE INDEX "users_login_unique" ON "users"("login");

-- CreateIndex
CREATE UNIQUE INDEX "groups_code_unique" ON "groups"("code");

-- CreateIndex
CREATE UNIQUE INDEX "group_user_uq" ON "group_users"("gid", "uid");

-- CreateIndex
CREATE UNIQUE INDEX "group_menu_uq" ON "group_permissions"("group_id", "menu");

-- CreateIndex
CREATE INDEX "messages_res_idx" ON "messages"("model", "res_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_default_code_unique" ON "products"("default_code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_unique" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_name_unique" ON "sales_orders"("name");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_name_unique" ON "purchase_orders"("name");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_name_unique" ON "stock_transfers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balance_uq" ON "stock_balances"("product_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_store_unique" ON "accounts"("code_store");

-- CreateIndex
CREATE UNIQUE INDEX "journals_code_unique" ON "journals"("code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_name_unique" ON "journal_entries"("name");

-- CreateIndex
CREATE UNIQUE INDEX "payments_name_unique" ON "payments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "stock_rule_uq" ON "stock_rules"("product_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "doc_seq_uq" ON "document_sequences"("code", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_unique" ON "api_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "documents_number_unique" ON "documents"("number");

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type");

-- ---- FOREIGN KEY: relasi antar tabel -------------------------------
-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "group_users" ADD CONSTRAINT "group_users_gid_groups_id_fk" FOREIGN KEY ("gid") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "group_users" ADD CONSTRAINT "group_users_uid_users_id_fk" FOREIGN KEY ("uid") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "group_permissions" ADD CONSTRAINT "group_permissions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "change_logs" ADD CONSTRAINT "change_logs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_property_payment_term_id_payment_terms_id_fk" FOREIGN KEY ("property_payment_term_id") REFERENCES "payment_terms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_sales_pricelist_id_sales_pricelists_id_fk" FOREIGN KEY ("sales_pricelist_id") REFERENCES "sales_pricelists"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_parent_id_partners_id_fk" FOREIGN KEY ("parent_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_templates" ADD CONSTRAINT "product_templates_uom_id_units_id_fk" FOREIGN KEY ("uom_id") REFERENCES "units"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_templates" ADD CONSTRAINT "product_templates_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_templates" ADD CONSTRAINT "product_templates_main_supplier_id_partners_id_fk" FOREIGN KEY ("main_supplier_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_product_tmpl_id_product_templates_id_fk" FOREIGN KEY ("product_tmpl_id") REFERENCES "product_templates"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_product_tmpl_id_product_templates_id_fk" FOREIGN KEY ("product_tmpl_id") REFERENCES "product_templates"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_partner_shipping_id_partners_id_fk" FOREIGN KEY ("partner_shipping_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_payment_term_id_payment_terms_id_fk" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_mtpp_warehouse_id_warehouses_id_fk" FOREIGN KEY ("mtpp_warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_mtpp_sale_order_id_sales_orders_id_fk" FOREIGN KEY ("mtpp_sale_order_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_dest_address_id_partners_id_fk" FOREIGN KEY ("dest_address_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_mtpp_sale_line_id_sales_order_lines_id_fk" FOREIGN KEY ("mtpp_sale_line_id") REFERENCES "sales_order_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transfer_types" ADD CONSTRAINT "transfer_types_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_picking_type_id_transfer_types_id_fk" FOREIGN KEY ("picking_type_id") REFERENCES "transfer_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_sale_id_sales_orders_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_purchase_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "purchase_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_location_dest_id_locations_id_fk" FOREIGN KEY ("location_dest_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_picking_id_stock_transfers_id_fk" FOREIGN KEY ("picking_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_location_dest_id_locations_id_fk" FOREIGN KEY ("location_dest_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_sale_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "sales_order_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_purchase_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_default_account_id_accounts_id_fk" FOREIGN KEY ("default_account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_mtpp_sale_order_id_sales_orders_id_fk" FOREIGN KEY ("mtpp_sale_order_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_mtpp_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("mtpp_purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_move_id_journal_entries_id_fk" FOREIGN KEY ("move_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_sale_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "sales_order_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_purchase_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_move_id_journal_entries_id_fk" FOREIGN KEY ("move_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_journal_entries_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_mtpp_sale_order_id_sales_orders_id_fk" FOREIGN KEY ("mtpp_sale_order_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_pricelist_items" ADD CONSTRAINT "sales_pricelist_items_pricelist_id_sales_pricelists_id_fk" FOREIGN KEY ("pricelist_id") REFERENCES "sales_pricelists"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_pricelist_items" ADD CONSTRAINT "sales_pricelist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_rules" ADD CONSTRAINT "stock_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_rules" ADD CONSTRAINT "stock_rules_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_sale_order_id_sales_orders_id_fk" FOREIGN KEY ("sale_order_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

