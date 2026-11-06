# Celah validasi yang tersisa

Validasi hanya menolak isian yang sudah pasti gagal atau merusak data. Aturan bisnis baru sengaja tidak ditambahkan.

**Belum memakai DTO** karena isinya bebas atau berupa formulir unggahan:
`PUT settings/:key`, `documents` (create, update, preview), `import/:kind`, `email/webhook`, `bank-statements/import`,
`records/activities`, `saved-filters`, `records/.../messages`, `api-keys`, `groups/:id/permissions`, `partners/.../addresses`.

**Isi baris tidak diperiksa per kolom:** `lines` dan `moves` hanya dipastikan berupa daftar objek. Pemeriksaan isi barisnya tetap di service.

**Belum diaudit:** batas bisnis seperti kuantitas negatif atau diskon di atas 100 belum ditinjau per endpoint. Keputusan aturannya ada pada pemilik.
