import { UpdatePurchaseOrderDto, SendPurchaseOrderDto, ConfirmPurchaseOrderDto } from './purchasing.dto';
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser, Perm, stripCost } from '../../shared/auth';
import { PurchasingService } from './purchasing.service';

@Controller('purchase-orders')
export class PurchasingController {
  constructor(private po: PurchasingService) {}
  @Get() @Perm('pengadaan', 'read') list(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.po.list(q, u);
  }
  @Get(':id') @Perm('pengadaan', 'read') async get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return stripCost(u, await this.po.get(id));
  }
  @Post('from-sale/:soId') @Perm('pengadaan', 'create') fromSale(
    @CurrentUser() u: AuthUser,
    @Param('soId', ParseIntPipe) id: number,
  ) {
    return this.po.fromSale(u, id);
  }
  @Patch(':id') @Perm('pengadaan', 'write') update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: UpdatePurchaseOrderDto,
  ) {
    return this.po.update(u, id, b);
  }
  @Post(':id/send') @Perm('pengadaan', 'write') send(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: SendPurchaseOrderDto,
  ) {
    return this.po.send(u, id, b || {});
  }
  // Pimpinan (hak baca) boleh mengonfirmasi dengan pengecualian uang muka; selain itu perlu hak ubah, dicek di service
  @Post(':id/confirm') @Perm('pengadaan', 'read') confirm(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: ConfirmPurchaseOrderDto,
  ) {
    return this.po.confirm(u, id, b || {});
  }
  @Post(':id/close-remaining') @Perm('pengadaan', 'write') closeRemaining(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.po.closeRemaining(u, id);
  }
  @Post(':id/cancel') @Perm('pengadaan', 'delete') cancel(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.po.cancel(u, id);
  }
  @Get(':id/pdf')
  @Perm('pengadaan', 'read')
  async pdf(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const f = await this.po.pdfBuffer(u, id);
    res
      .set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${f.name}"` })
      .send(f.buffer);
  }
}
