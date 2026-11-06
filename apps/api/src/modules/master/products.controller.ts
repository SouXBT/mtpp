import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Perm } from '../../shared/auth';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private service: ProductsService) {}

  @Get()
  @Perm('produk', 'read')
  list(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.service.list(u, q);
  }

  @Get(':id/price')
  @Perm('produk', 'read')
  price(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() q: any) {
    return this.service.price(u, id, q);
  }

  @Post()
  @Perm('produk', 'create')
  create(@CurrentUser() u: AuthUser, @Body() b: any) {
    return this.service.create(u, b);
  }

  @Patch(':id')
  @Perm('produk', 'write')
  update(@Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.service.update(id, b);
  }

  @Delete(':id')
  @Perm('produk', 'delete')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
