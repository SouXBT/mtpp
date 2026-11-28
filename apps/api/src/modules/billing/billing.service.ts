import { nowDate } from '../../shared/clock';
import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser, dataRule } from '../../shared/auth';
import { SettingsService } from '../../shared/settings.service';
import { ChatterService } from '../../shared/chatter.service';
import { PdfService } from '../../shared/pdf.service';
import { graduateCustomer, purchaseAdvances, refreshPurchase, refreshSale, salePayments } from '../../shared/status';
import {
  addDays,
  fail,
  must,
  idr,
  num,
  round2,
  rupiah,
  terbilang,
  terbilangEn,
  tglIndo,
  today,
} from '../../shared/util';
import {
  DUE_STATE,
  allocate,
  collectionSettings,
  graceOf,
  planError,
  receivableSlices,
  summarize,
  paidAfterPlan,
} from '../../shared/collection';
import { JournalService } from '../accounting/journal.service';
import { lockKey, lockRow } from '../../shared/lock';
import { EmailService } from '../email/email.service';
import { Prisma } from '@prisma/client';

const sql = Prisma.sql;

const MODEL = 'journal_entries';
// keterangan jurnal UMM; advanceUses membacanya kembali untuk mengetahui uang muka mana yang dipakai invoice
const REF_USE = 'Pemakaian uang muka ',
  REF_ROUND = 'Pembulatan uang muka ',
  REF_ROUND_AR = 'Pembulatan piutang';
export const PAY_STATE: Record<string, string> = {
  not_paid: 'Belum dibayar',
  partial: 'Sebagian',
  paid: 'Lunas',
  reversed: 'Dibalik',
};

// Invoice (F.e), pembayaran dan piutang (F.f), tagihan dan pembayaran principal (F.c), uang muka pelanggan baru
@Injectable()
export class BillingService {
  constructor(
    @Inject(DB) private db: Db,
    private settings: SettingsService,
    private chatter: ChatterService,
    private pdf: PdfService,
    private journal: JournalService,
    private email: EmailService,
  ) {}

  async list(q: any, u?: AuthUser) {
    const rule = u && dataRule(u, 'journal_entries');
    const w: any[] = [
      ...(rule ? [rule] : []),
      { moveType: { in: q.type === 'bill' ? ['in_invoice', 'in_refund'] : ['out_invoice', 'out_refund'] } },
    ];
    if (q.state) w.push({ state: q.state });
    if (q.paymentState) w.push({ paymentState: { in: String(q.paymentState).split(',') } });
    if (q.partnerId) w.push({ partnerId: +q.partnerId });
    // jatuh tempo efektif bergantung pada cicilan, jadi filter lewat jatuh tempo diterapkan setelah status dihitung
    if (q.overdue === 'true' || q.dueState) w.push({ AND: [{ amountResidual: { gt: 0 } }, { state: 'posted' }] });
    if (q.q)
      w.push({
        OR: [
          { name: { contains: `${q.q}`, mode: 'insensitive' } },
          { partner: { name: { contains: `${q.q}`, mode: 'insensitive' } } },
          { ref: { contains: `${q.q}`, mode: 'insensitive' } },
          { invoiceOrigin: { contains: `${q.q}`, mode: 'insensitive' } },
        ],
      });
    const rows: any[] = (
      await this.db.journalEntries.findMany({
        where: { AND: w },
        include: { partner: { select: { name: true } } },
        orderBy: { id: 'desc' },
        take: 500,
      })
    ).map(({ partner, ...e }) => ({ e, partner: partner?.name ?? null }));
    const t = today();
    const open = rows.filter((r) => r.e.moveType === 'out_invoice' && r.e.state === 'posted').map((r) => r.e.id);
    const sum = open.length ? summarize(await receivableSlices(this.db, { invoiceIds: open }), t) : new Map();
    const out = rows.map((r) => {
      const s = sum.get(r.e.id);
      return {
        ...r.e,
        partner: r.partner,
        paymentLabel: PAY_STATE[r.e.paymentState],
        dueDate: s?.due ?? r.e.invoiceDateDue,
        dueState: s?.state ?? null,
        dueLabel: s ? DUE_STATE[s.state] : null,
        graceUntil: s?.graceUntil ?? null,
        overdue: s
          ? s.overdue
          : r.e.state === 'posted' && Number(r.e.amountResidual) > 0 && !!r.e.invoiceDateDue && r.e.invoiceDateDue < t,
      };
    });
    return out.filter(
      (x) => (q.overdue !== 'true' || x.overdue) && (!q.dueState || String(q.dueState).split(',').includes(x.dueState)),
    );
  }

  // Semua perubahan uang atas satu SO (pembayaran invoice, uang muka, posting, pembalik, cicilan, pembatalan)
  // dikunci di tingkat SO lebih dulu, baru dokumennya: urutan tetap SO lalu invoice, sehingga pembayaran invoice dan
  // pembayaran SO yang bersamaan tidak menerima uang dua kali dan tidak saling mengunci.
  private async lockSaleOf(tx: any, entryId: number) {
    const e = await tx.journalEntries.findFirst({ where: { id: entryId }, select: { saleId: true } });
    if (e?.saleId) await lockRow(tx, 'sales_orders', e.saleId);
  }

  // Jadwal cicilan beserta alokasi pembayaran per termin
  async installments(e: any) {
    const rows = await this.db.invoiceInstallments.findMany({
      where: { invoiceId: e.id },
      orderBy: { sequence: 'asc' },
    });
    if (!rows.length) return { state: null, rows: [], outside: 0 };
    const paidAfter = await paidAfterPlan(this.db, e.id, Number(e.amountResidual), rows);
    const a = allocate(Number(e.amountTotal), Number(e.amountResidual), rows as any, paidAfter);
    const uids = [...new Set(rows.map((r) => r.approveUid).filter(Boolean))] as number[];
    const users = uids.length
      ? await this.db.users.findMany({ where: { id: { in: uids } }, include: { partner: { select: { name: true } } } })
      : [];
    const t = today();
    return {
      state: rows[0].state,
      approvedBy: users[0]?.partner.name ?? null,
      approveDate: rows[0].approveDate,
      note: rows[0].note,
      outside: a.outside,
      rows: a.rows.map((x) => ({ ...x, late: x.open > 0.5 && x.dateDue < t })),
    };
  }

  // Buat atau ganti jadwal cicilan (status draf, belum berlaku sampai disetujui)
  async setInstallments(u: AuthUser, id: number, b: { termins: { dateDue: string; amount: number }[]; note?: string }) {
    const e = must(await this.db.journalEntries.findFirst({ where: { id }, include: { partner: true } }), 'Invoice');
    if (e.moveType !== 'out_invoice' || e.state !== 'posted')
      fail('Cicilan hanya untuk invoice pelanggan yang sudah diposting');
    if (e.paymentState === 'reversed') fail('Invoice sudah dibalik');
    if (!(Number(e.amountResidual) > 0.5)) fail('Invoice sudah lunas');
    if (e.partner?.mtppIsNewCustomer) fail('Pelanggan baru wajib melunasi di muka; cicilan hanya untuk pelanggan lama');
    const cfg = await collectionSettings(this.db);
    if (!Array.isArray(b.termins)) fail('Isi jadwal termin');
    for (const x of b.termins)
      if (typeof x?.amount !== 'number' && !(typeof x?.amount === 'string' && /^\d+(\.\d+)?$/.test(x.amount)))
        fail('Nominal termin harus berupa angka');
    const termins = b.termins.map((x) => ({
      dateDue: String(x.dateDue || ''),
      amount: round2(Number(x.amount)),
    }));
    const err = planError(termins, Number(e.amountResidual), e.invoiceDate || e.date, {
      maxTermins: Number(cfg.maxInstallments),
      maxMonths: Number(cfg.maxMonths),
    });
    if (err) fail(err);
    await this.db.$transaction(async (tx) => {
      // dikunci bersama pembayaran invoice: klik ganda tidak membuat termin dobel, dan sisa tagihan dibaca ulang
      await this.lockSaleOf(tx, id);
      await lockRow(tx, 'journal_entries', id);
      const cur = must(await tx.journalEntries.findFirst({ where: { id } }), 'Invoice');
      if (cur.paymentState === 'reversed') fail('Invoice sudah dibalik');
      if (Math.abs(Number(cur.amountResidual) - Number(e.amountResidual)) > 0.009)
        fail('Sisa tagihan berubah karena ada pembayaran baru; buka ulang invoice lalu ajukan jadwal lagi');
      const had = await tx.invoiceInstallments.count({ where: { invoiceId: id } });
      await tx.invoiceInstallments.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceInstallments.createMany({
        data: termins.map((x, i) => ({
          invoiceId: id,
          sequence: i + 1,
          dateDue: x.dateDue,
          amount: x.amount,
          note: b.note || null,
          createUid: u.id,
          writeUid: u.id,
        })),
      });
      const list = termins.map((x, i) => `${i + 1}) ${tglIndo(x.dateDue)} ${rupiah(x.amount)}`).join('; ');
      await this.chatter.log(
        MODEL,
        id,
        u.id,
        `${had ? 'Jadwal cicilan diubah' : 'Jadwal cicilan diajukan'}, menunggu persetujuan: ${list}`,
        [],
        tx,
      );
    });
    return this.get(id);
  }

  async approveInstallments(u: AuthUser, id: number) {
    await this.db.$transaction(async (tx) => {
      // dikunci bersama pembayaran invoice: persetujuan memakai sisa tagihan terbaru
      await this.lockSaleOf(tx, id);
      await lockRow(tx, 'journal_entries', id);
      const rows = await tx.invoiceInstallments.findMany({ where: { invoiceId: id } });
      if (!rows.length) fail('Invoice belum memiliki jadwal cicilan');
      if (rows[0].state === 'approved') fail('Jadwal cicilan sudah disetujui');
      const e = must(await tx.journalEntries.findFirst({ where: { id } }), 'Invoice');
      if (e.paymentState === 'reversed') fail('Invoice sudah dibalik');
      const planned = round2(rows.reduce((a: number, x: any) => a + Number(x.amount), 0));
      if (Math.abs(planned - Number(e.amountResidual)) > 0.009)
        fail('Sisa tagihan berubah sejak jadwal diajukan; ajukan ulang jadwal cicilan');
      await tx.invoiceInstallments.updateMany({
        where: { invoiceId: id },
        data: { state: 'approved', approveUid: u.id, approveDate: nowDate(), writeUid: u.id },
      });
      await this.chatter.log(MODEL, id, u.id, `Jadwal cicilan ${rows.length} termin disetujui`, [], tx);
    });
    return this.get(id);
  }

  async cancelInstallments(u: AuthUser, id: number) {
    await this.db.$transaction(async (tx) => {
      await this.lockSaleOf(tx, id);
      await lockRow(tx, 'journal_entries', id);
      const n = await tx.invoiceInstallments.count({ where: { invoiceId: id } });
      if (!n) fail('Invoice belum memiliki jadwal cicilan');
      await tx.invoiceInstallments.deleteMany({ where: { invoiceId: id } });
      await this.chatter.log(
        MODEL,
        id,
        u.id,
        'Jadwal cicilan dibatalkan; jatuh tempo kembali ke tanggal invoice',
        [],
        tx,
      );
    });
    return this.get(id);
  }

  // Email pengingat pembayaran untuk invoice yang mendekati atau melewati jatuh tempo
  async remind(u: AuthUser, id: number, b: { to?: string }) {
    const e: any = await this.get(id);
    if (e.moveType !== 'out_invoice' || e.state !== 'posted' || !(Number(e.amountResidual) > 0.5))
      fail('Pengingat hanya untuk invoice yang belum lunas');
    const to = b.to || e.partner?.email;
    if (!to) fail('Email pelanggan belum diisi');
    const f = await this.pdfBuffer(u, id);
    const open = e.installments.rows.filter((x: any) => x.open > 0.5);
    const next = open[0];
    const what = next
      ? ` Cicilan ke-${next.sequence} sebesar ${rupiah(next.open)} jatuh tempo ${tglIndo(next.dateDue)}.`
      : ` Sisa tagihan ${rupiah(e.amountResidual)} jatuh tempo ${tglIndo(e.invoiceDateDue)}.`;
    const grace =
      e.dueState === 'tenggang'
        ? ` Saat ini dalam masa tenggang sampai ${tglIndo(e.graceUntil)}.`
        : e.dueState === 'lewat_tenggang'
          ? ' Masa tenggang sudah berakhir; pengiriman berikutnya ditahan sampai tagihan ini diselesaikan.'
          : '';
    const r = await this.email.send(
      {
        model: MODEL,
        resId: id,
        documentName: e.name,
        to,
        subject: `Pengingat pembayaran ${e.name} – PT Mentari Timur Prima Perkasa`,
        html: this.email.html('Pengingat pembayaran', e.name, e.partner.name, what + grace),
        pdf: { name: f.name, buffer: f.buffer },
      },
      u.id,
    );
    await this.chatter.log(MODEL, id, u.id, `Pengingat pembayaran dikirim ke ${to}`);
    return r;
  }

  async get(id: number) {
    const e = must(
      await this.db.journalEntries.findFirst({
        where: { id: id },
        include: { partner: true, journal: true, sale: true, purchase: true },
      }),
      'Dokumen',
    );
    const lines: any[] = (
      await this.db.journalEntryLines.findMany({
        where: { moveId: id },
        include: { account: { select: { code: true, name: true } } },
        orderBy: { id: 'asc' },
      })
    ).map(({ account, ...l }) => ({ l, account: account.name, code: account.code }));
    const pays0 = await this.db.payments.findMany({ where: { invoiceId: id, state: { not: 'cancel' } } });
    const proofs = await this.db.attachments.findMany({
      where: { resModel: 'payments', resId: { in: pays0.map((p) => p.id) } },
      select: { id: true, resId: true, name: true },
    });
    const pays = pays0.map((p) => ({ ...p, proof: proofs.find((a) => a.resId === p.id) ?? null }));
    // hanya uang muka yang dipakai invoice ini
    const uses =
      // uang muka SO untuk invoice pelanggan, uang muka PO untuk tagihan principal
      ['out_invoice', 'in_invoice'].includes(e.moveType)
        ? (await this.advanceUses(this.db, e)).filter((x: any) => x.receivable && x.paymentName)
        : [];
    const advPays = uses.length
      ? await this.db.payments.findMany({ where: { name: { in: uses.map((x: any) => x.paymentName) } } })
      : [];
    const advances = uses.map((x: any) => {
      const p = advPays.find((a) => a.name === x.paymentName);
      return { ...p, amount: x.amount };
    });
    const inst = e.moveType === 'out_invoice' ? await this.installments(e) : { state: null, rows: [], outside: 0 };
    const sum =
      e.moveType === 'out_invoice' && e.state === 'posted'
        ? summarize(await receivableSlices(this.db, { invoiceIds: [id] }), today()).get(id)
        : undefined;
    const cfg = await collectionSettings(this.db);
    return {
      ...e,
      installments: inst,
      graceDays: graceOf(e.partner, cfg.graceDays),
      dueDate: sum?.due ?? e.invoiceDateDue,
      dueState: sum?.state ?? null,
      dueLabel: sum ? DUE_STATE[sum.state] : null,
      graceUntil: sum?.graceUntil ?? null,
      canInstall:
        e.moveType === 'out_invoice' &&
        e.state === 'posted' &&
        Number(e.amountResidual) > 0.5 &&
        !e.partner?.mtppIsNewCustomer,
      lines: lines.map((r) => ({ ...r.l, account: `${r.code} ${r.account}` })),
      productLines: lines.filter((r) => r.l.displayType === 'product').map((r) => r.l),
      payments: pays,
      advances,
      paymentLabel: PAY_STATE[e.paymentState],
      canReverse: !(await this.reversalBlock(e)),
      words: terbilang(Number(e.amountTotal)),
      wordsEn: terbilangEn(Number(e.amountTotal)),
      emailStatus: await this.email.lastStatus(MODEL, id),
      overdue: sum
        ? sum.overdue
        : e.state === 'posted' && Number(e.amountResidual) > 0 && !!e.invoiceDateDue && e.invoiceDateDue < today(),
    };
  }

  // Invoice dibuat dari SO untuk barang yang sudah dikirim (qty terkirim - qty tertagih)
  async invoiceFromSale(u: AuthUser, saleId: number, b: any = {}) {
    return this.db.$transaction(async (tx) => {
      // dikunci: dua permintaan bersamaan tidak membuat dua invoice untuk barang yang sama
      await lockRow(tx, 'sales_orders', saleId);
      const so = must(
        await tx.salesOrders.findFirst({ where: { id: saleId }, include: { partner: true, paymentTerm: true } }),
        'Sales order',
      );
      if (!['sale', 'done'].includes(so.state)) fail('Invoice dibuat dari sales order yang sudah dikonfirmasi');
      const draft = await tx.journalEntries.findMany({
        where: { AND: [{ saleId: saleId }, { state: 'draft' }, { moveType: 'out_invoice' }] },
      });
      if (draft.length) fail(`Masih ada invoice draf ${draft[0].name}; posting atau hapus dulu`);
      const lines = (await tx.salesOrderLines.findMany({ where: { orderId: saleId } }))
        .map((l) => ({ l, q: round2(Number(l.qtyDelivered) - Number(l.qtyInvoiced)) }))
        .filter((x) => x.q > 0);
      if (!lines.length) fail('Belum ada barang terkirim yang belum ditagih');
      const date = b.date || today();
      const prod = lines.map((x) => {
        // subtotal dihitung seperti baris SO (harga x qty x (1 - diskon)) lalu dibulatkan sekali,
        // sehingga total invoice sama dengan total SO dan tidak meninggalkan sisa receh
        const net = round2(Number(x.l.priceUnit) * (1 - Number(x.l.discount) / 100));
        return { ...x, net, sub: round2(Number(x.l.priceUnit) * x.q * (1 - Number(x.l.discount) / 100)) };
      });
      const untaxed = round2(prod.reduce((a, x) => a + x.sub, 0));
      const tax = await this.settings.tax(untaxed);
      const total = round2(untaxed + tax.tax);
      // pelanggan baru dan SO yang sudah lunas di muka: jatuh tempo pada tanggal invoice
      const prepaid = (await salePayments(this.db, saleId)).advance >= Number(so.amountTotal) - 0.5;
      const days = so.partner.mtppIsNewCustomer || prepaid ? 0 : (so.paymentTerm?.days ?? 0);
      const due = addDays(date, days);
      const e = await this.journal.create(tx, {
        journal: 'INV',
        date,
        partnerId: so.partnerId,
        moveType: 'out_invoice',
        invoiceDate: date,
        due,
        saleId,
        invoiceOrigin: so.name,
        ref: so.clientOrderRef,
        uid: u.id,
        amounts: { untaxed, tax: tax.tax, total },
        lines: [
          ...prod.map((x) => ({
            key: 'income',
            credit: x.sub,
            name: x.l.name,
            productId: x.l.productId,
            quantity: x.q,
            priceUnit: x.net,
            displayType: 'product',
            saleLineId: x.l.id,
          })),
          { key: 'taxOut', credit: tax.tax, name: `${tax.label} ${tax.rate}% x DPP nilai lain`, displayType: 'tax' },
          { key: 'receivable', debit: total, name: so.name, displayType: 'payment_term', dateMaturity: due },
        ],
      });
      return e;
    });
  }

  async post(u: AuthUser, id: number) {
    await this.db.$transaction(async (tx) => {
      // dikunci dan dibaca ulang: dua posting bersamaan tidak menambah qty tertagih dua kali
      await this.lockSaleOf(tx, id);
      await lockRow(tx, 'journal_entries', id);
      const e = must(await tx.journalEntries.findFirst({ where: { id: id } }), 'Dokumen');
      if (e.state !== 'draft') fail('Dokumen sudah diposting');
      const lines = await this.journal.assertBalanced(tx, id);
      await tx.journalEntries.updateMany({
        where: { id: id },
        data: { state: 'posted', amountResidual: e.amountTotal, writeUid: u.id },
      });
      for (const l of lines) {
        if (l.saleLineId)
          await tx.salesOrderLines.updateMany({
            where: { id: l.saleLineId },
            data: { qtyInvoiced: { increment: Number(l.quantity) } },
          });
        if (l.purchaseLineId)
          await tx.purchaseOrderLines.updateMany({
            where: { id: l.purchaseLineId },
            data: { qtyInvoiced: { increment: Number(l.quantity) } },
          });
      }
      await this.chatter.log(
        MODEL,
        id,
        u.id,
        'Dokumen diposting, jurnal dibuat',
        [{ field: 'Status', old: 'Draf', new: 'Diposting' }],
        tx,
      );
      if (e.saleId && e.moveType === 'out_invoice') {
        await refreshSale(tx, e.saleId);
        await this.applyAdvances(tx, id, u.id);
        await graduateCustomer(tx, e.saleId, this.chatter, u.id);
      }
      if (e.purchaseId && e.moveType === 'in_invoice') await this.applyPurchaseAdvances(tx, id, u.id);
      if (e.purchaseId) await refreshPurchase(tx, e.purchaseId);
    });
    return this.get(id);
  }

  // uang muka PO dipakai otomatis saat tagihan principal diposting: Debit Utang Usaha, Kredit Uang Muka Pembelian
  private async applyPurchaseAdvances(tx: any, billId: number, uid: number) {
    const bill = await tx.journalEntries.findFirst({ where: { id: billId } });
    let residual = Number(bill.amountResidual);
    const adv = await purchaseAdvances(tx, bill.purchaseId);
    if (!adv.available || residual <= 0) return;
    for (const p of adv.rows) {
      const avail = round2(Number(p.amount) - Number(p.amountApplied));
      if (avail <= 0 || residual <= 0) continue;
      const x = round2(Math.min(avail, residual));
      await this.journal.create(tx, {
        journal: 'UMM',
        partnerId: bill.partnerId,
        ref: `${REF_USE}${p.name} untuk ${bill.name}`,
        post: true,
        uid,
        lines: [
          { accountId: await this.journal.map('payable', tx), debit: x, name: bill.name },
          { accountId: await this.journal.map('purchaseAdvance', tx), credit: x, name: 'Pemakaian uang muka' },
        ],
      });
      await tx.payments.updateMany({
        where: { id: p.id },
        data: { amountApplied: round2(Number(p.amountApplied) + x) },
      });
      residual = round2(residual - x);
    }
    await tx.journalEntries.updateMany({
      where: { id: billId },
      data: {
        amountResidual: residual,
        paymentState: residual <= 0.5 ? 'paid' : residual < Number(bill.amountTotal) ? 'partial' : 'not_paid',
      },
    });
  }

  // Jurnal UMM yang menyelesaikan sebuah invoice, dikenali dari keterangannya (lihat applyAdvances dan settleRounding).
  // receivable: mengurangi piutang invoice; paymentName: uang muka yang terpakai.
  private async advanceUses(tx: any, inv: any) {
    const tail = ` untuk ${inv.name}`;
    const rows = await tx.journalEntries.findMany({
      where: {
        AND: [
          { journal: { code: 'UMM' } },
          { state: 'posted' },
          { reversedEntryId: null },
          { partnerId: inv.partnerId },
          { ref: { endsWith: tail } },
        ],
      },
      orderBy: { id: 'asc' },
    });
    return rows
      .filter((r: any) => r.paymentState !== 'reversed')
      .map((r: any) => {
        const head = String(r.ref).slice(0, -tail.length);
        const used = head.startsWith(REF_USE),
          rounding = head.startsWith(REF_ROUND);
        return {
          id: r.id,
          date: r.date,
          amount: Number(r.amountTotal),
          receivable: used || head === REF_ROUND_AR,
          paymentName: used ? head.slice(REF_USE.length) : rounding ? head.slice(REF_ROUND.length) : null,
        };
      });
  }

  // alasan invoice atau tagihan tidak dapat dibalik; null berarti boleh
  private async reversalBlock(e: any, tx: any = this.db) {
    if (!['out_invoice', 'in_invoice'].includes(e.moveType) || e.state !== 'posted' || e.paymentState === 'reversed')
      return 'Dokumen tidak dapat dibalik';
    if (await tx.payments.findFirst({ where: { invoiceId: e.id, state: { not: 'cancel' } } }))
      return 'Dokumen sudah memiliki pembayaran; batalkan pembayaran dulu';
    const uses = await this.advanceUses(tx, e);
    const settled = uses.filter((x: any) => x.receivable).reduce((a: number, x: any) => a + x.amount, 0);
    if (Number(e.amountResidual) + settled < Number(e.amountTotal) - 0.5)
      return 'Dokumen sudah dibayar sebagian; koreksi dengan jurnal penyesuaian';
    return null;
  }

  // Selisih pembulatan PPN per dokumen pada invoice terakhir SO: paling banyak Rp 1 per baris invoice.
  // Sisa uang muka menjadi pendapatan lain, kekurangan piutang menjadi beban lain, sehingga tidak ada yang tertinggal.
  private async settleRounding(tx: any, inv: any, uid: number) {
    const lines = await tx.salesOrderLines.findMany({ where: { orderId: inv.saleId } });
    if (
      !lines.every(
        (l: any) =>
          Number(l.qtyDelivered) >= Number(l.productUomQty) && Number(l.qtyInvoiced) >= Number(l.productUomQty),
      )
    )
      return;
    const adv = await this.liveAdvances(tx, inv.saleId);
    if (!adv.length) return;
    const invs = await tx.journalEntries.findMany({
      where: { AND: [{ saleId: inv.saleId }, { state: 'posted' }, { moveType: 'out_invoice' }] },
      select: { id: true, paymentState: true },
    });
    const live = invs.filter((x: any) => x.paymentState !== 'reversed').map((x: any) => x.id);
    const tolerance = await tx.journalEntryLines.count({ where: { moveId: { in: live }, displayType: 'product' } });
    const fresh = await tx.journalEntries.findFirst({ where: { id: inv.id } });
    const residual = Number(fresh.amountResidual);
    const leftover = round2(adv.reduce((a: number, p: any) => a + Number(p.amount) - Number(p.amountApplied), 0));
    if (residual <= 0 && leftover > 0 && leftover <= tolerance) {
      for (const p of adv) {
        const x = round2(Number(p.amount) - Number(p.amountApplied));
        if (x <= 0) continue;
        await this.journal.create(tx, {
          journal: 'UMM',
          partnerId: inv.partnerId,
          ref: `${REF_ROUND}${p.name} untuk ${inv.name}`,
          post: true,
          uid,
          lines: [
            { accountId: await this.journal.map('advance', tx), debit: x, name: 'Selisih pembulatan uang muka' },
            { accountId: await this.journal.map('roundingIncome', tx), credit: x, name: 'Selisih pembulatan PPN' },
          ],
        });
        await tx.payments.updateMany({ where: { id: p.id }, data: { amountApplied: Number(p.amount) } });
      }
    } else if (residual > 0 && residual <= tolerance && leftover <= 0) {
      await this.journal.create(tx, {
        journal: 'UMM',
        partnerId: inv.partnerId,
        ref: `${REF_ROUND_AR} untuk ${inv.name}`,
        post: true,
        uid,
        lines: [
          { accountId: await this.journal.map('roundingExpense', tx), debit: residual, name: 'Selisih pembulatan PPN' },
          { accountId: await this.journal.map('receivable', tx), credit: residual, name: inv.name },
        ],
      });
      await tx.journalEntries.updateMany({ where: { id: inv.id }, data: { amountResidual: 0, paymentState: 'paid' } });
    }
  }

  private liveAdvances(tx: any, saleId: number) {
    return tx.payments.findMany({
      where: { AND: [{ mtppSaleOrderId: saleId }, { state: { not: 'cancel' } }, { paymentType: 'inbound' }] },
      orderBy: { id: 'asc' },
    });
  }

  // uang muka SO dipakai otomatis saat invoice diposting: Debit Uang Muka Pelanggan, Kredit Piutang Usaha
  private async applyAdvances(tx: any, invoiceId: number, uid: number) {
    const inv = await tx.journalEntries.findFirst({ where: { id: invoiceId } });
    let residual = Number(inv.amountResidual);
    const adv = await this.liveAdvances(tx, inv.saleId);
    for (const p of adv) {
      const avail = round2(Number(p.amount) - Number(p.amountApplied));
      if (avail <= 0 || residual <= 0) continue;
      const x = round2(Math.min(avail, residual));
      await this.journal.create(tx, {
        journal: 'UMM',
        partnerId: inv.partnerId,
        ref: `${REF_USE}${p.name} untuk ${inv.name}`,
        post: true,
        uid,
        lines: [
          { accountId: await this.journal.map('advance', tx), debit: x, name: 'Pemakaian uang muka' },
          { accountId: await this.journal.map('receivable', tx), credit: x, name: inv.name },
        ],
      });
      await tx.payments.updateMany({
        where: { id: p.id },
        data: { amountApplied: round2(Number(p.amountApplied) + x) },
      });
      residual = round2(residual - x);
    }
    await tx.journalEntries.updateMany({
      where: { id: invoiceId },
      data: {
        amountResidual: residual,
        paymentState: residual <= 0 ? 'paid' : residual < Number(inv.amountTotal) ? 'partial' : 'not_paid',
      },
    });
    await this.settleRounding(tx, inv, uid);
  }

  async remove(u: AuthUser, id: number) {
    const e = must(await this.db.journalEntries.findFirst({ where: { id: id } }), 'Dokumen');
    if (e.state !== 'draft') fail('Dokumen yang sudah diposting tidak dapat dihapus; gunakan jurnal pembalik');
    await this.journal.assertOpen(e.date);
    await this.db.journalEntries.deleteMany({ where: { id: id } });
    return { ok: true };
  }

  // koreksi invoice yang sudah diposting: nota kredit (jurnal pembalik)
  async reverse(u: AuthUser, id: number) {
    const r = await this.db.$transaction(async (tx) => {
      // dikunci dan diperiksa ulang di dalam transaksi: pembalikan bersamaan atau pembayaran yang baru masuk
      await this.lockSaleOf(tx, id);
      await lockRow(tx, 'journal_entries', id);
      const e = must(await tx.journalEntries.findFirst({ where: { id: id } }), 'Dokumen');
      if (!['out_invoice', 'in_invoice'].includes(e.moveType)) fail('Hanya invoice atau tagihan yang dapat dibalik');
      const block = await this.reversalBlock(e, tx);
      if (block) fail(block);
      const lines = await tx.journalEntryLines.findMany({ where: { moveId: id } });
      // pemakaian uang muka dibatalkan lebih dulu sehingga uangnya kembali ke uang muka SO atau PO
      for (const use of await this.advanceUses(tx, e)) {
        await this.journal.reverse(tx, use.id, u.id);
        if (use.paymentName) {
          const p = await tx.payments.findFirst({ where: { name: use.paymentName } });
          if (p)
            await tx.payments.updateMany({
              where: { id: p.id },
              data: { amountApplied: round2(Math.max(Number(p.amountApplied) - use.amount, 0)) },
            });
        }
      }
      const rv = await this.journal.reverse(tx, id, u.id, e.moveType === 'out_invoice' ? 'out_refund' : 'in_refund');
      await tx.invoiceInstallments.deleteMany({ where: { invoiceId: id } });
      for (const l of lines) {
        if (l.saleLineId)
          await tx.$executeRaw(
            sql`update sales_order_lines set qty_invoiced = greatest(qty_invoiced - ${Number(l.quantity)}::numeric, 0) where id = ${l.saleLineId}`,
          );
        if (l.purchaseLineId)
          await tx.$executeRaw(
            sql`update purchase_order_lines set qty_invoiced = greatest(qty_invoiced - ${Number(l.quantity)}::numeric, 0) where id = ${l.purchaseLineId}`,
          );
      }
      await this.chatter.log(MODEL, id, u.id, `Dibalik dengan nota kredit ${rv.name}`, [], tx);
      if (e.saleId) await refreshSale(tx, e.saleId);
      if (e.purchaseId) await refreshPurchase(tx, e.purchaseId);
      return rv;
    });
    return this.get(r.id);
  }

  // Tagihan principal dari PO berdasarkan qty yang sudah diterima
  async billFromPurchase(u: AuthUser, poId: number, b: any = {}) {
    return this.db.$transaction(async (tx) => {
      // dikunci per PO (tagihan ganda dari dua permintaan) dan per principal (nomor tagihan ganda)
      await lockRow(tx, 'purchase_orders', poId);
      const po = must(
        await tx.purchaseOrders.findFirst({
          where: { id: poId },
          include: { partner: { include: { paymentTerm: true } } },
        }),
        'Pesanan',
      );
      if (!['purchase', 'done'].includes(po.state))
        fail('Tagihan hanya untuk PO yang sudah dikonfirmasi dan tidak batal');
      await lockKey(tx, `bill-ref:${po.partnerId}`);
      const draft = await tx.journalEntries.findMany({ where: { AND: [{ purchaseId: poId }, { state: 'draft' }] } });
      if (draft.length) fail(`Masih ada tagihan draf ${draft[0].name}`);
      // nomor tagihan principal tidak boleh tercatat dua kali (seperti duplicate vendor reference di Odoo)
      const ref = String(b.ref || '').trim();
      if (ref) {
        const dup = await tx.journalEntries.findFirst({
          where: {
            partnerId: po.partnerId,
            moveType: 'in_invoice',
            ref: { equals: ref, mode: 'insensitive' },
            state: { not: 'cancel' },
            paymentState: { not: 'reversed' },
          },
        });
        if (dup) fail(`Nomor tagihan ${ref} dari principal ini sudah dicatat pada ${dup.name}`);
      }
      const lines = (await tx.purchaseOrderLines.findMany({ where: { orderId: poId } }))
        .map((l) => ({ l, q: round2(Number(l.qtyReceived) - Number(l.qtyInvoiced)) }))
        .filter((x) => x.q > 0);
      if (!lines.length) fail('Belum ada barang diterima yang belum ditagih');
      const date = b.date || today();
      // subtotal per baris dibulatkan dulu, lalu dijumlahkan: sama dengan baris jurnal sehingga tetap seimbang
      const untaxed = round2(lines.reduce((a, x) => a + round2(Number(x.l.priceUnit) * x.q), 0));
      const tax = await this.settings.tax(untaxed);
      const total = round2(untaxed + tax.tax);
      const due = addDays(date, b.dueDays ?? po.partner.paymentTerm?.days ?? 30);
      return this.journal.create(tx, {
        journal: 'BILL',
        date,
        partnerId: po.partnerId,
        moveType: 'in_invoice',
        invoiceDate: date,
        due,
        purchaseId: poId,
        invoiceOrigin: po.name,
        ref: b.ref,
        uid: u.id,
        amounts: { untaxed, tax: tax.tax, total },
        lines: [
          ...lines.map((x) => ({
            key: 'expense',
            debit: round2(Number(x.l.priceUnit) * x.q),
            name: x.l.name,
            productId: x.l.productId,
            quantity: x.q,
            priceUnit: Number(x.l.priceUnit),
            displayType: 'product',
            purchaseLineId: x.l.id,
          })),
          { key: 'taxIn', debit: tax.tax, name: `${tax.label} masukan`, displayType: 'tax' },
          { key: 'payable', credit: total, name: po.name, displayType: 'payment_term', dateMaturity: due },
        ],
      });
    });
  }

  // nota kredit dari principal (mengurangi sisa utang)
  async supplierRefund(u: AuthUser, poId: number, b: { amount: number; ref?: string; date?: string }) {
    if (!(Number(b.amount) > 0)) fail('Nilai nota kredit harus lebih dari 0');
    const untaxed = round2(Number(b.amount));
    const tax = await this.settings.tax(untaxed);
    const total = round2(untaxed + tax.tax);
    const r = await this.db.$transaction(async (tx) => {
      await lockRow(tx, 'purchase_orders', poId);
      const po = must(await tx.purchaseOrders.findFirst({ where: { id: poId } }), 'Pesanan');
      if (!['purchase', 'done'].includes(po.state)) fail('Nota kredit hanya untuk PO yang sudah dikonfirmasi');
      // nota kredit hanya mengurangi tagihan yang sudah diposting dan belum lunas, sehingga tidak ada kredit
      // menggantung yang tidak terlihat di PO dan tidak terpakai saat tagihan berikutnya dibayar
      const open = await tx.journalEntries.findMany({
        where: {
          AND: [{ purchaseId: poId }, { state: 'posted' }, { moveType: 'in_invoice' }, { amountResidual: { gt: 0 } }],
        },
      });
      const due = round2(open.reduce((a: number, x: any) => a + Number(x.amountResidual), 0));
      if (!open.length) fail('Belum ada tagihan principal yang diposting dan belum lunas untuk dikurangi');
      if (total > due + 0.009)
        fail(`Nota kredit ${rupiah(total)} (termasuk PPN) melebihi sisa tagihan principal ${rupiah(due)}`);
      const e = await this.journal.create(tx, {
        journal: 'BILL',
        date: b.date,
        partnerId: po.partnerId,
        moveType: 'in_refund',
        purchaseId: poId,
        invoiceOrigin: po.name,
        ref: b.ref || 'Nota kredit principal',
        post: true,
        uid: u.id,
        amounts: { untaxed, tax: tax.tax, total },
        lines: [
          { accountId: await this.journal.map('payable', tx), debit: total, name: 'Nota kredit' },
          { accountId: await this.journal.map('expense', tx), credit: untaxed, name: 'Nota kredit' },
          { accountId: await this.journal.map('taxIn', tx), credit: tax.tax, name: 'Nota kredit' },
        ],
      });
      // nota kredit langsung mengurangi tagihan yang masih terbuka, dari jatuh tempo terlama
      const bills = await tx.journalEntries.findMany({
        where: {
          AND: [{ purchaseId: poId }, { state: 'posted' }, { moveType: 'in_invoice' }, { amountResidual: { gt: 0 } }],
        },
        orderBy: { invoiceDateDue: 'asc' },
      });
      let left = total;
      for (const bill of bills) {
        if (left <= 0) break;
        const x = round2(Math.min(left, Number(bill.amountResidual)));
        const residual = round2(Number(bill.amountResidual) - x);
        await tx.journalEntries.updateMany({
          where: { id: bill.id },
          data: { amountResidual: residual, paymentState: residual <= 0.5 ? 'paid' : 'partial' },
        });
        left = round2(left - x);
      }
      await tx.journalEntries.updateMany({
        where: { id: e.id },
        data: { amountResidual: left, paymentState: left <= 0 ? 'paid' : left < total ? 'partial' : 'not_paid' },
      });
      await refreshPurchase(tx, poId);
      return e;
    });
    return this.get(r.id);
  }

  // Catat pembayaran: invoice pelanggan, uang muka SO, atau tagihan principal
  async pay(
    u: AuthUser,
    b: {
      invoiceId?: number;
      saleId?: number;
      purchaseId?: number;
      amount: number;
      method?: 'BNK' | 'KAS';
      date?: string;
      memo?: string;
      kind?: 'dp' | 'lunas';
      settleDate?: string;
    },
  ) {
    const amount = round2(Number(b.amount));
    if (!(amount > 0)) fail('Jumlah pembayaran harus lebih dari 0');
    const method = b.method === 'KAS' ? 'KAS' : 'BNK';
    const date = b.date || today();
    return this.db.$transaction(async (tx) => {
      const cashAcc = await this.journal.map(method === 'KAS' ? 'cash' : 'bank', tx);
      const jr = await this.journal.journal(method, tx);
      if (b.invoiceId) {
        // dikunci dulu: pembayaran bersamaan atas invoice yang sama dibaca berurutan
        await this.lockSaleOf(tx, b.invoiceId);
        await lockRow(tx, 'journal_entries', b.invoiceId);
        const inv = must(await tx.journalEntries.findFirst({ where: { id: b.invoiceId } }), 'Invoice');
        if (!['out_invoice', 'in_invoice'].includes(inv.moveType))
          fail('Hanya invoice pelanggan atau tagihan principal yang dapat dibayar');
        if (inv.state !== 'posted') fail('Invoice harus diposting sebelum dibayar');
        if (inv.paymentState === 'reversed') fail('Invoice sudah dibalik dan tidak dapat dibayar');
        if (Number(inv.amountResidual) <= 0.009) fail('Invoice sudah lunas');
        if (amount > Number(inv.amountResidual) + 0.009)
          fail(`Jumlah melebihi sisa tagihan (${rupiah(inv.amountResidual)})`);
        if (inv.invoiceDate && date < String(inv.invoiceDate))
          fail(`Tanggal pembayaran tidak boleh sebelum tanggal dokumen (${inv.invoiceDate})`);
        const isCust = inv.moveType === 'out_invoice';
        const e = await this.journal.create(tx, {
          journal: method,
          date,
          partnerId: inv.partnerId,
          ref: `Pembayaran ${inv.name}${b.memo ? ' – ' + b.memo : ''}`,
          post: true,
          uid: u.id,
          lines: isCust
            ? [
                { accountId: cashAcc, debit: amount, name: inv.name },
                { accountId: await this.journal.map('receivable', tx), credit: amount, name: inv.name },
              ]
            : [
                { accountId: await this.journal.map('payable', tx), debit: amount, name: inv.name },
                { accountId: cashAcc, credit: amount, name: inv.name },
              ],
        });
        const p = await tx.payments.create({
          data: {
            name: e.name,
            moveId: e.id,
            journalId: jr.id,
            partnerId: inv.partnerId,
            invoiceId: inv.id,
            amount,
            date,
            paymentType: isCust ? 'inbound' : 'outbound',
            partnerType: isCust ? 'customer' : 'supplier',
            memo: b.memo,
            createUid: u.id,
          },
        });
        const residual = round2(Number(inv.amountResidual) - amount);
        await tx.journalEntries.updateMany({
          where: { id: inv.id },
          data: { amountResidual: Math.max(residual, 0), paymentState: residual <= 0.5 ? 'paid' : 'partial' },
        });
        await this.chatter.log(MODEL, inv.id, u.id, `Pembayaran ${rupiah(amount)} dicatat (${e.name})`, [], tx);
        if (inv.purchaseId) await refreshPurchase(tx, inv.purchaseId);
        if (inv.saleId) await graduateCustomer(tx, inv.saleId, this.chatter, u.id);
        return p;
      }
      if (b.saleId) {
        if (b.kind && !['dp', 'lunas'].includes(b.kind)) fail('Jenis pembayaran harus uang muka (dp) atau lunas');
        // dikunci dulu: pembayaran bersamaan atas SO yang sama dibaca berurutan
        await lockRow(tx, 'sales_orders', b.saleId);
        const so = must(await tx.salesOrders.findFirst({ where: { id: b.saleId } }), 'Sales order');
        if (!['sale', 'done'].includes(so.state)) fail('Uang muka dicatat untuk sales order yang sudah dikonfirmasi');
        if (so.dateOrder && date < String(so.dateOrder))
          fail(`Tanggal pembayaran tidak boleh sebelum tanggal sales order (${so.dateOrder})`);
        // sisa = nilai SO dikurangi semua uang yang sudah diterima: uang muka dan pembayaran atas invoice SO ini
        const received = (await salePayments(tx, so.id)).amount;
        const left = round2(Number(so.amountTotal) - received);
        if (left <= 0.5) fail('Sales order ini sudah lunas');
        if (amount > left + 0.009) fail(`Jumlah melebihi sisa nilai sales order (${rupiah(left)})`);
        // pilihan: uang muka (sisanya dilunasi pada tanggal yang disepakati) atau langsung lunas
        const kind = b.kind || (amount >= left - 0.5 ? 'lunas' : 'dp');
        if (kind === 'lunas' && Math.abs(amount - left) > 0.5)
          fail(`Pelunasan harus sebesar sisa nilai sales order (${rupiah(left)})`);
        if (kind === 'dp') {
          if (amount >= left - 0.5) fail('Jumlah ini melunasi sales order; pilih Lunasi langsung');
          const settle = b.settleDate || so.mtppSettleDate;
          if (!settle) fail('Isi tanggal pelunasan sisa pembayaran');
          if (String(settle) <= date) fail('Tanggal pelunasan harus setelah tanggal pembayaran');
          await tx.salesOrders.updateMany({ where: { id: so.id }, data: { mtppSettleDate: settle } });
        }
        const e = await this.journal.create(tx, {
          journal: method,
          date,
          partnerId: so.partnerId,
          ref: `${kind === 'lunas' ? 'Pelunasan' : 'Uang muka'} ${so.name}${b.memo ? ' – ' + b.memo : ''}`,
          post: true,
          uid: u.id,
          lines: [
            { accountId: cashAcc, debit: amount, name: so.name },
            { accountId: await this.journal.map('advance', tx), credit: amount, name: `Uang muka ${so.name}` },
          ],
        });
        const p = await tx.payments.create({
          data: {
            name: e.name,
            moveId: e.id,
            journalId: jr.id,
            partnerId: so.partnerId,
            mtppSaleOrderId: so.id,
            amount,
            date,
            paymentType: 'inbound',
            partnerType: 'customer',
            memo: b.memo,
            createUid: u.id,
          },
        });
        await this.chatter.log(
          'sales_orders',
          so.id,
          u.id,
          kind === 'lunas'
            ? `Pelunasan ${rupiah(amount)} diterima (${e.name})`
            : `Uang muka ${rupiah(amount)} diterima (${e.name}); sisa ${rupiah(left - amount)} dilunasi paling lambat ${tglIndo(b.settleDate || so.mtppSettleDate)}`,
          [],
          tx,
        );
        // jika sudah ada invoice diposting yang belum lunas, uang muka langsung dipakai
        const invs = await tx.journalEntries.findMany({
          where: {
            AND: [{ saleId: so.id }, { state: 'posted' }, { moveType: 'out_invoice' }, { amountResidual: { gt: 0 } }],
          },
        });
        for (const i of invs) await this.applyAdvances(tx, i.id, u.id);
        await graduateCustomer(tx, so.id, this.chatter, u.id);
        return p;
      }
      if (b.purchaseId && b.kind === 'dp') {
        // uang muka kepada principal atas PO: Debit Uang Muka Pembelian, Kredit Kas/Bank
        await lockRow(tx, 'purchase_orders', b.purchaseId);
        const po = must(await tx.purchaseOrders.findFirst({ where: { id: b.purchaseId } }), 'Pesanan');
        if (!['draft', 'sent', 'purchase'].includes(po.state))
          fail('Uang muka dibayar untuk PO yang belum selesai atau batal');
        if (po.dateOrder && date < String(po.dateOrder))
          fail(`Tanggal pembayaran tidak boleh sebelum tanggal PO (${po.dateOrder})`);
        const adv = await purchaseAdvances(tx, po.id);
        const left = round2(Number(po.amountTotal) - adv.paid);
        if (amount > left + 0.009) fail(`Jumlah melebihi sisa nilai PO (${rupiah(left)})`);
        const e = await this.journal.create(tx, {
          journal: method,
          date,
          partnerId: po.partnerId,
          ref: `Uang muka ${po.name}${b.memo ? ' – ' + b.memo : ''}`,
          post: true,
          uid: u.id,
          lines: [
            {
              accountId: await this.journal.map('purchaseAdvance', tx),
              debit: amount,
              name: `Uang muka ${po.name}`,
            },
            { accountId: cashAcc, credit: amount, name: po.name },
          ],
        });
        const p = await tx.payments.create({
          data: {
            name: e.name,
            moveId: e.id,
            journalId: jr.id,
            partnerId: po.partnerId,
            mtppPurchaseOrderId: po.id,
            amount,
            date,
            paymentType: 'outbound',
            partnerType: 'supplier',
            memo: b.memo || `Uang muka ${po.name}`,
            createUid: u.id,
          },
        });
        await this.chatter.log(
          'purchase_orders',
          po.id,
          u.id,
          `Uang muka ${rupiah(amount)} dibayar ke principal (${e.name})`,
          [],
          tx,
        );
        // tagihan yang sudah diposting dan belum lunas langsung dipotong
        const bills = await tx.journalEntries.findMany({
          where: {
            AND: [
              { purchaseId: po.id },
              { state: 'posted' },
              { moveType: 'in_invoice' },
              { amountResidual: { gt: 0 } },
            ],
          },
        });
        for (const x of bills) await this.applyPurchaseAdvances(tx, x.id, u.id);
        await refreshPurchase(tx, po.id);
        return p;
      }
      if (b.purchaseId) {
        // bayar principal: tagihan diposting yang belum lunas, dari yang terlama
        await lockRow(tx, 'purchase_orders', b.purchaseId);
        const bills = await tx.journalEntries.findMany({
          where: {
            AND: [
              { purchaseId: b.purchaseId },
              { state: 'posted' },
              { moveType: 'in_invoice' },
              { amountResidual: { gt: 0 } },
            ],
          },
          orderBy: { invoiceDateDue: 'asc' },
        });
        if (!bills.length) fail('Belum ada tagihan principal yang diposting dan belum lunas');
        const totalDue = round2(bills.reduce((a, x) => a + Number(x.amountResidual), 0));
        if (amount > totalDue + 0.009) fail(`Jumlah melebihi sisa utang (${rupiah(totalDue)})`);
        let left = amount;
        let last: any = null;
        for (const bill of bills) {
          if (left <= 0) break;
          const x = round2(Math.min(left, Number(bill.amountResidual)));
          const e = await this.journal.create(tx, {
            journal: method,
            date,
            partnerId: bill.partnerId,
            ref: `Pembayaran ${bill.name}${b.memo ? ' – ' + b.memo : ''}`,
            post: true,
            uid: u.id,
            lines: [
              { accountId: await this.journal.map('payable', tx), debit: x, name: bill.name },
              { accountId: cashAcc, credit: x, name: bill.name },
            ],
          });
          last = await tx.payments.create({
            data: {
              name: e.name,
              moveId: e.id,
              journalId: jr.id,
              partnerId: bill.partnerId!,
              invoiceId: bill.id,
              amount: x,
              date,
              paymentType: 'outbound',
              partnerType: 'supplier',
              memo: b.memo,
              createUid: u.id,
            },
          });
          const residual = round2(Number(bill.amountResidual) - x);
          await tx.journalEntries.updateMany({
            where: { id: bill.id },
            data: { amountResidual: residual, paymentState: residual <= 0.5 ? 'paid' : 'partial' },
          });
          left = round2(left - x);
        }
        await this.chatter.log(
          'purchase_orders',
          b.purchaseId,
          u.id,
          `Pembayaran principal ${rupiah(amount)} dicatat`,
          [],
          tx,
        );
        await refreshPurchase(tx, b.purchaseId);
        return last;
      }
      fail('Pilih invoice, sales order, atau PO Principal yang dibayar');
    });
  }

  // riwayat pembayaran satu SO (dipakai kuitansi); logika sama dengan SalesService.paymentHistory
  private async sales(saleId: number) {
    const so = await this.db.salesOrders.findFirst({ where: { id: saleId } });
    if (!so) return [];
    const pays = await this.db.payments.findMany({
      where: {
        AND: [
          { partnerType: 'customer' },
          { paymentType: 'inbound' },
          { state: { not: 'cancel' } },
          { OR: [{ mtppSaleOrderId: saleId }, { invoice: { saleId } }] },
        ],
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    const total = Number(so.amountTotal);
    let paid = 0,
      dp = 0,
      prior = 0; // pembayaran sebelum baris ini (uang muka maupun invoice), sama dengan riwayat pembayaran
    return pays.map((p) => {
      paid = round2(paid + Number(p.amount));
      const full = paid >= total - 0.5;
      const adv = !!p.mtppSaleOrderId;
      if (adv && !full) dp++;
      const kind = full ? (prior === 0 && adv ? 'lunas_langsung' : 'pelunasan') : adv ? 'uang_muka' : 'invoice';
      prior++;
      return {
        id: p.id,
        kind,
        kindLabel: {
          lunas_langsung: 'Lunas langsung',
          pelunasan: 'Pelunasan',
          uang_muka: `Uang muka ke-${dp}`,
          invoice: 'Pembayaran invoice',
        }[kind],
        total,
        paidAfter: paid,
        remaining: round2(Math.max(total - paid, 0)),
        settleDate: so.mtppSettleDate,
      };
    });
  }

  async payment(id: number) {
    return must(await this.db.payments.findFirst({ where: { id: id } }), 'Pembayaran');
  }

  // Batalkan pembayaran: jurnal dibalik, jumlahnya kembali ke sisa invoice atau tagihan, status SO dan PO dihitung ulang
  async cancelPayment(u: AuthUser, id: number) {
    const p = await this.payment(id);
    if (p.state === 'cancel') fail('Pembayaran sudah dibatalkan');
    if (p.partnerType === 'customer' && p.paymentType === 'outbound')
      fail('Pengembalian dana kepada pelanggan tidak dapat dibatalkan');
    if (Number(p.amountApplied) > 0) fail('Uang muka sudah terpakai atau hangus; batalkan invoice itu dulu');
    if (await this.db.bankStatementLines.findFirst({ where: { paymentId: id, isReconciled: true } }))
      fail('Pembayaran sudah direkonsiliasi; batalkan pencocokan mutasi bank dulu');
    await this.db.$transaction(async (tx) => {
      // dikunci: pembatalan bersamaan atas pembayaran yang sama hanya diproses sekali
      if (p.mtppSaleOrderId) await lockRow(tx, 'sales_orders', p.mtppSaleOrderId);
      if (p.invoiceId) await this.lockSaleOf(tx, p.invoiceId);
      if (p.invoiceId) await lockRow(tx, 'journal_entries', p.invoiceId);
      await lockRow(tx, 'journal_entries', p.moveId);
      const cur = await tx.payments.findFirst({ where: { id } });
      if (cur?.state === 'cancel') fail('Pembayaran sudah dibatalkan');
      if (Number(cur?.amountApplied) > 0) fail('Uang muka sudah terpakai atau hangus; batalkan invoice itu dulu');
      const rv = await this.journal.reverse(tx, p.moveId, u.id);
      await tx.payments.updateMany({ where: { id: id }, data: { state: 'cancel' } });
      const msg = `Pembayaran ${p.name} sebesar ${rupiah(p.amount)} dibatalkan dengan jurnal pembalik ${rv.name}`;
      if (p.invoiceId) {
        const inv = must(await tx.journalEntries.findFirst({ where: { id: p.invoiceId } }), 'Invoice');
        const residual = round2(Math.min(Number(inv.amountResidual) + Number(p.amount), Number(inv.amountTotal)));
        await tx.journalEntries.updateMany({
          where: { id: inv.id },
          data: {
            amountResidual: residual,
            paymentState: residual >= Number(inv.amountTotal) - 0.5 ? 'not_paid' : 'partial',
          },
        });
        await this.chatter.log(MODEL, inv.id, u.id, msg, [], tx);
        if (inv.purchaseId) await refreshPurchase(tx, inv.purchaseId);
        if (inv.saleId) await refreshSale(tx, inv.saleId);
      }
      if (p.mtppSaleOrderId) await this.chatter.log('sales_orders', p.mtppSaleOrderId, u.id, msg, [], tx);
      // pelanggan yang "lulus" dari pelanggan baru karena SO ini kembali menjadi pelanggan baru bila SO ini tidak lagi
      // lunas dan belum ada SO lain yang terkirim penuh dan lunas (aturan bayar di muka berlaku lagi)
      const saleId =
        p.mtppSaleOrderId ??
        (p.invoiceId ? (await tx.journalEntries.findFirst({ where: { id: p.invoiceId } }))?.saleId : null);
      if (saleId) await this.revertGraduation(tx, saleId, u.id);
      if (p.mtppPurchaseOrderId) {
        await this.chatter.log('purchase_orders', p.mtppPurchaseOrderId, u.id, msg, [], tx);
        await refreshPurchase(tx, p.mtppPurchaseOrderId);
      }
    });
    return { ok: true };
  }

  private async revertGraduation(tx: any, saleId: number, uid: number) {
    const so = await tx.salesOrders.findFirst({ where: { id: saleId }, include: { partner: true } });
    if (!so || so.partner.mtppIsNewCustomer) return;
    // hanya pelanggan yang pernah ditandai baru (riwayat partner mencatat kelulusannya)
    const graduated = await tx.messages.findFirst({
      where: {
        model: 'partners',
        resId: so.partnerId,
        body: { contains: 'tidak lagi pelanggan baru', mode: 'insensitive' },
      },
    });
    if (!graduated) return;
    if ((await salePayments(tx, saleId)).amount >= Number(so.amountTotal) - 0.5) return;
    const others = await tx.salesOrders.findMany({
      where: { partnerId: so.partnerId, id: { not: saleId }, state: { in: ['sale', 'done'] } },
    });
    for (const o of others) {
      const lines = await tx.salesOrderLines.findMany({ where: { orderId: o.id } });
      const delivered = lines.length && lines.every((l: any) => Number(l.qtyDelivered) >= Number(l.productUomQty));
      if (delivered && (await salePayments(tx, o.id)).amount >= Number(o.amountTotal) - 0.5) return;
    }
    await tx.partners.updateMany({ where: { id: so.partnerId }, data: { mtppIsNewCustomer: true } });
    await this.chatter.log(
      'partners',
      so.partnerId,
      uid,
      `Kembali menjadi pelanggan baru: pembayaran ${so.name} dibatalkan sehingga belum ada pesanan yang lunas`,
      [],
      tx,
    );
  }

  async payments(q: any) {
    const w: any[] = [];
    if (q.partnerType) w.push({ partnerType: q.partnerType });
    // pembayaran SO: uang muka atau pelunasan langsung, dan pembayaran atas invoice SO itu
    if (q.saleId) w.push({ OR: [{ mtppSaleOrderId: +q.saleId }, { invoice: { saleId: +q.saleId } }] });
    const rows: any[] = (
      await this.db.payments.findMany({
        where: w.length ? { AND: w } : undefined,
        include: {
          partner: { select: { name: true } },
          journal: { select: { name: true } },
          invoice: { select: { name: true, saleId: true } },
        },
        orderBy: { id: 'desc' },
      })
    ).map(({ partner, journal, invoice, ...p }) => ({
      p,
      partner: partner.name,
      inv: invoice?.name ?? null,
      saleId: p.mtppSaleOrderId ?? invoice?.saleId ?? null,
      jr: journal.name,
    }));
    const sos = await this.db.salesOrders.findMany({ select: { id: true, name: true } });
    const pos = await this.db.purchaseOrders.findMany({ select: { id: true, name: true } });
    const proofs = await this.db.attachments.findMany({
      where: { resModel: 'payments', resId: { in: rows.map((r) => r.p.id) } },
      select: { id: true, resId: true, name: true },
    });
    // pencarian juga mencakup nomor invoice dan nomor sales order
    const qq = String(q.q || '').toLowerCase();
    return rows
      .map((r) => ({
        ...r.p,
        proof: proofs.find((a) => a.resId === r.p.id) ?? null,
        partner: r.partner,
        invoice: r.inv,
        journal: r.jr,
        saleId: r.saleId,
        sale: sos.find((x) => x.id === r.saleId)?.name,
        purchase: pos.find((x) => x.id === r.p.mtppPurchaseOrderId)?.name,
      }))
      .filter(
        (r) =>
          !qq ||
          `${r.name} ${r.partner} ${r.memo || ''} ${r.invoice || ''} ${r.sale || ''} ${r.purchase || ''}`
            .toLowerCase()
            .includes(qq),
      );
  }

  private async signer(uid: number) {
    const [r] = (
      await this.db.users.findMany({ where: { id: uid }, include: { partner: { select: { name: true } } } })
    ).map((x) => ({ name: x.partner.name, sig: x.signatureId }));
    return r;
  }

  async pdfBuffer(u: AuthUser, id: number) {
    const e: any = await this.get(id);
    if (!['out_invoice', 'out_refund'].includes(e.moveType)) fail('Cetak hanya untuk invoice pelanggan');
    const tax = await this.settings.tax(Number(e.amountUntaxed));
    const bank = await this.settings.get('bank');
    const sg = await this.signer(e.createUid || u.id);
    const isRefund = e.moveType === 'out_refund';
    const spec: any = {
      title: isRefund ? 'NOTA KREDIT' : 'INVOICE',
      titleEn: isRefund ? 'Credit Note' : 'Invoice',
      number: e.name,
      notesKey: isRefund ? undefined : 'invoice',
      infoLeft: [
        ['Kepada', 'Bill to', e.partner?.name],
        ['Alamat', 'Address', [e.partner?.street, e.partner?.city].filter(Boolean).join(', ')],
        ['NPWP', 'Tax ID', e.partner?.vat || '-'],
      ],
      infoRight: [
        ['Tanggal', 'Date', tglIndo(e.invoiceDate || e.date)],
        ['Jatuh tempo', 'Due date', tglIndo(e.invoiceDateDue)],
        ['Sales order', 'Sales order', e.invoiceOrigin || '-'],
        ['PO pelanggan', 'Customer PO', e.ref || '-'],
      ],
      columns: [
        { h: 'No', en: 'No', w: 18 },
        { h: 'Produk', en: 'Product', w: '*' },
        { h: 'Qty', en: 'Qty', w: 45, align: 'right' },
        { h: 'Harga (Rp)', en: 'Unit price', w: 80, align: 'right' },
        { h: 'Subtotal (Rp)', en: 'Amount', w: 85, align: 'right' },
      ],
      rows: e.productLines.map((l: any, i: number) => [
        i + 1,
        l.name,
        num(l.quantity),
        idr(l.priceUnit),
        idr(Number(l.credit) || Number(l.debit)),
      ]),
      totals: [
        ['DPP', rupiah(e.amountUntaxed)],
        [`${tax.label} ${tax.rate}% x DPP nilai lain ${rupiah(tax.dppNilaiLain)}`, rupiah(e.amountTax)],
        ['Total', rupiah(e.amountTotal)],
        ['Sisa tagihan / Balance due', rupiah(e.amountResidual)],
      ],
      words: terbilang(Number(e.amountTotal)),
      wordsEn: terbilangEn(Number(e.amountTotal)),
      terms: [
        ...(e.installments.state === 'approved'
          ? [
              [
                'Jadwal cicilan / Installments',
                e.installments.rows
                  .map(
                    (x: any) =>
                      `${x.sequence}. ${tglIndo(x.dateDue)} – ${rupiah(x.amount)}${x.status === 'lunas' ? ' (lunas)' : x.paid > 0 ? ` (sisa ${rupiah(x.open)})` : ''}`,
                  )
                  .join('\n'),
              ],
            ]
          : []),
        ['Pembayaran / Payment', bank.text],
      ],
      signer: { name: sg?.name || u.name, role: 'Finance – PT Mentari Timur Prima Perkasa', signatureId: sg?.sig },
    };
    return { buffer: await this.pdf.document(spec), name: `${e.name.replace(/\//g, '-')}.pdf`, e };
  }

  async send(u: AuthUser, id: number, b: { to?: string }) {
    const f = await this.pdfBuffer(u, id);
    if (f.e.state !== 'posted') fail('Invoice harus diposting sebelum dikirim');
    const to = b.to || f.e.partner?.email;
    if (!to) fail('Email pelanggan belum diisi');
    const r = await this.email.send(
      {
        model: MODEL,
        resId: id,
        documentName: f.e.name,
        to,
        subject: `Invoice ${f.e.name} – PT Mentari Timur Prima Perkasa`,
        html: this.email.html(
          'Invoice',
          f.e.name,
          f.e.partner.name,
          ` Jatuh tempo pembayaran ${tglIndo(f.e.invoiceDateDue)}.`,
        ),
        pdf: { name: f.name, buffer: f.buffer },
      },
      u.id,
    );
    await this.chatter.log(MODEL, id, u.id, `Invoice dikirim ke ${to}`);
    return r;
  }

  // kuitansi untuk pembayaran pelanggan
  async receiptPdf(u: AuthUser, paymentId: number) {
    const p = must(
      await this.db.payments.findFirst({
        where: { id: paymentId },
        include: { partner: true, invoice: true, journal: true },
      }),
      'Pembayaran',
    );
    if (p.partnerType !== 'customer' || p.paymentType === 'outbound') fail('Kuitansi hanya untuk pembayaran pelanggan');
    const so = p.mtppSaleOrderId ? await this.db.salesOrders.findFirst({ where: { id: p.mtppSaleOrderId } }) : null;
    const sg = await this.signer(p.createUid || u.id);
    // jenis pembayaran SO: uang muka ke-n, pelunasan, atau lunas langsung, beserta total, terbayar, dan sisa
    const saleId = p.mtppSaleOrderId ?? p.invoice?.saleId ?? null;
    const hist = saleId ? (await this.sales(saleId)).find((x: any) => x.id === p.id) : null;
    const kindText = hist ? (hist.kind === 'invoice' ? null : hist.kindLabel) : null;
    const purpose =
      p.memo || (p.invoice ? `Pembayaran invoice ${p.invoice.name}` : `${kindText || 'Uang muka'} ${so?.name || ''}`);
    const spec: any = {
      title: 'KUITANSI',
      titleEn: 'Official Receipt',
      number: p.name,
      materai: Number(p.amount) > 5000000,
      receipt: { from: p.partner.name, amount: rupiah(p.amount), purpose, method: p.journal.name },
      infoLeft: [
        ['Diterima dari', 'Received from', p.partner.name],
        ['Alamat', 'Address', [p.partner.street, p.partner.city].filter(Boolean).join(', ')],
      ],
      infoRight: [
        ['Tanggal', 'Date', tglIndo(p.date)],
        ['Metode', 'Method', p.journal.name],
        ['Untuk', 'For', p.invoice?.name || (so ? `${kindText || 'Uang muka'} ${so.name}` : '-')],
        ...(kindText ? [['Jenis', 'Type', kindText]] : []),
      ],
      columns: [
        { h: 'Keterangan', en: 'Description', w: '*' },
        { h: 'Jumlah (Rp)', en: 'Amount', w: 120, align: 'right' },
      ],
      rows: [
        [p.memo || (p.invoice ? `Pembayaran invoice ${p.invoice.name}` : `Uang muka ${so?.name || ''}`), idr(p.amount)],
      ],
      totals: [
        ['Total', rupiah(p.amount)],
        ...(hist
          ? [
              ['Nilai sales order / Order total', rupiah(hist.total)],
              ['Sudah dibayar / Paid to date', rupiah(hist.paidAfter)],
              ['Sisa / Balance', rupiah(hist.remaining)],
            ]
          : []),
      ],
      note:
        hist?.settleDate && hist.remaining > 0.5
          ? `Sisa pembayaran dilunasi paling lambat ${tglIndo(String(hist.settleDate))}.`
          : undefined,
      words: terbilang(Number(p.amount)),
      wordsEn: terbilangEn(Number(p.amount)),
      signer: { name: sg?.name || u.name, role: 'Finance – PT Mentari Timur Prima Perkasa', signatureId: sg?.sig },
    };
    return { buffer: await this.pdf.document(spec), name: `Kuitansi-${p.name.replace(/\//g, '-')}.pdf` };
  }
}
