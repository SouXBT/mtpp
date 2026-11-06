import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from '../../shared/files.service';
import * as bcrypt from 'bcryptjs';
import { DB, Db } from '../../db/db.module';
import { Perm, clearAuthCache } from '../../shared/auth';
import { MENUS } from '../../shared/menus';
import { fail, must } from '../../shared/util';

// Akun pengguna, grup, dan hak akses CRUD per grup (fitur C.a)
@Controller()
export class UsersController {
  constructor(
    @Inject(DB) private db: Db,
    private files: FilesService,
  ) {}

  @Get('menus') menus() {
    return MENUS;
  }

  @Get('users')
  @Perm('pengguna', 'read')
  async list() {
    const rows = await this.db.users.findMany({
      include: { partner: true, groups: { include: { group: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((u) => ({
      id: u.id,
      login: u.login,
      active: u.active,
      loginDate: u.loginDate,
      signatureId: u.signatureId,
      name: u.partner?.name,
      email: u.partner?.email,
      groupId: u.groups[0]?.gid,
      groupCode: u.groups[0]?.group.code,
      groupName: u.groups[0]?.group.name,
    }));
  }

  @Get('users/:id')
  @Perm('pengguna', 'read')
  async get(@Param('id', ParseIntPipe) id: number) {
    return must(
      (await this.list()).find((u) => u.id === id),
      'Pengguna',
    );
  }

  @Post('users')
  @Perm('pengguna', 'create')
  async create(@Body() b: { name: string; login: string; password: string; groupId: number }) {
    if (!b.name || !b.login || !b.groupId) fail('Nama, email login, dan grup wajib diisi');
    if ((b.password || '').length < 8) fail('Kata sandi minimal 8 karakter');
    return this.db.$transaction(async (tx) => {
      const p = await tx.partners.create({ data: { name: b.name, email: b.login.toLowerCase(), type: 'user' } });
      const u = await tx.users.create({
        data: { partnerId: p.id, login: b.login.trim().toLowerCase(), password: await bcrypt.hash(b.password, 10) },
      });
      await tx.groupUsers.create({ data: { gid: b.groupId, uid: u.id } });
      return { id: u.id };
    });
  }

  @Patch('users/:id')
  @Perm('pengguna', 'write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() b: { name?: string; login?: string; active?: boolean; groupId?: number },
  ) {
    const u = must(await this.db.users.findFirst({ where: { id: id } }), 'Pengguna');
    await this.db.$transaction(async (tx) => {
      if (b.name !== undefined) await tx.partners.updateMany({ where: { id: u.partnerId }, data: { name: b.name } });
      if (b.login !== undefined || b.active !== undefined)
        await tx.users.updateMany({
          where: { id: id },
          data: { login: b.login?.trim().toLowerCase(), active: b.active },
        });
      if (b.groupId) {
        await tx.groupUsers.deleteMany({ where: { uid: id } });
        await tx.groupUsers.create({ data: { gid: b.groupId, uid: id } });
      }
    });
    clearAuthCache();
    return { ok: true };
  }

  @Post('users/:id/reset-password')
  @Perm('pengguna', 'write')
  async reset(@Param('id', ParseIntPipe) id: number, @Body() b: { password: string }) {
    if ((b.password || '').length < 8) fail('Kata sandi minimal 8 karakter');
    await this.db.users.updateMany({ where: { id: id }, data: { password: await bcrypt.hash(b.password, 10) } });
    return { ok: true };
  }

  // Admin mengatur tanda tangan setiap pengguna yang tercetak pada dokumen (fitur data perusahaan dan tanda tangan)
  @Post('users/:id/signature')
  @Perm('pengguna', 'write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async signature(@Param('id', ParseIntPipe) id: number, @UploadedFile() f: Express.Multer.File) {
    if (!f || !/^image\/(png|jpe?g)$/.test(f.mimetype)) fail('Tanda tangan harus berupa gambar PNG atau JPG');
    const a = await this.files.save(f.buffer, f.originalname, f.mimetype, 'users', id);
    await this.db.users.updateMany({ where: { id: id }, data: { signatureId: a.id } });
    return a;
  }

  @Get('groups')
  async groups() {
    return this.db.groups.findMany({ include: { permissions: true }, orderBy: { id: 'asc' } });
  }

  @Put('groups/:id/permissions')
  @Perm('pengguna', 'write')
  async setPerms(
    @Param('id', ParseIntPipe) id: number,
    @Body() rows: { menu: string; read: boolean; create: boolean; write: boolean; delete: boolean }[],
  ) {
    await this.db.$transaction(async (tx) => {
      for (const r of rows) {
        const v = {
          groupId: id,
          menu: r.menu,
          permRead: !!r.read,
          permCreate: !!r.create,
          permWrite: !!r.write,
          permDelete: !!r.delete,
        };
        await tx.groupPermissions.upsert({
          where: { groupId_menu: { groupId: id, menu: r.menu } },
          create: v,
          update: v,
        });
      }
    });
    clearAuthCache();
    return this.groups();
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
