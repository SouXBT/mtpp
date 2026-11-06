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
