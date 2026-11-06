import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { AccountingModule } from '../accounting/accounting.module';
import { ImporterController } from './importer.controller';
import { ImporterService } from './importer.service';

@Module({ imports: [StockModule, AccountingModule], controllers: [ImporterController], providers: [ImporterService] })
export class ImporterModule {}
