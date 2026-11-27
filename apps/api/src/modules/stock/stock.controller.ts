import { Controller, Get, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { Perm } from '../../shared/auth';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(
    private stock: StockService,
    @Inject(DB) private db: Db,
  ) {}
  @Get()
  @Perm('stok', 'read')
  overview(@Query() q: any) {
    return this.stock.overview({ warehouseId: q.warehouseId, categoryId: q.categoryId, low: q.low === 'true', q: q.q });
  }
  // mutasi stok: setiap validasi penerimaan atau surat jalan
  @Get('moves')
  @Perm('stok', 'read')
  async moves(@Query() q: any) {
    const [rows, locs] = await Promise.all([
      this.db.stockMoves.findMany({
        // hanya mutasi yang benar-benar terjadi; dokumen draf atau batal tidak memindahkan stok
        where: q.productId ? { productId: +q.productId || -1, state: 'done' } : { state: 'done' },
        include: {
          product: { include: { template: { select: { name: true } } } },
          picking: { select: { name: true } },
          location: { select: { completeName: true } },
        },
        orderBy: { id: 'desc' },
        take: 500,
      }),
      this.db.locations.findMany(),
    ]);
    return rows.map((m) => ({
      id: m.id,
      date: m.date,
      qty: m.quantity,
      product: m.product.template.name,
      code: m.product.defaultCode,
      doc: m.picking?.name ?? null,
      from: m.location.completeName,
      toId: m.locationDestId,
      to: locs.find((l) => l.id === m.locationDestId)?.completeName,
    }));
  }
}
