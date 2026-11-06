import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ValidationOptions, registerDecorator } from 'class-validator';
import { Prisma } from '@prisma/client';

// Validasi hanya menolak isian yang memang akan gagal atau merusak data.
// Kelonggaran lama tetap berlaku: '' berarti kosong, dan angka boleh dikirim sebagai string.
const isEmpty = (v: unknown) => v === '' || v === null || v === undefined;
const isNumeric = (v: unknown) =>
  isEmpty(v) || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v));
const isDateLike = (v: unknown) =>
  isEmpty(v) ||
  v instanceof Date ||
  (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(new Date(v).getTime()));

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
export const IsDateLike = rule('isDateLike', isDateLike, 'harus berupa tanggal yang benar');
export const IsText = rule('isText', (v) => isEmpty(v) || typeof v === 'string', 'harus berupa teks');
export const IsFlag = rule('isFlag', (v) => isEmpty(v) || typeof v === 'boolean', 'harus berupa ya atau tidak');
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
  Int: [isNumeric, 'harus berupa angka'],
  Decimal: [isNumeric, 'harus berupa angka'],
  Float: [isNumeric, 'harus berupa angka'],
  DateTime: [isDateLike, 'harus berupa tanggal yang benar'],
  Boolean: [(v) => isEmpty(v) || typeof v === 'boolean', 'harus berupa ya atau tidak'],
};
export function checkColumnTypes(model: string, body: Record<string, unknown>, keys: string[]) {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name.toLowerCase() === model.toLowerCase());
  for (const k of keys) {
    const check = CHECKS[m?.fields.find((f) => f.name === k)?.type ?? ''];
    if (check && !check[0](body[k])) throw new BadRequestException(`Kolom ${k} ${check[1]}`);
  }
}
