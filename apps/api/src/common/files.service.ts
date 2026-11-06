import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { DB, Db } from '../db/db.module';
import { must } from './util';

export const STORAGE = path.resolve(process.env.STORAGE_DIR || './storage');

@Injectable()
export class FilesService {
  constructor(@Inject(DB) private db: Db) {
    fs.mkdirSync(STORAGE, { recursive: true });
  }

  async save(buf: Buffer, name: string, mimetype: string, resModel: string, resId: number, uid?: number) {
    const fname = randomUUID() + path.extname(name || '');
    fs.writeFileSync(path.join(STORAGE, fname), buf);
    const a = await this.db.attachments.create({
      data: { name, mimetype, resModel, resId, storeFname: fname, fileSize: buf.length, createUid: uid },
    });
    return a;
  }
  async get(id: number) {
    const a = must(await this.db.attachments.findFirst({ where: { id: id } }), 'Lampiran');
    return { meta: a, buffer: fs.readFileSync(path.join(STORAGE, a.storeFname)) };
  }
  list(resModel: string, resId: number) {
    return this.db.attachments.findMany({
      where: { AND: [{ resModel: resModel }, { resId: resId }] },
      orderBy: { id: 'desc' },
    });
  }
  async remove(id: number) {
    const a = await this.db.attachments.findFirst({ where: { id: id } });
    if (!a) return;
    try {
      fs.unlinkSync(path.join(STORAGE, a.storeFname));
    } catch {}
    await this.db.attachments.deleteMany({ where: { id: id } });
  }
}
