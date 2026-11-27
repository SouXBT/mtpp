import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ValidationOptions, registerDecorator } from 'class-validator';
import { fieldsOf } from '../db/convert';

// Validasi hanya menolak isian yang memang akan gagal atau merusak data.
// Kelonggaran lama tetap berlaku: '' berarti kosong, dan angka boleh dikirim sebagai string.
const isEmpty = (v: unknown) => v === '' || v === null || v === undefined;
// batas nilai: kolom uang Decimal(18,2) dan kuantitas; di atas ini database meluap (dulu galat 500)
const MAX_NUM = 1e14;
const isNumeric = (v: unknown) =>
  isEmpty(v) ||
  (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_NUM) ||
  (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && Math.abs(Number(v)) <= MAX_NUM);
const isIntLike = (v: unknown) => {
  if (isEmpty(v)) return true;
  if (typeof v !== 'number' && !(typeof v === 'string' && /^-?\d+$/.test(v))) return false;
  const n = Number(v);
  return Number.isInteger(n) && Math.abs(n) <= 2147483647;
};
// Tanggal yang tidak ada (31 Februari) ditolak, karena Date diam-diam menggesernya ke bulan berikutnya.
const isRealDay = (s: string) => {
  const day = s.slice(0, 10);
  const d = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
};
// Hanya YYYY-MM-DD, atau waktu ISO lengkap dengan zona (Z atau +07:00). Teks tambahan ("2026-11-27 abc") atau waktu
// tanpa zona ditolak, karena dulu digeser diam-diam ke tanggal lain dan bisa melewati tanggal kunci periode.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/;
const inYears = (s: string) => {
  const y = Number(s.slice(0, 4));
  return y >= 2000 && y <= 2100;
};
const isDateLike = (v: unknown) =>
  isEmpty(v) ||
  v instanceof Date ||
  (typeof v === 'string' &&
    (DAY_RE.test(v) || ISO_RE.test(v)) &&
    inYears(v) &&
    isRealDay(v) &&
    !Number.isNaN(new Date(v).getTime()));
const isFlag = (v: unknown) => isEmpty(v) || typeof v === 'boolean';

const rule = (name: string, test: (v: unknown) => boolean, message: string) => (options?: ValidationOptions) => {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name,
      target: target.constructor,
      propertyName,
      options: { message: `Kolom ${propertyName} ${message}`, ...options },
      validator: { validate: test },
    });
};

export const IsNumeric = rule('isNumeric', isNumeric, 'harus berupa angka');
export const IsId = rule('isId', isIntLike, 'harus berupa angka bulat');
export const IsDateLike = rule('isDateLike', isDateLike, 'harus berupa tanggal yang benar');
export const IsText = rule('isText', (v) => isEmpty(v) || typeof v === 'string', 'harus berupa teks');
export const IsFlag = rule('isFlag', isFlag, 'harus berupa ya atau tidak');
// Untuk kolom wajib: bila dikirim tidak boleh null, karena kode dan database tidak menerimanya.
export const IsPresentText = rule(
  'isPresentText',
  (v) => v === undefined || typeof v === 'string',
  'harus berupa teks',
);
export const IsFilledText = rule(
  'isFilledText',
  (v) => v === undefined || (typeof v === 'string' && v.trim() !== ''),
  'wajib diisi',
);
export const IsPresentFlag = rule(
  'isPresentFlag',
  (v) => v === undefined || typeof v === 'boolean',
  'harus berupa ya atau tidak',
);
export const IsRows = rule(
  'isRows',
  (v) => isEmpty(v) || (Array.isArray(v) && v.every((x) => !!x && typeof x === 'object')),
  'harus berupa daftar baris',
);

export const appValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    transform: false,
    exceptionFactory: (errors) =>
      new BadRequestException(errors.flatMap((e) => Object.values(e.constraints || {})).join('; ')),
  });

// Untuk endpoint yang memakai daftar kolom (makeCrud, pelanggan, produk): tipe dibaca dari skema.
const CHECKS: Record<string, [(v: unknown) => boolean, string]> = {
  Int: [isIntLike, 'harus berupa angka bulat'],
  Decimal: [isNumeric, 'harus berupa angka'],
  Float: [isNumeric, 'harus berupa angka'],
  DateTime: [isDateLike, 'harus berupa tanggal yang benar'],
  Boolean: [isFlag, 'harus berupa ya atau tidak'],
};
export function checkColumnTypes(table: string, body: Record<string, unknown>, keys: string[]) {
  const fields = fieldsOf(table);
  for (const k of keys) {
    const f = fields.get(k);
    if (!f || body[k] === undefined) continue;
    // pick() mengubah '' menjadi null, yang tidak diterima kolom wajib
    if (f.isRequired && isEmpty(body[k])) throw new BadRequestException(`Kolom ${k} wajib diisi`);
    const check = CHECKS[f.type];
    if (check && !check[0](body[k])) throw new BadRequestException(`Kolom ${k} ${check[1]}`);
  }
}
