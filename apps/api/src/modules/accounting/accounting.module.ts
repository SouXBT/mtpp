import { Body, Controller, Get, Inject, Module, Param, ParseIntPipe, Post, Query, UploadedFile, UseInterceptors, Delete } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DB, Db } from '../../db/db.module';
import { AuthUser, CurrentUser, Perm } from '../../common/auth';
import { makeCrud } from '../../common/crud';
import { ChatterService } from '../../common/chatter.service';
import { daysBetween, fail, must, round2, today } from '../../common/util';
import { JournalService } from './journal.service';
import { Prisma } from '@prisma/client';

const sql = Prisma.sql;

// Kas (F.g), bagan akun dan jurnal (F.h), jurnal penyesuaian, buku besar, neraca saldo (F.i), rekonsiliasi bank (F.j)
@Controller()
export class AccountingController {
  constructor(@Inject(DB) private db: Db, private journal: JournalService, private chatter: ChatterService) {}

  @Get('journals') @Perm('akuntansi', 'read') journals() { return this.db.journals.findMany({ orderBy: { id: 'asc' } }); }

  @Get('journal-entries') @Perm('akuntansi', 'read')
  async entries(@Query() q: any) {
    const w: any[] = [];
    if (q.journal) w.push({ journal: { code: q.journal } });
    if (q.from) w.push({ date: { gte: q.from } });
    if (q.to) w.push({ date: { lte: q.to } });
    if (q.state) w.push({ state: q.state });
    if (q.q) w.push({ OR: [{ name: { contains: `${q.q}`, mode: 'insensitive' } }, { ref: { contains: `${q.q}`, mode: 'insensitive' } }] });
    const rows: any[] = (await this.db.journalEntries.findMany({ where: w.length ? { AND: w } : undefined, include: { journal: { select: { name: true, code: true } }, partner: { select: { name: true } } }, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 500 }))
      .map(({ journal, partner, ...e }) => ({ e, journal: journal.name, code: journal.code, partner: partner?.name ?? null }));
    return rows.map((r) => ({ ...r.e, journal: r.journal, journalCode: r.code, partner: r.partner }));
  }

  // jurnal pembayaran dan pemakaian uang muka hanya dibatalkan dari dokumennya supaya sisa tagihan tetap benar
  private async isPaymentEntry(id: number) {
    const [pay, e] = await Promise.all([this.db.payments.findFirst({ where: { moveId: id }, select: { id: true } }), this.db.journalEntries.findFirst({ where: { id: id }, include: { journal: { select: { code: true } } } })]);
    return !!pay || e?.journal?.code === 'UMM';
  }

  @Get('journal-entries/:id') @Perm('akuntansi', 'read')
  async entry(@Param('id', ParseIntPipe) id: number) {
    const e = must(await this.db.journalEntries.findFirst({ where: { id: id }, include: { journal: true, partner: true } }), 'Jurnal');
    const lines: any[] = (await this.db.journalEntryLines.findMany({ where: { moveId: id }, include: { account: { select: { code: true, name: true } } }, orderBy: { id: 'asc' } })).map(({ account, ...l }) => ({ l, code: account.code, account: account.name }));
    const reversal = await this.db.journalEntries.findFirst({ where: { reversedEntryId: id } });
    return { ...e, lines: lines.map((r) => ({ ...r.l, account: `${r.code} ${r.account}` })), reversal, paymentEntry: await this.isPaymentEntry(id) };
  }

  // jurnal umum untuk penyesuaian (dibuat draf lalu diposting)
  @Post('journal-entries') @Perm('akuntansi', 'create')
  async createEntry(@CurrentUser() u: AuthUser, @Body() b: { date?: string; ref?: string; journal?: string; lines: { accountId: number; debit?: number; credit?: number; name?: string; partnerId?: number }[]; post?: boolean }) {
    if (!b.lines?.length) fail('Jurnal belum memiliki baris');
    const e = await this.db.$transaction((tx) => this.journal.create(tx, { journal: b.journal === 'KAS' ? 'KAS' : 'MISC', date: b.date, ref: b.ref, post: !!b.post, uid: u.id, lines: b.lines }));
    return this.entry(e.id);
  }

  @Post('journal-entries/:id/post') @Perm('akuntansi', 'write')
  async post(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const e = must(await this.db.journalEntries.findFirst({ where: { id: id } }), 'Jurnal');
    if (e.moveType !== 'entry') fail('Invoice dan tagihan diposting dari menunya masing-masing');
    if (e.state !== 'draft') fail('Jurnal sudah diposting');
    await this.db.$transaction(async (tx) => { await this.journal.assertBalanced(tx, id); await tx.journalEntries.updateMany({ where: { id: id }, data: { state: 'posted' } }); });
    await this.chatter.log('journal_entries', id, u.id, 'Jurnal diposting');
    return this.entry(id);
  }

  @Delete('journal-entries/:id') @Perm('akuntansi', 'delete')
  async del(@Param('id', ParseIntPipe) id: number) {
    const e = must(await this.db.journalEntries.findFirst({ where: { id: id } }), 'Jurnal');
    if (e.state !== 'draft') fail('Jurnal yang sudah diposting hanya dapat dibatalkan melalui jurnal pembalik');
    await this.db.journalEntries.deleteMany({ where: { id: id } }); return { ok: true };
  }

  @Post('journal-entries/:id/reverse') @Perm('akuntansi', 'write')
  async reverse(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const e = must(await this.db.journalEntries.findFirst({ where: { id: id } }), 'Jurnal');
    if (e.moveType !== 'entry') fail('Invoice dan tagihan dibalik dari menunya masing-masing');
    if (await this.isPaymentEntry(id)) fail('Pembayaran dibatalkan dari menu Penagihan');
    const r = await this.db.$transaction((tx) => this.journal.reverse(tx, id, u.id));
    await this.chatter.log('journal_entries', id, u.id, `Dibalik dengan ${r.name}`);
    return this.entry(r.id);
  }

  // transaksi kas di luar pembayaran invoice dan tagihan
  @Post('cash') @Perm('akuntansi', 'create')
  async cash(@CurrentUser() u: AuthUser, @Body() b: { type: 'in' | 'out'; accountId: number; amount: number; date?: string; memo: string; partnerId?: number }) {
    const amt = round2(Number(b.amount)); if (!(amt > 0)) fail('Jumlah harus lebih dari 0'); if (!b.accountId) fail('Akun lawan wajib dipilih');
    const e = await this.db.$transaction(async (tx) => {
      const kas = await this.journal.map('cash', tx);
      return this.journal.create(tx, { journal: 'KAS', date: b.date, partnerId: b.partnerId, ref: b.memo, post: true, uid: u.id,
        lines: b.type === 'in' ? [{ accountId: kas, debit: amt, name: b.memo }, { accountId: b.accountId, credit: amt, name: b.memo }] : [{ accountId: b.accountId, debit: amt, name: b.memo }, { accountId: kas, credit: amt, name: b.memo }] });
    });
    return this.entry(e.id);
  }

  @Get('cash/balance') @Perm('akuntansi', 'read')
  async cashBalance() {
    const out: any = {};
    for (const k of ['cash', 'bank']) {
      const id = await this.journal.map(k);
      const [r]: any[] = await this.db.$queryRaw(sql`select coalesce(sum(l.debit - l.credit),0)::float as b from journal_entry_lines l join journal_entries e on e.id = l.move_id where l.account_id = ${id} and e.state = 'posted'`);
      out[k] = Number(r.b);
    }
    return out;
  }

  // buku besar: saldo awal, mutasi, saldo akhir
  @Get('ledger') @Perm('akuntansi', 'read')
  async ledger(@Query() q: any) {
    const from = q.from || today().slice(0, 8) + '01', to = q.to || today();
    const accs = await this.db.accounts.findMany({ where: q.accountId ? { id: +q.accountId } : undefined, orderBy: { code: 'asc' } });
    const out = [];
    for (const a of accs) {
      const [op]: any[] = await this.db.$queryRaw(sql`select coalesce(sum(l.debit - l.credit),0)::float as b from journal_entry_lines l join journal_entries e on e.id = l.move_id where l.account_id = ${a.id} and e.state = 'posted' and e.date < ${from}::date`);
      const lines: any[] = (await this.db.journalEntryLines.findMany({ where: { accountId: a.id, move: { state: 'posted', date: { gte: from, lte: to } } }, include: { move: { select: { id: true, date: true, name: true, ref: true } }, partner: { select: { name: true } } }, orderBy: [{ move: { date: 'asc' } }, { move: { id: 'asc' } }] }))
        .map((l) => ({ date: l.move.date, name: l.move.name, ref: l.move.ref, label: l.name, debit: l.debit, credit: l.credit, partner: l.partner?.name ?? null, moveId: l.move.id }));
      if (!q.accountId && !lines.length && !Number(op.b)) continue;
      let run = Number(op.b);
      const ls = lines.map((l) => { run = round2(run + Number(l.debit) - Number(l.credit)); return { ...l, balance: run }; });
      out.push({ account: a, opening: Number(op.b), debit: round2(lines.reduce((x, l) => x + Number(l.debit), 0)), credit: round2(lines.reduce((x, l) => x + Number(l.credit), 0)), closing: run, lines: ls });
    }
    return { from, to, accounts: out };
  }

  @Get('trial-balance') @Perm('akuntansi', 'read')
  async trial(@Query() q: any) {
    const from = q.from || today().slice(0, 8) + '01', to = q.to || today();
    const rows: any[] = await this.db.$queryRaw(sql`
      select a.id, a.code_store as code, a.name, a.account_type as type,
        coalesce(sum(case when e.date < ${from} then l.debit - l.credit end),0)::float as opening,
        coalesce(sum(case when e.date between ${from} and ${to} then l.debit end),0)::float as debit,
        coalesce(sum(case when e.date between ${from} and ${to} then l.credit end),0)::float as credit
      from accounts a left join journal_entry_lines l on l.account_id = a.id
      left join journal_entries e on e.id = l.move_id and e.state = 'posted' and e.date <= ${to}
      where (e.id is not null or l.id is null)
      group by a.id order by a.code_store`);
    const list = rows.map((r) => ({ ...r, closing: round2(r.opening + r.debit - r.credit) }));
    return { from, to, rows: list, totalDebit: round2(list.reduce((a, r) => a + r.debit, 0)), totalCredit: round2(list.reduce((a, r) => a + r.credit, 0)) };
  }

  // ===== Rekonsiliasi bank =====
  @Get('bank-statements') @Perm('akuntansi', 'read')
  async bankLines(@Query() q: any) {
    const rows: any[] = (await this.db.bankStatementLines.findMany({ where: q.reconciled ? { isReconciled: q.reconciled === 'true' } : undefined, include: { payment: { select: { name: true, partner: { select: { name: true } } } } }, orderBy: [{ date: 'desc' }, { id: 'desc' }] }))
      .map(({ payment, ...b }) => ({ b, pay: payment?.name ?? null, partner: payment?.partner?.name ?? null }));
    return rows.map((r) => ({ ...r.b, payment: r.pay, partner: r.partner }));
  }

  @Post('bank-statements/import') @Perm('akuntansi', 'create') @UseInterceptors(FileInterceptor('file'))
  async importBank(@UploadedFile() file: Express.Multer.File, @Body() b: { dateCol: string; refCol: string; amountCol?: string; debitCol?: string; creditCol?: string; dateFormat?: string }) {
    if (!file) fail('File CSV wajib diunggah');
    const rows = parseCsv(file.buffer.toString('utf8'));
    if (rows.length < 2) fail('File kosong');
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (n?: string) => (n ? head.indexOf(n.trim().toLowerCase()) : -1);
    // kolom dipetakan pengguna; jika kosong ditebak dari judul kolom
    const guess = (re: RegExp) => head.findIndex((h) => re.test(h));
    const di = b.dateCol ? col(b.dateCol) : guess(/tanggal|tgl|date/);
    const ri = b.refCol ? col(b.refCol) : guess(/keterangan|uraian|deskripsi|description|berita|ref/);
    const ai = b.amountCol ? col(b.amountCol) : b.debitCol ? -1 : guess(/^(jumlah|nilai|nominal|amount|mutasi)$/);
    const dbi = b.debitCol ? col(b.debitCol) : guess(/debit|keluar/), cri = b.creditCol ? col(b.creditCol) : guess(/kredit|credit|masuk/);
    if (di < 0 || ri < 0 || (ai < 0 && (dbi < 0 || cri < 0))) fail('Kolom tanggal, keterangan, dan nilai (atau debit dan kredit) tidak ditemukan pada baris judul');
    const bank = must(await this.db.journals.findFirst({ where: { code: 'BNK' } }), 'Jurnal bank');
    const batch = 'IMP-' + Date.now();
    const errors: any[] = []; let imported = 0, matched = 0;
    for (const [i, r] of rows.slice(1).entries()) {
      if (!r.some((c) => c.trim())) continue;
      const date = parseDate(r[di], b.dateFormat || 'DD/MM/YYYY');
      const amount = ai >= 0 ? parseAmount(r[ai]) : round2(parseAmount(r[cri]) - parseAmount(r[dbi]));
      if (!date || isNaN(amount) || !amount) { errors.push({ row: i + 2, reason: 'Tanggal atau nilai tidak terbaca' }); continue; }
      const line = await this.db.bankStatementLines.create({ data: { journalId: bank.id, date, paymentRef: r[ri] || '-', amount, importBatch: batch } });
      imported++;
      const c = await this.candidates(line.id);
      if (c.length === 1) { await this.match(line.id, { paymentId: c[0].id }); matched++; }
    }
    return { imported, matched, errors };
  }

  @Get('bank-statements/:id/candidates') @Perm('akuntansi', 'read')
  async candidates(@Param('id', ParseIntPipe) id: number) {
    const l = must(await this.db.bankStatementLines.findFirst({ where: { id: id } }), 'Baris mutasi');
    const used = (await this.db.bankStatementLines.findMany({ where: { isReconciled: true }, select: { paymentId: true } })).map((x) => x.paymentId).filter(Boolean) as number[];
    const pays: any[] = (await this.db.payments.findMany({ where: { state: { not: 'cancel' }, journal: { code: 'BNK' }, amount: Math.abs(Number(l.amount)), paymentType: Number(l.amount) > 0 ? 'inbound' : 'outbound' }, include: { partner: { select: { name: true } } } })).map(({ partner, ...p }) => ({ p, partner: partner.name }));
    return pays.filter((x) => !used.includes(x.p.id) && Math.abs(daysBetween(x.p.date, l.date)) <= 3).map((x) => ({ ...x.p, partner: x.partner }));
  }

  @Post('bank-statements/:id/match') @Perm('akuntansi', 'write')
  async match(@Param('id', ParseIntPipe) id: number, @Body() b: { paymentId: number }) {
    await this.db.bankStatementLines.updateMany({ where: { id: id }, data: { paymentId: b.paymentId, isReconciled: true } }); return { ok: true };
  }
  @Post('bank-statements/:id/unmatch') @Perm('akuntansi', 'write')
  async unmatch(@Param('id', ParseIntPipe) id: number) {
    await this.db.bankStatementLines.updateMany({ where: { id: id }, data: { paymentId: null, isReconciled: false } }); return { ok: true };
  }
}

export function parseCsv(text: string): string[][] {
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const out: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}
export function parseAmount(v: string) {
  if (v == null) return 0; let t = String(v).replace(/[^\d,.\-]/g, '');
  if (!t) return 0;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
  return round2(parseFloat(t));
}
export function parseDate(v: string, fmt: string) {
  if (!v) return null; const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  let [, a, b, y] = m; if (y.length === 2) y = '20' + y;
  const [d, mo] = fmt.startsWith('MM') ? [b, a] : [a, b];
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const accountsCrud = makeCrud({ path: 'accounts', menu: 'akuntansi', table: 'accounts', search: ['code', 'name'], order: 'code', writable: ['code', 'name', 'accountType'], required: ['code', 'name', 'accountType'] });

@Module({ controllers: [AccountingController, accountsCrud], providers: [JournalService], exports: [JournalService] })
export class AccountingModule {}
