import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { Public } from '../../shared/auth';
import { must } from '../../shared/util';
import { hashKey } from '../settings/settings.module';
import { StockModule } from '../stock/stock.module';
import { StockService } from '../stock/stock.service';

// REST API untuk aplikasi lain: hanya baca, memakai header X-API-Key
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(DB) private db: Db) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-api-key'];
    if (!key) throw new UnauthorizedException('Header X-API-Key wajib diisi');
    const k = await this.db.apiKeys.findFirst({ where: { keyHash: hashKey(String(key)) } });
    if (!k || !k.active) throw new UnauthorizedException('API key tidak valid');
    await this.db.apiKeys.updateMany({ where: { id: k.id }, data: { lastUsed: new Date() } });
    return true;
  }
}

const page = (q: any) => ({ limit: Math.min(Number(q.limit) || 50, 200), offset: Number(q.offset) || 0 });

@Public()
@UseGuards(ApiKeyGuard)
@Controller('v1')
export class PublicApiController {
  constructor(
    @Inject(DB) private db: Db,
    private stock: StockService,
  ) {}

  @Get('sales-orders')
  async orders(@Query() q: any) {
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

  @Get('sales-orders/:id')
  async order(@Param('id', ParseIntPipe) id: number) {
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

  @Get('invoices')
  async invoices(@Query() q: any) {
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

  @Get('stock')
  async stockList(@Query() q: any) {
    const rows = await this.stock.overview({ warehouseId: q.warehouseId, q: q.q });
    return { data: rows.map(({ key, ruleId, ...r }) => r) };
  }
}

@Module({ imports: [StockModule], controllers: [PublicApiController], providers: [ApiKeyGuard] })
export class PublicApiModule {}
