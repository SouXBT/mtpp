import { Body, Controller, Delete, Get, Inject, Module, Param, ParseIntPipe, Patch, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { DB, Db } from '../../db/db.module';
import { AuthUser, CurrentUser, Perm, Public, checkPerm } from '../../common/auth';
import { DEFAULT_SETTINGS, SettingsService } from '../../common/settings.service';
import { FilesService } from '../../common/files.service';
import { NumberingService } from '../../common/numbering.service';
import { fail, today } from '../../common/util';

export const hashKey = (k: string) => createHash('sha256').update(k).digest('hex');

// Pengaturan PPN, syarat dokumen, data perusahaan (C.f, C.j), API key (REST API)
@Controller('settings')
export class SettingsController {
  constructor(@Inject(DB) private db: Db, private settings: SettingsService, private files: FilesService, private numbering: NumberingService) {}

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
      const r = Number(b.rate), n = Number(b.dppNum), d = Number(b.dppDen);
      if (!(r >= 0 && r <= 100) || !(n > 0) || !(d > 0)) fail('Tarif PPN atau DPP tidak valid');
    }
    return this.settings.set(key, b);
  }

  @Post('logo') @Perm('perusahaan', 'write') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async logo(@CurrentUser() u: AuthUser, @UploadedFile() f: Express.Multer.File) {
    if (!f || !/^image\/(png|jpe?g)$/.test(f.mimetype)) fail('Logo harus berupa gambar PNG atau JPG');
    const a = await this.files.save(f.buffer, f.originalname, f.mimetype, 'company', 1, u.id);
    const c = await this.settings.get('company');
    return this.settings.set('company', { ...c, logoAttachmentId: a.id });
  }
  @Public() @Get('logo')
  async getLogo(@Res() res: Response) {
    const c = await this.settings.get('company');
    if (!c.logoAttachmentId) return res.status(404).send();
    const f = await this.files.get(c.logoAttachmentId);
    res.set({ 'Content-Type': f.meta.mimetype, 'Cache-Control': 'max-age=300' }).send(f.buffer);
  }

  // pratinjau nomor berikutnya setiap kode dokumen
  @Get('sequences/preview') @Perm('pengaturan', 'read')
  async seq() {
    const d = today(); const out: any = {};
    for (const c of ['PN', 'SO', 'PO', 'PI', 'DO', 'INV', 'BILL', 'BNK', 'KAS', 'UMM', 'MISC', 'SP', 'BA', 'BC', 'LM']) out[c] = await this.numbering.peek(c, d);
    return out;
  }
}

@Controller('api-keys')
export class ApiKeysController {
  constructor(@Inject(DB) private db: Db) {}
  @Get() @Perm('pengaturan', 'read')
  list() { return this.db.apiKeys.findMany({ select: { id: true, name: true, prefix: true, active: true, lastUsed: true, createDate: true }, orderBy: { id: 'desc' } }); }
  // kunci asli hanya ditampilkan sekali saat dibuat; database menyimpan hash-nya
  @Post() @Perm('pengaturan', 'create')
  async create(@Body() b: { name: string }) {
    if (!b.name) fail('Nama aplikasi wajib diisi');
    const key = 'mtpp_' + randomBytes(24).toString('hex');
    const r = await this.db.apiKeys.create({ data: { name: b.name, keyHash: hashKey(key), prefix: key.slice(0, 10) } });
    return { id: r.id, name: r.name, key };
  }
  @Patch(':id') @Perm('pengaturan', 'write')
  async toggle(@Param('id', ParseIntPipe) id: number, @Body() b: { active: boolean }) {
    const [r] = await this.db.apiKeys.updateManyAndReturn({ where: { id: id }, data: { active: !!b.active } }); return { id: r.id, active: r.active };
  }
  @Delete(':id') @Perm('pengaturan', 'delete')
  async remove(@Param('id', ParseIntPipe) id: number) { await this.db.apiKeys.deleteMany({ where: { id: id } }); return { ok: true }; }
}

@Module({ controllers: [SettingsController, ApiKeysController] })
export class SettingsModule {}
