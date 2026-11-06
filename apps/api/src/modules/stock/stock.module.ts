import { Module } from '@nestjs/common';
import { StockService } from './stock.service';
import { TransfersService } from './transfers.service';
import { StockController } from './stock.controller';
import { TransfersController } from './transfers.controller';

@Module({
  controllers: [StockController, TransfersController],
  providers: [StockService, TransfersService],
  exports: [StockService, TransfersService],
})
export class StockModule {}
