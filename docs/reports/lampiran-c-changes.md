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

## Migrasi `20261121090000_payment_proof_settle_purchase_returns`

Nama tabel dan kolom lama tidak berubah. Dua tabel, dua kolom, dan sembilan relasi baru.

**Kolom baru**

| Tabel | Kolom | Tipe | Arti |
| --- | --- | --- | --- |
| `sales_orders` | `mtpp_settle_date` | date, boleh kosong | Tanggal pelunasan sisa yang disepakati pelanggan baru setelah membayar uang muka |
| `sales_returns` | `replacement_picking_id` | integer, boleh kosong | Surat jalan pengganti yang dibuat otomatis untuk retur "kirim pengganti" |

**Tabel baru**

- `purchase_returns`: `id`, `name` (RP/MTPP/…), `purchase_id`, `partner_id`, `warehouse_id`, `date`, `resolution` (ganti/nota_kredit), `state` (draft/done/cancel), `note`, `refund_entry_id`, `receipt_id`, `amount_untaxed`, `amount_tax`, `amount_total`, kolom audit.
- `purchase_return_lines`: `id`, `return_id`, `purchase_line_id`, `product_id`, `quantity`, `price_unit`, `subtotal`, `create_uid`, `create_date`.

**Relasi baru**

| Dari | Ke | Saat data induk dihapus |
| --- | --- | --- |
| `sales_returns.replacement_picking_id` | `stock_transfers.id` | ditolak |
| `purchase_returns.purchase_id` | `purchase_orders.id` | ditolak |
| `purchase_returns.partner_id` | `partners.id` | ditolak |
| `purchase_returns.warehouse_id` | `warehouses.id` | ditolak |
| `purchase_returns.refund_entry_id` | `journal_entries.id` | ditolak |
| `purchase_returns.receipt_id` | `stock_transfers.id` | ditolak |
| `purchase_return_lines.return_id` | `purchase_returns.id` | ikut terhapus |
| `purchase_return_lines.purchase_line_id` | `purchase_order_lines.id` | ditolak |
| `purchase_return_lines.product_id` | `products.id` | ditolak |

**Tanpa tabel baru**: bukti transfer disimpan di `attachments` dengan `res_model = 'payments'`. Uang muka hangus dicatat sebagai jurnal UMM (Debit 2-1200 Uang Muka Pelanggan, Kredit 4-2000 Pendapatan Lain-lain) yang terhubung ke `journal_entries.mtpp_sale_order_id`.

## Migrasi `20261127090000_purchase_down_payment`

Uang muka (DP) kepada principal: PO baru dapat dikonfirmasi setelah uang muka minimal sebesar persen di Pengaturan (bawaan 30%) dibayar, kecuali Pimpinan mengecualikannya dengan alasan.

**Kolom baru**

| Tabel | Kolom | Tipe | Arti |
| --- | --- | --- | --- |
| `payments` | `mtpp_purchase_order_id` | integer, boleh kosong | PO yang dibayar uang mukanya kepada principal (sebelum tagihan ada) |
| `purchase_orders` | `mtpp_dp_waive_note` | text, boleh kosong | Alasan PO dikonfirmasi tanpa uang muka (pengecualian oleh Pimpinan) |

**Relasi baru**

| Dari | Ke | Saat data induk dihapus |
| --- | --- | --- |
| `payments.mtpp_purchase_order_id` | `purchase_orders.id` | ditolak |

**Jurnal**: pembayaran uang muka Debit 1-1500 Uang Muka Pembelian, Kredit Kas/Bank. Saat tagihan principal diposting, uang muka dipakai lewat jurnal UMM (Debit 2-1100 Utang Usaha, Kredit 1-1500 Uang Muka Pembelian). Persen uang muka disimpan di `settings` (kunci `po_terms`, nilai `dpPercent`), tanpa tabel baru.

## Migrasi `20261128090000_drop_returns`

Fitur retur pelanggan dan retur ke principal dihapus atas keputusan pemilik. Lampiran C tidak lagi memuat tabel-tabel berikut beserta relasinya (lihat dua migrasi di atas untuk daftar kolom dan relasi yang ikut hilang).

**Tabel dihapus**

| Tabel | Isi sebelumnya |
| --- | --- |
| `sales_returns` | Kepala retur pelanggan (RET/MTPP/…) |
| `sales_return_lines` | Baris retur pelanggan |
| `purchase_returns` | Kepala retur ke principal (RP/MTPP/…) |
| `purchase_return_lines` | Baris retur ke principal |

**Tetap ada**: akun `4-1100 Retur Penjualan` dan lokasi stok `usage = 'damaged'` (Barang Rusak) tidak dihapus karena bisa sudah dipakai jurnal atau mutasi stok lama. Jurnal nota kredit dan mutasi stok yang pernah dibuat retur tetap tersimpan sebagai riwayat. Pengaturan `collection.returnDays` tidak dipakai lagi.

## Migrasi `20261128100000_proforma_due_date`

Proforma invoice memiliki batas bayar: tanggal proforma ditambah masa tenggang, bawaan 7 hari (Pengaturan → Penagihan, `collection.proformaGraceDays`), paling sedikit 7 hari dan boleh diatur lebih lama (sampai 90 hari), baik bawaannya maupun per proforma.

**Kolom baru**

| Tabel | Kolom | Tipe | Arti |
| --- | --- | --- | --- |
| `sales_orders` | `mtpp_proforma_due_date` | date, boleh kosong | Batas bayar proforma invoice (tanggal proforma + masa tenggang, paling sedikit 7 hari) |

**Tanpa relasi baru.** Proforma yang sudah ada diberi batas bayar 7 hari setelah tanggal proformanya.

## Tanpa migrasi: tanggal kunci periode akuntansi

Disimpan di `settings` (kunci `lock_date`, nilai `date`), tanpa tabel atau kolom baru. Jurnal bertanggal sampai tanggal kunci tidak dapat dibuat, diposting, dihapus, atau dibalik.
