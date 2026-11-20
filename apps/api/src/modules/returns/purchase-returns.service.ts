import { nowDate } from '../../shared/clock';
import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser } from '../../shared/auth';
import { ChatterService } from '../../shared/chatter.service';
import { NumberingService } from '../../shared/numbering.service';
import { PdfService } from '../../shared/pdf.service';
import { SettingsService } from '../../shared/settings.service';
import { refreshPurchase } from '../../shared/status';
import { fail, idr, must, num, round2, rupiah, tglIndo, today } from '../../shared/util';
import { JournalService } from '../accounting/journal.service';
import { StockService } from '../stock/stock.service';

const MODEL = 'purchase_returns';
export const P_RET_STATE: Record<string, string> = { draft: 'Draf', done: 'Selesai', cancel: 'Batal' };
export const P_RESOLUTIONS: Record<string, string> = {
  ganti: 'Principal mengirim barang pengganti',
  nota_kredit: 'Nota kredit dari principal',
};

interface PReturnIn {
  purchaseId: number;
  date?: string;
  resolution: string;
  note?: string;
  lines: { purchaseLineId: number; quantity: number }[];
}

// Retur barang rusak ke principal atas satu PO. Barang keluar dari lokasi Barang Rusak gudang PO.
// ganti: penerimaan barang pengganti dibuat (tanpa mengubah qty diterima PO).
// nota_kredit: utang ke principal berkurang (Debit Utang Usaha, Kredit Pembelian dan PPN Masukan).
@Injectable()
export class PurchaseReturnsService {
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
    if (q.purchaseId) w.push({ purchaseId: +q.purchaseId });
    if (q.state) w.push({ state: { in: String(q.state).split(',') } });
    if (q.q)
      w.push({
        OR: [
          { name: { contains: `${q.q}`, mode: 'insensitive' } },
          { partner: { name: { contains: `${q.q}`, mode: 'insensitive' } } },
          { purchase: { name: { contains: `${q.q}`, mode: 'insensitive' } } },
        ],
      });
    const rows = await this.db.purchaseReturns.findMany({
      where: w.length ? { AND: w } : undefined,
      include: { partner: { select: { name: true } }, purchase: { select: { name: true } } },
      orderBy: { id: 'desc' },
      take: 500,
    });
    return rows.map(({ partner, purchase, ...r }) => ({
      ...r,
      partner: partner.name,
      purchase: purchase.name,
      stateLabel: P_RET_STATE[r.state],
      resolutionLabel: P_RESOLUTIONS[r.resolution],
    }));
  }

  // baris PO yang dapat diretur: dibatasi qty diterima dan stok Barang Rusak gudang PO
  async returnable(purchaseId: number, exceptId?: number) {
    const po = must(
      await this.db.purchaseOrders.findFirst({ where: { id: purchaseId }, include: { partner: true } }),
      'PO Principal',
    );
    if (!['purchase', 'done'].includes(po.state)) fail('Retur hanya untuk PO yang sudah dikonfirmasi');
    if (!po.warehouseId) fail('PO tidak memiliki gudang');
    const lines = await this.db.purchaseOrderLines.findMany({
      where: { orderId: purchaseId },
      include: { product: { include: { template: { include: { uom: { select: { name: true } } } } } } },
      orderBy: { id: 'asc' },
    });
    const bad = await this.stock.damagedLocation(po.warehouseId);
    const bal = await this.db.stockBalances.findMany({
      where: { locationId: bad.id, productId: { in: lines.map((l) => l.productId) } },
    });
    const others = await this.db.purchaseReturnLines.findMany({
      where: { ret: { state: { not: 'cancel' }, ...(exceptId ? { id: { not: exceptId } } : {}) } },
      include: { ret: { select: { state: true, warehouseId: true, resolution: true } } },
    });
    return {
      po,
      warehouseId: po.warehouseId,
      lines: lines.map((l) => {
        const mine = others.filter((x) => x.purchaseLineId === l.id);
        const returned = round2(mine.reduce((a, x) => a + Number(x.quantity), 0));
        const credited = round2(
          mine.filter((x) => x.ret.resolution === 'nota_kredit').reduce((a, x) => a + Number(x.quantity), 0),
        );
        // stok Barang Rusak yang sudah dijanjikan untuk retur draf lain atas produk dan gudang yang sama
        const held = round2(
          others
            .filter(
              (x) => x.productId === l.productId && x.ret.state === 'draft' && x.ret.warehouseId === po.warehouseId,
            )
            .reduce((a, x) => a + Number(x.quantity), 0),
        );
        const damaged = Number(bal.find((b) => b.productId === l.productId)?.quantity || 0);
        return {
          purchaseLineId: l.id,
          productId: l.productId,
          code: l.product.defaultCode,
          product: l.product.template.name,
          uom: l.product.template.uom.name,
          received: Number(l.qtyReceived),
          invoiced: Number(l.qtyInvoiced),
          returned,
          credited,
          damaged: round2(Math.max(damaged - held, 0)),
          available: round2(Math.max(Math.min(Number(l.qtyReceived) - returned, damaged - held), 0)),
          priceUnit: Number(l.priceUnit),
        };
      }),
    };
  }

  async get(id: number) {
    const r = must(
      await this.db.purchaseReturns.findFirst({
        where: { id },
        include: {
          partner: true,
          purchase: { select: { id: true, name: true } },
          warehouse: { select: { name: true, code: true } },
          refundEntry: { select: { id: true, name: true, amountResidual: true, amountTotal: true } },
          receipt: { select: { id: true, name: true, state: true } },
          lines: {
            include: { product: { include: { template: { include: { uom: { select: { name: true } } } } } } },
            orderBy: { id: 'asc' },
          },
        },
      }),
      'Retur principal',
    );
    return {
      ...r,
      stateLabel: P_RET_STATE[r.state],
      resolutionLabel: P_RESOLUTIONS[r.resolution],
      lines: r.lines.map(({ product, ...l }: any) => ({
        ...l,
        code: product.defaultCode,
        product: product.template.name,
        uom: product.template.uom.name,
      })),
    };
  }

  private async build(b: PReturnIn, exceptId?: number) {
    if (!P_RESOLUTIONS[b.resolution]) fail('Pilih penyelesaian retur ke principal');
    const info = await this.returnable(+b.purchaseId, exceptId);
    const lines = (b.lines || []).filter((x) => Number(x.quantity) > 0);
    if (!lines.length) fail('Isi kuantitas barang yang dikembalikan');
    const out = [];
    for (const x of lines) {
      const l = info.lines.find((y) => y.purchaseLineId === +x.purchaseLineId);
      if (!l) fail('Baris tidak berasal dari PO ini');
      const q = round2(Number(x.quantity));
      if (q > l!.available + 0.0001)
        fail(`Kuantitas ${l!.product} melebihi stok Barang Rusak yang dapat diretur (${num(l!.available)})`);
      if (b.resolution === 'nota_kredit' && l!.credited + q > l!.invoiced + 0.0001)
        fail(
          `${l!.product} belum ditagih principal sebanyak itu (tertagih ${num(l!.invoiced)}); catat tagihan dulu atau pilih barang pengganti`,
        );
      const price = b.resolution === 'nota_kredit' ? l!.priceUnit : 0;
      out.push({ l: l!, q, price, sub: round2(price * q) });
    }
    const untaxed = round2(out.reduce((a, x) => a + x.sub, 0));
    const tax = b.resolution === 'nota_kredit' ? await this.settings.tax(untaxed) : { tax: 0, rate: 0, label: '' };
    return { info, out, untaxed, tax, total: round2(untaxed + tax.tax) };
  }

  async create(u: AuthUser, b: PReturnIn) {
    const date = b.date || today();
    const x = await this.build(b);
    const r = await this.db.$transaction(async (tx) => {
      const name = await this.numbering.next(tx, 'RP', date);
      const r = await tx.purchaseReturns.create({
        data: {
          name,
          purchaseId: x.info.po.id,
          partnerId: x.info.po.partnerId,
          warehouseId: x.info.warehouseId!,
          date,
          resolution: b.resolution,
          note: b.note || null,
          amountUntaxed: x.untaxed,
          amountTax: x.tax.tax,
          amountTotal: x.total,
          createUid: u.id,
          writeUid: u.id,
        },
      });
      await tx.purchaseReturnLines.createMany({
        data: x.out.map((l) => ({
          returnId: r.id,
          purchaseLineId: l.l.purchaseLineId,
          productId: l.l.productId,
          quantity: l.q,
          priceUnit: l.price,
          subtotal: l.sub,
          createUid: u.id,
        })),
      });
      await this.chatter.log(MODEL, r.id, u.id, `Retur ke principal dibuat: ${P_RESOLUTIONS[b.resolution]}`, [], tx);
      await this.chatter.log('purchase_orders', x.info.po.id, u.id, `Retur ke principal ${name} dibuat`, [], tx);
      return r;
    });
    return this.get(r.id);
  }

  async state(id: number) {
    return must(
      await this.db.purchaseReturns.findFirst({ where: { id }, select: { state: true, resolution: true } }),
      'Retur principal',
    );
  }

  async process(u: AuthUser, id: number) {
    const r = must(
      await this.db.purchaseReturns.findFirst({ where: { id }, include: { lines: true } }),
      'Retur principal',
    );
    if (r.state !== 'draft') fail('Retur sudah diproses atau dibatalkan');
    const x = await this.build(
      {
        purchaseId: r.purchaseId,
        resolution: r.resolution,
        lines: r.lines.map((l: any) => ({ purchaseLineId: l.purchaseLineId, quantity: Number(l.quantity) })),
      },
      id,
    );
    const po = x.info.po;
    await this.db.$transaction(async (tx) => {
      const msgs: string[] = [];
      const bad = await this.stock.damagedLocation(r.warehouseId, tx);
      const sup = await this.stock.virtualLocation('supplier', tx);
      for (const l of x.out) {
        await this.stock.applyMove(tx, l.l.productId, bad, sup, l.q);
        await tx.stockMoves.create({
          data: {
            productId: l.l.productId,
            locationId: bad.id,
            locationDestId: sup.id,
            productUomQty: l.q,
            quantity: l.q,
            state: 'done',
            createUid: u.id,
          },
        });
      }
      msgs.push(`barang keluar dari ${bad.completeName} ke principal`);
      let receiptId: number | null = null,
        refundId: number | null = null;
      if (r.resolution === 'ganti') {
        // penerimaan barang pengganti; tidak menambah qty diterima PO karena menggantikan barang yang sudah diterima
        const [type] = await tx.transferTypes.findMany({
          where: { AND: [{ warehouseId: r.warehouseId }, { code: 'incoming' }] },
        });
        const loc = await this.stock.internalLocation(r.warehouseId, tx);
        let n = 1,
          name = `${po.name}-R${n}`;
        while (await tx.stockTransfers.findFirst({ where: { name } })) name = `${po.name}-R${++n}`;
        const t = await tx.stockTransfers.create({
          data: {
            name,
            pickingTypeId: type.id,
            partnerId: po.partnerId,
            purchaseId: po.id,
            locationId: sup.id,
            locationDestId: loc.id,
            origin: `${po.name} / ${r.name}`,
            scheduledDate: today(),
            state: 'waiting',
            note: `Pengganti retur principal ${r.name}`,
            createUid: u.id,
          },
        });
        for (const l of x.out)
          await tx.stockMoves.create({
            data: {
              pickingId: t.id,
              productId: l.l.productId,
              locationId: sup.id,
              locationDestId: loc.id,
              productUomQty: l.q,
              quantity: l.q,
            },
          });
        receiptId = t.id;
        msgs.push(`penerimaan barang pengganti ${name} dibuat`);
      } else {
        const e = await this.journal.create(tx, {
          journal: 'BILL',
          date: r.date,
          partnerId: r.partnerId,
          moveType: 'in_refund',
          invoiceDate: r.date,
          purchaseId: po.id,
          invoiceOrigin: po.name,
          ref: `Retur principal ${r.name}`,
          post: true,
          uid: u.id,
          amounts: { untaxed: x.untaxed, tax: x.tax.tax, total: x.total },
          lines: [
            { key: 'payable', debit: x.total, name: r.name, displayType: 'payment_term' },
            ...x.out.map((l) => ({
              key: 'expense',
              credit: l.sub,
              name: `Retur ${l.l.product}`,
              productId: l.l.productId,
              quantity: l.q,
              priceUnit: l.price,
              displayType: 'product',
            })),
            { key: 'taxIn', credit: x.tax.tax, name: `${x.tax.label} masukan`, displayType: 'tax' },
          ],
        });
        refundId = e.id;
        // nota kredit langsung mengurangi tagihan principal yang masih terbuka, dari jatuh tempo terlama
        const bills = await tx.journalEntries.findMany({
          where: {
            AND: [
              { purchaseId: po.id },
              { state: 'posted' },
              { moveType: 'in_invoice' },
              { amountResidual: { gt: 0 } },
            ],
          },
          orderBy: { invoiceDateDue: 'asc' },
        });
        let left = x.total;
        for (const bill of bills) {
          if (left <= 0) break;
          const y = round2(Math.min(left, Number(bill.amountResidual)));
          const res = round2(Number(bill.amountResidual) - y);
          await tx.journalEntries.updateMany({
            where: { id: bill.id },
            data: { amountResidual: res, paymentState: res <= 0.5 ? 'paid' : 'partial' },
          });
          left = round2(left - y);
        }
        await tx.journalEntries.updateMany({
          where: { id: e.id },
          data: { amountResidual: left, paymentState: left <= 0.5 ? 'paid' : left < x.total ? 'partial' : 'not_paid' },
        });
        await refreshPurchase(tx, po.id);
        msgs.push(`nota kredit ${e.name} ${rupiah(x.total)}`);
        if (left > 0.5) msgs.push(`sisa ${rupiah(left)} menjadi piutang ke principal`);
      }
      await tx.purchaseReturns.updateMany({
        where: { id },
        data: { state: 'done', receiptId, refundEntryId: refundId, writeUid: u.id, writeDate: nowDate() },
      });
      await this.chatter.log(
        MODEL,
        id,
        u.id,
        `Retur diproses: ${msgs.join('; ')}`,
        [{ field: 'Status', old: 'Draf', new: 'Selesai' }],
        tx,
      );
      await this.chatter.log('purchase_orders', po.id, u.id, `Retur ${r.name} diproses: ${msgs.join('; ')}`, [], tx);
    });
    return this.get(id);
  }

  async cancel(u: AuthUser, id: number) {
    const r = must(await this.db.purchaseReturns.findFirst({ where: { id } }), 'Retur principal');
    if (r.state !== 'draft') fail('Hanya retur berstatus Draf yang dapat dibatalkan');
    await this.db.purchaseReturns.updateMany({ where: { id }, data: { state: 'cancel', writeUid: u.id } });
    await this.chatter.log(MODEL, id, u.id, 'Retur dibatalkan', [{ field: 'Status', old: 'Draf', new: 'Batal' }]);
    return this.get(id);
  }

  async pdfBuffer(u: AuthUser, id: number) {
    const r: any = await this.get(id);
    const signer = (
      await this.db.users.findMany({
        where: { id: r.createUid || u.id },
        include: { partner: { select: { name: true } } },
      })
    ).map((x) => ({ name: x.partner.name, sig: x.signatureId }))[0];
    const credit = r.resolution === 'nota_kredit';
    const spec: any = {
      title: 'BUKTI RETUR KE PRINCIPAL',
      titleEn: 'Return to Supplier',
      number: r.name,
      infoLeft: [
        ['Principal', 'Supplier', r.partner.name],
        ['Alamat', 'Address', [r.partner.street, r.partner.city].filter(Boolean).join(', ') || '-'],
        ['Penyelesaian', 'Resolution', r.resolutionLabel],
      ],
      infoRight: [
        ['Tanggal', 'Date', tglIndo(r.date)],
        ['PO Principal', 'Purchase order', r.purchase.name],
        ['Gudang', 'Warehouse', r.warehouse.name],
      ],
      columns: [
        { h: 'No', en: 'No', w: 18 },
        { h: 'Produk', en: 'Product', w: '*' },
        { h: 'Satuan', en: 'Unit', w: 45 },
        { h: 'Qty', en: 'Qty', w: 45, align: 'right' },
        ...(credit
          ? [
              { h: 'Harga (Rp)', en: 'Unit price', w: 80, align: 'right' },
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
        [r.note, r.resolution === 'ganti' ? 'Mohon kirim barang pengganti dalam kondisi baik.' : null]
          .filter(Boolean)
          .join('\n') || undefined,
      receiverBox: true,
      signer: { name: signer?.name || u.name, role: 'PT Mentari Timur Prima Perkasa', signatureId: signer?.sig },
    };
    return { buffer: await this.pdf.document(spec), name: `${r.name.replace(/\//g, '-')}.pdf` };
  }
}
