-- CreateIndex
CREATE INDEX "users_partner_id_idx" ON "users"("partner_id");

-- CreateIndex
CREATE INDEX "users_signature_attachment_id_idx" ON "users"("signature_attachment_id");

-- CreateIndex
CREATE INDEX "group_users_uid_idx" ON "group_users"("uid");

-- CreateIndex
CREATE INDEX "messages_author_id_idx" ON "messages"("author_id");

-- CreateIndex
CREATE INDEX "change_logs_message_id_idx" ON "change_logs"("message_id");

-- CreateIndex
CREATE INDEX "partners_sales_pricelist_id_idx" ON "partners"("sales_pricelist_id");

-- CreateIndex
CREATE INDEX "partners_parent_id_idx" ON "partners"("parent_id");

-- CreateIndex
CREATE INDEX "partners_property_payment_term_id_idx" ON "partners"("property_payment_term_id");

-- CreateIndex
CREATE INDEX "product_templates_category_id_idx" ON "product_templates"("category_id");

-- CreateIndex
CREATE INDEX "product_templates_main_supplier_id_idx" ON "product_templates"("main_supplier_id");

-- CreateIndex
CREATE INDEX "product_templates_uom_id_idx" ON "product_templates"("uom_id");

-- CreateIndex
CREATE INDEX "products_product_tmpl_id_idx" ON "products"("product_tmpl_id");

-- CreateIndex
CREATE INDEX "supplier_prices_product_tmpl_id_idx" ON "supplier_prices"("product_tmpl_id");

-- CreateIndex
CREATE INDEX "supplier_prices_partner_id_idx" ON "supplier_prices"("partner_id");

-- CreateIndex
CREATE INDEX "warehouses_partner_id_idx" ON "warehouses"("partner_id");

-- CreateIndex
CREATE INDEX "locations_warehouse_id_idx" ON "locations"("warehouse_id");

-- CreateIndex
CREATE INDEX "sales_orders_partner_shipping_id_idx" ON "sales_orders"("partner_shipping_id");

-- CreateIndex
CREATE INDEX "sales_orders_partner_id_idx" ON "sales_orders"("partner_id");

-- CreateIndex
CREATE INDEX "sales_orders_payment_term_id_idx" ON "sales_orders"("payment_term_id");

-- CreateIndex
CREATE INDEX "sales_orders_user_id_idx" ON "sales_orders"("user_id");

-- CreateIndex
CREATE INDEX "sales_order_lines_mtpp_warehouse_id_idx" ON "sales_order_lines"("mtpp_warehouse_id");

-- CreateIndex
CREATE INDEX "sales_order_lines_order_id_idx" ON "sales_order_lines"("order_id");

-- CreateIndex
CREATE INDEX "sales_order_lines_product_id_idx" ON "sales_order_lines"("product_id");

-- CreateIndex
CREATE INDEX "purchase_orders_mtpp_sale_order_id_idx" ON "purchase_orders"("mtpp_sale_order_id");

-- CreateIndex
CREATE INDEX "purchase_orders_dest_address_id_idx" ON "purchase_orders"("dest_address_id");

-- CreateIndex
CREATE INDEX "purchase_orders_warehouse_id_idx" ON "purchase_orders"("warehouse_id");

-- CreateIndex
CREATE INDEX "purchase_orders_partner_id_idx" ON "purchase_orders"("partner_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_order_id_idx" ON "purchase_order_lines"("order_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_mtpp_sale_line_id_idx" ON "purchase_order_lines"("mtpp_sale_line_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_product_id_idx" ON "purchase_order_lines"("product_id");

-- CreateIndex
CREATE INDEX "transfer_types_warehouse_id_idx" ON "transfer_types"("warehouse_id");

-- CreateIndex
CREATE INDEX "stock_transfers_partner_id_idx" ON "stock_transfers"("partner_id");

-- CreateIndex
CREATE INDEX "stock_transfers_location_id_idx" ON "stock_transfers"("location_id");

-- CreateIndex
CREATE INDEX "stock_transfers_picking_type_id_idx" ON "stock_transfers"("picking_type_id");

-- CreateIndex
CREATE INDEX "stock_transfers_location_dest_id_idx" ON "stock_transfers"("location_dest_id");

-- CreateIndex
CREATE INDEX "stock_transfers_purchase_id_idx" ON "stock_transfers"("purchase_id");

-- CreateIndex
CREATE INDEX "stock_transfers_sale_id_idx" ON "stock_transfers"("sale_id");

-- CreateIndex
CREATE INDEX "stock_transfers_backorder_id_idx" ON "stock_transfers"("backorder_id");

-- CreateIndex
CREATE INDEX "stock_moves_sale_line_id_idx" ON "stock_moves"("sale_line_id");

-- CreateIndex
CREATE INDEX "stock_moves_product_id_idx" ON "stock_moves"("product_id");

-- CreateIndex
CREATE INDEX "stock_moves_purchase_line_id_idx" ON "stock_moves"("purchase_line_id");

-- CreateIndex
CREATE INDEX "stock_moves_location_id_idx" ON "stock_moves"("location_id");

-- CreateIndex
CREATE INDEX "stock_moves_picking_id_idx" ON "stock_moves"("picking_id");

-- CreateIndex
CREATE INDEX "stock_moves_location_dest_id_idx" ON "stock_moves"("location_dest_id");

-- CreateIndex
CREATE INDEX "stock_balances_location_id_idx" ON "stock_balances"("location_id");

-- CreateIndex
CREATE INDEX "journals_default_account_id_idx" ON "journals"("default_account_id");

-- CreateIndex
CREATE INDEX "journal_entries_journal_id_idx" ON "journal_entries"("journal_id");

-- CreateIndex
CREATE INDEX "journal_entries_partner_id_idx" ON "journal_entries"("partner_id");

-- CreateIndex
CREATE INDEX "journal_entries_mtpp_sale_order_id_idx" ON "journal_entries"("mtpp_sale_order_id");

-- CreateIndex
CREATE INDEX "journal_entries_mtpp_purchase_order_id_idx" ON "journal_entries"("mtpp_purchase_order_id");

-- CreateIndex
CREATE INDEX "journal_entries_reversed_entry_id_idx" ON "journal_entries"("reversed_entry_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_account_id_idx" ON "journal_entry_lines"("account_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_partner_id_idx" ON "journal_entry_lines"("partner_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_sale_line_id_idx" ON "journal_entry_lines"("sale_line_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_product_id_idx" ON "journal_entry_lines"("product_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_move_id_idx" ON "journal_entry_lines"("move_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_purchase_line_id_idx" ON "journal_entry_lines"("purchase_line_id");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_journal_id_idx" ON "payments"("journal_id");

-- CreateIndex
CREATE INDEX "payments_mtpp_sale_order_id_idx" ON "payments"("mtpp_sale_order_id");

-- CreateIndex
CREATE INDEX "payments_move_id_idx" ON "payments"("move_id");

-- CreateIndex
CREATE INDEX "payments_partner_id_idx" ON "payments"("partner_id");

-- CreateIndex
CREATE INDEX "bank_statement_lines_journal_id_idx" ON "bank_statement_lines"("journal_id");

-- CreateIndex
CREATE INDEX "bank_statement_lines_partner_id_idx" ON "bank_statement_lines"("partner_id");

-- CreateIndex
CREATE INDEX "bank_statement_lines_payment_id_idx" ON "bank_statement_lines"("payment_id");

-- CreateIndex
CREATE INDEX "sales_pricelist_items_pricelist_id_idx" ON "sales_pricelist_items"("pricelist_id");

-- CreateIndex
CREATE INDEX "sales_pricelist_items_product_id_idx" ON "sales_pricelist_items"("product_id");

-- CreateIndex
CREATE INDEX "stock_rules_warehouse_id_idx" ON "stock_rules"("warehouse_id");

-- CreateIndex
CREATE INDEX "activities_user_id_idx" ON "activities"("user_id");

-- CreateIndex
CREATE INDEX "saved_filters_user_id_idx" ON "saved_filters"("user_id");

-- CreateIndex
CREATE INDEX "documents_partner_id_idx" ON "documents"("partner_id");

-- CreateIndex
CREATE INDEX "documents_sale_order_id_idx" ON "documents"("sale_order_id");

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversed_entry_id_fk" FOREIGN KEY ("reversed_entry_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("signature_attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_backorder_id_fk" FOREIGN KEY ("backorder_id") REFERENCES "stock_transfers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- Aturan nilai state. Prisma tidak memodelkan CHECK, jadi hanya ada di migrasi ini.
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_state_check" CHECK ("state" IN ('draft', 'sent', 'sale', 'done', 'cancel'));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_state_check" CHECK ("state" IN ('draft', 'sent', 'purchase', 'done', 'cancel'));
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_state_check" CHECK ("state" IN ('draft', 'waiting', 'assigned', 'done', 'cancel'));
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_state_check" CHECK ("state" IN ('draft', 'waiting', 'assigned', 'done', 'cancel'));
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_state_check" CHECK ("state" IN ('draft', 'posted', 'cancel'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_state_check" CHECK ("state" IN ('draft', 'posted', 'cancel'));
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_state_check" CHECK ("state" IN ('diproses', 'simulasi', 'terkirim', 'ditolak', 'gagal'));
