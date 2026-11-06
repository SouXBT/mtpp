import { JournalEntryDto, CashDto, MatchBankLineDto } from './accounting.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, CurrentUser, Perm } from '../../shared/auth';
import { AccountingService } from './accounting.service';

@Controller()
export class AccountingController {
  constructor(private service: AccountingService) {}

  @Get('journals')
  @Perm('akuntansi', 'read')
  journals() {
    return this.service.journals();
  }

  @Get('journal-entries')
  @Perm('akuntansi', 'read')
  entries(@Query() q: any) {
    return this.service.entries(q);
  }

  @Get('journal-entries/:id')
  @Perm('akuntansi', 'read')
  entry(@Param('id', ParseIntPipe) id: number) {
    return this.service.entry(id);
  }

  @Post('journal-entries')
  @Perm('akuntansi', 'create')
  createEntry(
    @CurrentUser() u: AuthUser,
    @Body()
    b: JournalEntryDto,
  ) {
    return this.service.createEntry(u, b);
  }

  @Post('journal-entries/:id/post')
  @Perm('akuntansi', 'write')
  post(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.post(u, id);
  }

  @Delete('journal-entries/:id')
  @Perm('akuntansi', 'delete')
  del(@Param('id', ParseIntPipe) id: number) {
    return this.service.del(id);
  }

  @Post('journal-entries/:id/reverse')
  @Perm('akuntansi', 'write')
  reverse(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.reverse(u, id);
  }

  @Post('cash')
  @Perm('akuntansi', 'create')
  cash(
    @CurrentUser() u: AuthUser,
    @Body()
    b: CashDto,
  ) {
    return this.service.cash(u, b);
  }

  @Get('cash/balance')
  @Perm('akuntansi', 'read')
  cashBalance() {
    return this.service.cashBalance();
  }

  @Get('ledger')
  @Perm('akuntansi', 'read')
  ledger(@Query() q: any) {
    return this.service.ledger(q);
  }

  @Get('trial-balance')
  @Perm('akuntansi', 'read')
  trial(@Query() q: any) {
    return this.service.trial(q);
  }

  @Get('bank-statements')
  @Perm('akuntansi', 'read')
  bankLines(@Query() q: any) {
    return this.service.bankLines(q);
  }

  @Post('bank-statements/import')
  @Perm('akuntansi', 'create')
  @UseInterceptors(FileInterceptor('file'))
  importBank(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    b: {
      dateCol: string;
      refCol: string;
      amountCol?: string;
      debitCol?: string;
      creditCol?: string;
      dateFormat?: string;
    },
  ) {
    return this.service.importBank(file, b);
  }

  @Get('bank-statements/:id/candidates')
  @Perm('akuntansi', 'read')
  candidates(@Param('id', ParseIntPipe) id: number) {
    return this.service.candidates(id);
  }

  @Post('bank-statements/:id/match')
  @Perm('akuntansi', 'write')
  match(@Param('id', ParseIntPipe) id: number, @Body() b: MatchBankLineDto) {
    return this.service.match(id, b);
  }

  @Post('bank-statements/:id/unmatch')
  @Perm('akuntansi', 'write')
  unmatch(@Param('id', ParseIntPipe) id: number) {
    return this.service.unmatch(id);
  }
}
