import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser, checkPerm } from '../../shared/auth';
import { ReturnDto, ReturnRefundDto } from './returns.dto';
import { ReturnsService, isCredit } from './returns.service';

// Retur dibaca oleh gudang, penjualan, dan penagihan. Dibuat oleh Operasional (gudang) atau Sales (penjualan).
// Diproses oleh gudang untuk kirim pengganti, dan oleh penagihan untuk nota kredit atau potongan.
const canRead = (u: AuthUser) => u.perms.gudang?.read || u.perms.penjualan?.read || u.perms.penagihan?.read;
const canCreate = (u: AuthUser) => u.perms.gudang?.create || u.perms.penjualan?.write;

@Controller()
export class ReturnsController {
  constructor(private r: ReturnsService) {}

  private read(u: AuthUser) {
    if (!canRead(u)) throw new ForbiddenException('Anda tidak memiliki akses');
  }
  private create(u: AuthUser) {
    if (!canCreate(u)) throw new ForbiddenException('Anda tidak memiliki akses');
  }

  @Get('returns') list(@CurrentUser() u: AuthUser, @Query() q: any) {
    this.read(u);
    return this.r.list(q);
  }
  @Get('returns/:id') get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    this.read(u);
    return this.r.get(id);
  }
  @Get('transfers/:id/returnable') returnable(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    this.read(u);
    return this.r.returnable(id);
  }
  @Post('returns') add(@CurrentUser() u: AuthUser, @Body() b: ReturnDto) {
    this.create(u);
    return this.r.create(u, b);
  }
  @Patch('returns/:id') update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: ReturnDto,
  ) {
    this.create(u);
    return this.r.update(u, id, b);
  }
  @Post('returns/:id/process') async process(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const s = await this.r.state(id);
    checkPerm(u, isCredit(s.resolution) ? 'penagihan' : 'gudang', 'write');
    return this.r.process(u, id);
  }
  @Post('returns/:id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    this.create(u);
    return this.r.cancel(u, id);
  }
  @Post('returns/:id/refund') refund(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: ReturnRefundDto,
  ) {
    checkPerm(u, 'penagihan', 'write');
    return this.r.refund(u, id, b);
  }
  @Get('returns/:id/pdf') async pdf(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    this.read(u);
    const f = await this.r.pdfBuffer(u, id);
    res
      .set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${f.name}"` })
      .send(f.buffer);
  }
}
