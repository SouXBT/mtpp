// Kunci dokumen di dalam transaksi sehingga dua permintaan bersamaan atas dokumen yang sama berjalan berurutan:
// permintaan kedua menunggu, lalu membaca keadaan terbaru dan ditolak bila sudah tidak berlaku (misalnya
// pembayaran ganda, invoice ganda, PO ganda, atau konfirmasi PO dua kali).
//
// Memakai advisory lock Postgres (lepas otomatis saat transaksi selesai), bukan SELECT ... FOR UPDATE: kunci baris
// akan memblokir penulisan baris yang sama dari koneksi lain di dalam proses yang sama (misalnya pembatalan SO
// yang memperbarui status SO lewat koneksi lain) sehingga proses menunggu dirinya sendiri. Advisory lock hanya
// mengurutkan operasi yang sama-sama meminta kunci dokumen itu, dan boleh diminta ulang dalam transaksi yang sama.
const TABLES = [
  'sales_orders',
  'purchase_orders',
  'journal_entries',
  'stock_transfers',
  'bank_statement_lines',
  'payments',
] as const;
export type LockTable = (typeof TABLES)[number];

// pg_advisory_xact_lock mengembalikan void, yang tidak dapat dibaca Prisma; dibungkus agar mengembalikan angka
const LOCK_SQL = 'select 1 as ok from (select pg_advisory_xact_lock(hashtext($1))) as x';

export async function lockRow(tx: any, table: LockTable, id: number) {
  if (!TABLES.includes(table)) throw new Error(`Tabel ${table} tidak dapat dikunci`);
  if (!Number.isInteger(Number(id))) return;
  await tx.$queryRawUnsafe(LOCK_SQL, `${table}:${Number(id)}`);
}

// Kunci berdasarkan kunci teks, untuk aturan yang tidak terikat satu baris, misalnya nomor tagihan principal
// yang tidak boleh ganda untuk satu principal.
export async function lockKey(tx: any, key: string) {
  await tx.$queryRawUnsafe(LOCK_SQL, key);
}
