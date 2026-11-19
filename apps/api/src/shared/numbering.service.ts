import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../db/db.module';
import { Prisma } from '@prisma/client';

const sql = Prisma.sql;

// tabel dan kolom tempat nomor setiap kode disimpan
const SOURCE: Record<string, { table: string; col: string }> = {
  SO: { table: 'sales_orders', col: 'name' },
  PN: { table: 'sales_orders', col: 'mtpp_quotation_number' },
  PI: { table: 'sales_orders', col: 'mtpp_proforma_number' },
  PO: { table: 'purchase_orders', col: 'name' },
  DO: { table: 'stock_transfers', col: 'name' },
  RET: { table: 'sales_returns', col: 'name' },
  SP: { table: 'documents', col: 'number' },
  BA: { table: 'documents', col: 'number' },
  BC: { table: 'documents', col: 'number' },
  LM: { table: 'documents', col: 'number' },
};
const sourceOf = (code: string) => SOURCE[code] || { table: 'journal_entries', col: 'name' };

// Algoritma 3.1 Penomoran Dokumen Otomatis: <kode>/MTPP/<tahun>/<bulan>/<urut 4 digit>.
// Nomor urut = nomor urut terbesar dengan awalan yang sama + 1, sehingga dimulai ulang setiap bulan
// dan tetap benar walaupun nomor lama dimasukkan manual. Baris document_sequences dipakai sebagai kunci
// (FOR UPDATE) selama transaksi sehingga dua pengguna tidak mendapat nomor yang sama.
@Injectable()
export class NumberingService {
  constructor(@Inject(DB) private db: Db) {}

  prefix(code: string, dateIso: string) {
    const [y, m] = dateIso.slice(0, 7).split('-');
    return `${code}/MTPP/${y}/${m}/`;
  }

  // CariNomor + AngkaUrut: nomor urut terbesar yang sudah dipakai dengan awalan ini
  private async maxUsed(tx: any, code: string, prefix: string) {
    const s = sourceOf(code); // nama tabel dan kolom berasal dari daftar SOURCE di atas, bukan dari masukan pengguna
    const r: any[] =
      await tx.$queryRaw(Prisma.sql`select coalesce(max(substring(${Prisma.raw(`"${s.col}"`)} from ${prefix.length + 1}::int for 4)::int), 0) as n
      from ${Prisma.raw(`"${s.table}"`)} where ${Prisma.raw(`"${s.col}"`)} ~ ${'^' + prefix.replace(/\//g, '\\/') + '[0-9]{4}$'}`);
    return Number(r[0]?.n || 0);
  }

  async peek(code: string, dateIso: string) {
    const p = this.prefix(code, dateIso);
    return p + String((await this.maxUsed(this.db, code, p)) + 1).padStart(4, '0');
  }

  async next(tx: any, code: string, dateIso: string) {
    const [y, m] = dateIso.slice(0, 7).split('-').map(Number);
    const p = this.prefix(code, dateIso);
    await tx.$executeRaw(
      sql`insert into document_sequences(code, year, month, last_number) values (${code}, ${y}, ${m}, 0) on conflict (code, year, month) do nothing`,
    );
    const r = await tx.$queryRaw(
      sql`select last_number from document_sequences where code=${code} and year=${y} and month=${m} for update`,
    );
    void r; // baris terkunci sampai transaksi selesai; pembacaan berikutnya melihat nomor yang baru disimpan
    const n = (await this.maxUsed(tx, code, p)) + 1;
    await tx.$executeRaw(
      sql`update document_sequences set last_number=${n} where code=${code} and year=${y} and month=${m}`,
    );
    return p + String(n).padStart(4, '0');
  }
}
