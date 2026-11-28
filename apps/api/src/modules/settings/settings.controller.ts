import { Body, Controller, Get, Inject, Param, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { DB, Db } from '../../db/db.module';
import { AuthUser, CurrentUser, Perm, Public, checkPerm } from '../../shared/auth';
import { DEFAULT_SETTINGS, SettingsService } from '../../shared/settings.service';
import { FilesService } from '../../shared/files.service';
import { NumberingService } from '../../shared/numbering.service';
import { fail, today } from '../../shared/util';
import { PROFORMA_MAX_GRACE, PROFORMA_MIN_GRACE } from '../../shared/collection';

// Pengaturan PPN, syarat dokumen, data perusahaan (C.f, C.j), API key (REST API)
@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(DB) private db: Db,
    private settings: SettingsService,
    private files: FilesService,
    private numbering: NumberingService,
  ) {}

  // data perusahaan dan tarif dibaca semua pengguna yang login (untuk tampilan dan perhitungan)
  @Get() async all(@CurrentUser() u: AuthUser) {
    const a = await this.settings.all();
    if (!u.perms.akuntansi?.read && !u.perms.pengaturan?.read) delete a.accounts;
    return a;
  }

  @Put(':key')
  async set(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() b: any) {
    // hanya kunci milik pengaturan sendiri (bukan properti bawaan objek seperti "constructor")
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) fail('Kunci pengaturan tidak dikenal');
    checkPerm(
      u,
      key === 'company' ? 'perusahaan' : ['accounts', 'lock_date'].includes(key) ? 'akuntansi' : 'pengaturan',
      'write',
    );
    if (key === 'lock_date') {
      // seperti lock date Odoo: bukan tanggal masa depan, dan tidak ada dokumen draf yang tertinggal di periode itu
      const d = b.date ? String(b.date) : null;
      const real = d && new Date(`${d}T00:00:00Z`);
      if (
        d &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(d) ||
          !real ||
          Number.isNaN(real.getTime()) ||
          real.toISOString().slice(0, 10) !== d)
      )
        fail('Format tanggal kunci tidak valid');
      if (d && d > today()) fail('Tanggal kunci tidak boleh di masa depan');
      if (d) {
        const draft = await this.db.journalEntries.findFirst({ where: { state: 'draft', date: { lte: d } } });
        if (draft) fail(`Masih ada dokumen draf ${draft.name} bertanggal ${draft.date}; posting atau hapus dulu`);
      }
      return this.settings.set(key, { date: d });
    }
    if (key === 'tax') {
      const r = Number(b.rate),
        n = Number(b.dppNum),
        d = Number(b.dppDen);
      if (!(r >= 0 && r <= 100) || !(n > 0) || !(d > 0)) fail('Tarif PPN atau DPP tidak valid');
    }
    if (key === 'collection') {
      // setiap angka penagihan diperiksa batasnya dan disimpan sebagai angka, bukan teks
      const ranges: [string, number, number, string][] = [
        ['graceDays', 0, 90, 'Masa tenggang bawaan harus 0 sampai 90 hari'],
        [
          'proformaGraceDays',
          PROFORMA_MIN_GRACE,
          PROFORMA_MAX_GRACE,
          `Masa tenggang proforma harus ${PROFORMA_MIN_GRACE} sampai ${PROFORMA_MAX_GRACE} hari`,
        ],
        ['maxInstallments', 2, 24, 'Cicilan paling banyak harus 2 sampai 24 termin'],
        ['maxMonths', 1, 36, 'Batas cicilan harus 1 sampai 36 bulan'],
      ];
      ranges.push(['poMinAmount', 0, 1e14, 'Batas minimal PO pelanggan harus 0 atau lebih (Rupiah)']);
      for (const [k, lo, hi, msg] of ranges) {
        if (b[k] === undefined) continue;
        const x = Number(b[k]);
        if (b[k] === '' || b[k] === null || !Number.isInteger(x) || x < lo || x > hi) fail(msg);
        b[k] = x;
      }
      if (b.blockDelivery !== undefined && typeof b.blockDelivery !== 'boolean')
        fail('Tahan surat jalan harus ya atau tidak');
    }
    if (key === 'po_terms' && b.dpPercent !== undefined) {
      const x = Number(b.dpPercent);
      if (!(x >= 0 && x <= 100)) fail('Persen uang muka principal harus 0 sampai 100');
    }
    return this.settings.set(key, b);
  }

  @Post('logo')
  @Perm('perusahaan', 'write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async logo(@CurrentUser() u: AuthUser, @UploadedFile() f: Express.Multer.File) {
    if (!f || !/^image\/(png|jpe?g)$/.test(f.mimetype)) fail('Logo harus berupa gambar PNG atau JPG');
    const a = await this.files.save(f.buffer, f.originalname, f.mimetype, 'company', 1, u.id);
    const c = await this.settings.get('company');
    return this.settings.set('company', { ...c, logoAttachmentId: a.id });
  }
  @Public()
  @Get('logo')
  async getLogo(@Res() res: Response) {
    const c = await this.settings.get('company');
    if (!c.logoAttachmentId) return res.status(404).send();
    const f = await this.files.get(c.logoAttachmentId);
    res.set({ 'Content-Type': f.meta.mimetype, 'Cache-Control': 'max-age=300' }).send(f.buffer);
  }

  // pratinjau nomor berikutnya setiap kode dokumen
  @Get('sequences/preview')
  @Perm('pengaturan', 'read')
  async seq() {
    const d = today();
    const out: any = {};
    for (const c of ['PN', 'SO', 'PO', 'PI', 'DO', 'INV', 'BILL', 'BNK', 'KAS', 'UMM', 'MISC', 'SP', 'BA', 'BC', 'LM'])
      out[c] = await this.numbering.peek(c, d);
    return out;
  }
}
