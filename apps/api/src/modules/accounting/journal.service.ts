import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { NumberingService } from '../../shared/numbering.service';
import { SettingsService } from '../../shared/settings.service';
import { fail, must, round2, today } from '../../shared/util';
import { lockRow } from '../../shared/lock';

export interface JLine {
  key?: string;
  account?: string;
  accountId?: number;
  debit?: number;
  credit?: number;
  name?: string;
  partnerId?: number | null;
  productId?: number | null;
  quantity?: number;
  priceUnit?: number;
  displayType?: string;
  dateMaturity?: string | null;
  saleLineId?: number | null;
  purchaseLineId?: number | null;
}
export interface JIn {
  journal: string;
  date?: string;
  partnerId?: number | null;
  moveType?: string;
  ref?: string;
  narration?: string;
  lines: JLine[];
  saleId?: number | null;
  purchaseId?: number | null;
  invoiceDate?: string;
  due?: string;
  post?: boolean;
  uid?: number;
  amounts?: { untaxed: number; tax: number; total: number };
  invoiceOrigin?: string;
  // saldo awal dari spreadsheet: saldo piutang/utang total tanpa rincian partner (rinciannya lewat impor invoice terbuka)
  opening?: boolean;
}

// Jurnal otomatis dengan debit = kredit (fitur F.h) dan jurnal pembalik (F.i)
@Injectable()
export class JournalService {
  constructor(
    @Inject(DB) private db: Db,
    private numbering: NumberingService,
    private settings: SettingsService,
  ) {}

  async accId(code: string, tx: any = this.db) {
    // tanpa kode, Prisma mengabaikan filter dan mengembalikan akun pertama: tolak lebih dulu
    if (!code) fail('Setiap baris jurnal wajib memiliki akun');
    const a = await tx.accounts.findFirst({ where: { code: code } });
    return must(a, `Akun ${code}`).id;
  }
  async map(key: string, tx: any = this.db) {
    const m = await this.settings.get('accounts');
    return this.accId(m[key], tx);
  }
  async journal(code: string, tx: any = this.db) {
    return must(await tx.journals.findFirst({ where: { code: code } }), `Jurnal ${code}`);
  }

  // Tanggal kunci periode (setara lock date Odoo): jurnal bertanggal sampai tanggal ini tidak dapat dibuat,
  // diposting, atau dibalik, sehingga laporan periode yang sudah ditutup tidak berubah.
  async lockDate(tx: any = this.db): Promise<string | null> {
    const r = await tx.settings.findFirst({ where: { key: 'lock_date' } });
    return (r?.value as any)?.date || null;
  }
  async assertOpen(date: string, tx: any = this.db) {
    const lock = await this.lockDate(tx);
    if (lock && String(date) <= lock)
      fail(`Periode akuntansi sampai ${lock} sudah dikunci; gunakan tanggal setelahnya`);
  }

  // Pemeriksaan baris seperti account.move.line Odoo: debit dan kredit tidak boleh terisi bersamaan,
  // akun harus aktif, dan baris piutang atau utang wajib memiliki partner.
  private async checkLines(
    tx: any,
    lines: { accountId: number; debit: number; credit: number; partnerId: number | null }[],
    opening = false,
  ) {
    const ids = [...new Set(lines.map((l) => l.accountId))];
    const accs = await tx.accounts.findMany({ where: { id: { in: ids } } });
    const m = await this.settings.get('accounts');
    const partnerAccs = await tx.accounts.findMany({ where: { code: { in: [m.receivable, m.payable] } } });
    for (const l of lines) {
      const a = accs.find((x: any) => x.id === l.accountId);
      if (!a) fail('Akun tidak ditemukan');
      if (a.active === false) fail(`Akun ${a.code} ${a.name} sudah diarsipkan dan tidak dapat dipakai`);
      if (l.debit > 0 && l.credit > 0) fail(`Baris akun ${a.code} tidak boleh berisi debit dan kredit sekaligus`);
      if (!opening && !l.partnerId && partnerAccs.some((x: any) => x.id === a.id))
        fail(`Baris ${a.code} ${a.name} wajib memiliki pelanggan atau principal`);
    }
  }

  async create(tx: any, j: JIn) {
    const date = j.date || today();
    await this.assertOpen(date, tx);
    if (j.invoiceDate && j.due && j.due < j.invoiceDate) fail('Jatuh tempo tidak boleh sebelum tanggal dokumen');
    const jr = await this.journal(j.journal, tx);
    const lines = [];
    for (const l of j.lines) {
      const accountId = l.accountId || (l.key ? await this.map(l.key, tx) : await this.accId(l.account!, tx));
      const debit = round2(Number(l.debit || 0)),
        credit = round2(Number(l.credit || 0));
      if (!Number.isFinite(debit) || !Number.isFinite(credit)) fail('Debit dan kredit harus berupa angka');
      if (Math.abs(debit) > 1e14 || Math.abs(credit) > 1e14) fail('Nilai debit atau kredit di luar batas');
      if (debit < 0 || credit < 0) fail('Debit dan kredit tidak boleh minus');
      lines.push({
        accountId,
        debit,
        credit,
        balance: round2(debit - credit),
        name: l.name,
        partnerId: l.partnerId ?? j.partnerId ?? null,
        productId: l.productId ?? null,
        quantity: l.quantity || 0,
        priceUnit: l.priceUnit || 0,
        displayType: l.displayType || 'line',
        date,
        dateMaturity: l.dateMaturity || null,
        saleLineId: l.saleLineId || null,
        purchaseLineId: l.purchaseLineId || null,
      });
    }
    const dr = round2(lines.reduce((a, l) => a + l.debit, 0)),
      cr = round2(lines.reduce((a, l) => a + l.credit, 0));
    if (j.post && Math.abs(dr - cr) > 0.009) fail(`Jurnal tidak seimbang (debit ${dr}, kredit ${cr})`);
    if (j.post && !lines.length) fail('Jurnal belum memiliki baris');
    if (j.post && (j.moveType || 'entry') === 'entry' && dr <= 0) fail('Jurnal bernilai nol tidak dapat diposting');
    await this.checkLines(tx, lines, !!j.opening);
    const name = await this.numbering.next(tx, jr.code, date);
    const am = j.amounts || { untaxed: dr, tax: 0, total: dr };
    const e = await tx.journalEntries.create({
      data: {
        name,
        journalId: jr.id,
        partnerId: j.partnerId || null,
        moveType: j.moveType || 'entry',
        date,
        invoiceDate: j.invoiceDate || null,
        invoiceDateDue: j.due || null,
        state: j.post ? 'posted' : 'draft',
        amountUntaxed: am.untaxed,
        amountTax: am.tax,
        amountTotal: am.total,
        amountResidual: ['out_invoice', 'in_invoice', 'out_refund', 'in_refund'].includes(j.moveType || '')
          ? am.total
          : 0,
        saleId: j.saleId || null,
        purchaseId: j.purchaseId || null,
        ref: j.ref,
        narration: j.narration,
        invoiceOrigin: j.invoiceOrigin,
        createUid: j.uid,
        writeUid: j.uid,
      },
    });
    if (lines.length) await tx.journalEntryLines.createMany({ data: lines.map((l) => ({ ...l, moveId: e.id })) });
    return e;
  }

  // dipanggil sebelum posting dokumen draf
  async assertBalanced(tx: any, id: number) {
    const e = await tx.journalEntries.findFirst({ where: { id } });
    if (e) await this.assertOpen(e.date, tx);
    const lines = await tx.journalEntryLines.findMany({ where: { moveId: id } });
    const dr = round2(lines.reduce((a: number, l: any) => a + Number(l.debit), 0)),
      cr = round2(lines.reduce((a: number, l: any) => a + Number(l.credit), 0));
    if (!lines.length) fail('Jurnal belum memiliki baris');
    if (Math.abs(dr - cr) > 0.009) fail(`Jurnal tidak seimbang (debit ${dr}, kredit ${cr})`);
    if (e?.moveType === 'entry' && dr <= 0) fail('Jurnal bernilai nol tidak dapat diposting');
    await this.checkLines(
      tx,
      lines.map((l: any) => ({
        accountId: l.accountId,
        debit: Number(l.debit),
        credit: Number(l.credit),
        partnerId: l.partnerId,
      })),
    );
    return lines;
  }

  async reverse(tx: any, id: number, uid: number, moveType?: string, journal?: string) {
    // dikunci: pembalikan bersamaan atas jurnal yang sama hanya diproses sekali
    await lockRow(tx, 'journal_entries', id);
    const e = must(await tx.journalEntries.findFirst({ where: { id: id }, include: { journal: true } }), 'Jurnal');
    if (e.state !== 'posted') fail('Hanya jurnal yang sudah diposting yang dapat dibalik');
    if (e.reversedEntryId) fail('Jurnal ini adalah jurnal pembalik');
    // satu jurnal hanya boleh dibalik sekali
    if (e.paymentState === 'reversed' || (await tx.journalEntries.findFirst({ where: { reversedEntryId: id } })))
      fail(`Jurnal ${e.name} sudah dibalik`);
    const lines = await tx.journalEntryLines.findMany({ where: { moveId: id } });
    const r = await this.create(tx, {
      journal: journal || e.journal.code,
      date: today(),
      partnerId: e.partnerId,
      moveType: moveType || e.moveType,
      ref: `Pembalik ${e.name}`,
      post: true,
      uid,
      saleId: e.saleId,
      purchaseId: e.purchaseId,
      amounts: { untaxed: Number(e.amountUntaxed), tax: Number(e.amountTax), total: Number(e.amountTotal) },
      lines: lines.map((l: any) => ({
        accountId: l.accountId,
        debit: Number(l.credit),
        credit: Number(l.debit),
        name: l.name,
        partnerId: l.partnerId,
        productId: l.productId,
        quantity: Number(l.quantity),
        priceUnit: Number(l.priceUnit),
        displayType: l.displayType,
      })),
    });
    await tx.journalEntries.updateMany({
      where: { id: r.id },
      data: { reversedEntryId: id, amountResidual: 0, paymentState: 'paid' },
    });
    await tx.journalEntries.updateMany({ where: { id: id }, data: { paymentState: 'reversed', amountResidual: 0 } });
    return r;
  }
}
