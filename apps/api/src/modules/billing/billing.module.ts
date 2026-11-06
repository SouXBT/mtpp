import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser, Perm, checkPerm } from '../../common/auth';
import { AccountingModule } from '../accounting/accounting.module';
import { BillingService } from './billing.service';

const menuOf = (type?: string) => (type === 'bill' ? 'pengadaan' : 'penagihan');

@Controller()
export class BillingController {
  constructor(private b: BillingService) {}

  @Get('invoices') list(@CurrentUser() u: AuthUser, @Query() q: any) {
    checkPerm(u, menuOf(q.type), 'read');
    return this.b.list(q, u);
  }
  @Get('invoices/:id') async get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const e = await this.b.get(id);
    checkPerm(u, e.moveType.startsWith('in_') ? 'pengadaan' : 'penagihan', 'read');
    return e;
  }
  @Post('invoices/from-sale/:soId') @Perm('penagihan', 'create') fromSale(
    @CurrentUser() u: AuthUser,
    @Param('soId', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.b.invoiceFromSale(u, id, body || {});
  }
  @Post('invoices/from-purchase/:poId') @Perm('pengadaan', 'create') fromPurchase(
    @CurrentUser() u: AuthUser,
    @Param('poId', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.b.billFromPurchase(u, id, body || {});
  }
  @Post('invoices/refund-purchase/:poId') @Perm('pengadaan', 'create') refund(
    @CurrentUser() u: AuthUser,
    @Param('poId', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.b.supplierRefund(u, id, body);
  }
  @Post('invoices/:id/post') async post(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const e = await this.b.get(id);
    checkPerm(u, e.moveType.startsWith('in_') ? 'pengadaan' : 'penagihan', 'write');
    return this.b.post(u, id);
  }
  @Post('invoices/:id/reverse') async reverse(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const e = await this.b.get(id);
    checkPerm(u, e.moveType.startsWith('in_') ? 'pengadaan' : 'penagihan', 'write');
    return this.b.reverse(u, id);
  }
  @Delete('invoices/:id') async remove(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const e = await this.b.get(id);
    checkPerm(u, e.moveType.startsWith('in_') ? 'pengadaan' : 'penagihan', 'delete');
    return this.b.remove(u, id);
  }
  @Post('invoices/:id/send') @Perm('penagihan', 'write') send(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.b.send(u, id, body || {});
  }
  @Get('invoices/:id/pdf')
  @Perm('penagihan', 'read')
  async pdf(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const f = await this.b.pdfBuffer(u, id);
    res
      .set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${f.name}"` })
      .send(f.buffer);
  }

  @Get('payments') list2(@CurrentUser() u: AuthUser, @Query() q: any) {
    if (!u.perms.penagihan?.read && !u.perms.pengadaan?.read) throw new ForbiddenException('Anda tidak memiliki akses');
    return this.b.payments(q);
  }
  @Post('payments') pay(@CurrentUser() u: AuthUser, @Body() body: any) {
    // pembayaran principal oleh Finance (pengadaan), pembayaran pelanggan (penagihan)
    checkPerm(u, body.purchaseId ? 'pengadaan' : 'penagihan', 'create');
    return this.b.pay(u, body);
  }
  @Post('sales-orders/:id/refund-advance') @Perm('penagihan', 'write') refundAdvance(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.b.refundAdvance(u, id, body || {});
  }
  @Post('payments/:id/cancel') async cancelPayment(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const p = await this.b.payment(id);
    checkPerm(u, p.partnerType === 'supplier' ? 'pengadaan' : 'penagihan', 'write');
    return this.b.cancelPayment(u, id);
  }
  @Get('payments/:id/receipt')
  @Perm('penagihan', 'read')
  async receipt(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const f = await this.b.receiptPdf(u, id);
    res
      .set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${f.name}"` })
      .send(f.buffer);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
