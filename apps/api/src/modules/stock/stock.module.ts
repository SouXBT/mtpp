import { Body, Controller, Get, Module, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Inject } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser, CurrentUser, Perm } from '../../common/auth';
import { StockService } from './stock.service';
import { TransfersService } from './transfers.service';

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
        where: q.productId ? { productId: +q.productId } : { state: 'done' },
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

@Controller('transfers')
export class TransfersController {
  constructor(private tr: TransfersService) {}
  @Get() @Perm('gudang', 'read') list(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.tr.list(q, u);
  }
  @Get(':id') @Perm('gudang', 'read') get(@Param('id', ParseIntPipe) id: number) {
    return this.tr.get(id);
  }
  @Post('from-sale/:soId') @Perm('gudang', 'create') fromSale(
    @CurrentUser() u: AuthUser,
    @Param('soId', ParseIntPipe) id: number,
  ) {
    return this.tr.createDeliveries(u, id);
  }
  @Patch(':id') @Perm('gudang', 'write') update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: any,
  ) {
    return this.tr.update(u, id, b);
  }
  @Post(':id/ready') @Perm('gudang', 'write') ready(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.tr.ready(u, id);
  }
  @Post(':id/validate') @Perm('gudang', 'write') validate(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: any,
  ) {
    return this.tr.validate(u, id, b);
  }
  @Post(':id/cancel') @Perm('gudang', 'delete') cancel(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.tr.cancel(u, id);
  }
  @Get(':id/pdf')
  @Perm('gudang', 'read')
  async pdf(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const f = await this.tr.pdfBuffer(u, id);
    res
      .set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${f.name}"` })
      .send(f.buffer);
  }
}

@Module({
  controllers: [StockController, TransfersController],
  providers: [StockService, TransfersService],
  exports: [StockService, TransfersService],
})
export class StockModule {}
