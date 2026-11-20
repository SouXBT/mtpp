import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser, checkPerm } from '../../shared/auth';
import { PurchaseReturnDto } from './returns.dto';
import { PurchaseReturnsService } from './purchase-returns.service';

// Retur ke principal: dibaca dan dibuat oleh gudang atau pengadaan; barang pengganti diproses gudang,
// nota kredit diproses pengadaan (Finance).
const canRead = (u: AuthUser) => u.perms.gudang?.read || u.perms.pengadaan?.read;
const canCreate = (u: AuthUser) => u.perms.gudang?.create || u.perms.pengadaan?.create;

@Controller()
export class PurchaseReturnsController {
  constructor(private r: PurchaseReturnsService) {}

  private guard(ok: any) {
    if (!ok) throw new ForbiddenException('Anda tidak memiliki akses');
  }

  @Get('purchase-returns') list(@CurrentUser() u: AuthUser, @Query() q: any) {
    this.guard(canRead(u));
    return this.r.list(q);
  }
  @Get('purchase-returns/:id') get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    this.guard(canRead(u));
    return this.r.get(id);
  }
  @Get('purchase-orders/:id/returnable') returnable(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    this.guard(canRead(u));
    return this.r.returnable(id);
  }
  @Post('purchase-returns') add(@CurrentUser() u: AuthUser, @Body() b: PurchaseReturnDto) {
    this.guard(canCreate(u));
    return this.r.create(u, b);
  }
  @Post('purchase-returns/:id/process') async process(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const s = await this.r.state(id);
    checkPerm(u, s.resolution === 'nota_kredit' ? 'pengadaan' : 'gudang', 'write');
    return this.r.process(u, id);
  }
  @Post('purchase-returns/:id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    this.guard(canCreate(u));
    return this.r.cancel(u, id);
  }
  @Get('purchase-returns/:id/pdf') async pdf(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    this.guard(canRead(u));
    const f = await this.r.pdfBuffer(u, id);
    res
      .set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${f.name}"` })
      .send(f.buffer);
  }
}
