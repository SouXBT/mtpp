import { Body, Controller, Get, Inject, Module, Patch, Post, UnauthorizedException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DB, Db } from '../../db/db.module';
import { AuthUser, CurrentUser, Public, clearAuthCache } from '../../common/auth';
import { REPORTS_BY_GROUP } from '../../common/menus';
import { FilesService } from '../../common/files.service';
import { fail } from '../../common/util';

// Login, profil, kata sandi, dan tanda tangan pengguna (fitur A.a dan A.j)
@Controller('auth')
export class AuthController {
  constructor(@Inject(DB) private db: Db, private jwt: JwtService, private files: FilesService) {}

  // akun contoh hanya ditampilkan pada halaman login bila data contoh aktif
  @Public() @Get('config') config() { return { demo: process.env.SEED_DEMO !== 'false' }; }

  @Public() @Post('login')
  async login(@Body() b: { login: string; password: string }) {
    const u = await this.db.users.findFirst({ where: { login: (b.login || '').trim().toLowerCase() } });
    if (!u || !u.active || !(await bcrypt.compare(b.password || '', u.password))) throw new UnauthorizedException('Email atau kata sandi salah');
    await this.db.users.updateMany({ where: { id: u.id }, data: { loginDate: new Date() } });
    return { token: await this.jwt.signAsync({ sub: u.id }) };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const p = await this.db.partners.findFirst({ where: { id: user.partnerId } });
    const u = await this.db.users.findFirst({ where: { id: user.id } });
    return { ...user, email: p?.email, phone: p?.phone, signatureId: u?.signatureId, reports: REPORTS_BY_GROUP[user.group] || [] };
  }

  @Patch('profile')
  async profile(@CurrentUser() user: AuthUser, @Body() b: { name?: string; email?: string; phone?: string }) {
    if (b.name !== undefined && !b.name.trim()) fail('Nama wajib diisi');
    await this.db.partners.updateMany({ where: { id: user.partnerId }, data: { name: b.name, email: b.email, phone: b.phone } });
    clearAuthCache();
    return { ok: true };
  }

  @Post('password')
  async password(@CurrentUser() user: AuthUser, @Body() b: { old: string; password: string; confirm: string }) {
    const u = await this.db.users.findFirst({ where: { id: user.id } });
    if (!(await bcrypt.compare(b.old || '', u.password))) fail('Kata sandi lama salah');
    if ((b.password || '').length < 8) fail('Kata sandi baru minimal 8 karakter');
    if (b.password !== b.confirm) fail('Konfirmasi kata sandi tidak sama');
    await this.db.users.updateMany({ where: { id: user.id }, data: { password: await bcrypt.hash(b.password, 10) } });
    return { ok: true };
  }

  @Post('signature') @UseInterceptors(FileInterceptor('file'))
  async signature(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) fail('File tanda tangan wajib diunggah');
    const a = await this.files.save(file.buffer, file.originalname, file.mimetype, 'users', user.id, user.id);
    await this.db.users.updateMany({ where: { id: user.id }, data: { signatureId: a.id } });
    return a;
  }
}

@Module({ controllers: [AuthController] })
export class AuthModule {}
