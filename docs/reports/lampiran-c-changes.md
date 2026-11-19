# Perubahan untuk Lampiran C (CDM/PDM)

Nama tabel dan kolom tidak berubah. Migrasi `20261106120000_indexes_relations_state_rules` menambah lima relasi yang perlu digambar pada PDM:

| Dari | Ke | Saat data induk dihapus |
| --- | --- | --- |
| `sales_orders.user_id` | `users.id` | ditolak |
| `messages.author_id` | `users.id` | ditolak |
| `users.signature_attachment_id` | `attachments.id` | kolom dikosongkan, karena lampiran tanda tangan boleh dihapus |
| `journal_entries.reversed_entry_id` | `journal_entries.id` | ditolak |
| `stock_transfers.backorder_id` | `stock_transfers.id` | ditolak |

Migrasi yang sama menambah indeks pada semua foreign key dan aturan CHECK pada kolom `state`. Keduanya tidak memengaruhi gambar CDM/PDM.

## Migrasi `20261120090000_installments_grace_returns`

Nama tabel dan kolom lama tidak berubah. Migrasi ini menambah tiga tabel, empat kolom, dan sembilan relasi yang perlu digambar pada CDM/PDM.

**Kolom baru**

| Tabel | Kolom | Tipe | Arti |
| --- | --- | --- | --- |
| `partners` | `mtpp_grace_days` | integer, boleh kosong | Masa tenggang pembayaran pelanggan (hari); kosong = bawaan di pengaturan |
| `sales_orders` | `mtpp_release_uid` | integer, boleh kosong | Pimpinan yang mengizinkan kirim walau ada tagihan lewat masa tenggang |
| `sales_orders` | `mtpp_release_date` | timestamp, boleh kosong | Waktu izin kirim |
| `sales_orders` | `mtpp_release_note` | text, boleh kosong | Alasan izin kirim |

**Tabel baru**

- `invoice_installments`: `id`, `invoice_id`, `sequence`, `date_due`, `amount`, `state` (draft/approved), `note`, `approve_uid`, `approve_date`, kolom audit. Unik (`invoice_id`, `sequence`).
- `sales_returns`: `id`, `name` (RET/MTPP/…), `sale_id`, `partner_id`, `picking_id`, `date`, `reason`, `resolution` (ganti/nota_kredit/potongan), `state` (draft/done/cancel), `note`, `refund_entry_id`, `amount_untaxed`, `amount_tax`, `amount_total`, kolom audit.
- `sales_return_lines`: `id`, `return_id`, `move_id`, `sale_line_id`, `product_id`, `quantity`, `price_unit`, `subtotal`, `create_uid`, `create_date`.

**Relasi baru**

| Dari | Ke | Saat data induk dihapus |
| --- | --- | --- |
| `invoice_installments.invoice_id` | `journal_entries.id` | ikut terhapus |
| `sales_returns.sale_id` | `sales_orders.id` | ditolak |
| `sales_returns.partner_id` | `partners.id` | ditolak |
| `sales_returns.picking_id` | `stock_transfers.id` | ditolak |
| `sales_returns.refund_entry_id` | `journal_entries.id` | ditolak |
| `sales_return_lines.return_id` | `sales_returns.id` | ikut terhapus |
| `sales_return_lines.move_id` | `stock_moves.id` | ditolak |
| `sales_return_lines.sale_line_id` | `sales_order_lines.id` | ditolak |
| `sales_return_lines.product_id` | `products.id` | ditolak |

**Data**: akun `4-1100 Retur Penjualan` (pendapatan, kontra penjualan) ditambahkan; lokasi stok `usage = 'damaged'` (Barang Rusak) dibuat per gudang saat retur pertama diproses. `mtpp_release_uid` dan `approve_uid` sengaja tanpa foreign key, sama seperti `create_uid`/`write_uid`.
