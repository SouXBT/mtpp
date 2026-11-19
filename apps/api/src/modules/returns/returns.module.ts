import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { StockModule } from '../stock/stock.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

@Module({
  imports: [AccountingModule, StockModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
})
export class ReturnsModule {}
