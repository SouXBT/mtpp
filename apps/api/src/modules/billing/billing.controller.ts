import { InstallmentsDto, InvoiceSourceDto, SendInvoiceDto, PaymentDto } from './billing.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  ForbiddenException,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from '../../shared/files.service';
import { Response } from 'express';
import { AuthUser, CurrentUser, Perm, checkPerm } from '../../shared/auth';
import { BillingService } from './billing.service';

const menuOf = (type?: string) => (type === 'bill' ? 'pengadaan' : 'penagihan');

@Controller()
export class BillingController {
  constructor(
    private b: BillingService,
    private files: FilesService,
  ) {}

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
    @Body() body: InvoiceSourceDto,
  ) {
    return this.b.invoiceFromSale(u, id, body || {});
  }
  @Post('invoices/from-purchase/:poId') @Perm('pengadaan', 'create') fromPurchase(
    @CurrentUser() u: AuthUser,
    @Param('poId', ParseIntPipe) id: number,
    @Body() body: InvoiceSourceDto,
  ) {
    return this.b.billFromPurchase(u, id, body || {});
  }
  @Post('invoices/refund-purchase/:poId') @Perm('pengadaan', 'create') refund(
    @CurrentUser() u: AuthUser,
    @Param('poId', ParseIntPipe) id: number,
    @Body() body: InvoiceSourceDto,
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
    @Body() body: SendInvoiceDto,
  ) {
    return this.b.send(u, id, body || {});
  }
  @Post('invoices/:id/remind') @Perm('penagihan', 'write') remind(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SendInvoiceDto,
  ) {
    return this.b.remind(u, id, body || {});
  }
  // cicilan: diajukan oleh pengguna dengan hak buat, disetujui atau dibatalkan oleh pengguna dengan hak ubah penagihan
  @Post('invoices/:id/installments') @Perm('penagihan', 'create') setInstallments(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: InstallmentsDto,
  ) {
    return this.b.setInstallments(u, id, body);
  }
  @Post('invoices/:id/installments/approve') @Perm('penagihan', 'write') approveInstallments(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.b.approveInstallments(u, id);
  }
  @Delete('invoices/:id/installments') @Perm('penagihan', 'write') cancelInstallments(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.b.cancelInstallments(u, id);
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
  // Pembayaran pelanggan (uang muka, pelunasan, invoice) wajib disertai bukti transfer: multipart, field "file"
  @Post('payments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async pay(@CurrentUser() u: AuthUser, @Body() body: PaymentDto, @UploadedFile() file?: Express.Multer.File) {
    const n = (v: any) => (v === undefined || v === null || v === '' ? undefined : Number(v));
    const b = {
      ...body,
      invoiceId: n(body.invoiceId),
      saleId: n(body.saleId),
      purchaseId: n(body.purchaseId),
      amount: Number(body.amount),
    };
    // pembayaran principal oleh Finance (pengadaan), pembayaran pelanggan (penagihan)
    checkPerm(u, b.purchaseId ? 'pengadaan' : 'penagihan', 'create');
    const customer = !!b.saleId || (!!b.invoiceId && (await this.b.get(b.invoiceId)).moveType === 'out_invoice');
    if (customer && !file) throw new BadRequestException('Lampirkan bukti transfer atau bukti pembayaran');
    if (file && !/^(image\/|application\/pdf)/.test(file.mimetype))
      throw new BadRequestException('Bukti pembayaran harus berupa gambar atau PDF');
    const p = await this.b.pay(u, b as any);
    if (file && p) await this.files.save(file.buffer, file.originalname, file.mimetype, 'payments', p.id, u.id);
    return p;
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
