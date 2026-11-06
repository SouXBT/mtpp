import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Response } from 'express';
import { DB, Db } from '../../db/db.module';
import { AuthUser } from '../../shared/auth';
import { NumberingService } from '../../shared/numbering.service';
import { PdfService } from '../../shared/pdf.service';
import { SettingsService } from '../../shared/settings.service';
import { fail, must, today } from '../../shared/util';
import { DOC_TYPES, renderDocument } from './documents.templates';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const titleOf = (type: string, d: any) =>
  String((type === 'surat' ? d.subject : d.project || d.location || d.eqRating) || '').slice(0, 250) || null;

const toId = (v: any) => (v === undefined || v === null || v === '' ? null : Number(v));

// Surat resmi, berita acara, dan laporan pemeliharaan (dibuat bebas, tidak menyentuh stok maupun jurnal)
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DB) private db: Db,
    private numbering: NumberingService,
    private pdf: PdfService,
    private settings: SettingsService,
  ) {}

  private check(b: any) {
    if (!DOC_TYPES[b.type]) fail('Jenis dokumen tidak dikenal');
    if (!ISO.test(b.date || '')) fail('Tanggal dokumen tidak valid');
    if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) fail('Isi dokumen tidak valid');
  }

  private async buffer(type: string, number: string, data: any) {
    const c = await this.settings.get('company');
    return this.pdf.page(renderDocument(this.pdf, type, number, data, c));
  }

  async list(q: any) {
    const where = [];
    if (q.type && DOC_TYPES[q.type]) where.push({ type: q.type });
    if (q.q)
      where.push({
        OR: [
          { number: { contains: `${q.q}`, mode: 'insensitive' } },
          { title: { contains: `${q.q}`, mode: 'insensitive' } },
          { partner: { name: { contains: `${q.q}`, mode: 'insensitive' } } },
        ],
      });
    const rows = (
      await this.db.documents.findMany({
        where: where.length ? { AND: where } : undefined,
        select: { id: true, type: true, number: true, date: true, title: true, partner: { select: { name: true } } },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
      })
    ).map((r) => ({ ...r, partner: r.partner?.name ?? null }));
    return rows.map((r) => ({ ...r, typeLabel: DOC_TYPES[r.type]?.label }));
  }

  async next(type: string, date: string) {
    if (!DOC_TYPES[type]) fail('Jenis dokumen tidak dikenal');
    return { number: await this.numbering.peek(DOC_TYPES[type].code, ISO.test(date || '') ? date : today()) };
  }

  // pratinjau langsung dari data formulir; tidak menyimpan apa pun dan tidak memakai nomor urut
  async preview(b: any, res: Response) {
    this.check(b);
    const number = b.number || (await this.numbering.peek(DOC_TYPES[b.type].code, b.date));
    const buf = await this.buffer(b.type, number, { ...b.data, date: b.date });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="pratinjau.pdf"' }).send(buf);
  }

  async get(id: number) {
    return must(await this.db.documents.findFirst({ where: { id: id } }), 'Dokumen');
  }

  async file(id: number, res: Response) {
    const d = must(await this.db.documents.findFirst({ where: { id: id } }), 'Dokumen');
    const buf = await this.buffer(d.type, d.number, { ...(d.data as any), date: d.date });
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${d.number.replace(/[^\w.-]+/g, '-')}.pdf"`,
      })
      .send(buf);
  }

  async create(u: AuthUser, b: any) {
    this.check(b);
    return this.db.$transaction(async (tx) => {
      const number = String(b.number || '').trim() || (await this.numbering.next(tx, DOC_TYPES[b.type].code, b.date));
      await this.unique(number, undefined, tx);
      const r = await tx.documents.create({
        data: {
          type: b.type,
          number,
          date: b.date,
          partnerId: toId(b.partnerId),
          saleOrderId: toId(b.saleOrderId),
          title: titleOf(b.type, b.data),
          data: b.data,
          createUid: u.id,
          writeUid: u.id,
        },
      });
      return r;
    });
  }

  async update(u: AuthUser, id: number, b: any) {
    const cur = must(await this.db.documents.findFirst({ where: { id: id } }), 'Dokumen');
    this.check({ ...b, type: cur.type });
    const number = String(b.number || '').trim();
    if (!number) fail('Nomor dokumen wajib diisi');
    await this.unique(number, id);
    const [r] = await this.db.documents.updateManyAndReturn({
      where: { id: id },
      data: {
        number,
        date: b.date,
        partnerId: toId(b.partnerId),
        saleOrderId: toId(b.saleOrderId),
        title: titleOf(cur.type, b.data),
        data: b.data,
        writeUid: u.id,
        writeDate: new Date(),
      },
    });
    return r;
  }

  async copy(u: AuthUser, id: number) {
    const d = must(await this.db.documents.findFirst({ where: { id: id } }), 'Dokumen');
    return this.create(u, {
      type: d.type,
      date: today(),
      partnerId: d.partnerId,
      saleOrderId: d.saleOrderId,
      data: d.data,
    });
  }

  async remove(id: number) {
    must(await this.db.documents.findFirst({ where: { id: id } }), 'Dokumen');
    await this.db.documents.deleteMany({ where: { id: id } });
    return { ok: true };
  }

  private async unique(number: string, id: number | undefined, tx: any = this.db) {
    const [hit] = await tx.documents.findMany({ select: { id: true }, where: { number: number } });
    if (hit && hit.id !== id) fail('Nomor dokumen sudah dipakai');
  }
}
