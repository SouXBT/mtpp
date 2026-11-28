-- Admin memegang semua hak akses (Baca, Buat, Ubah, Hapus) di semua menu.
UPDATE "group_permissions" gp
SET "perm_read" = true, "perm_create" = true, "perm_write" = true, "perm_delete" = true
FROM "groups" g
WHERE g."id" = gp."group_id" AND g."code" = 'ADMIN';
