import { Module } from '@nestjs/common';
import { makeCrud } from '../../shared/crud';
import { PricingService } from './pricing.service';
import { PartnersController } from './partners.controller';
import { ProductsController } from './products.controller';
import { SupplierPriceViewController } from './supplier-price-view.controller';
import { PartnersService } from './partners.service';
import { ProductsService } from './products.service';

const crud = [
  makeCrud({
    path: 'payment-terms',
    menu: 'top',
    table: 'paymentTerms',
    search: ['name'],
    writable: ['name', 'days', 'note'],
    required: ['name'],
  }),
  makeCrud({
    path: 'units',
    menu: 'produk',
    table: 'units',
    search: ['name'],
    writable: ['name', 'relativeFactor'],
    required: ['name'],
  }),
  makeCrud({
    path: 'categories',
    menu: 'produk',
    table: 'productCategories',
    search: ['name'],
    writable: ['name'],
    required: ['name'],
  }),
  makeCrud({
    path: 'supplier-prices',
    menu: 'pricelist_principal',
    table: 'supplierPrices',
    writable: ['partnerId', 'productTmplId', 'price', 'discount', 'minQty', 'dateStart', 'dateEnd'],
    required: ['partnerId', 'productTmplId', 'price'],
    filters: ['partnerId', 'productTmplId'],
  }),
  makeCrud({
    path: 'pricelists',
    menu: 'pricelist_jual',
    table: 'salesPricelists',
    search: ['name'],
    writable: ['name'],
    required: ['name'],
  }),
  makeCrud({
    path: 'pricelist-items',
    menu: 'pricelist_jual',
    table: 'salesPricelistItems',
    writable: ['pricelistId', 'productId', 'fixedPrice', 'discount', 'minQty', 'dateStart', 'dateEnd'],
    required: ['pricelistId', 'productId'],
    filters: ['pricelistId'],
  }),
  makeCrud({
    path: 'warehouses',
    menu: 'principal',
    table: 'warehouses',
    search: ['name', 'code'],
    writable: ['name'],
  }),
  makeCrud({
    path: 'stock-rules',
    menu: 'stok',
    table: 'stockRules',
    writable: ['productId', 'warehouseId', 'minQty'],
    required: ['productId', 'warehouseId', 'minQty'],
  }),
];

@Module({
  controllers: [PartnersController, ProductsController, SupplierPriceViewController, ...crud],
  providers: [PartnersService, ProductsService, PricingService],
  exports: [PricingService],
})
export class MasterModule {}
