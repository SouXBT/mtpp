import { Module } from '@nestjs/common';
import { MasterModule } from '../master/master.module';
import { StockModule } from '../stock/stock.module';
import { AccountingModule } from '../accounting/accounting.module';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';

@Module({
  imports: [MasterModule, StockModule, AccountingModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
