import {
  Body,
  Controller,
  ForbiddenException,
  Delete,
  Get,
  Inject,
  Module,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { DB, Db } from '../../db/db.module';
import { AuthUser, CurrentUser } from '../../shared/auth';
import { ChatterService } from '../../shared/chatter.service';
import { FilesService } from '../../shared/files.service';
import { fail, must, today } from '../../shared/util';

// model dokumen -> menu hak akses
export const MODEL_MENU: Record<string, string[]> = {
  sales_orders: ['penjualan'],
  purchase_orders: ['pengadaan'],
  stock_transfers: ['gudang'],
  journal_entries: ['penagihan', 'pengadaan', 'akuntansi'],
  partners: ['pelanggan', 'principal'],
  products: ['produk'],
};
// boleh membuka catatan/lampiran jika punya hak pada salah satu menu pemilik dokumen
function can(u: AuthUser, model: string, action: 'read' | 'write') {
  const menus = MODEL_MENU[model];
  if (!menus) fail('Model tidak dikenal');
  if (!menus.some((m) => u.perms[m]?.[action])) throw new ForbiddenException('Anda tidak memiliki akses');
}

// Catatan internal (A.f), lampiran (A.g), aktivitas terjadwal (A.h), filter favorit (A.e)
@Controller()
export class RecordsController {
  constructor(
    @Inject(DB) private db: Db,
    private chatter: ChatterService,
    private files: FilesService,
  ) {}

  @Get('records/:model/:id/messages')
  messages(@CurrentUser() u: AuthUser, @Param('model') model: string, @Param('id', ParseIntPipe) id: number) {
    can(u, model, 'read');
    return this.chatter.list(model, id);
  }
  @Post('records/:model/:id/messages')
  async note(
    @CurrentUser() u: AuthUser,
    @Param('model') model: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: { body: string },
  ) {
    can(u, model, 'read');
    if (!b.body?.trim()) fail('Catatan tidak boleh kosong');
    const [m] = await this.chatter.note(model, id, u.id, b.body.trim());
    return m;
  }

  @Get('records/:model/:id/attachments')
  attachments(@CurrentUser() u: AuthUser, @Param('model') model: string, @Param('id', ParseIntPipe) id: number) {
    can(u, model, 'read');
    return this.files.list(model, id);
  }
  @Post('records/:model/:id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() u: AuthUser,
    @Param('model') model: string,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() f: Express.Multer.File,
  ) {
    can(u, model, 'read');
    if (!f) fail('File belum dipilih');
    const a = await this.files.save(f.buffer, f.originalname, f.mimetype, model, id, u.id);
    await this.chatter.log(model, id, u.id, `Lampiran ditambahkan: ${f.originalname}`);
    return a;
  }
  @Get('attachments/:id/download')
  async download(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const f = await this.files.get(id);
    if (MODEL_MENU[f.meta.resModel]) can(u, f.meta.resModel, 'read');
    res
      .set({
        'Content-Type': f.meta.mimetype,
        'Content-Disposition': `inline; filename="${encodeURIComponent(f.meta.name)}"`,
      })
      .send(f.buffer);
  }
  @Delete('attachments/:id')
  async removeAttachment(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const f = await this.files.get(id);
    if (MODEL_MENU[f.meta.resModel]) can(u, f.meta.resModel, 'write');
    await this.files.remove(id);
    await this.chatter.log(f.meta.resModel, f.meta.resId, u.id, `Lampiran dihapus: ${f.meta.name}`);
    return { ok: true };
  }

  // ---------- aktivitas ----------
  @Get('activities')
  async activities(@CurrentUser() u: AuthUser, @Query() q: any) {
    const w: any[] = [];
    if (q.resModel && q.resId) {
      can(u, q.resModel, 'read');
      w.push({ resModel: q.resModel }, { resId: +q.resId });
    } else w.push({ userId: u.id }, { done: false });
    if (q.overdue === 'true') w.push({ dateDeadline: { lte: today() } });
    const rows: any[] = (
      await this.db.activities.findMany({
        where: { AND: w },
        include: { user: { include: { partner: { select: { name: true } } } } },
        orderBy: { dateDeadline: 'asc' },
      })
    ).map(({ user, ...a }) => ({ a, user: user.partner.name }));
    const t = today();
    return rows.map((r) => ({
      ...r.a,
      user: r.user,
      overdue: !r.a.done && r.a.dateDeadline < t,
      dueToday: !r.a.done && r.a.dateDeadline === t,
    }));
  }
  @Post('activities')
  async createActivity(@CurrentUser() u: AuthUser, @Body() b: any) {
    can(u, b.resModel, 'read');
    if (!b.summary || !b.dateDeadline) fail('Ringkasan dan tanggal jatuh tempo wajib diisi');
    const a = await this.db.activities.create({
      data: {
        resModel: b.resModel,
        resId: +b.resId,
        resName: b.resName,
        activityType: b.activityType || 'tindak lanjut',
        summary: b.summary,
        note: b.note,
        dateDeadline: b.dateDeadline,
        userId: +b.userId || u.id,
        createUid: u.id,
      },
    });
    await this.chatter.log(b.resModel, +b.resId, u.id, `Aktivitas dijadwalkan: ${b.summary} (${b.dateDeadline})`);
    return a;
  }
  @Patch('activities/:id')
  async updateActivity(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    const a = must(await this.db.activities.findFirst({ where: { id: id } }), 'Aktivitas');
    const v: any = {};
    for (const k of ['summary', 'note', 'dateDeadline', 'activityType', 'done', 'userId'])
      if (b[k] !== undefined) v[k] = b[k];
    const [r] = await this.db.activities.updateManyAndReturn({ where: { id: id }, data: v });
    if (b.done === true) await this.chatter.log(a.resModel, a.resId, u.id, `Aktivitas selesai: ${a.summary}`);
    return r;
  }
  @Delete('activities/:id')
  async removeActivity(@Param('id', ParseIntPipe) id: number) {
    await this.db.activities.deleteMany({ where: { id: id } });
    return { ok: true };
  }

  // ---------- filter favorit ----------
  @Get('saved-filters')
  filters(@CurrentUser() u: AuthUser, @Query('resource') resource: string) {
    return this.db.savedFilters.findMany({
      where: { AND: [{ userId: u.id }, { resource: resource || '' }] },
      orderBy: { name: 'asc' },
    });
  }
  @Post('saved-filters')
  async saveFilter(@CurrentUser() u: AuthUser, @Body() b: { resource: string; name: string; filter: any }) {
    if (!b.name || !b.resource) fail('Nama filter wajib diisi');
    const r = await this.db.savedFilters.create({
      data: { userId: u.id, resource: b.resource, name: b.name, filter: b.filter || {} },
    });
    return r;
  }
  @Delete('saved-filters/:id')
  async removeFilter(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.db.savedFilters.deleteMany({ where: { AND: [{ id: id }, { userId: u.id }] } });
    return { ok: true };
  }
}

@Module({ controllers: [RecordsController] })
export class RecordsModule {}
