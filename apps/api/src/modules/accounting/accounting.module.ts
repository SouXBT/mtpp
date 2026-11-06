import { Module } from '@nestjs/common';
import { makeCrud } from '../../shared/crud';
import { JournalService } from './journal.service';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

const accountsCrud = makeCrud({
  path: 'accounts',
  menu: 'akuntansi',
  table: 'accounts',
  search: ['code', 'name'],
  order: 'code',
  writable: ['code', 'name', 'accountType'],
  required: ['code', 'name', 'accountType'],
});

@Module({
  controllers: [AccountingController, accountsCrud],
  providers: [AccountingService, JournalService],
  exports: [JournalService],
})
export class AccountingModule {}
