import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser, Perm } from '../../shared/auth';
import { TransfersService } from './transfers.service';

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
