import { Module } from '@nestjs/common';
import { MasterModule } from '../master/master.module';
import { StockModule } from '../stock/stock.module';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';

@Module({
  imports: [MasterModule, StockModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
