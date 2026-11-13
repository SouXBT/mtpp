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
-- Dipakai di halaman: Login (/login), Profil (/profil), Pengaturan > Pengguna (/pengaturan/pengguna, /pengaturan/pengguna/:id)
CREATE TABLE "users" ( -- Akun login pengguna sistem; setiap akun terhubung ke satu partner (data orangnya).
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
-- Dipakai di halaman: Pengaturan > Grup (/pengaturan/grup), Pengaturan > Pengguna (pilih grup)
CREATE TABLE "groups" ( -- Grup/peran pengguna (mis. Admin, Sales, Operasional, Keuangan) untuk mengatur hak akses.
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
-- Dipakai di halaman: Pengaturan > Pengguna (/pengaturan/pengguna/:id), Pengaturan > Grup (/pengaturan/grup)
CREATE TABLE "group_users" ( -- Tabel penghubung pengguna ↔ grup (satu pengguna bisa masuk beberapa grup).
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
-- Dipakai di halaman: Pengaturan > Grup (/pengaturan/grup); juga menentukan menu yang tampil di navigasi semua halaman
CREATE TABLE "group_permissions" ( -- Hak akses tiap grup per menu: baca, buat, ubah, hapus.
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
-- Dipakai di halaman: Panel riwayat (chatter) di halaman detail: Penawaran/SO (/penjualan/:id), PO (/pengadaan/:id), Surat Jalan/Penerimaan (/stok/dok/:id), Invoice (/penagihan/:id), Tagihan (/pengadaan/tagihan/:id), Jurnal (/akuntansi/jurnal/:id), Pelanggan/Principal, Produk (/master/produk/:id)
CREATE TABLE "messages" ( -- Catatan/riwayat (chatter) yang menempel pada dokumen apa pun (model + res_id).
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
-- Dipakai di halaman: Panel riwayat (chatter) di halaman detail yang sama dengan tabel messages
CREATE TABLE "change_logs" ( -- Detail perubahan nilai kolom (nilai lama → baru) untuk satu pesan riwayat.
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
-- Dipakai di halaman: Pengaturan > Email (/pengaturan/email); tombol Kirim Email di halaman detail dokumen; Beranda (/)
CREATE TABLE "email_logs" ( -- Log email dokumen yang dikirim (tujuan, subjek, status pengiriman).
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
-- Dipakai di halaman: Tab Lampiran di panel chatter halaman detail dokumen; PDF yang dikirim lewat email; Pengaturan > Impor (/pengaturan/impor)
CREATE TABLE "attachments" ( -- Metadata berkas lampiran (PDF, tanda tangan, dll.); berkasnya disimpan di folder storage.
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
-- Dipakai di halaman: Master > TOP (/master/top); dipilih di Pelanggan/Principal, Penawaran/SO (/penjualan/:id), PO (/pengadaan/:id), Invoice/Tagihan
CREATE TABLE "payment_terms" ( -- Termin pembayaran, mis. Tunai atau Net 30 hari.
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
-- Dipakai di halaman: Penjualan > Pricelist (/penjualan/pricelist, /master/pricelist); dipasang di detail Pelanggan
CREATE TABLE "sales_pricelists" ( -- Daftar harga jual khusus yang bisa dipasang ke pelanggan.
    "id" SERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sales_pricelists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Dipakai di halaman: Pelanggan (/penjualan/pelanggan, /master/pelanggan), Principal (/pengadaan/principal, /master/principal), Pengaturan > Pengguna; dipilih di semua dokumen transaksi
CREATE TABLE "partners" ( -- Data kontak: pelanggan, supplier/principal, dan orang kontak di perusahaan.
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
-- Dipakai di halaman: Master > Kategori & Satuan (/master/kategori); dipakai di Produk dan baris dokumen
CREATE TABLE "units" ( -- Satuan barang (pcs, box, unit) beserta faktor konversinya.
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
-- Dipakai di halaman: Master > Kategori & Satuan (/master/kategori); Produk (/master/produk)
CREATE TABLE "product_categories" ( -- Kategori produk untuk pengelompokan.
    "id" SERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Dipakai di halaman: Master > Produk (/master/produk, /master/produk/:id)
CREATE TABLE "product_templates" ( -- Data induk produk: nama, satuan, kategori, harga jual, supplier utama.
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
-- Dipakai di halaman: Master > Produk (/master/produk/:id); dipilih di baris Penawaran/SO, PO, Surat Jalan, Invoice; Stok (/stok)
CREATE TABLE "products" ( -- Varian produk yang dipakai di transaksi, dengan kode barang unik.
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
-- Dipakai di halaman: Pengadaan > Pricelist Principal (/pengadaan/pricelist); tab harga beli di detail Produk; harga beli di PO
CREATE TABLE "supplier_prices" ( -- Harga beli produk dari tiap supplier (diskon, minimal qty, masa berlaku).
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
-- Dipakai di halaman: Stok per Gudang (/stok); detail Principal (kode gudang); Penerimaan/Surat Jalan
CREATE TABLE "warehouses" ( -- Gudang perusahaan.
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
-- Dipakai di halaman: Stok per Gudang (/stok), Mutasi (/stok/mutasi), detail Penerimaan/Surat Jalan (/stok/dok/:id)
CREATE TABLE "locations" ( -- Lokasi stok di dalam gudang, juga lokasi virtual (pelanggan, supplier).
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
-- Dipakai di halaman: Penjualan > Penawaran & Sales Order (/penjualan, /penjualan/:id); Siap Dikirim (/stok/siap-dikirim); Siap Ditagih (/penagihan/siap); Perlu PO Principal (/pengadaan/perlu-pesanan); Beranda (/); Laporan
CREATE TABLE "sales_orders" ( -- Header penawaran / sales order ke pelanggan, beserta total, termin, dan DP.
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
-- Dipakai di halaman: Detail Penawaran/SO (/penjualan/:id); Perlu PO Principal (/pengadaan/perlu-pesanan); Siap Ditagih (/penagihan/siap); Laporan
CREATE TABLE "sales_order_lines" ( -- Baris barang pada sales order: produk, qty, harga, diskon, margin.
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
-- Dipakai di halaman: Pengadaan > PO Principal (/pengadaan, /pengadaan/:id); Penerimaan Barang (/stok/penerimaan); Beranda (/); Laporan
CREATE TABLE "purchase_orders" ( -- Header purchase order ke supplier, bisa berasal dari sales order (dropship/pesanan).
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
-- Dipakai di halaman: Detail PO (/pengadaan/:id); Perlu PO Principal (/pengadaan/perlu-pesanan); Penerimaan Barang
CREATE TABLE "purchase_order_lines" ( -- Baris barang pada purchase order: produk, qty, harga beli, qty diterima.
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
-- Dipakai di halaman: Penerimaan Barang (/stok/penerimaan), Surat Jalan (/stok/surat-jalan) — pembeda jenis dokumen; Beranda (/); Laporan
CREATE TABLE "transfer_types" ( -- Jenis perpindahan stok, mis. Penerimaan, Pengiriman (Surat Jalan), Internal.
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
-- Dipakai di halaman: Stok > Penerimaan Barang (/stok/penerimaan), Siap Dikirim (/stok/siap-dikirim), Surat Jalan (/stok/surat-jalan), detail (/stok/dok/:id); tombol Buat Surat Jalan di SO
CREATE TABLE "stock_transfers" ( -- Dokumen perpindahan stok (penerimaan barang / surat jalan) dari lokasi asal ke tujuan.
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
-- Dipakai di halaman: Detail Penerimaan/Surat Jalan (/stok/dok/:id); Stok > Mutasi (/stok/mutasi); Laporan
CREATE TABLE "stock_moves" ( -- Baris pergerakan stok per produk di dalam satu transfer.
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
-- Dipakai di halaman: Stok per Gudang (/stok); ketersediaan stok di Penawaran/SO; Stok Minimum (/stok/minimum)
CREATE TABLE "stock_balances" ( -- Saldo stok terkini per produk per lokasi (jumlah fisik dan yang sudah dipesan).
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
-- Dipakai di halaman: Akuntansi > Bagan Akun (/akuntansi/akun), Buku Besar (/akuntansi/buku-besar), Neraca Saldo (/akuntansi/neraca-saldo); Pengaturan > Perusahaan (akun bawaan)
CREATE TABLE "accounts" ( -- Bagan akun (Chart of Accounts) untuk akuntansi.
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
-- Dipakai di halaman: Akuntansi > Kas (/akuntansi/kas), Jurnal (/akuntansi/jurnal); pilihan jurnal di Pembayaran dan Invoice/Tagihan
CREATE TABLE "journals" ( -- Buku jurnal, mis. Penjualan, Pembelian, Bank, Kas.
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
-- Dipakai di halaman: Penagihan > Invoice (/penagihan, /penagihan/:id); Pengadaan > Tagihan Principal (/pengadaan/tagihan, /pengadaan/tagihan/:id); Akuntansi > Jurnal (/akuntansi/jurnal, /akuntansi/jurnal/:id); Beranda (/); Laporan
CREATE TABLE "journal_entries" ( -- Header entri jurnal: faktur pelanggan, tagihan supplier, atau jurnal umum.
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
-- Dipakai di halaman: Detail Invoice/Tagihan/Jurnal; Akuntansi > Buku Besar (/akuntansi/buku-besar), Neraca Saldo (/akuntansi/neraca-saldo); Laporan
CREATE TABLE "journal_entry_lines" ( -- Baris debit/kredit dari entri jurnal.
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
-- Dipakai di halaman: Penagihan > Pembayaran (/penagihan/pembayaran); uang muka di detail SO (/penjualan/:id); pembayaran di detail PO (/pengadaan/:id) dan Invoice/Tagihan; Akuntansi > Kas (/akuntansi/kas); Rekonsiliasi Bank (/akuntansi/rekonsiliasi)
CREATE TABLE "payments" ( -- Pembayaran masuk (dari pelanggan) atau keluar (ke supplier).
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
-- Dipakai di halaman: Akuntansi > Rekonsiliasi Bank (/akuntansi/rekonsiliasi); Beranda (/)
CREATE TABLE "bank_statement_lines" ( -- Baris mutasi rekening bank hasil impor, untuk dicocokkan dengan pembayaran.
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
-- Dipakai di halaman: Penjualan > Pricelist (/penjualan/pricelist, /master/pricelist); harga otomatis di baris Penawaran/SO
CREATE TABLE "sales_pricelist_items" ( -- Isi daftar harga jual: harga tetap atau diskon per produk.
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
-- Dipakai di halaman: Stok > Stok Minimum (/stok/minimum); kolom Stok minimum di Stok per Gudang (/stok); pemberitahuan stok rendah di Beranda (/)
CREATE TABLE "stock_rules" ( -- Aturan stok minimum per produk per gudang (peringatan stok menipis).
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "min_qty" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "stock_rules_pkey" PRIMARY KEY ("id")
);

-- ---- BASE: aktivitas / tugas ---------------------------------------
-- CreateTable
-- Dipakai di halaman: Beranda (/) dan notifikasi tugas di bilah atas (semua halaman); tab Aktivitas di panel chatter halaman detail
CREATE TABLE "activities" ( -- Tugas/pengingat yang ditugaskan ke pengguna untuk suatu dokumen.
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
-- Dipakai di halaman: Pengaturan > Perusahaan (/pengaturan/perusahaan), Pengaturan > Dokumen (/pengaturan/dokumen); dibaca saat login dan untuk kop PDF di semua dokumen
CREATE TABLE "settings" ( -- Pengaturan sistem dalam bentuk kunci–nilai (JSON).
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
-- Dipakai di halaman: Pengaturan > Dokumen (/pengaturan/dokumen, pratinjau nomor); dipakai saat membuat Penawaran/SO, PO, Surat Jalan, Invoice, Surat & BA
CREATE TABLE "document_sequences" ( -- Penghitung nomor dokumen otomatis per kode, tahun, dan bulan (mis. SO/MTPP/2026/11/0001).
    "id" SERIAL NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Dipakai di halaman: Simpan Filter di kolom pencarian halaman daftar: Penjualan (/penjualan), PO Principal (/pengadaan), Penerimaan/Surat Jalan, Invoice/Tagihan, Pembayaran (/penagihan/pembayaran)
CREATE TABLE "saved_filters" ( -- Filter pencarian yang disimpan oleh pengguna.
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "resource" VARCHAR(60) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "filter" JSONB NOT NULL,

    CONSTRAINT "saved_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Dipakai di halaman: Pengaturan > API (/pengaturan/api)
CREATE TABLE "api_keys" ( -- Kunci API (disimpan sebagai hash) untuk akses sistem dari aplikasi luar.
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
-- Dipakai di halaman: Surat & Berita Acara (/dokumen, /dokumen/baru, /dokumen/:id)
CREATE TABLE "documents" ( -- Dokumen bebas (mis. berita acara, surat) dengan nomor unik dan isi JSON.
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
-- Keterangan relasi: N:1 = banyak baris di tabel ini menunjuk satu baris di tabel induk.
-- ON DELETE CASCADE = baris induk dihapus, baris anak ikut terhapus;
-- NO ACTION = induk tidak bisa dihapus selama masih dipakai (gunakan Arsipkan).
-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak users → satu partners. Data diri (nama, email) pengguna diambil dari partner.

-- AddForeignKey
ALTER TABLE "group_users" ADD CONSTRAINT "group_users_gid_groups_id_fk" FOREIGN KEY ("gid") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION; -- N:1 | banyak group_users → satu groups. Menunjuk grup yang diikuti pengguna; grup dihapus = keanggotaannya ikut terhapus.

-- AddForeignKey
ALTER TABLE "group_users" ADD CONSTRAINT "group_users_uid_users_id_fk" FOREIGN KEY ("uid") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION; -- N:1 | banyak group_users → satu users. Menunjuk pengguna anggota grup; pengguna dihapus = keanggotaannya ikut terhapus.

-- AddForeignKey
ALTER TABLE "group_permissions" ADD CONSTRAINT "group_permissions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION; -- N:1 | banyak group_permissions → satu groups. Hak akses per menu milik grup; grup dihapus = hak aksesnya ikut terhapus.

-- AddForeignKey
ALTER TABLE "change_logs" ADD CONSTRAINT "change_logs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION; -- N:1 | banyak change_logs → satu messages. Rincian perubahan milik satu catatan riwayat; ikut terhapus bersama pesannya.

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_property_payment_term_id_payment_terms_id_fk" FOREIGN KEY ("property_payment_term_id") REFERENCES "payment_terms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak partners → satu payment_terms. Termin bayar bawaan pelanggan/supplier.

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_sales_pricelist_id_sales_pricelists_id_fk" FOREIGN KEY ("sales_pricelist_id") REFERENCES "sales_pricelists"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak partners → satu sales_pricelists. Daftar harga khusus yang berlaku untuk pelanggan.

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_parent_id_partners_id_fk" FOREIGN KEY ("parent_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 (relasi ke diri sendiri) | banyak kontak → satu perusahaan induk. Orang kontak menempel ke perusahaannya.

-- AddForeignKey
ALTER TABLE "product_templates" ADD CONSTRAINT "product_templates_uom_id_units_id_fk" FOREIGN KEY ("uom_id") REFERENCES "units"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak product_templates → satu units. Satuan barang.

-- AddForeignKey
ALTER TABLE "product_templates" ADD CONSTRAINT "product_templates_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak product_templates → satu product_categories. Pengelompokan produk.

-- AddForeignKey
ALTER TABLE "product_templates" ADD CONSTRAINT "product_templates_main_supplier_id_partners_id_fk" FOREIGN KEY ("main_supplier_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak product_templates → satu partners. Supplier/principal utama produk.

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_product_tmpl_id_product_templates_id_fk" FOREIGN KEY ("product_tmpl_id") REFERENCES "product_templates"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak products → satu product_templates. Varian mengambil nama, satuan, dan harga dari induknya.

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak supplier_prices → satu partners. Supplier pemberi harga beli.

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_product_tmpl_id_product_templates_id_fk" FOREIGN KEY ("product_tmpl_id") REFERENCES "product_templates"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak supplier_prices → satu product_templates. Produk yang diberi harga beli.

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak warehouses → satu partners. Alamat/pemilik gudang.

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak locations → satu warehouses. Lokasi berada di gudang mana (kosong = lokasi virtual).

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak sales_orders → satu partners. Pelanggan yang memesan.

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_partner_shipping_id_partners_id_fk" FOREIGN KEY ("partner_shipping_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak sales_orders → satu partners. Alamat pengiriman (bisa berbeda dari pelanggan).

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_payment_term_id_payment_terms_id_fk" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak sales_orders → satu payment_terms. Termin bayar untuk order ini.

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION; -- N:1 | banyak sales_order_lines → satu sales_orders. Baris milik order; order dihapus = barisnya ikut terhapus.

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak sales_order_lines → satu products. Barang yang dijual.

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_mtpp_warehouse_id_warehouses_id_fk" FOREIGN KEY ("mtpp_warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak sales_order_lines → satu warehouses. Gudang asal pengiriman baris ini.

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak purchase_orders → satu partners. Supplier tujuan pembelian.

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak purchase_orders → satu warehouses. Gudang penerima barang.

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_mtpp_sale_order_id_sales_orders_id_fk" FOREIGN KEY ("mtpp_sale_order_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak purchase_orders → satu sales_orders. PO yang dibuat untuk memenuhi SO tertentu (pesanan/dropship).

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_dest_address_id_partners_id_fk" FOREIGN KEY ("dest_address_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak purchase_orders → satu partners. Alamat kirim langsung ke pelanggan untuk dropship.

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION; -- N:1 | banyak purchase_order_lines → satu purchase_orders. Baris milik PO; PO dihapus = barisnya ikut terhapus.

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak purchase_order_lines → satu products. Barang yang dibeli.

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_mtpp_sale_line_id_sales_order_lines_id_fk" FOREIGN KEY ("mtpp_sale_line_id") REFERENCES "sales_order_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak purchase_order_lines → satu sales_order_lines. Melacak baris PO dibeli untuk baris SO mana.

-- AddForeignKey
ALTER TABLE "transfer_types" ADD CONSTRAINT "transfer_types_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak transfer_types → satu warehouses. Jenis transfer milik gudang tertentu.

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_picking_type_id_transfer_types_id_fk" FOREIGN KEY ("picking_type_id") REFERENCES "transfer_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_transfers → satu transfer_types. Menentukan jenis dan awalan nomor transfer.

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_transfers → satu partners. Pelanggan/supplier pengirim atau penerima barang.

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_sale_id_sales_orders_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_transfers → satu sales_orders. Surat jalan untuk SO ini (bisa bertahap).

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_purchase_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "purchase_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_transfers → satu purchase_orders. Penerimaan barang dari PO ini (bisa bertahap).

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_transfers → satu locations. Lokasi asal barang.

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_location_dest_id_locations_id_fk" FOREIGN KEY ("location_dest_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_transfers → satu locations. Lokasi tujuan barang.

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_picking_id_stock_transfers_id_fk" FOREIGN KEY ("picking_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE NO ACTION; -- N:1 | banyak stock_moves → satu stock_transfers. Baris milik transfer; transfer dihapus = barisnya ikut terhapus.

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_moves → satu products. Barang yang dipindahkan.

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_moves → satu locations. Lokasi asal pergerakan.

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_location_dest_id_locations_id_fk" FOREIGN KEY ("location_dest_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_moves → satu locations. Lokasi tujuan pergerakan.

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_sale_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "sales_order_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_moves → satu sales_order_lines. Menghitung qty terkirim per baris SO.

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_purchase_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_moves → satu purchase_order_lines. Menghitung qty diterima per baris PO.

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_balances → satu products. Saldo stok produk ini.

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_balances → satu locations. Saldo stok di lokasi ini.

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_default_account_id_accounts_id_fk" FOREIGN KEY ("default_account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak journals → satu accounts. Akun bawaan jurnal (mis. akun Bank).

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak journal_entries → satu journals. Entri dicatat di buku jurnal mana.

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak journal_entries → satu partners. Pelanggan/supplier pada faktur atau tagihan.

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_mtpp_sale_order_id_sales_orders_id_fk" FOREIGN KEY ("mtpp_sale_order_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak journal_entries → satu sales_orders. Faktur yang dibuat dari SO ini.

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_mtpp_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("mtpp_purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak journal_entries → satu purchase_orders. Tagihan supplier dari PO ini.

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_move_id_journal_entries_id_fk" FOREIGN KEY ("move_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION; -- N:1 | banyak journal_entry_lines → satu journal_entries. Baris debit/kredit milik entri; entri dihapus = barisnya ikut terhapus.

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak journal_entry_lines → satu accounts. Akun yang didebit/dikredit.

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak journal_entry_lines → satu partners. Untuk buku besar pembantu piutang/hutang.

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak journal_entry_lines → satu products. Barang pada baris faktur.

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_sale_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "sales_order_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak journal_entry_lines → satu sales_order_lines. Menghitung qty sudah difakturkan per baris SO.

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_purchase_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak journal_entry_lines → satu purchase_order_lines. Menghitung qty sudah ditagih per baris PO.

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_move_id_journal_entries_id_fk" FOREIGN KEY ("move_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak payments → satu journal_entries. Entri jurnal yang dibuat oleh pembayaran ini.

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak payments → satu journals. Pembayaran lewat jurnal Kas/Bank mana.

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak payments → satu partners. Pelanggan yang membayar / supplier yang dibayar.

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_journal_entries_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak payments → satu journal_entries. Faktur/tagihan yang dilunasi (bisa dicicil).

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_mtpp_sale_order_id_sales_orders_id_fk" FOREIGN KEY ("mtpp_sale_order_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak payments → satu sales_orders. Pembayaran yang terkait langsung dengan SO.

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak bank_statement_lines → satu journals. Mutasi milik rekening/jurnal bank mana.

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak bank_statement_lines → satu partners. Pihak pengirim/penerima dana.

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak bank_statement_lines → satu payments. Pencocokan (rekonsiliasi) mutasi dengan pembayaran.

-- AddForeignKey
ALTER TABLE "sales_pricelist_items" ADD CONSTRAINT "sales_pricelist_items_pricelist_id_sales_pricelists_id_fk" FOREIGN KEY ("pricelist_id") REFERENCES "sales_pricelists"("id") ON DELETE CASCADE ON UPDATE NO ACTION; -- N:1 | banyak sales_pricelist_items → satu sales_pricelists. Item milik daftar harga; daftar dihapus = itemnya ikut terhapus.

-- AddForeignKey
ALTER TABLE "sales_pricelist_items" ADD CONSTRAINT "sales_pricelist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak sales_pricelist_items → satu products. Produk yang diberi harga khusus.

-- AddForeignKey
ALTER TABLE "stock_rules" ADD CONSTRAINT "stock_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_rules → satu products. Produk yang dipantau stok minimumnya.

-- AddForeignKey
ALTER TABLE "stock_rules" ADD CONSTRAINT "stock_rules_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak stock_rules → satu warehouses. Gudang tempat aturan berlaku.

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak activities → satu users. Pengguna yang ditugasi.

-- AddForeignKey
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION; -- N:1 | banyak saved_filters → satu users. Pemilik filter; pengguna dihapus = filternya ikut terhapus.

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak documents → satu partners. Pihak yang dituju dokumen.

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_sale_order_id_sales_orders_id_fk" FOREIGN KEY ("sale_order_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; -- N:1 | banyak documents → satu sales_orders. Dokumen yang terkait dengan SO.

