import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser, dataRule } from '../../shared/auth';
import { NumberingService } from '../../shared/numbering.service';
import { SettingsService } from '../../shared/settings.service';
import { ChatterService } from '../../shared/chatter.service';
import { PdfService } from '../../shared/pdf.service';
import { refreshPurchase } from '../../shared/status';
import { addDays, fail, must, num, round2, rupiah, terbilang, terbilangEn, tglIndo, today } from '../../shared/util';
import { PricingService } from '../master/pricing.service';
import { TransfersService } from '../stock/transfers.service';
import { SalesService } from '../sales/sales.service';
import { EmailService } from '../email/email.service';

export const PO_STATE: Record<string, string> = {
  draft: 'Permintaan',
  sent: 'Terkirim',
  purchase: 'Pesanan',
  done: 'Selesai',
  cancel: 'Batal',
};

const MODEL = 'purchase_orders';

// Pesanan kepada principal (F.b), pemantauan pesanan (E.a), status bayar (F.c, Algoritma 3.3)
@Injectable()
export class PurchasingService {
  constructor(
    @Inject(DB) private db: Db,
    private numbering: NumberingService,
    private settings: SettingsService,
    private chatter: ChatterService,
    private pdf: PdfService,
    private pricing: PricingService,
    private transfers: TransfersService,
    private sales: SalesService,
    private email: EmailService,
  ) {}

  async list(q: any, u?: AuthUser) {
    const w: any[] = [];
    const rule = u && dataRule(u, 'purchase_orders');
    if (rule) w.push(rule);
    if (q.state) w.push({ state: { in: String(q.state).split(',') } });
    if (q.partnerId) w.push({ partnerId: +q.partnerId });
    if (q.saleId) w.push({ saleId: +q.saleId });
    if (q.paymentState) w.push({ mtppPaymentState: q.paymentState });
    if (q.q)
      w.push({
        OR: [
          { name: { contains: `${q.q}`, mode: 'insensitive' } },
          { partner: { name: { contains: `${q.q}`, mode: 'insensitive' } } },
        ],
      });
    const rows: any[] = (
      await this.db.purchaseOrders.findMany({
        where: w.length ? { AND: w } : undefined,
        include: { partner: { select: { name: true } }, sale: { select: { name: true } } },
        orderBy: { id: 'desc' },
        take: 500,
      })
    ).map(({ partner, sale, ...o }) => ({ o, partner: partner.name, sale: sale?.name ?? null }));
    return rows.map((r) => ({ ...r.o, partner: r.partner, sale: r.sale, stateLabel: PO_STATE[r.o.state] }));
  }

  async get(id: number) {
    const o = must(
      await this.db.purchaseOrders.findFirst({
        where: { id: id },
        include: { partner: true, warehouse: true, sale: true },
      }),
      'Pesanan',
    );
    const lines: any[] = (
      await this.db.purchaseOrderLines.findMany({
        where: { orderId: id },
        include: { product: { include: { template: { include: { uom: { select: { name: true } } } } } } },
        orderBy: { id: 'asc' },
      })
    ).map(({ product, ...l }) => ({ l, code: product.defaultCode, uom: product.template.uom.name }));
    const transfers = await this.db.stockTransfers.findMany({
      select: { id: true, name: true, state: true, scheduledDate: true },
      where: { purchaseId: id },
      orderBy: { id: 'asc' },
    });
    const bills = await this.db.journalEntries.findMany({
      where: { AND: [{ purchaseId: id }, { moveType: { in: ['in_invoice', 'in_refund'] } }] },
      orderBy: { id: 'asc' },
    });
    const dest = o.destAddressId ? await this.db.partners.findFirst({ where: { id: o.destAddressId } }) : null;
    return {
      ...o,
      stateLabel: PO_STATE[o.state],
      destAddress: dest,
      lines: lines.map((r) => ({ ...r.l, code: r.code, uom: r.uom })),
      transfers,
      bills,
      emailStatus: await this.email.lastStatus(MODEL, id),
    };
  }

  private async totals(lines: any[]) {
    const untaxed = round2(lines.reduce((a, l) => a + Number(l.priceSubtotal), 0));
    const t = await this.settings.tax(untaxed);
    return { amountUntaxed: untaxed, amountTax: t.tax, amountTotal: round2(untaxed + t.tax) };
  }

  // Buat Pesanan Principal dari SO: satu PO per principal untuk kekurangan stok (rencana bagian 4)
  async fromSale(u: AuthUser, saleId: number) {
    const so = must(await this.db.salesOrders.findFirst({ where: { id: saleId } }), 'Sales order');
    if (so.state !== 'sale') fail('PO Principal dibuat setelah sales order dikonfirmasi');
    const short = (await this.sales.shortage(saleId)).filter((x) => x.shortage > 0);
    if (!short.length) fail('Stok mencukupi; tidak ada barang yang perlu dipesan');
    const groups = new Map<string, any[]>();
    for (const x of short) {
      const pr = await this.pricing.product(x.productId);
      if (!pr.t.mainSupplierId) fail(`Produk ${x.name} belum memiliki principal pemasok`);
      const key = `${pr.t.mainSupplierId}-${x.dropship ? 1 : 0}`;
      groups.set(key, [...(groups.get(key) || []), { ...x, supplierId: pr.t.mainSupplierId }]);
    }
    const poTerms = await this.settings.get('po_terms');
    const created: any[] = [];
    await this.db.$transaction(async (tx) => {
      for (const items of groups.values()) {
        const sup = items[0].supplierId,
          drop = !!items[0].dropship;
        const wh = await this.pricing.warehouseOf(sup);
        const lines = [];
        for (const x of items) {
          const c = await this.pricing.cost(x.productId, x.shortage, today(), sup);
          if (c.missing) fail(`Harga principal untuk ${x.name} belum ada atau sudah tidak berlaku`);
          lines.push({
            productId: x.productId,
            name: x.name,
            productQty: x.shortage,
            priceUnit: c.cost,
            priceSubtotal: round2(c.cost * x.shortage),
            mtppSaleLineId: x.lineId,
            datePlanned: so.commitmentDate || addDays(today(), 14),
          });
        }
        const tot = await this.totals(lines);
        const name = await this.numbering.next(tx, 'PO', today());
        const po = await tx.purchaseOrders.create({
          data: {
            name,
            partnerId: sup,
            warehouseId: wh?.id,
            saleId,
            isDropship: drop,
            destAddressId: drop ? so.partnerShippingId || so.partnerId : null,
            dateOrder: today(),
            datePlanned: so.commitmentDate || addDays(today(), 14),
            note: poTerms.note,
            ...tot,
            createUid: u.id,
            writeUid: u.id,
          },
        });
        await tx.purchaseOrderLines.createMany({ data: lines.map((l) => ({ ...l, orderId: po.id })) });
        await this.chatter.log(MODEL, po.id, u.id, `Permintaan dibuat dari ${so.name}`, [], tx);
        await this.chatter.log('sales_orders', saleId, u.id, `PO Principal ${name} dibuat`, [], tx);
        created.push(po);
      }
    });
    return created;
  }

  async update(u: AuthUser, id: number, b: any) {
    const o = must(await this.db.purchaseOrders.findFirst({ where: { id: id } }), 'Pesanan');
    const editable = ['draft', 'sent'].includes(o.state);
    if (!editable && Object.keys(b).some((k) => !['datePlanned', 'note'].includes(k)))
      fail('Pesanan sudah dikonfirmasi; hanya tanggal perkiraan tiba dan catatan yang dapat diubah');
    return this.db.$transaction(async (tx) => {
      const head: any = {};
      for (const k of ['datePlanned', 'note']) if (b[k] !== undefined) head[k] = b[k] || null;
      const changes = this.chatter.diff(o, head, [{ key: 'datePlanned', label: 'Perkiraan tiba' }]);
      if (b.lines && editable) {
        const old = await tx.purchaseOrderLines.findMany({ where: { orderId: id } });
        const lines = b.lines.map((l: any) => ({
          productId: l.productId,
          name: l.name,
          productQty: Number(l.productQty),
          priceUnit: Number(l.priceUnit),
          priceSubtotal: round2(Number(l.productQty) * Number(l.priceUnit)),
          mtppSaleLineId: l.mtppSaleLineId || null,
          datePlanned: head.datePlanned || o.datePlanned,
        }));
        if (lines.some((l: any) => !(l.productQty > 0))) fail('Kuantitas harus lebih dari 0');
        const noPrice = lines.find((l: any) => !(l.priceUnit > 0));
        if (noPrice) fail(`Harga principal untuk ${noPrice.name} belum ada atau sudah tidak berlaku`);
        for (const nl of lines) {
          const ol = old.find((x) => x.productId === nl.productId);
          if (ol && Number(ol.priceUnit) !== nl.priceUnit)
            changes.push({ field: `Harga ${nl.name}`, old: Number(ol.priceUnit), new: nl.priceUnit });
        }
        await tx.purchaseOrderLines.deleteMany({ where: { orderId: id } });
        await tx.purchaseOrderLines.createMany({ data: lines.map((l: any) => ({ ...l, orderId: id })) });
        Object.assign(head, await this.totals(lines));
      }
      const [r] = await tx.purchaseOrders.updateManyAndReturn({
        where: { id: id },
        data: { ...head, writeUid: u.id, writeDate: new Date() },
      });
      if (changes.length) await this.chatter.log(MODEL, id, u.id, 'Data diubah', changes, tx);
      if (head.datePlanned)
        await tx.stockTransfers.updateMany({
          where: { AND: [{ purchaseId: id }, { state: { in: ['waiting', 'draft'] } }] },
          data: { scheduledDate: head.datePlanned },
        });
      return r;
    });
  }

  async confirm(u: AuthUser, id: number) {
    const o = must(await this.db.purchaseOrders.findFirst({ where: { id: id } }), 'Pesanan');
    if (!['draft', 'sent'].includes(o.state)) fail('Pesanan sudah dikonfirmasi atau batal');
    const lines = await this.db.purchaseOrderLines.findMany({ where: { orderId: id } });
    await this.db.$transaction(async (tx) => {
      await tx.purchaseOrders.updateMany({ where: { id: id }, data: { state: 'purchase', writeUid: u.id } });
      const items = lines.map((l) => ({
        productId: l.productId,
        qty: Number(l.productQty),
        purchaseLineId: l.id,
        saleLineId: l.mtppSaleLineId,
      }));
      const t = o.isDropship
        ? await this.transfers.createDropship(tx, o, items, u.id)
        : await this.transfers.createReceipt(tx, o, items, u.id);
      await this.chatter.log(
        MODEL,
        id,
        u.id,
        `Pesanan dikonfirmasi principal; ${o.isDropship ? 'surat jalan dropship' : 'penerimaan barang'} ${t.name} dibuat`,
        [{ field: 'Status', old: PO_STATE[o.state], new: 'Pesanan' }],
        tx,
      );
      await refreshPurchase(tx, id);
    });
    return this.get(id);
  }

  async cancel(u: AuthUser, id: number) {
    const o = must(await this.db.purchaseOrders.findFirst({ where: { id: id } }), 'Pesanan');
    const lines = await this.db.purchaseOrderLines.findMany({ where: { orderId: id } });
    if (lines.some((l) => Number(l.qtyReceived) > 0))
      fail('Barang sudah diterima sebagian sehingga pesanan tidak dapat dibatalkan');
    await this.db.stockTransfers.updateMany({
      where: { AND: [{ purchaseId: id }, { state: { not: 'done' } }] },
      data: { state: 'cancel' },
    });
    await this.db.purchaseOrders.updateMany({ where: { id: id }, data: { state: 'cancel' } });
    await this.chatter.log(MODEL, id, u.id, 'Pesanan dibatalkan', [
      { field: 'Status', old: PO_STATE[o.state], new: 'Batal' },
    ]);
    return this.get(id);
  }

  // Tutup sisa PO: barang yang belum datang tidak akan dikirim principal, sehingga tidak lagi dihitung sebagai dipesan
  async closeRemaining(u: AuthUser, id: number) {
    const o = must(await this.db.purchaseOrders.findFirst({ where: { id: id } }), 'Pesanan');
    if (o.state !== 'purchase') fail('Hanya pesanan yang sudah dikonfirmasi yang dapat ditutup sisanya');
    const lines = await this.db.purchaseOrderLines.findMany({ where: { orderId: id } });
    if (!lines.some((l) => Number(l.qtyReceived) > 0)) fail('Belum ada barang diterima; gunakan Batalkan');
    if (!lines.some((l) => Number(l.qtyReceived) < Number(l.productQty)))
      fail('Tidak ada sisa barang yang perlu ditutup');
    await this.db.$transaction(async (tx) => {
      await tx.stockTransfers.updateMany({
        where: { AND: [{ purchaseId: id }, { state: { notIn: ['done', 'cancel'] } }] },
        data: { state: 'cancel' },
      });
      const next = lines.map((l) => ({
        ...l,
        productQty: Number(l.qtyReceived),
        priceSubtotal: round2(Number(l.qtyReceived) * Number(l.priceUnit)),
      }));
      for (const l of next)
        await tx.purchaseOrderLines.updateMany({
          where: { id: l.id },
          data: { productQty: l.productQty, priceSubtotal: l.priceSubtotal },
        });
      await tx.purchaseOrders.updateMany({
        where: { id: id },
        data: { ...(await this.totals(next)), writeUid: u.id, writeDate: new Date() },
      });
      const changes = lines
        .filter((l) => Number(l.qtyReceived) < Number(l.productQty))
        .map((l) => ({ field: `Kuantitas ${l.name}`, old: Number(l.productQty), new: Number(l.qtyReceived) }));
      await this.chatter.log(
        MODEL,
        id,
        u.id,
        'Sisa pesanan ditutup; barang yang belum diterima tidak lagi dipesan',
        changes,
        tx,
      );
      await refreshPurchase(tx, id);
    });
    return this.get(id);
  }

  async pdfBuffer(u: AuthUser, id: number) {
    const o: any = await this.get(id);
    const signer = (
      await this.db.users.findMany({
        where: { id: o.createUid || u.id },
        include: { partner: { select: { name: true } } },
      })
    ).map((x) => ({ name: x.partner.name, sig: x.signatureId }));
    const tax = await this.settings.tax(Number(o.amountUntaxed));
    const dest = o.isDropship ? o.destAddress : null;
    const spec: any = {
      title: 'PESANAN PRINCIPAL',
      titleEn: 'Purchase Order',
      number: o.name,
      notesKey: 'po',
      infoLeft: [
        ['Kepada', 'To', o.partner.name],
        ['Alamat', 'Address', [o.partner.street, o.partner.city].filter(Boolean).join(', ')],
        ['Kirim ke', 'Deliver to', dest ? `${dest.name}, ${dest.street || ''} ${dest.city || ''}` : o.warehouse?.name],
      ],
      infoRight: [
        ['Tanggal', 'Date', tglIndo(o.dateOrder)],
        ['Perkiraan tiba', 'Expected', tglIndo(o.datePlanned)],
        ['Referensi', 'Reference', o.sale?.name || '-'],
      ],
      columns: [
        { h: 'No', en: 'No', w: 18 },
        { h: 'Produk', en: 'Product', w: '*' },
        { h: 'Qty', en: 'Qty', w: 50, align: 'right' },
        { h: 'Harga (Rp)', en: 'Unit price', w: 80, align: 'right' },
        { h: 'Subtotal (Rp)', en: 'Amount', w: 85, align: 'right' },
      ],
      rows: o.lines.map((l: any, i: number) => [
        i + 1,
        l.name,
        `${num(l.productQty)} ${l.uom}`,
        num(l.priceUnit),
        num(l.priceSubtotal),
      ]),
      totals: [
        ['Subtotal', rupiah(o.amountUntaxed)],
        [`${tax.label} ${tax.rate}% x DPP ${rupiah(tax.dppNilaiLain)}`, rupiah(o.amountTax)],
        ['Total', rupiah(o.amountTotal)],
      ],
      words: terbilang(Number(o.amountTotal)),
      wordsEn: terbilangEn(Number(o.amountTotal)),
      terms: [['Syarat pesanan / Terms', o.note || '-']],
      signer: {
        name: signer[0]?.name || u.name,
        role: 'Finance – PT Mentari Timur Prima Perkasa',
        signatureId: signer[0]?.sig,
      },
    };
    return {
      buffer: await this.pdf.document(spec),
      name: `${o.name.replace(/\//g, '-')}.pdf`,
      number: o.name,
      partner: o.partner,
    };
  }

  async send(u: AuthUser, id: number, b: { to?: string }) {
    const o = must(
      await this.db.purchaseOrders.findFirst({ where: { id: id }, include: { partner: true } }),
      'Pesanan',
    );
    const to = b.to || o.partner.email;
    if (!to) fail('Email principal belum diisi');
    const f = await this.pdfBuffer(u, id);
    const r = await this.email.send(
      {
        model: MODEL,
        resId: id,
        documentName: o.name,
        to,
        subject: `Pesanan Principal ${o.name} – PT Mentari Timur Prima Perkasa`,
        html: this.email.html('Pesanan Principal', o.name, o.partner.name),
        pdf: { name: f.name, buffer: f.buffer },
      },
      u.id,
    );
    if (o.state === 'draft' && r.state !== 'gagal') {
      await this.db.purchaseOrders.updateMany({ where: { id: id }, data: { state: 'sent' } });
      await this.chatter.log(MODEL, id, u.id, `Pesanan dikirim ke ${to}`, [
        { field: 'Status', old: 'Permintaan', new: 'Terkirim' },
      ]);
    } else await this.chatter.log(MODEL, id, u.id, `Pesanan dikirim ulang ke ${to}`);
    return r;
  }
}
