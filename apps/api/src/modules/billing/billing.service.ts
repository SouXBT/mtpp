import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser, dataRule } from '../../common/auth';
import { SettingsService } from '../../common/settings.service';
import { ChatterService } from '../../common/chatter.service';
import { PdfService } from '../../common/pdf.service';
import { graduateCustomer, refreshPurchase, refreshSale, salePayments } from '../../common/status';
import { addDays, fail, must, num, round2, rupiah, terbilang, terbilangEn, tglIndo, today } from '../../common/util';
import { JournalService } from '../accounting/journal.service';
import { EmailService } from '../email/email.service';
import { Prisma } from '@prisma/client';

const sql = Prisma.sql;

const MODEL = 'journal_entries';
// keterangan jurnal UMM; advanceUses membacanya kembali untuk mengetahui uang muka mana yang dipakai invoice
const REF_USE = 'Pemakaian uang muka ', REF_ROUND = 'Pembulatan uang muka ', REF_ROUND_AR = 'Pembulatan piutang';
export const PAY_STATE: Record<string, string> = { not_paid: 'Belum dibayar', partial: 'Sebagian', paid: 'Lunas', reversed: 'Dibalik' };

// Invoice (F.e), pembayaran dan piutang (F.f), tagihan dan pembayaran principal (F.c), uang muka pelanggan baru
@Injectable()
export class BillingService {
  constructor(@Inject(DB) private db: Db, private settings: SettingsService, private chatter: ChatterService, private pdf: PdfService, private journal: JournalService, private email: EmailService) {}

  async list(q: any, u?: AuthUser) {
    const rule = u && dataRule(u, 'journal_entries');
    const w: any[] = [...(rule ? [rule] : []), { moveType: { in: q.type === 'bill' ? ['in_invoice', 'in_refund'] : ['out_invoice', 'out_refund'] } }];
    if (q.state) w.push({ state: q.state });
    if (q.paymentState) w.push({ paymentState: { in: String(q.paymentState).split(',') } });
    if (q.partnerId) w.push({ partnerId: +q.partnerId });
    if (q.overdue === 'true') w.push({ AND: [{ invoiceDateDue: { lt: today() } }, { amountResidual: { gt: 0 } }, { state: 'posted' }] });
    if (q.q) w.push({ OR: [{ name: { contains: `${q.q}`, mode: 'insensitive' } }, { partner: { name: { contains: `${q.q}`, mode: 'insensitive' } } }, { ref: { contains: `${q.q}`, mode: 'insensitive' } }, { invoiceOrigin: { contains: `${q.q}`, mode: 'insensitive' } }] });
    const rows: any[] = (await this.db.journalEntries.findMany({ where: { AND: w }, include: { partner: { select: { name: true } } }, orderBy: { id: 'desc' }, take: 500 })).map(({ partner, ...e }) => ({ e, partner: partner?.name ?? null }));
    const t = today();
    return rows.map((r) => ({ ...r.e, partner: r.partner, paymentLabel: PAY_STATE[r.e.paymentState], overdue: r.e.state === 'posted' && Number(r.e.amountResidual) > 0 && !!r.e.invoiceDateDue && r.e.invoiceDateDue < t }));
  }

  async get(id: number) {
    const e = must(await this.db.journalEntries.findFirst({ where: { id: id }, include: { partner: true, journal: true, sale: true, purchase: true } }), 'Dokumen');
    const lines: any[] = (await this.db.journalEntryLines.findMany({ where: { moveId: id }, include: { account: { select: { code: true, name: true } } }, orderBy: { id: 'asc' } })).map(({ account, ...l }) => ({ l, account: account.name, code: account.code }));
    const pays = await this.db.payments.findMany({ where: { invoiceId: id, state: { not: 'cancel' } } });
    // hanya uang muka yang dipakai invoice ini
    const uses = e.moveType === 'out_invoice' ? (await this.advanceUses(this.db, e)).filter((x: any) => x.receivable && x.paymentName) : [];
    const advPays = uses.length ? await this.db.payments.findMany({ where: { name: { in: uses.map((x: any) => x.paymentName) } } }) : [];
    const advances = uses.map((x: any) => { const p = advPays.find((a) => a.name === x.paymentName); return { ...p, amount: x.amount }; });
    return { ...e, lines: lines.map((r) => ({ ...r.l, account: `${r.code} ${r.account}` })), productLines: lines.filter((r) => r.l.displayType === 'product').map((r) => r.l), payments: pays, advances, paymentLabel: PAY_STATE[e.paymentState],
      canReverse: !(await this.reversalBlock(e)), words: terbilang(Number(e.amountTotal)), wordsEn: terbilangEn(Number(e.amountTotal)), emailStatus: await this.email.lastStatus(MODEL, id), overdue: e.state === 'posted' && Number(e.amountResidual) > 0 && !!e.invoiceDateDue && e.invoiceDateDue < today() };
  }

  // Invoice dibuat dari SO untuk barang yang sudah dikirim (qty terkirim - qty tertagih)
  async invoiceFromSale(u: AuthUser, saleId: number, b: any = {}) {
    const so = must(await this.db.salesOrders.findFirst({ where: { id: saleId }, include: { partner: true, paymentTerm: true } }), 'Sales order');
    if (!['sale', 'done'].includes(so.state)) fail('Invoice dibuat dari sales order yang sudah dikonfirmasi');
    const draft = await this.db.journalEntries.findMany({ where: { AND: [{ saleId: saleId }, { state: 'draft' }, { moveType: 'out_invoice' }] } });
    if (draft.length) fail(`Masih ada invoice draf ${draft[0].name}; posting atau hapus dulu`);
    const lines = (await this.db.salesOrderLines.findMany({ where: { orderId: saleId } })).map((l) => ({ l, q: round2(Number(l.qtyDelivered) - Number(l.qtyInvoiced)) })).filter((x) => x.q > 0);
    if (!lines.length) fail('Belum ada barang terkirim yang belum ditagih');
    const date = b.date || today();
    const prod = lines.map((x) => { const net = round2(Number(x.l.priceUnit) * (1 - Number(x.l.discount) / 100)); return { ...x, net, sub: round2(net * x.q) }; });
    const untaxed = round2(prod.reduce((a, x) => a + x.sub, 0));
    const tax = await this.settings.tax(untaxed);
    const total = round2(untaxed + tax.tax);
    // pelanggan baru dan SO yang sudah lunas di muka: jatuh tempo pada tanggal invoice
    const prepaid = (await salePayments(this.db, saleId)).advance >= Number(so.amountTotal) - 0.5;
    const days = so.partner.mtppIsNewCustomer || prepaid ? 0 : (so.paymentTerm?.days ?? 0);
    const due = addDays(date, days);
    return this.db.$transaction(async (tx) => {
      const e = await this.journal.create(tx, { journal: 'INV', date, partnerId: so.partnerId, moveType: 'out_invoice', invoiceDate: date, due, saleId, invoiceOrigin: so.name, ref: so.clientOrderRef, uid: u.id,
        amounts: { untaxed, tax: tax.tax, total },
        lines: [
          ...prod.map((x) => ({ key: 'income', credit: x.sub, name: x.l.name, productId: x.l.productId, quantity: x.q, priceUnit: x.net, displayType: 'product', saleLineId: x.l.id })),
          { key: 'taxOut', credit: tax.tax, name: `${tax.label} ${tax.rate}% x DPP nilai lain`, displayType: 'tax' },
          { key: 'receivable', debit: total, name: so.name, displayType: 'payment_term', dateMaturity: due },
        ],
      });
      return e;
    });
  }

  async post(u: AuthUser, id: number) {
    const e = must(await this.db.journalEntries.findFirst({ where: { id: id } }), 'Dokumen');
    if (e.state !== 'draft') fail('Dokumen sudah diposting');
    await this.db.$transaction(async (tx) => {
      const lines = await this.journal.assertBalanced(tx, id);
      await tx.journalEntries.updateMany({ where: { id: id }, data: { state: 'posted', amountResidual: e.amountTotal, writeUid: u.id } });
      for (const l of lines) {
        if (l.saleLineId) await tx.salesOrderLines.updateMany({ where: { id: l.saleLineId }, data: { qtyInvoiced: { increment: Number(l.quantity) } } });
        if (l.purchaseLineId) await tx.purchaseOrderLines.updateMany({ where: { id: l.purchaseLineId }, data: { qtyInvoiced: { increment: Number(l.quantity) } } });
      }
      await this.chatter.log(MODEL, id, u.id, 'Dokumen diposting, jurnal dibuat', [{ field: 'Status', old: 'Draf', new: 'Diposting' }], tx);
      if (e.saleId && e.moveType === 'out_invoice') { await refreshSale(tx, e.saleId); await this.applyAdvances(tx, id, u.id); await graduateCustomer(tx, e.saleId, this.chatter, u.id); }
      if (e.purchaseId) await refreshPurchase(tx, e.purchaseId);
    });
    return this.get(id);
  }

  // Jurnal UMM yang menyelesaikan sebuah invoice, dikenali dari keterangannya (lihat applyAdvances dan settleRounding).
  // receivable: mengurangi piutang invoice; paymentName: uang muka yang terpakai.
  private async advanceUses(tx: any, inv: any) {
    const tail = ` untuk ${inv.name}`;
    const rows = await tx.journalEntries.findMany({ where: { AND: [{ journal: { code: 'UMM' } }, { state: 'posted' }, { reversedEntryId: null }, { partnerId: inv.partnerId }, { ref: { endsWith: tail } }] }, orderBy: { id: 'asc' } });
    return rows.filter((r: any) => r.paymentState !== 'reversed').map((r: any) => {
      const head = String(r.ref).slice(0, -tail.length);
      const used = head.startsWith(REF_USE), rounding = head.startsWith(REF_ROUND);
      return { id: r.id, date: r.date, amount: Number(r.amountTotal), receivable: used || head === REF_ROUND_AR, paymentName: used ? head.slice(REF_USE.length) : rounding ? head.slice(REF_ROUND.length) : null };
    });
  }

  // alasan invoice atau tagihan tidak dapat dibalik; null berarti boleh
  private async reversalBlock(e: any, tx: any = this.db) {
    if (!['out_invoice', 'in_invoice'].includes(e.moveType) || e.state !== 'posted' || e.paymentState === 'reversed') return 'Dokumen tidak dapat dibalik';
    if (await tx.payments.findFirst({ where: { invoiceId: e.id, state: { not: 'cancel' } } })) return 'Dokumen sudah memiliki pembayaran; batalkan pembayaran dulu';
    const uses = e.moveType === 'out_invoice' ? await this.advanceUses(tx, e) : [];
    const settled = uses.filter((x: any) => x.receivable).reduce((a: number, x: any) => a + x.amount, 0);
    if (Number(e.amountResidual) + settled < Number(e.amountTotal) - 0.5) return 'Dokumen sudah dibayar sebagian; koreksi dengan jurnal penyesuaian';
    return null;
  }

  // Selisih pembulatan PPN per dokumen pada invoice terakhir SO: paling banyak Rp 1 per baris invoice.
  // Sisa uang muka menjadi pendapatan lain, kekurangan piutang menjadi beban lain, sehingga tidak ada yang tertinggal.
  private async settleRounding(tx: any, inv: any, uid: number) {
    const lines = await tx.salesOrderLines.findMany({ where: { orderId: inv.saleId } });
    if (!lines.every((l: any) => Number(l.qtyDelivered) >= Number(l.productUomQty) && Number(l.qtyInvoiced) >= Number(l.productUomQty))) return;
    const adv = await this.liveAdvances(tx, inv.saleId);
    if (!adv.length) return;
    const invs = await tx.journalEntries.findMany({ where: { AND: [{ saleId: inv.saleId }, { state: 'posted' }, { moveType: 'out_invoice' }] }, select: { id: true, paymentState: true } });
    const live = invs.filter((x: any) => x.paymentState !== 'reversed').map((x: any) => x.id);
    const tolerance = await tx.journalEntryLines.count({ where: { moveId: { in: live }, displayType: 'product' } });
    const fresh = await tx.journalEntries.findFirst({ where: { id: inv.id } });
    const residual = Number(fresh.amountResidual);
    const leftover = round2(adv.reduce((a: number, p: any) => a + Number(p.amount) - Number(p.amountApplied), 0));
    if (residual <= 0 && leftover > 0 && leftover <= tolerance) {
      for (const p of adv) {
        const x = round2(Number(p.amount) - Number(p.amountApplied));
        if (x <= 0) continue;
        await this.journal.create(tx, { journal: 'UMM', partnerId: inv.partnerId, ref: `${REF_ROUND}${p.name} untuk ${inv.name}`, post: true, uid,
          lines: [{ accountId: await this.journal.map('advance', tx), debit: x, name: 'Selisih pembulatan uang muka' }, { accountId: await this.journal.map('roundingIncome', tx), credit: x, name: 'Selisih pembulatan PPN' }] });
        await tx.payments.updateMany({ where: { id: p.id }, data: { amountApplied: Number(p.amount) } });
      }
    } else if (residual > 0 && residual <= tolerance && leftover <= 0) {
      await this.journal.create(tx, { journal: 'UMM', partnerId: inv.partnerId, ref: `${REF_ROUND_AR} untuk ${inv.name}`, post: true, uid,
        lines: [{ accountId: await this.journal.map('roundingExpense', tx), debit: residual, name: 'Selisih pembulatan PPN' }, { accountId: await this.journal.map('receivable', tx), credit: residual, name: inv.name }] });
      await tx.journalEntries.updateMany({ where: { id: inv.id }, data: { amountResidual: 0, paymentState: 'paid' } });
    }
  }

  private liveAdvances(tx: any, saleId: number) {
    return tx.payments.findMany({ where: { AND: [{ mtppSaleOrderId: saleId }, { state: { not: 'cancel' } }, { paymentType: 'inbound' }] }, orderBy: { id: 'asc' } });
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
      await this.journal.create(tx, { journal: 'UMM', partnerId: inv.partnerId, ref: `${REF_USE}${p.name} untuk ${inv.name}`, post: true, uid,
        lines: [{ accountId: await this.journal.map('advance', tx), debit: x, name: 'Pemakaian uang muka' }, { accountId: await this.journal.map('receivable', tx), credit: x, name: inv.name }] });
      await tx.payments.updateMany({ where: { id: p.id }, data: { amountApplied: round2(Number(p.amountApplied) + x) } });
      residual = round2(residual - x);
    }
    await tx.journalEntries.updateMany({ where: { id: invoiceId }, data: { amountResidual: residual, paymentState: residual <= 0 ? 'paid' : residual < Number(inv.amountTotal) ? 'partial' : 'not_paid' } });
    await this.settleRounding(tx, inv, uid);
  }

  async remove(u: AuthUser, id: number) {
    const e = must(await this.db.journalEntries.findFirst({ where: { id: id } }), 'Dokumen');
    if (e.state !== 'draft') fail('Dokumen yang sudah diposting tidak dapat dihapus; gunakan jurnal pembalik');
    await this.db.journalEntries.deleteMany({ where: { id: id } });
    return { ok: true };
  }

  // koreksi invoice yang sudah diposting: nota kredit (jurnal pembalik)
  async reverse(u: AuthUser, id: number) {
    const e = must(await this.db.journalEntries.findFirst({ where: { id: id } }), 'Dokumen');
    if (!['out_invoice', 'in_invoice'].includes(e.moveType)) fail('Hanya invoice atau tagihan yang dapat dibalik');
    const block = await this.reversalBlock(e); if (block) fail(block);
    const r = await this.db.$transaction(async (tx) => {
      const lines = await tx.journalEntryLines.findMany({ where: { moveId: id } });
      // pemakaian uang muka dibatalkan lebih dulu sehingga uangnya kembali ke uang muka SO
      if (e.moveType === 'out_invoice') for (const use of await this.advanceUses(tx, e)) {
        await this.journal.reverse(tx, use.id, u.id);
        if (use.paymentName) {
          const p = await tx.payments.findFirst({ where: { name: use.paymentName } });
          if (p) await tx.payments.updateMany({ where: { id: p.id }, data: { amountApplied: round2(Math.max(Number(p.amountApplied) - use.amount, 0)) } });
        }
      }
      const rv = await this.journal.reverse(tx, id, u.id, e.moveType === 'out_invoice' ? 'out_refund' : 'in_refund');
      for (const l of lines) {
        if (l.saleLineId) await tx.$executeRaw(sql`update sales_order_lines set qty_invoiced = greatest(qty_invoiced - ${Number(l.quantity)}::numeric, 0) where id = ${l.saleLineId}`);
        if (l.purchaseLineId) await tx.$executeRaw(sql`update purchase_order_lines set qty_invoiced = greatest(qty_invoiced - ${Number(l.quantity)}::numeric, 0) where id = ${l.purchaseLineId}`);
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
    const po = must(await this.db.purchaseOrders.findFirst({ where: { id: poId }, include: { partner: { include: { paymentTerm: true } } } }), 'Pesanan');
    const draft = await this.db.journalEntries.findMany({ where: { AND: [{ purchaseId: poId }, { state: 'draft' }] } });
    if (draft.length) fail(`Masih ada tagihan draf ${draft[0].name}`);
    const lines = (await this.db.purchaseOrderLines.findMany({ where: { orderId: poId } })).map((l) => ({ l, q: round2(Number(l.qtyReceived) - Number(l.qtyInvoiced)) })).filter((x) => x.q > 0);
    if (!lines.length) fail('Belum ada barang diterima yang belum ditagih');
    const date = b.date || today();
    const untaxed = round2(lines.reduce((a, x) => a + Number(x.l.priceUnit) * x.q, 0));
    const tax = await this.settings.tax(untaxed);
    const total = round2(untaxed + tax.tax);
    const due = addDays(date, b.dueDays ?? po.partner.paymentTerm?.days ?? 30);
    return this.db.$transaction(async (tx) => this.journal.create(tx, { journal: 'BILL', date, partnerId: po.partnerId, moveType: 'in_invoice', invoiceDate: date, due, purchaseId: poId, invoiceOrigin: po.name, ref: b.ref, uid: u.id,
      amounts: { untaxed, tax: tax.tax, total },
      lines: [
        ...lines.map((x) => ({ key: 'expense', debit: round2(Number(x.l.priceUnit) * x.q), name: x.l.name, productId: x.l.productId, quantity: x.q, priceUnit: Number(x.l.priceUnit), displayType: 'product', purchaseLineId: x.l.id })),
        { key: 'taxIn', debit: tax.tax, name: `${tax.label} masukan`, displayType: 'tax' },
        { key: 'payable', credit: total, name: po.name, displayType: 'payment_term', dateMaturity: due },
      ] }));
  }

  // nota kredit dari principal (mengurangi sisa utang)
  async supplierRefund(u: AuthUser, poId: number, b: { amount: number; ref?: string; date?: string }) {
    const po = must(await this.db.purchaseOrders.findFirst({ where: { id: poId } }), 'Pesanan');
    if (!(Number(b.amount) > 0)) fail('Nilai nota kredit harus lebih dari 0');
    const untaxed = round2(Number(b.amount)); const tax = await this.settings.tax(untaxed); const total = round2(untaxed + tax.tax);
    const r = await this.db.$transaction(async (tx) => {
      const e = await this.journal.create(tx, { journal: 'BILL', date: b.date, partnerId: po.partnerId, moveType: 'in_refund', purchaseId: poId, invoiceOrigin: po.name, ref: b.ref || 'Nota kredit principal', post: true, uid: u.id, amounts: { untaxed, tax: tax.tax, total },
        lines: [{ accountId: await this.journal.map('payable', tx), debit: total, name: 'Nota kredit' }, { accountId: await this.journal.map('expense', tx), credit: untaxed, name: 'Nota kredit' }, { accountId: await this.journal.map('taxIn', tx), credit: tax.tax, name: 'Nota kredit' }] });
      // nota kredit langsung mengurangi tagihan yang masih terbuka, dari jatuh tempo terlama
      const bills = await tx.journalEntries.findMany({ where: { AND: [{ purchaseId: poId }, { state: 'posted' }, { moveType: 'in_invoice' }, { amountResidual: { gt: 0 } }] }, orderBy: { invoiceDateDue: 'asc' } });
      let left = total;
      for (const bill of bills) {
        if (left <= 0) break;
        const x = round2(Math.min(left, Number(bill.amountResidual)));
        const residual = round2(Number(bill.amountResidual) - x);
        await tx.journalEntries.updateMany({ where: { id: bill.id }, data: { amountResidual: residual, paymentState: residual <= 0.5 ? 'paid' : 'partial' } });
        left = round2(left - x);
      }
      await tx.journalEntries.updateMany({ where: { id: e.id }, data: { amountResidual: left, paymentState: left <= 0 ? 'paid' : left < total ? 'partial' : 'not_paid' } });
      await refreshPurchase(tx, poId);
      return e;
    });
    return this.get(r.id);
  }

  // Catat pembayaran: invoice pelanggan, uang muka SO, atau tagihan principal
  async pay(u: AuthUser, b: { invoiceId?: number; saleId?: number; purchaseId?: number; amount: number; method?: 'BNK' | 'KAS'; date?: string; memo?: string }) {
    const amount = round2(Number(b.amount)); if (!(amount > 0)) fail('Jumlah pembayaran harus lebih dari 0');
    const method = b.method === 'KAS' ? 'KAS' : 'BNK'; const date = b.date || today();
    return this.db.$transaction(async (tx) => {
      const cashAcc = await this.journal.map(method === 'KAS' ? 'cash' : 'bank', tx);
      const jr = await this.journal.journal(method, tx);
      if (b.invoiceId) {
        const inv = must(await tx.journalEntries.findFirst({ where: { id: b.invoiceId } }), 'Invoice');
        if (inv.state !== 'posted') fail('Invoice harus diposting sebelum dibayar');
        if (amount > Number(inv.amountResidual) + 0.5) fail(`Jumlah melebihi sisa tagihan (${rupiah(inv.amountResidual)})`);
        const isCust = inv.moveType === 'out_invoice';
        const e = await this.journal.create(tx, { journal: method, date, partnerId: inv.partnerId, ref: `Pembayaran ${inv.name}${b.memo ? ' – ' + b.memo : ''}`, post: true, uid: u.id,
          lines: isCust ? [{ accountId: cashAcc, debit: amount, name: inv.name }, { accountId: await this.journal.map('receivable', tx), credit: amount, name: inv.name }]
            : [{ accountId: await this.journal.map('payable', tx), debit: amount, name: inv.name }, { accountId: cashAcc, credit: amount, name: inv.name }] });
        const p = await tx.payments.create({ data: { name: e.name, moveId: e.id, journalId: jr.id, partnerId: inv.partnerId, invoiceId: inv.id, amount, date, paymentType: isCust ? 'inbound' : 'outbound', partnerType: isCust ? 'customer' : 'supplier', memo: b.memo, createUid: u.id } });
        const residual = round2(Number(inv.amountResidual) - amount);
        await tx.journalEntries.updateMany({ where: { id: inv.id }, data: { amountResidual: Math.max(residual, 0), paymentState: residual <= 0.5 ? 'paid' : 'partial' } });
        await this.chatter.log(MODEL, inv.id, u.id, `Pembayaran ${rupiah(amount)} dicatat (${e.name})`, [], tx);
        if (inv.purchaseId) await refreshPurchase(tx, inv.purchaseId);
        if (inv.saleId) await graduateCustomer(tx, inv.saleId, this.chatter, u.id);
        return p;
      }
      if (b.saleId) {
        const so = must(await tx.salesOrders.findFirst({ where: { id: b.saleId } }), 'Sales order');
        if (!['sale', 'done'].includes(so.state)) fail('Uang muka dicatat untuk sales order yang sudah dikonfirmasi');
        const net = (await salePayments(tx, so.id)).advance;
        if (amount > Number(so.amountTotal) - net + 0.5) fail(`Jumlah melebihi sisa nilai sales order (${rupiah(Number(so.amountTotal) - net)})`);
        const e = await this.journal.create(tx, { journal: method, date, partnerId: so.partnerId, ref: `Uang muka ${so.name}${b.memo ? ' – ' + b.memo : ''}`, post: true, uid: u.id,
          lines: [{ accountId: cashAcc, debit: amount, name: so.name }, { accountId: await this.journal.map('advance', tx), credit: amount, name: `Uang muka ${so.name}` }] });
        const p = await tx.payments.create({ data: { name: e.name, moveId: e.id, journalId: jr.id, partnerId: so.partnerId, mtppSaleOrderId: so.id, amount, date, paymentType: 'inbound', partnerType: 'customer', memo: b.memo, createUid: u.id } });
        await this.chatter.log('sales_orders', so.id, u.id, `Uang muka ${rupiah(amount)} diterima (${e.name})`, [], tx);
        // jika sudah ada invoice diposting yang belum lunas, uang muka langsung dipakai
        const invs = await tx.journalEntries.findMany({ where: { AND: [{ saleId: so.id }, { state: 'posted' }, { moveType: 'out_invoice' }, { amountResidual: { gt: 0 } }] } });
        for (const i of invs) await this.applyAdvances(tx, i.id, u.id);
        await graduateCustomer(tx, so.id, this.chatter, u.id);
        return p;
      }
      if (b.purchaseId) {
        // bayar principal: tagihan diposting yang belum lunas, dari yang terlama
        const bills = await tx.journalEntries.findMany({ where: { AND: [{ purchaseId: b.purchaseId }, { state: 'posted' }, { moveType: 'in_invoice' }, { amountResidual: { gt: 0 } }] }, orderBy: { invoiceDateDue: 'asc' } });
        if (!bills.length) fail('Belum ada tagihan principal yang diposting dan belum lunas');
        const totalDue = round2(bills.reduce((a, x) => a + Number(x.amountResidual), 0));
        if (amount > totalDue + 0.5) fail(`Jumlah melebihi sisa utang (${rupiah(totalDue)})`);
        let left = amount; let last: any = null;
        for (const bill of bills) {
          if (left <= 0) break;
          const x = round2(Math.min(left, Number(bill.amountResidual)));
          const e = await this.journal.create(tx, { journal: method, date, partnerId: bill.partnerId, ref: `Pembayaran ${bill.name}${b.memo ? ' – ' + b.memo : ''}`, post: true, uid: u.id,
            lines: [{ accountId: await this.journal.map('payable', tx), debit: x, name: bill.name }, { accountId: cashAcc, credit: x, name: bill.name }] });
          last = await tx.payments.create({ data: { name: e.name, moveId: e.id, journalId: jr.id, partnerId: bill.partnerId, invoiceId: bill.id, amount: x, date, paymentType: 'outbound', partnerType: 'supplier', memo: b.memo, createUid: u.id } });
          const residual = round2(Number(bill.amountResidual) - x);
          await tx.journalEntries.updateMany({ where: { id: bill.id }, data: { amountResidual: residual, paymentState: residual <= 0.5 ? 'paid' : 'partial' } });
          left = round2(left - x);
        }
        await this.chatter.log('purchase_orders', b.purchaseId, u.id, `Pembayaran principal ${rupiah(amount)} dicatat`, [], tx);
        await refreshPurchase(tx, b.purchaseId);
        return last;
      }
      fail('Pilih invoice, sales order, atau PO Principal yang dibayar');
    });
  }

  // Kembalikan uang muka yang belum terpakai kepada pelanggan: Debit Uang Muka Pelanggan, Kredit Bank atau Kas
  async refundAdvance(u: AuthUser, saleId: number, b: { amount: number; method?: 'BNK' | 'KAS'; date?: string; memo?: string }) {
    const amount = round2(Number(b.amount)); if (!(amount > 0)) fail('Jumlah pengembalian harus lebih dari 0');
    const method = b.method === 'KAS' ? 'KAS' : 'BNK'; const date = b.date || today();
    return this.db.$transaction(async (tx) => {
      const so = must(await tx.salesOrders.findFirst({ where: { id: saleId } }), 'Sales order');
      const adv = await this.liveAdvances(tx, saleId);
      const avail = round2(adv.reduce((a: number, p: any) => a + Number(p.amount) - Number(p.amountApplied), 0));
      if (amount > avail + 0.5) fail(`Jumlah melebihi sisa uang muka (${rupiah(avail)})`);
      const jr = await this.journal.journal(method, tx);
      const e = await this.journal.create(tx, { journal: method, date, partnerId: so.partnerId, ref: `Pengembalian uang muka ${so.name}${b.memo ? ' – ' + b.memo : ''}`, post: true, uid: u.id,
        lines: [{ accountId: await this.journal.map('advance', tx), debit: amount, name: `Pengembalian uang muka ${so.name}` }, { accountId: await this.journal.map(method === 'KAS' ? 'cash' : 'bank', tx), credit: amount, name: so.name }] });
      const r = await tx.payments.create({ data: { name: e.name, moveId: e.id, journalId: jr.id, partnerId: so.partnerId, mtppSaleOrderId: so.id, amount, date, paymentType: 'outbound', partnerType: 'customer', memo: b.memo, createUid: u.id } });
      let left = amount;
      for (const p of adv) {
        if (left <= 0) break;
        const x = round2(Math.min(left, Number(p.amount) - Number(p.amountApplied)));
        if (x <= 0) continue;
        await tx.payments.updateMany({ where: { id: p.id }, data: { amountApplied: round2(Number(p.amountApplied) + x) } });
        left = round2(left - x);
      }
      await this.chatter.log('sales_orders', so.id, u.id, `Uang muka ${rupiah(amount)} dikembalikan kepada pelanggan (${e.name})`, [], tx);
      return r;
    });
  }

  async payment(id: number) { return must(await this.db.payments.findFirst({ where: { id: id } }), 'Pembayaran'); }

  // Batalkan pembayaran: jurnal dibalik, jumlahnya kembali ke sisa invoice atau tagihan, status SO dan PO dihitung ulang
  async cancelPayment(u: AuthUser, id: number) {
    const p = await this.payment(id);
    if (p.state === 'cancel') fail('Pembayaran sudah dibatalkan');
    if (p.partnerType === 'customer' && p.paymentType === 'outbound') fail('Pengembalian uang muka tidak dapat dibatalkan; catat uang muka baru bila perlu');
    if (Number(p.amountApplied) > 0) fail('Uang muka sudah terpakai atau dikembalikan; batalkan invoice itu dulu');
    if (await this.db.bankStatementLines.findFirst({ where: { paymentId: id, isReconciled: true } })) fail('Pembayaran sudah direkonsiliasi; batalkan pencocokan mutasi bank dulu');
    await this.db.$transaction(async (tx) => {
      const rv = await this.journal.reverse(tx, p.moveId, u.id);
      await tx.payments.updateMany({ where: { id: id }, data: { state: 'cancel' } });
      const msg = `Pembayaran ${p.name} sebesar ${rupiah(p.amount)} dibatalkan dengan jurnal pembalik ${rv.name}`;
      if (p.invoiceId) {
        const inv = await tx.journalEntries.findFirst({ where: { id: p.invoiceId } });
        const residual = round2(Math.min(Number(inv.amountResidual) + Number(p.amount), Number(inv.amountTotal)));
        await tx.journalEntries.updateMany({ where: { id: inv.id }, data: { amountResidual: residual, paymentState: residual >= Number(inv.amountTotal) - 0.5 ? 'not_paid' : 'partial' } });
        await this.chatter.log(MODEL, inv.id, u.id, msg, [], tx);
        if (inv.purchaseId) await refreshPurchase(tx, inv.purchaseId);
        if (inv.saleId) await refreshSale(tx, inv.saleId);
      }
      if (p.mtppSaleOrderId) await this.chatter.log('sales_orders', p.mtppSaleOrderId, u.id, msg, [], tx);
    });
    return { ok: true };
  }

  async payments(q: any) {
    const w: any[] = [];
    if (q.partnerType) w.push({ partnerType: q.partnerType });
    if (q.saleId) w.push({ mtppSaleOrderId: +q.saleId });
    if (q.q) w.push({ OR: [{ name: { contains: `${q.q}`, mode: 'insensitive' } }, { partner: { name: { contains: `${q.q}`, mode: 'insensitive' } } }, { memo: { contains: `${q.q}`, mode: 'insensitive' } }] });
    const rows: any[] = (await this.db.payments.findMany({ where: w.length ? { AND: w } : undefined, include: { partner: { select: { name: true } }, journal: { select: { name: true } }, invoice: { select: { name: true } } }, orderBy: { id: 'desc' }, take: 500 }))
      .map(({ partner, journal, invoice, ...p }) => ({ p, partner: partner.name, inv: invoice?.name ?? null, jr: journal.name }));
    const sos = await this.db.salesOrders.findMany({ select: { id: true, name: true } });
    return rows.map((r) => ({ ...r.p, partner: r.partner, invoice: r.inv, journal: r.jr, sale: sos.find((x) => x.id === r.p.mtppSaleOrderId)?.name }));
  }

  private async signer(uid: number) {
    const [r] = (await this.db.users.findMany({ where: { id: uid }, include: { partner: { select: { name: true } } } })).map((x) => ({ name: x.partner.name, sig: x.signatureId }));
    return r;
  }

  async pdfBuffer(u: AuthUser, id: number) {
    const e: any = await this.get(id);
    if (!['out_invoice', 'out_refund'].includes(e.moveType)) fail('Cetak hanya untuk invoice pelanggan');
    const tax = await this.settings.tax(Number(e.amountUntaxed)); const bank = await this.settings.get('bank');
    const sg = await this.signer(e.createUid || u.id);
    const isRefund = e.moveType === 'out_refund';
    const spec: any = {
      title: isRefund ? 'NOTA KREDIT' : 'INVOICE', titleEn: isRefund ? 'Credit Note' : 'Invoice', number: e.name, notesKey: isRefund ? undefined : 'invoice',
      infoLeft: [['Kepada', 'Bill to', e.partner?.name], ['Alamat', 'Address', [e.partner?.street, e.partner?.city].filter(Boolean).join(', ')], ['NPWP', 'Tax ID', e.partner?.vat || '-']],
      infoRight: [['Tanggal', 'Date', tglIndo(e.invoiceDate || e.date)], ['Jatuh tempo', 'Due date', tglIndo(e.invoiceDateDue)], ['Sales order', 'Sales order', e.invoiceOrigin || '-'], ['PO pelanggan', 'Customer PO', e.ref || '-']],
      columns: [{ h: 'No', en: 'No', w: 18 }, { h: 'Produk', en: 'Product', w: '*' }, { h: 'Qty', en: 'Qty', w: 45, align: 'right' }, { h: 'Harga (Rp)', en: 'Unit price', w: 80, align: 'right' }, { h: 'Subtotal (Rp)', en: 'Amount', w: 85, align: 'right' }],
      rows: e.productLines.map((l: any, i: number) => [i + 1, l.name, num(l.quantity), num(l.priceUnit), num(Number(l.credit) || Number(l.debit))]),
      totals: [['DPP', rupiah(e.amountUntaxed)], [`${tax.label} ${tax.rate}% x DPP nilai lain ${rupiah(tax.dppNilaiLain)}`, rupiah(e.amountTax)], ['Total', rupiah(e.amountTotal)], ['Sisa tagihan / Balance due', rupiah(e.amountResidual)]],
      words: terbilang(Number(e.amountTotal)), wordsEn: terbilangEn(Number(e.amountTotal)), terms: [['Pembayaran / Payment', bank.text]],
      signer: { name: sg?.name || u.name, role: 'Finance – PT Mentari Timur Prima Perkasa', signatureId: sg?.sig },
    };
    return { buffer: await this.pdf.document(spec), name: `${e.name.replace(/\//g, '-')}.pdf`, e };
  }

  async send(u: AuthUser, id: number, b: { to?: string }) {
    const f = await this.pdfBuffer(u, id);
    if (f.e.state !== 'posted') fail('Invoice harus diposting sebelum dikirim');
    const to = b.to || f.e.partner?.email; if (!to) fail('Email pelanggan belum diisi');
    const r = await this.email.send({ model: MODEL, resId: id, documentName: f.e.name, to, subject: `Invoice ${f.e.name} – PT Mentari Timur Prima Perkasa`, html: this.email.html('Invoice', f.e.name, f.e.partner.name, ` Jatuh tempo pembayaran ${tglIndo(f.e.invoiceDateDue)}.`), pdf: { name: f.name, buffer: f.buffer } }, u.id);
    await this.chatter.log(MODEL, id, u.id, `Invoice dikirim ke ${to}`);
    return r;
  }

  // kuitansi untuk pembayaran pelanggan
  async receiptPdf(u: AuthUser, paymentId: number) {
    const p = must(await this.db.payments.findFirst({ where: { id: paymentId }, include: { partner: true, invoice: true, journal: true } }), 'Pembayaran');
    if (p.partnerType !== 'customer' || p.paymentType === 'outbound') fail('Kuitansi hanya untuk pembayaran pelanggan');
    const so = p.mtppSaleOrderId ? await this.db.salesOrders.findFirst({ where: { id: p.mtppSaleOrderId } }) : null;
    const sg = await this.signer(p.createUid || u.id);
    const purpose = p.memo || (p.invoice ? `Pembayaran invoice ${p.invoice.name}` : `Uang muka ${so?.name || ''}`);
    const spec: any = { title: 'KUITANSI', titleEn: 'Official Receipt', number: p.name, materai: Number(p.amount) > 5000000,
      receipt: { from: p.partner.name, amount: rupiah(p.amount), purpose, method: p.journal.name },
      infoLeft: [['Diterima dari', 'Received from', p.partner.name], ['Alamat', 'Address', [p.partner.street, p.partner.city].filter(Boolean).join(', ')]],
      infoRight: [['Tanggal', 'Date', tglIndo(p.date)], ['Metode', 'Method', p.journal.name], ['Untuk', 'For', p.invoice?.name || (so ? `Uang muka ${so.name}` : '-')]],
      columns: [{ h: 'Keterangan', en: 'Description', w: '*' }, { h: 'Jumlah (Rp)', en: 'Amount', w: 120, align: 'right' }],
      rows: [[p.memo || (p.invoice ? `Pembayaran invoice ${p.invoice.name}` : `Uang muka ${so?.name || ''}`), num(p.amount)]],
      totals: [['Total', rupiah(p.amount)]], words: terbilang(Number(p.amount)), wordsEn: terbilangEn(Number(p.amount)),
      signer: { name: sg?.name || u.name, role: 'Finance – PT Mentari Timur Prima Perkasa', signatureId: sg?.sig } };
    return { buffer: await this.pdf.document(spec), name: `Kuitansi-${p.name.replace(/\//g, '-')}.pdf` };
  }
}
