import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { PublicApiController } from './public-api.controller';
import { PublicApiService } from './public-api.service';
import { ApiKeyGuard } from './api-key.guard';

@Module({ imports: [StockModule], controllers: [PublicApiController], providers: [PublicApiService, ApiKeyGuard] })
export class PublicApiModule {}
