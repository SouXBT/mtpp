import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../shared/auth';
import { ApiKeyGuard } from './api-key.guard';
import { PublicApiService } from './public-api.service';

@Public()
@UseGuards(ApiKeyGuard)
@Controller('v1')
export class PublicApiController {
  constructor(private service: PublicApiService) {}

  @Get('sales-orders')
  orders(@Query() q: any) {
    return this.service.orders(q);
  }

  @Get('sales-orders/:id')
  order(@Param('id', ParseIntPipe) id: number) {
    return this.service.order(id);
  }

  @Get('invoices')
  invoices(@Query() q: any) {
    return this.service.invoices(q);
  }

  @Get('stock')
  stockList(@Query() q: any) {
    return this.service.stockList(q);
  }
}
