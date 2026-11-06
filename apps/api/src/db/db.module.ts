import { Global, Module } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DATE_FIELDS, INT_FIELDS, JSON_FIELDS, STAMP_FIELDS } from './fields';

// Penyesuai tipe supaya kontrak API tetap sama bagi frontend:
// kolom date berupa string YYYY-MM-DD dan kolom numeric berupa number (Prisma memakai Date dan Decimal).
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/;
const midnight = (d: Date) =>
  d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

function toDate(v: any): any {
  if (typeof v === 'string' && DATE_LIKE.test(v)) return new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
  if (Array.isArray(v)) return v.map(toDate);
  if (v && typeof v === 'object' && !(v instanceof Date))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toDate(x)]));
  return v;
}
function toInt(v: any): any {
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  if (Array.isArray(v)) return v.map(toInt);
  if (v && typeof v === 'object' && !(v instanceof Date))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toInt(x)]));
  return v;
}
function toDb(v: any): any {
  if (Array.isArray(v)) return v.map(toDb);
  if (!v || typeof v !== 'object' || v instanceof Date || Prisma.Decimal.isDecimal(v)) return v;
  const out: any = {};
  for (const [k, x] of Object.entries(v)) {
    if (JSON_FIELDS.has(k)) out[k] = x;
    else if (DATE_FIELDS.has(k) || STAMP_FIELDS.has(k)) out[k] = toDate(x);
    else if (INT_FIELDS.has(k)) out[k] = toInt(x);
    else out[k] = toDb(x);
  }
  return out;
}
function fromDb(v: any, key?: string): any {
  if (v instanceof Date) return key && DATE_FIELDS.has(key) && midnight(v) ? v.toISOString().slice(0, 10) : v;
  if (Prisma.Decimal.isDecimal(v)) return Number(v);
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map((x) => fromDb(x, key));
  if (v && typeof v === 'object' && !(key && JSON_FIELDS.has(key))) {
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = fromDb(v[k], k);
    return out;
  }
  return v;
}
// hasil SQL mentah: tanggal tanpa jam menjadi string, angka menjadi number
function fromRaw(v: any): any {
  if (v instanceof Date) return midnight(v) ? v.toISOString().slice(0, 10) : v.toISOString();
  if (Prisma.Decimal.isDecimal(v)) return Number(v);
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(fromRaw);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromRaw(x)]));
  return v;
}

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  transactionOptions: { maxWait: 10000, timeout: 60000 },
});

export const db = client.$extends({
  query: {
    async $allOperations({ model, args, query }: any) {
      if (!model) return fromRaw(await query(args));
      // `data` pada argumen Prisma adalah isi baris; kolom JSON bernama data ada di dalamnya dan tidak diubah
      const { data, ...rest } = args || {};
      const input = data === undefined ? toDb(rest) : { ...toDb(rest), data: toDb(data) };
      return fromDb(await query(input));
    },
  },
});

export type Db = typeof db;
export const DB = 'DB';

@Global()
@Module({ providers: [{ provide: DB, useValue: db }], exports: [DB] })
export class DbModule {}
