import { Prisma } from '@prisma/client';
import { DATE_COLUMNS } from './date-columns.generated';

// Penyesuai tipe supaya kontrak API tetap sama bagi frontend: kolom date menjadi string YYYY-MM-DD,
// numeric dan bigint menjadi number. Aturan dibaca per model dari skema, jadi nama kolom yang sama
// di tabel lain tidak ikut terpengaruh.
type Field = { kind: string; type: string };
const FIELDS = new Map<string, Map<string, Field>>(
  Prisma.dmmf.datamodel.models.map((m) => [
    m.name,
    new Map(m.fields.map((f) => [f.name, { kind: f.kind, type: f.type } as Field])),
  ]),
);
const DATES = new Map(Object.entries(DATE_COLUMNS).map(([m, cols]) => [m, new Set(cols)]));
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/;

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !(v instanceof Date) && !Prisma.Decimal.isDecimal(v);
const mapDeep = (v: unknown, leaf: (x: unknown) => unknown): unknown => {
  if (Array.isArray(v)) return v.map((x) => mapDeep(x, leaf));
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapDeep(x, leaf)]));
  return leaf(v);
};
const dateIn = (v: unknown) =>
  typeof v === 'string' && DATE_LIKE.test(v) ? new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v) : v;
const intIn = (v: unknown) => (typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v);

/** Mengubah argumen Prisma (where, data, nested write) mengikuti tipe kolom model. */
export function toDb(model: string, v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => toDb(model, x));
  if (!isPlain(v)) return v;
  const fields = FIELDS.get(model);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const f = fields?.get(k);
    if (f?.kind === 'object') out[k] = toDb(f.type, x);
    else if (f?.type === 'Json') out[k] = x;
    else if (f?.type === 'DateTime') out[k] = mapDeep(x, dateIn);
    else if (f?.type === 'Int') out[k] = mapDeep(x, intIn);
    else out[k] = toDb(model, x);
  }
  return out;
}

/** Argumen tingkat atas: `data` adalah isi baris, bukan kolom JSON bernama data. */
export function argsToDb(model: string, args: Record<string, unknown> | undefined): Record<string, unknown> {
  const { data, ...rest } = args || {};
  const input = toDb(model, rest) as Record<string, unknown>;
  return data === undefined ? input : { ...input, data: toDb(model, data) };
}

/** Mengubah hasil Prisma sesuai kontrak API. */
export function fromDb(model: string, v: unknown): unknown {
  if (Prisma.Decimal.isDecimal(v) || typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map((x) => fromDb(model, x));
  if (!isPlain(v)) return v;
  const fields = FIELDS.get(model);
  const dates = DATES.get(model);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const f = fields?.get(k);
    if (x instanceof Date) out[k] = dates?.has(k) ? x.toISOString().slice(0, 10) : x;
    else if (f?.type === 'Json') out[k] = x;
    else out[k] = fromDb(f?.kind === 'object' ? f.type : model, x);
  }
  return out;
}

/** Hasil SQL mentah tidak punya model: tanggal tanpa jam menjadi string, angka menjadi number. */
export function fromRaw(v: unknown): unknown {
  if (v instanceof Date) {
    const midnight = v.getUTCHours() + v.getUTCMinutes() + v.getUTCSeconds() + v.getUTCMilliseconds() === 0;
    return midnight ? v.toISOString().slice(0, 10) : v.toISOString();
  }
  if (Prisma.Decimal.isDecimal(v) || typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(fromRaw);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromRaw(x)]));
  return v;
}
