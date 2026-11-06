import { Controller, Get, Inject, Query } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { Perm } from '../../shared/auth';

// Pricelist principal (F.a) dengan nama produk dan principal
@Controller('supplier-prices/view')
export class SupplierPriceViewController {
  constructor(@Inject(DB) private db: Db) {}
  @Get()
  @Perm('pricelist_principal', 'read')
  async list(@Query() q: any) {
    return (
      await this.db.supplierPrices.findMany({
        where: q.partnerId ? { partnerId: +q.partnerId } : undefined,
        include: { partner: { select: { name: true } }, template: { select: { name: true } } },
        orderBy: [{ partner: { name: 'asc' } }, { template: { name: 'asc' } }],
      })
    ).map((x) => ({
      id: x.id,
      partnerId: x.partnerId,
      partner: x.partner.name,
      productTmplId: x.productTmplId,
      product: x.template.name,
      price: x.price,
      discount: x.discount,
      minQty: x.minQty,
      dateStart: x.dateStart,
      dateEnd: x.dateEnd,
    }));
  }
}
