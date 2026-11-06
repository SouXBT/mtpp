-- Catatan invoice dan PO selaras: sistem tidak memiliki proses retur. Hanya teks yang masih bawaan yang diganti.
UPDATE "settings"
SET "value" = jsonb_set("value"::jsonb, '{po}', to_jsonb(E'Harga belum termasuk PPN; PPN dihitung terpisah pada dokumen ini\nHarga sudah termasuk biaya pengiriman ke alamat tujuan\nFaktur pajak dan surat jalan wajib dilampirkan pada saat pengiriman\nBarang yang tidak sesuai spesifikasi diselesaikan melalui kesepakatan tertulis dengan penjual'::text))
WHERE "key" = 'doc_notes'
  AND "value"::jsonb->>'po' = E'Harga belum termasuk PPN; PPN dihitung terpisah pada dokumen ini\nHarga sudah termasuk biaya pengiriman ke alamat tujuan\nFaktur pajak dan surat jalan wajib dilampirkan pada saat pengiriman\nBarang yang tidak sesuai spesifikasi akan dikembalikan atas biaya penjual';

UPDATE "settings"
SET "value" = jsonb_set("value"::jsonb, '{invoice}', to_jsonb(E'Barang yang sudah dibeli tidak dapat ditukar atau dikembalikan, kecuali ada kesepakatan tertulis\nPembayaran dengan cheque / giro bilyet dinyatakan lunas setelah clearing\nPembayaran melebihi batas waktu yang disepakati dikenakan bunga 3% per bulan'::text))
WHERE "key" = 'doc_notes'
  AND "value"::jsonb->>'invoice' = E'Barang yang sudah dibeli tidak dapat ditukar atau dikembalikan\nPembayaran dengan cheque / giro bilyet dinyatakan lunas setelah clearing\nPembayaran melebihi batas waktu yang disepakati dikenakan bunga 3% per bulan';

-- Catatan contoh PT Daya Pompa: sistem tidak mendukung uang muka kepada principal
UPDATE "partners" SET "mtpp_supplier_note" = 'Pembayaran 30 hari setelah tagihan'
WHERE "name" = 'PT Daya Pompa Mandiri' AND "mtpp_supplier_note" = 'Uang muka 30%, pelunasan sebelum kirim';
