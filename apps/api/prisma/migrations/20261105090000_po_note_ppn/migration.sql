-- ======================================================================
-- Migrasi po_note_ppn (perubahan DATA, bukan struktur).
-- Mengganti catatan bawaan PO di settings.doc_notes: harga kini
-- BELUM termasuk PPN dan PPN dihitung terpisah.
-- Hanya mengenai baris yang masih memakai teks bawaan lama, sehingga
-- catatan yang sudah diedit pengguna tidak tersentuh.
-- ======================================================================

-- Catatan PO tidak lagi menyebut harga sudah termasuk PPN. Hanya baris yang masih memakai teks bawaan lama.
UPDATE "settings"
SET "value" = jsonb_set("value"::jsonb, '{po}', to_jsonb(E'Harga belum termasuk PPN; PPN dihitung terpisah pada dokumen ini\nHarga sudah termasuk biaya pengiriman ke alamat tujuan\nFaktur pajak dan surat jalan wajib dilampirkan pada saat pengiriman\nBarang yang tidak sesuai spesifikasi akan dikembalikan atas biaya penjual'::text))
WHERE "key" = 'doc_notes'
  AND "value"::jsonb->>'po' = E'Harga sudah termasuk PPN dan biaya pengiriman ke alamat tujuan\nFaktur pajak dan surat jalan wajib dilampirkan pada saat pengiriman\nBarang yang tidak sesuai spesifikasi akan dikembalikan atas biaya penjual';
