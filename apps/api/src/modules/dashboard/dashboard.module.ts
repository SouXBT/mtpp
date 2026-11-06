import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { SalesModule } from '../sales/sales.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({ imports: [StockModule, SalesModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
