import { Body, Controller, Get, Inject, Param, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { DB, Db } from '../../db/db.module';
import { AuthUser, CurrentUser, Perm, Public, checkPerm } from '../../shared/auth';
import { DEFAULT_SETTINGS, SettingsService } from '../../shared/settings.service';
import { FilesService } from '../../shared/files.service';
import { NumberingService } from '../../shared/numbering.service';
import { fail, today } from '../../shared/util';

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
    if (!DEFAULT_SETTINGS[key]) fail('Kunci pengaturan tidak dikenal');
    checkPerm(u, key === 'company' ? 'perusahaan' : key === 'accounts' ? 'akuntansi' : 'pengaturan', 'write');
    if (key === 'tax') {
      const r = Number(b.rate),
        n = Number(b.dppNum),
        d = Number(b.dppDen);
      if (!(r >= 0 && r <= 100) || !(n > 0) || !(d > 0)) fail('Tarif PPN atau DPP tidak valid');
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
