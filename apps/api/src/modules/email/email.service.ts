import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { FilesService } from '../../common/files.service';
import { SettingsService } from '../../common/settings.service';
import { must } from '../../common/util';

export interface SendInput {
  model: string; resId: number; documentName: string; to: string; subject: string; html: string;
  pdf?: { name: string; buffer: Buffer }; attachmentId?: number;
}

// Pemetaan event Brevo ke status email di sistem (rencana bagian 9)
export const EVENT_MAP: Record<string, string | null> = {
  request: null, deferred: null, delivered: 'terkirim',
  hard_bounce: 'ditolak', invalid_email: 'ditolak', blocked: 'ditolak',
  soft_bounce: 'gagal', error: 'gagal',
};

// Pengiriman email dan pencatatan status (Algoritma 3.4)
@Injectable()
export class EmailService {
  private log = new Logger('Email');
  constructor(@Inject(DB) private db: Db, private files: FilesService, private settings: SettingsService) {}

  async send(i: SendInput, uid?: number) {
    let attachmentId = i.attachmentId;
    if (i.pdf && !attachmentId) attachmentId = (await this.files.save(i.pdf.buffer, i.pdf.name, 'application/pdf', i.model, i.resId, uid)).id;
    const row = await this.db.emailLogs.create({ data: { model: i.model, resId: i.resId, documentName: i.documentName, emailTo: i.to, subject: i.subject, state: 'diproses', attachmentId, createUid: uid } });
    const key = process.env.BREVO_API_KEY;
    if (!key) {
      // mode simulasi: tanpa API key tidak ada email yang dikirim, statusnya jujur "simulasi"
      await this.db.emailLogs.updateMany({ where: { id: row.id }, data: { mtppProviderRef: 'simulasi-' + row.id } });
      setTimeout(() => this.db.emailLogs.updateMany({ where: { id: row.id }, data: { state: 'simulasi', mtppDeliveryStatus: 'simulasi', statusAt: new Date() } }).catch(() => undefined), 1500);
      return { ...row, state: 'diproses' };
    }
    try {
      const c = await this.settings.get('company');
      const body: any = {
        sender: { email: process.env.EMAIL_FROM || 'noreply@mtpp.co.id', name: process.env.EMAIL_FROM_NAME || c.name },
        to: i.to.split(',').map((e) => ({ email: e.trim() })), subject: i.subject, htmlContent: i.html,
      };
      if (attachmentId) { const f = await this.files.get(attachmentId); body.attachment = [{ name: f.meta.name, content: f.buffer.toString('base64') }]; }
      const res = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      await this.db.emailLogs.updateMany({ where: { id: row.id }, data: { mtppProviderRef: j.messageId } });
      return { ...row, mtppProviderRef: j.messageId };
    } catch (e: any) {
      this.log.warn('Gagal kirim: ' + e.message);
      await this.db.emailLogs.updateMany({ where: { id: row.id }, data: { state: 'gagal', failureReason: e.message, statusAt: new Date() } });
      return { ...row, state: 'gagal', failureReason: e.message };
    }
  }

  async webhook(data: any) {
    const ref = data['message-id'] || data.messageId;
    const st = EVENT_MAP[data.event];
    if (!ref || st === undefined || st === null) return { ignored: true };
    const e = await this.db.emailLogs.findFirst({ where: { mtppProviderRef: ref } });
    if (!e) return { ignored: true };
    await this.db.emailLogs.updateMany({ where: { id: e.id }, data: { state: st, mtppDeliveryStatus: data.event, failureReason: data.reason || null, statusAt: new Date() } });
    return { ok: true };
  }

  async resend(id: number, to: string | undefined, uid: number) {
    const e = must(await this.db.emailLogs.findFirst({ where: { id: id } }), 'Email');
    return this.send({ model: e.model, resId: e.resId, documentName: e.documentName, to: to || e.emailTo, subject: e.subject, html: `<p>${e.subject}</p><p>Dokumen terlampir.</p>`, attachmentId: e.attachmentId }, uid);
  }

  async lastStatus(model: string, resId: number) {
    const rows = await this.db.emailLogs.findMany({ where: { resId: resId } });
    const r = rows.filter((x) => x.model === model).sort((a, b) => b.id - a.id)[0];
    return r ? { state: r.state, to: r.emailTo, at: r.sentAt, reason: r.failureReason } : null;
  }

  html(title: string, number: string, partnerName: string, extra = '') {
    return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2E2A27">
      <p>Yth. ${partnerName},</p>
      <p>Bersama email ini kami lampirkan <b>${title} ${number}</b>.${extra}</p>
      <p>Apabila ada pertanyaan, silakan balas email ini.</p>
      <p>Hormat kami,<br/>PT Mentari Timur Prima Perkasa</p></div>`;
  }
}
