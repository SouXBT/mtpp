import { Body, Controller, Get, Module, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser, Perm } from '../../common/auth';
import { NumberingService } from '../../common/numbering.service';
import { today } from '../../common/util';
import { MasterModule } from '../master/master.module';
import { StockModule } from '../stock/stock.module';
import { SalesService } from './sales.service';

// Penawaran dan sales order (fitur D.a sampai D.j) serta proforma invoice (F.d)
@Controller('sales-orders')
export class SalesController {
  constructor(private sales: SalesService, private numbering: NumberingService) {}

  @Get() @Perm('penjualan', 'read') list(@CurrentUser() u: AuthUser, @Query() q: any) { return this.sales.list(u, q); }
  @Get('next-number') @Perm('penjualan', 'read') next(@Query('date') d: string) { return this.numbering.peek('PN', d || today()).then((n) => ({ number: n })); }
  @Get('worklist/need-po') @Perm('penjualan', 'read') needPo() { return this.sales.needPurchase(); }
  @Get('worklist/ready') @Perm('penjualan', 'read') ready() { return this.sales.readyToShip(); }
  @Get(':id') @Perm('penjualan', 'read') get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.sales.get(u, id); }
  @Post() @Perm('penjualan', 'create') create(@CurrentUser() u: AuthUser, @Body() b: any) { return this.sales.create(u, b); }
  @Patch(':id') @Perm('penjualan', 'write') update(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: any) { return this.sales.update(u, id, b); }
  @Post(':id/confirm') @Perm('penjualan', 'write') confirm(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: any) { return this.sales.confirm(u, id, b); }
  @Post(':id/cancel') @Perm('penjualan', 'delete') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.sales.cancel(u, id); }
  @Post(':id/draft') @Perm('penjualan', 'write') draft(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.sales.toDraft(u, id); }
  @Post(':id/copy') @Perm('penjualan', 'create') copy(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.sales.copy(u, id); }
  @Post(':id/send') @Perm('penjualan', 'write') send(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: any) { return this.sales.send(u, id, b || {}); }
  @Get(':id/shortage') @Perm('penjualan', 'read') shortage(@Param('id', ParseIntPipe) id: number) { return this.sales.shortage(id); }

  @Get(':id/pdf') @Perm('penjualan', 'read')
  async pdf(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Query('kind') kind: any, @Res() res: Response) {
    const f = await this.sales.pdfBuffer(u, id, kind || 'quotation');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${f.name}"` }).send(f.buffer);
  }

  // proforma invoice diterbitkan oleh Finance
  @Post(':id/proforma') @Perm('penagihan', 'create') proforma(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: any) { return this.sales.proforma(u, id, b); }
  @Post(':id/proforma/send') @Perm('penagihan', 'create') proformaSend(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: any) { return this.sales.send(u, id, { ...(b || {}), kind: 'proforma' }); }
}

@Module({ imports: [MasterModule, StockModule], controllers: [SalesController], providers: [SalesService], exports: [SalesService] })
export class SalesModule {}
