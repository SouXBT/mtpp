-- Catatan PO tidak lagi menyebut harga sudah termasuk PPN. Hanya baris yang masih memakai teks bawaan lama.
UPDATE "settings"
SET "value" = jsonb_set("value"::jsonb, '{po}', to_jsonb(E'Harga belum termasuk PPN; PPN dihitung terpisah pada dokumen ini\nHarga sudah termasuk biaya pengiriman ke alamat tujuan\nFaktur pajak dan surat jalan wajib dilampirkan pada saat pengiriman\nBarang yang tidak sesuai spesifikasi akan dikembalikan atas biaya penjual'::text))
WHERE "key" = 'doc_notes'
  AND "value"::jsonb->>'po' = E'Harga sudah termasuk PPN dan biaya pengiriman ke alamat tujuan\nFaktur pajak dan surat jalan wajib dilampirkan pada saat pengiriman\nBarang yang tidak sesuai spesifikasi akan dikembalikan atas biaya penjual';
