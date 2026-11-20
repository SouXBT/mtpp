import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { StockModule } from '../stock/stock.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { PurchaseReturnsController } from './purchase-returns.controller';
import { PurchaseReturnsService } from './purchase-returns.service';

@Module({
  imports: [AccountingModule, StockModule],
  controllers: [ReturnsController, PurchaseReturnsController],
  providers: [ReturnsService, PurchaseReturnsService],
})
export class ReturnsModule {}
