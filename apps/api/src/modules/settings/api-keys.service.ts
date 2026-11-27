import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { DB, Db } from '../../db/db.module';
import { fail } from '../../shared/util';

export const hashKey = (k: string) => createHash('sha256').update(k).digest('hex');

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DB) private db: Db) {}

  list() {
    return this.db.apiKeys.findMany({
      select: { id: true, name: true, prefix: true, active: true, lastUsed: true, createDate: true },
      orderBy: { id: 'desc' },
    });
  }

  // kunci asli hanya ditampilkan sekali saat dibuat; database menyimpan hash-nya
  async create(b: { name: string }) {
    if (typeof b.name !== 'string' || !b.name.trim()) fail('Nama aplikasi wajib diisi');
    if (b.name.length > 80) fail('Nama aplikasi paling panjang 80 karakter');
    const key = 'mtpp_' + randomBytes(24).toString('hex');
    const r = await this.db.apiKeys.create({ data: { name: b.name, keyHash: hashKey(key), prefix: key.slice(0, 10) } });
    return { id: r.id, name: r.name, key };
  }

  async toggle(id: number, b: { active: boolean }) {
    // "false" dari formulir berarti nonaktif, bukan teks yang dianggap benar
    const v: unknown = b.active;
    const active = v === true || v === 'true' || v === 1 || v === '1';
    if (![true, false, 'true', 'false', 1, 0, '1', '0'].includes(v as any)) fail('Isi aktif atau nonaktif');
    const [r] = await this.db.apiKeys.updateManyAndReturn({ where: { id: id }, data: { active } });
    if (!r) fail('Kunci API tidak ditemukan');
    return { id: r.id, active: r.active };
  }

  async remove(id: number) {
    await this.db.apiKeys.deleteMany({ where: { id: id } });
    return { ok: true };
  }
}
