import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { must } from '../../shared/util';
import { StockService } from '../stock/stock.service';

const page = (q: any) => ({ limit: Math.min(Number(q.limit) || 50, 200), offset: Number(q.offset) || 0 });

@Injectable()
export class PublicApiService {
  constructor(
    @Inject(DB) private db: Db,
    private stock: StockService,
  ) {}

  async orders(q: any) {
    const w: any[] = [];
    if (q.state) w.push({ state: q.state });
    if (q.from) w.push({ dateOrder: { gte: q.from } });
    if (q.to) w.push({ dateOrder: { lte: q.to } });
    const { limit, offset } = page(q);
    const rows = (
      await this.db.salesOrders.findMany({
        where: w.length ? { AND: w } : undefined,
        include: { partner: { select: { name: true } } },
        orderBy: { id: 'desc' },
        take: limit,
        skip: offset,
      })
    ).map((o) => ({
      id: o.id,
      name: o.name,
      date: o.dateOrder,
      dateConfirm: o.dateConfirm,
      state: o.state,
      customer: o.partner.name,
      customerRef: o.clientOrderRef,
      amountUntaxed: o.amountUntaxed,
      amountTax: o.amountTax,
      amountTotal: o.amountTotal,
      invoiceStatus: o.invoiceStatus,
    }));
    return { data: rows, limit, offset };
  }

  async order(id: number) {
    const o = must(
      await this.db.salesOrders.findFirst({
        where: { id: id },
        include: { partner: true, lines: { include: { product: { include: { template: true } } } } },
      }),
      'Sales order',
    );
    return {
      id: o.id,
      name: o.name,
      date: o.dateOrder,
      state: o.state,
      customer: o.partner.name,
      amountUntaxed: o.amountUntaxed,
      amountTax: o.amountTax,
      amountTotal: o.amountTotal,
      lines: o.lines.map((l) => ({
        code: l.product.defaultCode,
        product: l.product.template.name,
        qty: l.productUomQty,
        delivered: l.qtyDelivered,
        invoiced: l.qtyInvoiced,
        priceUnit: l.priceUnit,
        discount: l.discount,
        subtotal: l.priceSubtotal,
      })),
    };
  }

  async invoices(q: any) {
    const w: any[] = [{ moveType: 'out_invoice' }, { state: 'posted' }];
    if (q.paymentState) w.push({ paymentState: q.paymentState });
    if (q.from) w.push({ invoiceDate: { gte: q.from } });
    if (q.to) w.push({ invoiceDate: { lte: q.to } });
    const { limit, offset } = page(q);
    const rows = (
      await this.db.journalEntries.findMany({
        where: { AND: [...w, { partnerId: { not: null } }] },
        include: { partner: { select: { name: true } } },
        orderBy: { id: 'desc' },
        take: limit,
        skip: offset,
      })
    ).map((e) => ({
      id: e.id,
      name: e.name,
      date: e.invoiceDate,
      due: e.invoiceDateDue,
      customer: e.partner.name,
      origin: e.invoiceOrigin,
      amountUntaxed: e.amountUntaxed,
      amountTax: e.amountTax,
      amountTotal: e.amountTotal,
      amountResidual: e.amountResidual,
      paymentState: e.paymentState,
    }));
    return { data: rows, limit, offset };
  }

  async stockList(q: any) {
    const rows = await this.stock.overview({ warehouseId: q.warehouseId, q: q.q });
    return { data: rows.map(({ key, ruleId, ...r }) => r) };
  }
}
