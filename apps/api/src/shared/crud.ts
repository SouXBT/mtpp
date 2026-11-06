import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DB, Db } from '../db/db.module';
import { Perm } from './auth';
import { must } from './util';

export interface CrudOpts {
  path: string;
  menu: string;
  table: string;
  search?: string[];
  order?: string;
  writable: string[];
  required?: string[];
  filters?: string[];
}

// nama model Prisma (PascalCase) dari nama akses client (camelCase)
const hasActive = (table: string) =>
  !!Prisma.dmmf.datamodel.models
    .find((m) => m.name.toLowerCase() === table.toLowerCase())
    ?.fields.some((f) => f.name === 'active');

// Pengecekan hapus master: data yang sudah dipakai transaksi ditolak dan hanya bisa diarsipkan.
export async function safeDelete(fn: () => Promise<any>) {
  try {
    await fn();
    return { ok: true };
  } catch (e: any) {
    if (e?.code === 'P2003')
      throw new ConflictException('Data sudah dipakai pada transaksi sehingga tidak dapat dihapus. Gunakan Arsipkan.');
    throw e;
  }
}
export const pick = (o: any, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k] === '' ? null : o[k]]));

export function makeCrud(o: CrudOpts) {
  @Controller(o.path)
  class CrudController {
    constructor(@Inject(DB) public db: Db) {}
    get model(): any {
      return (this.db as any)[o.table];
    }

    @Get()
    @Perm(o.menu, 'read')
    async list(@Query() q: any) {
      const where: any[] = [];
      if (q.q && o.search?.length)
        where.push({ OR: o.search.map((f) => ({ [f]: { contains: q.q, mode: 'insensitive' } })) });
      if (q.active !== undefined && hasActive(o.table)) where.push({ active: q.active === 'true' });
      for (const f of o.filters || []) if (q[f] !== undefined) where.push({ [f]: isNaN(+q[f]) ? q[f] : +q[f] });
      return this.model.findMany({
        where: where.length ? { AND: where } : undefined,
        orderBy: { [o.order || 'id']: 'asc' },
        take: 1000,
      });
    }
    @Get(':id')
    @Perm(o.menu, 'read')
    async get(@Param('id', ParseIntPipe) id: number) {
      return must(await this.model.findFirst({ where: { id } }));
    }
    @Post()
    @Perm(o.menu, 'create')
    async create(@Body() b: any) {
      for (const k of o.required || [])
        if (b[k] === undefined || b[k] === null || b[k] === '') throw new ConflictException(`Kolom ${k} wajib diisi`);
      return this.model.create({ data: pick(b, o.writable) });
    }
    @Patch(':id')
    @Perm(o.menu, 'write')
    async update(@Param('id', ParseIntPipe) id: number, @Body() b: any) {
      const [r] = await this.model.updateManyAndReturn({ where: { id }, data: pick(b, [...o.writable, 'active']) });
      return must(r);
    }
    @Delete(':id')
    @Perm(o.menu, 'delete')
    remove(@Param('id', ParseIntPipe) id: number) {
      return safeDelete(() => this.model.deleteMany({ where: { id } }));
    }
  }
  Object.defineProperty(CrudController, 'name', { value: 'Crud_' + o.path.replace(/\W/g, '_') });
  return CrudController;
}
