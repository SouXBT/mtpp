import { Body, Controller, Get, Inject, Module, Param, ParseIntPipe, Post, Query, ForbiddenException, Global } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser, CurrentUser, Perm, Public } from '../../common/auth';
import { EmailService } from './email.service';

@Controller()
export class EmailController {
  constructor(@Inject(DB) private db: Db, private email: EmailService) {}

  // daftar email keluar (fitur status pengiriman email)
  @Get('emails') @Perm('email', 'read')
  list(@Query() q: any) {
    const w: any[] = [];
    if (q.state) w.push({ state: q.state });
    if (q.q) w.push({ OR: [{ documentName: { contains: `${q.q}`, mode: 'insensitive' } }, { emailTo: { contains: `${q.q}`, mode: 'insensitive' } }, { subject: { contains: `${q.q}`, mode: 'insensitive' } }] });
    if (q.today === 'true') w.push({ sentAt: { gte: new Date(new Date().toDateString()) } });
    return this.db.emailLogs.findMany({ where: w.length ? { AND: w } : undefined, orderBy: { id: 'desc' }, take: 500 });
  }

  @Post('emails/:id/resend')
  async resend(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: { to?: string }) {
    if (!u.perms.email?.write && !u.perms.email?.read) throw new ForbiddenException('Anda tidak memiliki akses');
    return this.email.resend(id, b.to, u.id);
  }

  // webhook Brevo: token rahasia pada URL (Brevo tidak menandatangani payload)
  @Public() @Post('email/webhook/:token')
  async webhook(@Param('token') token: string, @Body() body: any) {
    if (!process.env.WEBHOOK_TOKEN || token !== process.env.WEBHOOK_TOKEN) throw new ForbiddenException('permintaan tidak sah');
    const items = Array.isArray(body) ? body : [body];
    for (const it of items) await this.email.webhook(it);
    return { ok: true };
  }
}

@Global()
@Module({ controllers: [EmailController], providers: [EmailService], exports: [EmailService] })
export class EmailModule {}
