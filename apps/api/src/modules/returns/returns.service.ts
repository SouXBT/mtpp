import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser } from '../../shared/auth';
import { ChatterService } from '../../shared/chatter.service';
import { NumberingService } from '../../shared/numbering.service';
import { PdfService } from '../../shared/pdf.service';
import { SettingsService } from '../../shared/settings.service';
import { collectionSettings } from '../../shared/collection';
import { refreshSale } from '../../shared/status';
import { addDays, fail, idr, must, num, round2, rupiah, tglIndo, today } from '../../shared/util';
import { JournalService } from '../accounting/journal.service';
import { StockService } from '../stock/stock.service';

const MODEL = 'sales_returns';
// awalan catatan surat jalan pengganti; ikut tersalin ke surat jalan susulannya
export const REPLACEMENT_NOTE = 'Pengganti retur ';
export const RETURN_STATE: Record<string, string> = { draft: 'Draf', done: 'Selesai', cancel: 'Batal' };
export const REASONS: Record<string, string> = {
  rusak: 'Barang rusak',
  salah_barang: 'Salah barang',
  tidak_sesuai: 'Tidak sesuai spesifikasi',
  lainnya: 'Lainnya',
};
export const RESOLUTIONS: Record<string, string> = {
  ganti: 'Kirim pengganti',
  nota_kredit: 'Retur dan nota kredit',
  potongan: 'Potongan harga (barang tidak dikembalikan)',
};
// penyelesaian yang mengurangi piutang lewat nota kredit
export const isCredit = (r: string) => r === 'nota_kredit' || r === 'potongan';

interface ReturnIn {
  pickingId: number;
  date?: string;
  reason: string;
  resolution: string;
  note?: string;
  lines: { moveId: number; quantity: number; priceUnit?: number }[];
}

// Retur dan keluhan barang bermasalah dari pelanggan atas surat jalan yang sudah selesai.
// ganti: barang kembali ke lokasi Barang Rusak, qty terkirim SO berkurang sehingga surat jalan pengganti dapat dibuat.
// nota_kredit: barang kembali ke Barang Rusak, nota kredit mengurangi piutang invoice SO (sisanya dapat dikembalikan).
// potongan: barang tetap di pelanggan, nota kredit sebesar potongan yang disepakati.
@Injectable()
export class ReturnsService {
  constructor(
    @Inject(DB) private db: Db,
    private numbering: NumberingService,
    private chatter: ChatterService,
    private pdf: PdfService,
    private settings: SettingsService,
    private journal: JournalService,
    private stock: StockService,
  ) {}

  async list(q: any) {
    const w: any[] = [];
    if (q.saleId) w.push({ saleId: +q.saleId });
    if (q.pickingId) w.push({ pickingId: +q.pickingId });
    if (q.state) w.push({ state: { in: String(q.state).split(',') } });
    if (q.q)
      w.push({
        OR: [
          { name: { contains: `${q.q}`, mode: 'insensitive' } },
          { partner: { name: { contains: `${q.q}`, mode: 'insensitive' } } },
          { sale: { name: { contains: `${q.q}`, mode: 'insensitive' } } },
        ],
      });
    const rows = await this.db.salesReturns.findMany({
      where: w.length ? { AND: w } : undefined,
      include: {
        partner: { select: { name: true } },
        sale: { select: { name: true } },
        picking: { select: { name: true } },
      },
      orderBy: { id: 'desc' },
      take: 500,
    });
    return rows.map(({ partner, sale, picking, ...r }) => ({
      ...r,
      partner: partner.name,
      sale: sale.name,
      picking: picking.name,
      stateLabel: RETURN_STATE[r.state],
      reasonLabel: REASONS[r.reason],
      resolutionLabel: RESOLUTIONS[r.resolution],
    }));
  }

  // baris surat jalan yang masih dapat diretur: qty terkirim dikurangi retur lain yang belum dibatalkan
  async returnable(pickingId: number, exceptId?: number) {
    const t = must(
      await this.db.stockTransfers.findFirst({
        where: { id: pickingId },
        include: { pickingType: true, location: true, sale: true },
      }),
      'Surat jalan',
    );
    if (t.pickingType.code !== 'outgoing' || !t.saleId) fail('Retur hanya untuk surat jalan sales order');
    if (t.state !== 'done') fail('Retur hanya untuk surat jalan yang sudah divalidasi');
    const moves = await this.db.stockMoves.findMany({
      where: { pickingId, state: 'done', saleLineId: { not: null } },
      include: { product: { include: { template: { include: { uom: { select: { name: true } } } } } }, saleLine: true },
      orderBy: { id: 'asc' },
    });
    const used = await this.db.salesReturnLines.findMany({
      where: {
        moveId: { in: moves.map((m) => m.id) },
        ret: { state: { not: 'cancel' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      },
    });
    const cfg = await collectionSettings(this.db);
    const doneDate = t.dateDone ? new Date(t.dateDone).toISOString().slice(0, 10) : null;
    return {
      picking: t,
      dropship: t.location.usage === 'supplier',
      claimUntil: doneDate ? addDays(doneDate, Number(cfg.returnDays)) : null,
      lines: moves.map((m) => {
        const sl = m.saleLine!;
        const returned = round2(used.filter((x) => x.moveId === m.id).reduce((a, x) => a + Number(x.quantity), 0));
        return {
          moveId: m.id,
          saleLineId: sl.id,
          productId: m.productId,
          code: m.product.defaultCode,
          product: m.product.template.name,
          uom: m.product.template.uom.name,
          delivered: Number(m.quantity),
          returned,
          available: round2(Number(m.quantity) - returned),
          netPrice: round2(Number(sl.priceUnit) * (1 - Number(sl.discount) / 100)),
          qtyInvoiced: Number(sl.qtyInvoiced),
        };
      }),
    };
  }

  async get(id: number) {
    const r = must(
      await this.db.salesReturns.findFirst({
        where: { id },
        include: {
          partner: true,
          sale: { select: { id: true, name: true, clientOrderRef: true } },
          picking: { select: { id: true, name: true, dateDone: true } },
          refundEntry: { select: { id: true, name: true, amountResidual: true, amountTotal: true } },
          replacementPicking: { select: { id: true, name: true, state: true } },
          lines: {
            include: { product: { include: { template: { include: { uom: { select: { name: true } } } } } } },
            orderBy: { id: 'asc' },
          },
        },
      }),
      'Retur',
    );
    const info = await this.returnable(r.pickingId, r.id);
    const refunds = r.refundEntryId
      ? await this.db.payments.findMany({ where: { invoiceId: r.refundEntryId, state: { not: 'cancel' } } })
      : [];
    return {
      ...r,
      stateLabel: RETURN_STATE[r.state],
      reasonLabel: REASONS[r.reason],
      resolutionLabel: RESOLUTIONS[r.resolution],
      dropship: info.dropship,
      claimUntil: info.claimUntil,
      lateClaim: !!info.claimUntil && r.date > info.claimUntil,
      creditLeft: r.refundEntry ? Number(r.refundEntry.amountResidual) : 0,
      refunds,
      lines: r.lines.map(({ product, ...l }: any) => ({
        ...l,
        code: product.defaultCode,
        product: product.template.name,
        uom: product.template.uom.name,
      })),
    };
  }

  // Periksa isian dan susun baris retur dengan harga neto dari SO (nota kredit) atau potongan per unit
  private async build(b: ReturnIn, exceptId?: number) {
    if (!REASONS[b.reason]) fail('Pilih alasan retur');
    if (!RESOLUTIONS[b.resolution]) fail('Pilih penyelesaian retur');
    const info = await this.returnable(+b.pickingId, exceptId);
    if (b.resolution === 'ganti' && info.dropship)
      fail('Barang dropship tidak dapat diganti dari gudang; pilih nota kredit atau potongan dan klaim ke principal');
    const lines = (b.lines || []).filter((x) => Number(x.quantity) > 0);
    if (!lines.length) fail('Isi kuantitas barang yang bermasalah');
    const out = [];
    for (const x of lines) {
      const m = info.lines.find((l) => l.moveId === +x.moveId);
      if (!m) fail('Baris tidak berasal dari surat jalan ini');
      const q = round2(Number(x.quantity));
      if (q > m!.available + 0.0001) fail(`Kuantitas ${m!.product} melebihi yang dapat diretur (${num(m!.available)})`);
      let price = 0;
      if (b.resolution === 'nota_kredit') price = m!.netPrice;
      if (b.resolution === 'potongan') {
        price = round2(Number(x.priceUnit));
        if (!(price > 0)) fail(`Isi potongan per unit untuk ${m!.product}`);
        if (price > m!.netPrice) fail(`Potongan ${m!.product} melebihi harga neto (${rupiah(m!.netPrice)})`);
      }
      out.push({ m: m!, q, price, sub: round2(price * q) });
    }
    if (isCredit(b.resolution)) {
      // nota kredit hanya untuk barang yang sudah ditagih; yang belum ditagih cukup tidak ditagihkan
      const credited = await this.db.salesReturnLines.findMany({
        where: {
          saleLineId: { in: out.map((x) => x.m.saleLineId) },
          ret: {
            state: { not: 'cancel' },
            resolution: { in: ['nota_kredit', 'potongan'] },
            ...(exceptId ? { id: { not: exceptId } } : {}),
          },
        },
      });
      for (const x of out) {
        const before = credited
          .filter((c) => c.saleLineId === x.m.saleLineId)
          .reduce((a, c) => a + Number(c.quantity), 0);
        const same = out.filter((y) => y.m.saleLineId === x.m.saleLineId).reduce((a, y) => a + y.q, 0);
        if (before + same > x.m.qtyInvoiced + 0.0001)
          fail(
            `${x.m.product} belum ditagih sebanyak itu (tertagih ${num(x.m.qtyInvoiced)}); buat invoice dulu atau pilih kirim pengganti`,
          );
      }
    }
    const untaxed = round2(out.reduce((a, x) => a + x.sub, 0));
    const tax = isCredit(b.resolution)
      ? await this.settings.tax(untaxed)
      : { tax: 0, dppNilaiLain: 0, rate: 0, label: '' };
    return { info, out, untaxed, tax, total: round2(untaxed + tax.tax) };
  }

  async create(u: AuthUser, b: ReturnIn) {
    const date = b.date || today();
    const x = await this.build(b);
    const t = x.info.picking;
    const r = await this.db.$transaction(async (tx) => {
      const name = await this.numbering.next(tx, 'RET', date);
      const r = await tx.salesReturns.create({
        data: {
          name,
          saleId: t.saleId!,
          partnerId: t.sale!.partnerId,
          pickingId: t.id,
          date,
          reason: b.reason,
          resolution: b.resolution,
          note: b.note || null,
          amountUntaxed: x.untaxed,
          amountTax: x.tax.tax,
          amountTotal: x.total,
          createUid: u.id,
          writeUid: u.id,
        },
      });
      await tx.salesReturnLines.createMany({
        data: x.out.map((l) => ({
          returnId: r.id,
          moveId: l.m.moveId,
          saleLineId: l.m.saleLineId,
          productId: l.m.productId,
          quantity: l.q,
          priceUnit: l.price,
          subtotal: l.sub,
          createUid: u.id,
        })),
      });
      const late =
        x.info.claimUntil && date > x.info.claimUntil ? ` Klaim melewati batas ${tglIndo(x.info.claimUntil)}.` : '';
      await this.chatter.log(
        MODEL,
        r.id,
        u.id,
        `Retur dibuat dari ${t.name}: ${REASONS[b.reason]}, ${RESOLUTIONS[b.resolution]}.${late}`,
        [],
        tx,
      );
      await this.chatter.log('sales_orders', t.saleId!, u.id, `Retur ${name} dibuat (${REASONS[b.reason]})`, [], tx);
      return r;
    });
    return this.get(r.id);
  }

  async update(u: AuthUser, id: number, b: ReturnIn) {
    const r = must(await this.db.salesReturns.findFirst({ where: { id } }), 'Retur');
    if (r.state !== 'draft') fail('Hanya retur berstatus Draf yang dapat diubah');
    const x = await this.build({ ...b, pickingId: r.pickingId }, id);
    await this.db.$transaction(async (tx) => {
      await tx.salesReturns.updateMany({
        where: { id },
        data: {
          date: b.date || r.date,
          reason: b.reason,
          resolution: b.resolution,
          note: b.note ?? r.note,
          amountUntaxed: x.untaxed,
          amountTax: x.tax.tax,
          amountTotal: x.total,
          writeUid: u.id,
          writeDate: new Date(),
        },
      });
      await tx.salesReturnLines.deleteMany({ where: { returnId: id } });
      await tx.salesReturnLines.createMany({
        data: x.out.map((l) => ({
          returnId: id,
          moveId: l.m.moveId,
          saleLineId: l.m.saleLineId,
          productId: l.m.productId,
          quantity: l.q,
          priceUnit: l.price,
          subtotal: l.sub,
          createUid: u.id,
        })),
      });
      await this.chatter.log(MODEL, id, u.id, 'Retur diubah', [], tx);
    });
    return this.get(id);
  }

  async state(id: number) {
    return must(
      await this.db.salesReturns.findFirst({ where: { id }, select: { state: true, resolution: true } }),
      'Retur',
    );
  }

  // Proses retur: mutasi stok ke Barang Rusak, lalu kirim ulang atau nota kredit
  async process(u: AuthUser, id: number) {
    const r = must(await this.db.salesReturns.findFirst({ where: { id }, include: { lines: true } }), 'Retur');
    if (r.state !== 'draft') fail('Retur sudah diproses atau dibatalkan');
    // periksa ulang terhadap keadaan terbaru (retur lain, invoice yang dibalik)
    const x = await this.build(
      {
        pickingId: r.pickingId,
        reason: r.reason,
        resolution: r.resolution,
        lines: r.lines.map((l: any) => ({
          moveId: l.moveId,
          quantity: Number(l.quantity),
          priceUnit: Number(l.priceUnit),
        })),
      },
      id,
    );
    const so = must(await this.db.salesOrders.findFirst({ where: { id: r.saleId } }), 'Sales order');
    let replacementId: number | null = null;
    await this.db.$transaction(async (tx) => {
      const msgs: string[] = [];
      // barang kembali dari pelanggan ke lokasi Barang Rusak gudang asal (dropship: kembali ke principal, tanpa stok)
      if (r.resolution !== 'potongan' && !x.info.dropship) {
        const cust = await this.stock.virtualLocation('customer', tx);
        const wid = x.info.picking.pickingType.warehouseId!;
        const bad = await this.stock.damagedLocation(wid, tx);
        for (const l of x.out) {
          await this.stock.applyMove(tx, l.m.productId, cust, bad, l.q);
          await tx.stockMoves.create({
            data: {
              productId: l.m.productId,
              locationId: cust.id,
              locationDestId: bad.id,
              productUomQty: l.q,
              quantity: l.q,
              state: 'done',
              createUid: u.id,
            },
          });
        }
        msgs.push(`barang masuk ke ${bad.completeName}`);
      }
      if (r.resolution === 'ganti') {
        // qty terkirim berkurang sehingga SO kembali menunggu pengiriman pengganti; invoice tidak berubah
        for (const l of x.out)
          await tx.salesOrderLines.updateMany({
            where: { id: l.m.saleLineId },
            data: { qtyDelivered: { decrement: l.q } },
          });
        await refreshSale(tx, r.saleId);
        // surat jalan pengganti dibuat langsung, ditandai sebagai pengganti retur
        const src = x.info.picking;
        const wid = src.pickingType.warehouseId!;
        const loc = await this.stock.internalLocation(wid, tx);
        const cust = await this.stock.virtualLocation('customer', tx);
        const name = await this.numbering.next(tx, 'DO', today());
        const rep = await tx.stockTransfers.create({
          data: {
            name,
            pickingTypeId: src.pickingTypeId,
            partnerId: src.partnerId,
            saleId: r.saleId,
            locationId: loc.id,
            locationDestId: cust.id,
            origin: `${so.name} / ${r.name}`,
            scheduledDate: today(),
            state: 'draft',
            note: `${REPLACEMENT_NOTE}${r.name} (pengganti barang dari ${src.name})`,
            createUid: u.id,
          },
        });
        for (const l of x.out) {
          const phys = await this.stock.physical(l.m.productId, wid, tx);
          const other = await this.stock.reservedAhead(l.m.productId, wid, r.saleId, tx);
          await tx.stockMoves.create({
            data: {
              pickingId: rep.id,
              productId: l.m.productId,
              locationId: loc.id,
              locationDestId: cust.id,
              saleLineId: l.m.saleLineId,
              productUomQty: l.q,
              quantity: Math.max(0, Math.min(l.q, phys - other)),
            },
          });
        }
        replacementId = rep.id;
        await this.chatter.log('stock_transfers', rep.id, u.id, `Surat jalan pengganti untuk retur ${r.name}`, [], tx);
        msgs.push(`surat jalan pengganti ${name} dibuat`);
      }
      let refundId: number | null = null;
      if (isCredit(r.resolution)) {
        const label = r.resolution === 'potongan' ? 'Potongan harga' : 'Retur';
        const e = await this.journal.create(tx, {
          journal: 'INV',
          date: r.date,
          partnerId: r.partnerId,
          moveType: 'out_refund',
          invoiceDate: r.date,
          saleId: r.saleId,
          invoiceOrigin: so.name,
          ref: `${label} ${r.name}`,
          post: true,
          uid: u.id,
          amounts: { untaxed: x.untaxed, tax: x.tax.tax, total: x.total },
          lines: [
            ...x.out.map((l) => ({
              key: 'salesReturn',
              debit: l.sub,
              name: `${label} ${l.m.product}`,
              productId: l.m.productId,
              quantity: l.q,
              priceUnit: l.price,
              displayType: 'product',
            })),
            {
              key: 'taxOut',
              debit: x.tax.tax,
              name: `${x.tax.label} ${x.tax.rate}% x DPP nilai lain`,
              displayType: 'tax',
            },
            { key: 'receivable', credit: x.total, name: r.name, displayType: 'payment_term' },
          ],
        });
        refundId = e.id;
        // nota kredit langsung mengurangi invoice SO yang belum lunas, dari jatuh tempo terlama
        const invs = await tx.journalEntries.findMany({
          where: {
            AND: [
              { saleId: r.saleId },
              { moveType: 'out_invoice' },
              { state: 'posted' },
              { amountResidual: { gt: 0 } },
            ],
          },
          orderBy: [{ invoiceDateDue: 'asc' }, { id: 'asc' }],
        });
        let left = x.total;
        for (const inv of invs) {
          if (left <= 0) break;
          const y = round2(Math.min(left, Number(inv.amountResidual)));
          const res = round2(Number(inv.amountResidual) - y);
          await tx.journalEntries.updateMany({
            where: { id: inv.id },
            data: { amountResidual: res, paymentState: res <= 0.5 ? 'paid' : 'partial' },
          });
          await this.chatter.log(
            'journal_entries',
            inv.id,
            u.id,
            `Dikurangi nota kredit ${e.name} (${r.name}) sebesar ${rupiah(y)}`,
            [],
            tx,
          );
          left = round2(left - y);
        }
        await tx.journalEntries.updateMany({
          where: { id: e.id },
          data: { amountResidual: left, paymentState: left <= 0.5 ? 'paid' : left < x.total ? 'partial' : 'not_paid' },
        });
        msgs.push(`nota kredit ${e.name} ${rupiah(x.total)}`);
        if (left > 0.5) msgs.push(`sisa kredit ${rupiah(left)} dapat dikembalikan kepada pelanggan`);
      }
      await tx.salesReturns.updateMany({
        where: { id },
        data: {
          state: 'done',
          refundEntryId: refundId,
          replacementPickingId: replacementId,
          writeUid: u.id,
          writeDate: new Date(),
        },
      });
      await this.chatter.log(
        MODEL,
        id,
        u.id,
        `Retur diproses: ${msgs.join('; ')}`,
        [{ field: 'Status', old: 'Draf', new: 'Selesai' }],
        tx,
      );
      await this.chatter.log('sales_orders', r.saleId, u.id, `Retur ${r.name} diproses: ${msgs.join('; ')}`, [], tx);
    });
    return this.get(id);
  }

  async cancel(u: AuthUser, id: number) {
    const r = must(await this.db.salesReturns.findFirst({ where: { id } }), 'Retur');
    if (r.state !== 'draft') fail('Hanya retur berstatus Draf yang dapat dibatalkan');
    await this.db.salesReturns.updateMany({ where: { id }, data: { state: 'cancel', writeUid: u.id } });
    await this.chatter.log(MODEL, id, u.id, 'Retur dibatalkan', [{ field: 'Status', old: 'Draf', new: 'Batal' }]);
    return this.get(id);
  }

  // Kembalikan sisa kredit nota kredit kepada pelanggan: Debit Piutang Usaha, Kredit Bank atau Kas
  async refund(u: AuthUser, id: number, b: { amount: number; method?: 'BNK' | 'KAS'; date?: string; memo?: string }) {
    const r = must(await this.db.salesReturns.findFirst({ where: { id } }), 'Retur');
    if (!r.refundEntryId) fail('Retur ini tidak memiliki nota kredit');
    const amount = round2(Number(b.amount));
    if (!(amount > 0)) fail('Jumlah pengembalian harus lebih dari 0');
    const method = b.method === 'KAS' ? 'KAS' : 'BNK';
    const date = b.date || today();
    await this.db.$transaction(async (tx) => {
      const cn = must(await tx.journalEntries.findFirst({ where: { id: r.refundEntryId! } }), 'Nota kredit');
      if (amount > Number(cn.amountResidual) + 0.5) fail(`Jumlah melebihi sisa kredit (${rupiah(cn.amountResidual)})`);
      const jr = await this.journal.journal(method, tx);
      const e = await this.journal.create(tx, {
        journal: method,
        date,
        partnerId: r.partnerId,
        ref: `Pengembalian dana ${r.name}${b.memo ? ' – ' + b.memo : ''}`,
        post: true,
        uid: u.id,
        lines: [
          { accountId: await this.journal.map('receivable', tx), debit: amount, name: cn.name },
          { accountId: await this.journal.map(method === 'KAS' ? 'cash' : 'bank', tx), credit: amount, name: r.name },
        ],
      });
      await tx.payments.create({
        data: {
          name: e.name,
          moveId: e.id,
          journalId: jr.id,
          partnerId: r.partnerId,
          invoiceId: cn.id,
          amount,
          date,
          paymentType: 'outbound',
          partnerType: 'customer',
          memo: b.memo || `Pengembalian dana ${r.name}`,
          createUid: u.id,
        },
      });
      const res = round2(Number(cn.amountResidual) - amount);
      await tx.journalEntries.updateMany({
        where: { id: cn.id },
        data: { amountResidual: Math.max(res, 0), paymentState: res <= 0.5 ? 'paid' : 'partial' },
      });
      await this.chatter.log(
        MODEL,
        id,
        u.id,
        `Dana ${rupiah(amount)} dikembalikan kepada pelanggan (${e.name})`,
        [],
        tx,
      );
    });
    return this.get(id);
  }

  // Berita acara barang bermasalah
  async pdfBuffer(u: AuthUser, id: number) {
    const r: any = await this.get(id);
    const signer = (
      await this.db.users.findMany({
        where: { id: r.createUid || u.id },
        include: { partner: { select: { name: true } } },
      })
    ).map((x) => ({ name: x.partner.name, sig: x.signatureId }))[0];
    const credit = isCredit(r.resolution);
    const spec: any = {
      title: 'BERITA ACARA BARANG BERMASALAH',
      titleEn: 'Goods Complaint Report',
      number: r.name,
      infoLeft: [
        ['Pelanggan', 'Customer', r.partner.name],
        ['Alamat', 'Address', [r.partner.street, r.partner.city].filter(Boolean).join(', ') || '-'],
        ['Alasan', 'Reason', r.reasonLabel],
        ['Penyelesaian', 'Resolution', r.resolutionLabel],
      ],
      infoRight: [
        ['Tanggal', 'Date', tglIndo(r.date)],
        ['Sales order', 'Sales order', r.sale.name],
        ['Surat jalan', 'Delivery order', r.picking.name],
        ['PO pelanggan', 'Customer PO', r.sale.clientOrderRef || '-'],
      ],
      columns: [
        { h: 'No', en: 'No', w: 18 },
        { h: 'Produk', en: 'Product', w: '*' },
        { h: 'Satuan', en: 'Unit', w: 45 },
        { h: 'Qty', en: 'Qty', w: 45, align: 'right' },
        ...(credit
          ? [
              { h: r.resolution === 'potongan' ? 'Potongan (Rp)' : 'Harga (Rp)', en: 'Unit', w: 80, align: 'right' },
              { h: 'Subtotal (Rp)', en: 'Amount', w: 85, align: 'right' },
            ]
          : []),
      ],
      rows: r.lines.map((l: any, i: number) => [
        i + 1,
        `[${l.code}] ${l.product}`,
        l.uom,
        num(l.quantity),
        ...(credit ? [idr(l.priceUnit), idr(l.subtotal)] : []),
      ]),
      totals: credit
        ? [
            ['DPP', rupiah(r.amountUntaxed)],
            ['PPN', rupiah(r.amountTax)],
            ['Total nota kredit', rupiah(r.amountTotal)],
          ]
        : undefined,
      note:
        [
          r.note,
          r.resolution === 'ganti' ? 'Barang pengganti dikirim dengan surat jalan baru.' : null,
          r.dropship ? 'Barang dropship dikembalikan langsung kepada principal.' : null,
          r.lateClaim ? `Klaim diajukan setelah batas ${tglIndo(r.claimUntil)}.` : null,
        ]
          .filter(Boolean)
          .join('\n') || undefined,
      receiverBox: true,
      signer: { name: signer?.name || u.name, role: 'PT Mentari Timur Prima Perkasa', signatureId: signer?.sig },
    };
    return { buffer: await this.pdf.document(spec), name: `${r.name.replace(/\//g, '-')}.pdf` };
  }
}
