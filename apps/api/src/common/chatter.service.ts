import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../db/db.module';

export interface Change { field: string; old: any; new: any }

// Catatan internal dan riwayat perubahan pada setiap dokumen (messages + change_logs)
@Injectable()
export class ChatterService {
  constructor(@Inject(DB) private db: Db) {}

  async log(model: string, resId: number, authorId: number | undefined, body: string, changes: Change[] = [], tx: any = this.db) {
    const m = await tx.messages.create({ data: { model, resId, authorId, body, messageType: 'log' } });
    if (changes.length) {
      await tx.changeLogs.createMany({ data: changes.map((c) => {
        const isNum = typeof c.old === 'number' || typeof c.new === 'number';
        return {
          messageId: m.id, field: c.field,
          oldValueChar: isNum ? null : (c.old == null ? null : String(c.old)),
          newValueChar: isNum ? null : (c.new == null ? null : String(c.new)),
          oldValueFloat: isNum ? Number(c.old ?? 0) : null,
          newValueFloat: isNum ? Number(c.new ?? 0) : null,
        };
      }) });
    }
    return m;
  }

  note(model: string, resId: number, authorId: number, body: string) {
    return this.db.messages.createManyAndReturn({ data: [{ model, resId, authorId, body, messageType: 'note' }] });
  }

  diff(before: any, after: any, fields: { key: string; label: string }[]): Change[] {
    const out: Change[] = [];
    for (const f of fields) {
      const a = before?.[f.key], b = after?.[f.key];
      if (b !== undefined && String(a ?? '') !== String(b ?? '')) out.push({ field: f.label, old: a, new: b });
    }
    return out;
  }

  async list(model: string, resId: number) {
    const msgs = await this.db.messages.findMany({ where: { AND: [{ model: model }, { resId: resId }] }, orderBy: { id: 'desc' } });
    const ids = msgs.map((m) => m.id);
    const changes = ids.length ? await this.db.changeLogs.findMany({ where: { messageId: { in: ids } } }) : [];
    const authors = [...new Set(msgs.map((m) => m.authorId).filter(Boolean))] as number[];
    const names = authors.length ? (await this.db.users.findMany({ where: { id: { in: authors } }, include: { partner: { select: { name: true } } } })).map((u) => ({ id: u.id, name: u.partner.name })) : [];
    return msgs.map((m) => ({ ...m, author: names.find((n) => n.id === m.authorId)?.name || 'Sistem', changes: changes.filter((c) => c.messageId === m.id) }));
  }
}
