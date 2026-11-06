import { Module } from '@nestjs/common';
import { MasterModule } from '../master/master.module';
import { StockModule } from '../stock/stock.module';
import { SalesModule } from '../sales/sales.module';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';

@Module({
  imports: [MasterModule, StockModule, SalesModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
