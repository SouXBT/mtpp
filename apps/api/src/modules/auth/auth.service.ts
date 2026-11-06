import { Injectable } from '@nestjs/common';
import { Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DB, Db } from '../../db/db.module';
import { AuthUser, clearAuthCache } from '../../shared/auth';
import { REPORTS_BY_GROUP } from '../../shared/menus';
import { FilesService } from '../../shared/files.service';
import { fail, must } from '../../shared/util';

// Login, profil, kata sandi, dan tanda tangan pengguna (fitur A.a dan A.j)
@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private db: Db,
    private jwt: JwtService,
    private files: FilesService,
  ) {}

  // akun contoh hanya ditampilkan pada halaman login bila data contoh aktif
  config() {
    return { demo: process.env.SEED_DEMO !== 'false' };
  }

  async login(b: { login: string; password: string }) {
    const u = await this.db.users.findFirst({ where: { login: (b.login || '').trim().toLowerCase() } });
    if (!u || !u.active || !(await bcrypt.compare(b.password || '', u.password)))
      throw new UnauthorizedException('Email atau kata sandi salah');
    await this.db.users.updateMany({ where: { id: u.id }, data: { loginDate: new Date() } });
    return { token: await this.jwt.signAsync({ sub: u.id }) };
  }

  async me(user: AuthUser) {
    const p = await this.db.partners.findFirst({ where: { id: user.partnerId } });
    const u = await this.db.users.findFirst({ where: { id: user.id } });
    return {
      ...user,
      email: p?.email,
      phone: p?.phone,
      signatureId: u?.signatureId,
      reports: REPORTS_BY_GROUP[user.group] || [],
    };
  }

  async profile(user: AuthUser, b: { name?: string; email?: string; phone?: string }) {
    if (b.name !== undefined && !b.name.trim()) fail('Nama wajib diisi');
    await this.db.partners.updateMany({
      where: { id: user.partnerId },
      data: { name: b.name, email: b.email, phone: b.phone },
    });
    clearAuthCache();
    return { ok: true };
  }

  async password(user: AuthUser, b: { old: string; password: string; confirm: string }) {
    const u = must(await this.db.users.findFirst({ where: { id: user.id } }), 'Pengguna');
    if (!(await bcrypt.compare(b.old || '', u.password))) fail('Kata sandi lama salah');
    if ((b.password || '').length < 8) fail('Kata sandi baru minimal 8 karakter');
    if (b.password !== b.confirm) fail('Konfirmasi kata sandi tidak sama');
    await this.db.users.updateMany({ where: { id: user.id }, data: { password: await bcrypt.hash(b.password, 10) } });
    return { ok: true };
  }

  async signature(user: AuthUser, file: Express.Multer.File) {
    if (!file) fail('File tanda tangan wajib diunggah');
    const a = await this.files.save(file.buffer, file.originalname, file.mimetype, 'users', user.id, user.id);
    await this.db.users.updateMany({ where: { id: user.id }, data: { signatureId: a.id } });
    return a;
  }
}
