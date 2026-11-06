import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser, dataRule, stripCost } from '../../shared/auth';
import { NumberingService } from '../../shared/numbering.service';
import { SettingsService } from '../../shared/settings.service';
import { ChatterService } from '../../shared/chatter.service';
import { PdfService } from '../../shared/pdf.service';
import { salePayments } from '../../shared/status';
import { addDays, fail, must, num, round2, rupiah, terbilang, terbilangEn, tglIndo, today } from '../../shared/util';
import { PricingService } from '../master/pricing.service';
import { StockService } from '../stock/stock.service';
import { EmailService } from '../email/email.service';
import { Prisma } from '@prisma/client';

const sql = Prisma.sql;

export const SO_STATE: Record<string, string> = {
  draft: 'Draf',
  sent: 'Terkirim',
  sale: 'Sales Order',
  done: 'Selesai',
  cancel: 'Batal',
};
const MODEL = 'sales_orders';
const HEAD_FIELDS = [
  'partnerId',
  'partnerShippingId',
  'paymentTermId',
  'dateOrder',
  'validityDate',
  'commitmentDate',
  'clientOrderRef',
  'mtppTermPayment',
  'mtppTermDelivery',
  'mtppTermValidity',
  'mtppTermWarranty',
  'mtppTermHandover',
  'mtppTermStandard',
];

export interface LineIn {
  id?: number;
  productId: number;
  name?: string;
  productUomQty: number;
  priceUnit: number;
  discount?: number;
  mtppWarehouseId?: number | null;
  mtppIsDropship?: boolean;
}

@Injectable()
export class SalesService {
  constructor(
    @Inject(DB) private db: Db,
    private numbering: NumberingService,
    private settings: SettingsService,
    private chatter: ChatterService,
    private pricing: PricingService,
    private stock: StockService,
    private pdf: PdfService,
    private email: EmailService,
  ) {}

  async list(u: AuthUser, q: any) {
    const w: any[] = [];
    const rule = dataRule(u, 'sales_orders');
    if (rule) w.push(rule);
    if (q.state) w.push({ state: { in: String(q.state).split(',') } });
    if (q.partnerId) w.push({ partnerId: +q.partnerId });
    if (q.from) w.push({ dateOrder: { gte: q.from } });
    if (q.to) w.push({ dateOrder: { lte: q.to } });
    if (q.q)
      w.push({
        OR: [
          { name: { contains: `${q.q}`, mode: 'insensitive' } },
          { quotationNumber: { contains: `${q.q}`, mode: 'insensitive' } },
          { partner: { name: { contains: `${q.q}`, mode: 'insensitive' } } },
          { clientOrderRef: { contains: `${q.q}`, mode: 'insensitive' } },
        ],
      });
    const rows: any[] = (
      await this.db.salesOrders.findMany({
        where: w.length ? { AND: w } : undefined,
        include: { partner: { select: { name: true, mtppIsNewCustomer: true } } },
        orderBy: { id: 'desc' },
        take: 500,
      })
    ).map(({ partner, ...o }) => ({ o, partner: partner.name, isNew: partner.mtppIsNewCustomer }));
    const t = today();
    let out = rows.map((r) => ({
      ...r.o,
      partner: r.partner,
      isNewCustomer: r.isNew,
      expired: !!r.o.validityDate && r.o.validityDate < t && ['draft', 'sent'].includes(r.o.state),
    }));
    if (q.expired === 'true') out = out.filter((r) => r.expired);
    return out;
  }

  private async computeLines(lines: LineIn[], partnerId: number, date: string) {
    const out: any[] = [];
    for (const [i, l] of lines.entries()) {
      if (!l.productId || !(Number(l.productUomQty) > 0))
        fail('Setiap baris wajib berisi produk dan kuantitas lebih dari 0');
      const pr = await this.pricing.product(l.productId);
      const c = await this.pricing.cost(l.productId, Number(l.productUomQty), date);
      // harga kosong diisi otomatis dari pricelist pelanggan (fitur B.c), jika tidak ada dari harga jual produk
      const auto =
        l.priceUnit == null || (l as any).priceUnit === ''
          ? await this.pricing.salePrice(l.productId, partnerId, Number(l.productUomQty), date)
          : null;
      const qty = Number(l.productUomQty),
        price = Number(auto ? auto.priceUnit : l.priceUnit),
        disc = Number(l.discount ?? auto?.discount ?? 0);
      const subtotal = round2(qty * price * (1 - disc / 100));
      let wh = l.mtppWarehouseId;
      if (!wh && pr.t.mainSupplierId) wh = (await this.pricing.warehouseOf(pr.t.mainSupplierId))?.id;
      out.push({
        productId: l.productId,
        name: l.name || `[${pr.p.defaultCode}] ${pr.t.name}`,
        productUomQty: qty,
        priceUnit: price,
        discount: disc,
        priceSubtotal: subtotal,
        purchasePrice: c.cost,
        margin: round2(subtotal - qty * c.cost),
        mtppWarehouseId: wh || null,
        mtppIsDropship: l.mtppIsDropship ?? pr.t.mtppRoute === 'dropship',
        sequence: (i + 1) * 10,
      });
    }
    return out;
  }

  private async totals(lines: any[]) {
    const untaxed = round2(lines.reduce((a, l) => a + Number(l.priceSubtotal), 0));
    const t = await this.settings.tax(untaxed);
    return { amountUntaxed: untaxed, amountTax: t.tax, amountTotal: round2(untaxed + t.tax) };
  }

  // satu nomor hanya untuk satu dokumen, baik sebagai nomor dokumen maupun nomor penawarannya
  private numberTaken(number: string) {
    return { OR: [{ name: number }, { quotationNumber: number }] };
  }

  async create(u: AuthUser, b: any) {
    if (!b.partnerId) fail('Pelanggan wajib dipilih');
    const partner = must(await this.db.partners.findFirst({ where: { id: +b.partnerId } }), 'Pelanggan');
    const date = b.dateOrder || today();
    const terms = await this.settings.get('terms');
    const lines = await this.computeLines(b.lines || [], partner.id, date);
    const tot = await this.totals(lines);
    return this.db.$transaction(async (tx) => {
      const name = b.name?.trim() || (await this.numbering.next(tx, 'PN', date));
      const exists = await tx.salesOrders.findFirst({ where: this.numberTaken(name) });
      if (exists) fail('Nomor sudah dipakai dokumen lain');
      const o = await tx.salesOrders.create({
        data: {
          name,
          quotationNumber: name,
          partnerId: partner.id,
          partnerShippingId: b.partnerShippingId || null,
          userId: u.id,
          paymentTermId: b.paymentTermId ?? partner.paymentTermId,
          dateOrder: date,
          validityDate: b.validityDate || addDays(date, terms.validityDays || 30),
          commitmentDate: b.commitmentDate || null,
          clientOrderRef: b.clientOrderRef,
          mtppTermPayment: b.mtppTermPayment ?? terms.payment,
          mtppTermDelivery: b.mtppTermDelivery ?? terms.delivery,
          mtppTermValidity: b.mtppTermValidity ?? `${terms.validityDays || 30} hari sejak tanggal penawaran`,
          mtppTermWarranty: b.mtppTermWarranty ?? terms.warranty,
          mtppTermHandover: b.mtppTermHandover ?? terms.handover,
          mtppTermStandard: b.mtppTermStandard ?? terms.standard,
          ...tot,
          createUid: u.id,
          writeUid: u.id,
        },
      });
      if (lines.length) await tx.salesOrderLines.createMany({ data: lines.map((l) => ({ ...l, orderId: o.id })) });
      await this.chatter.log(MODEL, o.id, u.id, 'Penawaran dibuat', [], tx);
      return o;
    });
  }

  async get(u: AuthUser, id: number) {
    const o = must(
      await this.db.salesOrders.findFirst({
        where: { id: id },
        include: { partner: { include: { children: true } }, partnerShipping: true, paymentTerm: true },
      }),
      'Sales order',
    );
    const lines: any[] = (
      await this.db.salesOrderLines.findMany({
        where: { orderId: id },
        include: {
          product: { include: { template: { include: { uom: { select: { name: true } } } } } },
          warehouse: { select: { name: true } },
        },
        orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
      })
    ).map(({ product, warehouse, ...l }) => ({
      l,
      code: product.defaultCode,
      uom: product.template.uom.name,
      warehouse: warehouse?.name ?? null,
    }));
    const transfers = (
      await this.db.stockTransfers.findMany({
        where: { saleId: id },
        select: { id: true, name: true, state: true, scheduledDate: true, pickingType: { select: { code: true } } },
        orderBy: { id: 'asc' },
      })
    ).map(({ pickingType, ...t }) => ({ ...t, code: pickingType.code }));
    const invoices = await this.db.journalEntries.findMany({
      select: { id: true, name: true, state: true, paymentState: true, amountTotal: true, moveType: true },
      where: { AND: [{ saleId: id }, { moveType: { in: ['out_invoice', 'out_refund'] } }] },
    });
    const pos = await this.db.purchaseOrders.findMany({
      select: { id: true, name: true, state: true },
      where: { saleId: id },
    });
    const pay = await this.paid(id, o.amountTotal);
    const ls = lines.map((r) => ({
      ...r.l,
      code: r.code,
      uom: r.uom,
      warehouse: r.warehouse,
      marginPercent: r.l.priceSubtotal ? round2((Number(r.l.margin) / Number(r.l.priceSubtotal)) * 100) : 0,
      costMissing: !Number(r.l.purchasePrice),
    }));
    const costTotal = round2(ls.reduce((a, l) => a + Number(l.purchasePrice) * Number(l.productUomQty), 0));
    const marginTotal = round2(Number(o.amountUntaxed) - costTotal);
    const t = today();
    const res = {
      ...o,
      stateLabel: SO_STATE[o.state],
      expired: !!o.validityDate && o.validityDate < t && ['draft', 'sent'].includes(o.state),
      lines: ls,
      costTotal,
      marginTotal,
      marginPercent: Number(o.amountUntaxed) ? round2((marginTotal / Number(o.amountUntaxed)) * 100) : 0,
      transfers,
      invoices,
      purchaseOrders: pos,
      payment: pay,
      emailStatus: await this.email.lastStatus(MODEL, id),
      canDeliver: o.state === 'sale' && (!o.partner.mtppIsNewCustomer || pay.paidFull),
      deliverable: o.state === 'sale' && (await this.undelivered(id)).length > 0,
      shortage: o.state === 'sale' ? await this.shortage(id) : [],
      readyItems: o.state === 'sale' && (!o.partner.mtppIsNewCustomer || pay.paidFull) ? await this.readyItems(id) : 0,
    };
    return stripCost(u, res);
  }

  // uang muka pelanggan yang sudah dibayar untuk SO ini (rencana bagian 3)
  async paid(id: number, total: number) {
    // uang muka bersih ditambah pembayaran atas invoice SO ini
    const p = await salePayments(this.db, id);
    return {
      advance: p.advance,
      advanceAvailable: p.available,
      amount: p.amount,
      total: Number(total),
      paidFull: p.amount >= Number(total) - 0.5 && Number(total) > 0,
    };
  }

  async update(u: AuthUser, id: number, b: any) {
    const o = must(await this.db.salesOrders.findFirst({ where: { id: id } }), 'Sales order');
    const headOnly = ['commitmentDate', 'clientOrderRef', 'partnerShippingId'];
    if (!['draft', 'sent'].includes(o.state)) {
      // setelah dikonfirmasi baris terkunci; hanya tanggal rencana kirim, PO pelanggan, dan alamat kirim
      if (Object.keys(b).some((k) => !headOnly.includes(k)))
        fail('Sales order sudah dikonfirmasi; batalkan dan kembalikan ke Draf untuk mengubah baris');
    }
    const head: any = {};
    for (const k of HEAD_FIELDS) if (b[k] !== undefined) head[k] = b[k] === '' ? null : b[k];
    if (b.name && b.name !== o.name) {
      if (!['draft', 'sent'].includes(o.state)) fail('Nomor hanya dapat diubah sebelum dikonfirmasi');
      if (o.quotationNumber && o.name !== o.quotationNumber) fail('Nomor sales order tidak dapat diubah');
      if (await this.db.salesOrders.findFirst({ where: { id: { not: id }, ...this.numberTaken(b.name) } }))
        fail('Nomor sudah dipakai dokumen lain');
      head.name = b.name;
      // nomor penawaran selalu ikut, termasuk penawaran lama, supaya nomor PN tercatat di kolom sumber penomoran
      head.quotationNumber = b.name;
    }
    return this.db.$transaction(async (tx) => {
      const changes = this.chatter.diff(o, head, [
        { key: 'name', label: 'Nomor' },
        { key: 'partnerId', label: 'Pelanggan' },
        { key: 'commitmentDate', label: 'Tanggal rencana kirim' },
        { key: 'validityDate', label: 'Berlaku sampai' },
      ]);
      if (b.lines) {
        const old = await tx.salesOrderLines.findMany({ where: { orderId: id } });
        const lines = await this.computeLines(b.lines, head.partnerId || o.partnerId, head.dateOrder || o.dateOrder);
        for (const nl of lines) {
          const ol = old.find((x) => x.productId === nl.productId);
          if (ol && Number(ol.priceUnit) !== Number(nl.priceUnit))
            changes.push({ field: `Harga ${nl.name}`, old: Number(ol.priceUnit), new: Number(nl.priceUnit) });
          if (ol && Number(ol.discount) !== Number(nl.discount))
            changes.push({ field: `Diskon ${nl.name}`, old: Number(ol.discount), new: Number(nl.discount) });
          if (!ol) changes.push({ field: 'Baris ditambah', old: null, new: nl.name });
        }
        const oldIds = old.map((x) => x.id);
        const linked = await tx.purchaseOrderLines.findMany({
          where: { mtppSaleLineId: { in: oldIds } },
          include: { order: { select: { name: true, state: true } } },
        });
        const active = linked.find((l) => l.order.state !== 'cancel');
        if (active) fail(`Baris sudah dipakai PO Principal ${active.order.name}. Batalkan PO Principal itu dulu.`);
        // tautan dari dokumen yang sudah batal dilepas supaya baris dapat diganti
        await tx.purchaseOrderLines.updateMany({
          where: { mtppSaleLineId: { in: oldIds } },
          data: { mtppSaleLineId: null },
        });
        await tx.stockMoves.updateMany({
          where: { saleLineId: { in: oldIds }, picking: { state: 'cancel' } },
          data: { saleLineId: null },
        });
        await tx.salesOrderLines.deleteMany({ where: { orderId: id } });
        if (lines.length) await tx.salesOrderLines.createMany({ data: lines.map((l) => ({ ...l, orderId: id })) });
        Object.assign(head, await this.totals(lines));
      }
      const [r] = await tx.salesOrders.updateManyAndReturn({
        where: { id: id },
        data: { ...head, writeUid: u.id, writeDate: new Date() },
      });
      if (changes.length) await this.chatter.log(MODEL, id, u.id, 'Data diubah', changes, tx);
      return r;
    });
  }

  private async setState(u: AuthUser, id: number, state: string, body: string, extra: any = {}) {
    const o = must(await this.db.salesOrders.findFirst({ where: { id: id } }), 'Sales order');
    await this.db.salesOrders.updateMany({
      where: { id: id },
      data: { state, ...extra, writeUid: u.id, writeDate: new Date() },
    });
    await this.chatter.log(MODEL, id, u.id, body, [{ field: 'Status', old: SO_STATE[o.state], new: SO_STATE[state] }]);
  }

  async confirm(u: AuthUser, id: number, b: any = {}) {
    const notConfirmable = 'Hanya penawaran berstatus Draf atau Terkirim yang dapat dikonfirmasi';
    await this.db.$transaction(async (tx) => {
      const o = must(await tx.salesOrders.findFirst({ where: { id: id } }), 'Sales order');
      if (!['draft', 'sent'].includes(o.state)) fail(notConfirmable);
      if (!(await tx.salesOrderLines.count({ where: { orderId: id } }))) fail('Penawaran belum memiliki baris produk');
      // nomor SO hanya diberikan sekali; penawaran lama bernomor SO dan konfirmasi ulang memakai nomor yang ada
      const soNumber =
        o.quotationNumber && o.name === o.quotationNumber ? await this.numbering.next(tx, 'SO', today()) : null;
      // PO pelanggan: hanya string yang mengubah nilai ('' = dikosongkan); tidak dikirim atau null = tetap
      const po = typeof b.clientOrderRef === 'string' ? b.clientOrderRef.trim() || null : o.clientOrderRef;
      const head =
        b.clientOrderRef !== undefined || b.commitmentDate !== undefined
          ? { clientOrderRef: po, commitmentDate: b.commitmentDate || o.commitmentDate }
          : {};
      const { count } = await tx.salesOrders.updateMany({
        where: { id, state: { in: ['draft', 'sent'] } },
        data: {
          ...head,
          ...(soNumber ? { name: soNumber } : {}),
          state: 'sale',
          dateConfirm: today(),
          invoiceStatus: 'no',
          writeUid: u.id,
          writeDate: new Date(),
        },
      });
      if (count === 0) fail(notConfirmable);
      const changes = [
        { field: 'Status', old: SO_STATE[o.state], new: SO_STATE.sale },
        ...(po !== (o.clientOrderRef ?? null)
          ? [{ field: 'PO Pelanggan', old: o.clientOrderRef ?? '', new: po ?? '' }]
          : []),
        ...(soNumber ? [{ field: 'Nomor', old: o.name, new: soNumber }] : []),
      ];
      await this.chatter.log(
        MODEL,
        id,
        u.id,
        soNumber
          ? `Penawaran ${o.name} dikonfirmasi menjadi sales order ${soNumber}`
          : 'Penawaran dikonfirmasi menjadi sales order',
        changes,
        tx,
      );
    });
    return this.get(u, id);
  }

  async cancel(u: AuthUser, id: number) {
    const o = must(await this.db.salesOrders.findFirst({ where: { id: id } }), 'Sales order');
    if (o.state === 'cancel') fail('Dokumen sudah batal');
    const done = await this.db.stockTransfers.findMany({ where: { AND: [{ saleId: id }, { state: 'done' }] } });
    if (done.length) fail('Sudah ada surat jalan yang divalidasi sehingga tidak dapat dibatalkan');
    const inv = await this.db.journalEntries.findMany({
      where: {
        AND: [{ saleId: id }, { state: 'posted' }, { moveType: 'out_invoice' }, { paymentState: { not: 'reversed' } }],
      },
    });
    if (inv.length) fail('Sudah ada invoice yang diposting sehingga tidak dapat dibatalkan');
    // pesanan principal yang masih berjalan dan uang muka yang belum terpakai diselesaikan lebih dulu
    const activePo = await this.db.purchaseOrders.findMany({
      where: { saleId: id, state: { in: ['draft', 'sent', 'purchase'] } },
      select: { name: true },
    });
    const hasAdvance = (await salePayments(this.db, id)).available > 0.5;
    if (activePo.length && hasAdvance)
      fail(`Batalkan PO Principal ${activePo.map((p) => p.name).join(', ')} dan kembalikan uang muka dulu`);
    if (activePo.length) fail(`Batalkan PO Principal ${activePo.map((p) => p.name).join(', ')} dulu`);
    if (hasAdvance) fail('Kembalikan uang muka dulu');
    await this.db.stockTransfers.updateMany({
      where: { AND: [{ saleId: id }, { state: { in: ['draft', 'waiting', 'assigned'] } }] },
      data: { state: 'cancel' },
    });
    await this.setState(u, id, 'cancel', 'Dokumen dibatalkan');
    return this.get(u, id);
  }

  async toDraft(u: AuthUser, id: number) {
    const o = must(await this.db.salesOrders.findFirst({ where: { id: id } }), 'Sales order');
    if (o.state !== 'cancel') fail('Hanya dokumen batal yang dapat dikembalikan ke Draf');
    await this.setState(u, id, 'draft', 'Dokumen dikembalikan ke Draf');
    return this.get(u, id);
  }

  async copy(u: AuthUser, id: number) {
    const o = must(await this.db.salesOrders.findFirst({ where: { id: id } }), 'Sales order');
    const lines = await this.db.salesOrderLines.findMany({ where: { orderId: id } });
    return this.create(u, {
      partnerId: o.partnerId,
      partnerShippingId: o.partnerShippingId,
      paymentTermId: o.paymentTermId,
      mtppTermPayment: o.mtppTermPayment,
      mtppTermDelivery: o.mtppTermDelivery,
      mtppTermValidity: o.mtppTermValidity,
      mtppTermWarranty: o.mtppTermWarranty,
      mtppTermHandover: o.mtppTermHandover,
      mtppTermStandard: o.mtppTermStandard,
      lines: lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        productUomQty: l.productUomQty,
        priceUnit: l.priceUnit,
        discount: l.discount,
        mtppWarehouseId: l.mtppWarehouseId,
        mtppIsDropship: l.mtppIsDropship,
      })),
    });
  }

  // baris stok yang sisanya belum tertampung surat jalan terbuka (dropship dikirim lewat pesanan principal)
  private async undelivered(id: number) {
    const lines = (await this.db.salesOrderLines.findMany({ where: { orderId: id } })).filter((l) => !l.mtppIsDropship);
    if (!lines.length) return [];
    const open: any[] = await this.db.$queryRaw(
      sql`select m.sale_line_id as id, sum(m.product_uom_qty)::float as q from stock_moves m join stock_transfers t on t.id = m.picking_id where m.sale_line_id in (${Prisma.join(lines.map((l) => l.id))}) and t.state in ('draft', 'waiting', 'assigned') group by m.sale_line_id`,
    );
    return lines
      .map((l) => ({
        l,
        q: round2(Number(l.productUomQty) - Number(l.qtyDelivered) - Number(open.find((x) => x.id === l.id)?.q || 0)),
      }))
      .filter((x) => x.q > 0);
  }

  private row(o: any) {
    return {
      id: o.id,
      name: o.name,
      partner: o.partner.name,
      isNewCustomer: o.partner.mtppIsNewCustomer,
      clientOrderRef: o.clientOrderRef,
      dateConfirm: o.dateConfirm,
      commitmentDate: o.commitmentDate,
      amountTotal: o.amountTotal,
    };
  }

  // Daftar kerja Finance: sales order terkonfirmasi yang masih kekurangan stok dan belum dipesan
  async needPurchase() {
    const orders = await this.db.salesOrders.findMany({
      where: { state: 'sale' },
      include: { partner: true },
      orderBy: { id: 'asc' },
    });
    const out: any[] = [];
    for (const o of orders) {
      const short = (await this.shortage(o.id)).filter((x) => x.shortage > 0);
      if (short.length)
        out.push({
          ...this.row(o),
          items: short.length,
          shortage: round2(short.reduce((a, x) => a + x.shortage, 0)),
          paidAmount: (await salePayments(this.db, o.id)).amount,
        });
    }
    return out;
  }

  // Daftar kerja Operasional: sales order yang stoknya tersedia, pembayarannya memenuhi, dan belum punya surat jalan terbuka
  async readyToShip() {
    const orders = await this.db.salesOrders.findMany({
      where: { state: 'sale' },
      include: { partner: true },
      orderBy: { id: 'asc' },
    });
    const out: any[] = [];
    for (const o of orders) {
      if (o.partner.mtppIsNewCustomer && !(await this.paid(o.id, Number(o.amountTotal))).paidFull) continue;
      const items = await this.readyItems(o.id);
      if (items) out.push({ ...this.row(o), items });
    }
    return out;
  }

  // jumlah baris SO yang sisanya sudah bisa dikirim dari stok bebas
  private async readyItems(id: number) {
    let items = 0;
    for (const { l } of await this.undelivered(id)) {
      if (!l.mtppWarehouseId) continue;
      const free =
        (await this.stock.physical(l.productId, l.mtppWarehouseId)) -
        (await this.stock.reservedAhead(l.productId, l.mtppWarehouseId, id));
      if (free > 0) items++;
    }
    return items;
  }

  // kekurangan stok per baris = sisa - stok tersedia - qty yang sudah dipesan ke principal
  async shortage(id: number) {
    const lines = await this.db.salesOrderLines.findMany({ where: { orderId: id } });
    const out: any[] = [];
    for (const l of lines) {
      const remaining = round2(Number(l.productUomQty) - Number(l.qtyDelivered));
      if (remaining <= 0) continue;
      const [onOrder]: any[] = await this.db.$queryRaw(
        sql`select coalesce(sum(l.product_qty - l.qty_received),0)::float as q from purchase_order_lines l join purchase_orders o on o.id = l.order_id where l.mtpp_sale_line_id = ${l.id} and o.state <> 'cancel'`,
      );
      let available = 0;
      if (!l.mtppIsDropship && l.mtppWarehouseId) {
        const phys = await this.stock.physical(l.productId, l.mtppWarehouseId);
        // stok yang sudah menjadi hak SO yang dikonfirmasi lebih dulu; aturan yang sama dengan pemeriksaan surat jalan
        const other = await this.stock.reservedAhead(l.productId, l.mtppWarehouseId, id);
        available = Math.max(0, phys - other);
      }
      const short = round2(Math.max(0, remaining - available - Number(onOrder.q)));
      out.push({
        lineId: l.id,
        productId: l.productId,
        name: l.name,
        remaining,
        available,
        onOrder: Number(onOrder.q),
        shortage: short,
        dropship: l.mtppIsDropship,
      });
    }
    return out;
  }

  // Algoritma 3.2: perhitungan proforma invoice (nomor PI tetap jika diterbitkan ulang)
  async proforma(
    u: AuthUser,
    id: number,
    b: { mode: 'persen' | 'nominal'; percent?: number; amount?: number; note?: string; date?: string },
  ) {
    const o = must(await this.db.salesOrders.findFirst({ where: { id: id } }), 'Sales order');
    if (o.state !== 'sale') fail('Proforma hanya diterbitkan dari sales order yang sudah dikonfirmasi');
    const total = Number(o.amountTotal);
    let percent = Number(b.percent || 0),
      amount = Number(b.amount || 0);
    if (b.mode === 'persen') amount = round2((total * percent) / 100);
    else percent = total > 0 ? round2((amount / total) * 100) : 0;
    if (amount <= 0 || amount > total + 0.5)
      fail('Nilai proforma harus lebih dari 0 dan tidak melebihi total sales order');
    return this.db.$transaction(async (tx) => {
      const nomor = o.mtppProformaNumber || (await this.numbering.next(tx, 'PI', b.date || today()));
      await tx.salesOrders.updateMany({
        where: { id: id },
        data: {
          mtppProformaNumber: nomor,
          mtppProformaDate: b.date || today(),
          mtppDpMode: b.mode,
          mtppDpPercent: percent,
          mtppDpAmount: amount,
          mtppProformaNote: b.note ?? o.mtppProformaNote,
        },
      });
      await this.chatter.log(
        MODEL,
        id,
        u.id,
        `Proforma ${nomor} diterbitkan (tidak membuat jurnal)`,
        [{ field: 'Nilai proforma', old: Number(o.mtppDpAmount || 0), new: amount }],
        tx,
      );
      return { number: nomor, percent, amount };
    });
  }

  private async docSpec(u: AuthUser, id: number, kind: 'quotation' | 'order' | 'proforma') {
    const o: any = await this.get({ ...u, canSeeCost: false } as AuthUser, id);
    const ship = o.partnerShipping || o.partner;
    const signer = (
      await this.db.users.findMany({
        where: { id: o.userId || u.id },
        include: { partner: { select: { name: true } } },
      })
    ).map((x) => ({ name: x.partner.name, sig: x.signatureId }));
    const tax = await this.settings.tax(Number(o.amountUntaxed));
    const rows = o.lines.map((l: any, i: number) => [
      i + 1,
      l.name,
      `${num(l.productUomQty)} ${l.uom}`,
      num(l.priceUnit),
      l.discount ? num(l.discount, 0) + '%' : '-',
      num(l.priceSubtotal),
    ]);
    const cols = [
      { h: 'No', en: 'No', w: 18 },
      { h: 'Produk', en: 'Product', w: '*' },
      { h: 'Qty', en: 'Qty', w: 50, align: 'right' as const },
      { h: 'Harga (Rp)', en: 'Unit price', w: 70, align: 'right' as const },
      { h: 'Diskon', en: 'Disc.', w: 36, align: 'right' as const },
      { h: 'Subtotal (Rp)', en: 'Amount', w: 80, align: 'right' as const },
    ];
    const base = {
      infoLeft: [
        ['Kepada', 'To', o.partner.name],
        ['Alamat', 'Address', [o.partner.street, o.partner.city].filter(Boolean).join(', ')],
        ['NPWP', 'Tax ID', o.partner.vat || '-'],
        ['Alamat kirim', 'Ship to', [ship.street, ship.city].filter(Boolean).join(', ')],
      ] as any,
      columns: cols,
      rows,
      totals: [
        ['DPP / Subtotal', rupiah(o.amountUntaxed)],
        [`${tax.label} ${tax.rate}% x DPP ${rupiah(tax.dppNilaiLain)}`, rupiah(o.amountTax)],
        ['Total', rupiah(o.amountTotal)],
      ] as any,
      words: terbilang(Number(o.amountTotal)),
      wordsEn: terbilangEn(Number(o.amountTotal)),
      signer: { name: signer[0]?.name || u.name, role: 'PT Mentari Timur Prima Perkasa', signatureId: signer[0]?.sig },
    };
    if (kind === 'proforma') {
      const bank = await this.settings.get('bank');
      return {
        ...base,
        title: 'PROFORMA INVOICE',
        titleEn: 'Proforma Invoice',
        number: o.mtppProformaNumber,
        infoRight: [
          ['Tanggal', 'Date', tglIndo(o.mtppProformaDate)],
          ['Sales order', 'Sales order', o.name],
          ['PO pelanggan', 'Customer PO', o.clientOrderRef || '-'],
          [
            'Pembayaran',
            'Payment',
            o.mtppDpMode === 'persen' ? `${num(o.mtppDpPercent, 0)}% dari total` : 'Nominal tetap',
          ],
        ] as any,
        totals: [...base.totals, ['Jumlah yang diminta / Amount due', rupiah(o.mtppDpAmount)]] as any,
        words: terbilang(Number(o.mtppDpAmount)),
        wordsEn: terbilangEn(Number(o.mtppDpAmount)),
        terms: [
          ['Catatan pembayaran / Payment note', o.mtppProformaNote || bank.text],
          ['Keterangan / Remark', 'Proforma invoice bukan bukti pembayaran dan tidak dicatat sebagai jurnal.'],
        ] as any,
      };
    }
    const quote = kind === 'quotation';
    return {
      ...base,
      title: kind === 'order' ? 'SALES ORDER' : 'SURAT PENAWARAN HARGA',
      titleEn: kind === 'order' ? 'Sales Order Confirmation' : 'Quotation',
      number: kind === 'quotation' ? (o.quotationNumber ?? o.name) : o.name,
      infoRight: [
        ['Tanggal', 'Date', tglIndo(o.dateOrder)],
        ['Berlaku sampai', 'Valid until', tglIndo(o.validityDate)],
        ['PO pelanggan', 'Customer PO', o.clientOrderRef || '-'],
        ...(quote ? [] : [['Term of payment', 'Payment term', o.paymentTerm?.name || '-']]),
      ] as any,
      terms: [
        ...(quote
          ? [
              ['Pembayaran / Payment', o.mtppTermPayment],
              ['Penyerahan / Delivery term', o.mtppTermHandover],
              ['Standar / Standard', o.mtppTermStandard],
            ]
          : []),
        ['Waktu kirim / Delivery', o.mtppTermDelivery],
        ['Masa berlaku / Validity', o.mtppTermValidity],
        ['Garansi / Warranty', o.mtppTermWarranty],
      ] as any,
    };
  }

  async pdfBuffer(u: AuthUser, id: number, kind: 'quotation' | 'order' | 'proforma') {
    const spec: any = await this.docSpec(u, id, kind);
    if (kind === 'proforma' && !spec.number) fail('Proforma belum diterbitkan');
    return { buffer: await this.pdf.document(spec), name: `${spec.number.replace(/\//g, '-')}.pdf`, spec };
  }

  async send(u: AuthUser, id: number, b: { to?: string; kind?: 'quotation' | 'order' | 'proforma' }) {
    const o = must(
      await this.db.salesOrders.findFirst({ where: { id: id }, include: { partner: true } }),
      'Sales order',
    );
    const kind = b.kind || (['draft', 'sent'].includes(o.state) ? 'quotation' : 'order');
    const to = b.to || o.partner.email;
    if (kind === 'quotation') {
      if (!(await this.db.salesOrderLines.count({ where: { orderId: id } })))
        fail('Penawaran belum memiliki baris produk');
      if (!(Number(o.amountTotal) > 0)) fail('Total penawaran masih Rp 0');
    }
    if (!to) fail('Email pelanggan belum diisi');
    const { buffer, name, spec } = await this.pdfBuffer(u, id, kind);
    const title = kind === 'proforma' ? 'Proforma Invoice' : kind === 'order' ? 'Sales Order' : 'Surat Penawaran Harga';
    const r = await this.email.send(
      {
        model: MODEL,
        resId: id,
        documentName: spec.number,
        to,
        subject: `${title} ${spec.number} – PT Mentari Timur Prima Perkasa`,
        html: this.email.html(title, spec.number, o.partner.name),
        pdf: { name, buffer },
      },
      u.id,
    );
    if (o.state === 'draft' && kind === 'quotation' && r.state !== 'gagal')
      await this.setState(u, id, 'sent', `Penawaran dikirim ke ${to}`);
    else await this.chatter.log(MODEL, id, u.id, `${title} dikirim ke ${to}`);
    return r;
  }
}
