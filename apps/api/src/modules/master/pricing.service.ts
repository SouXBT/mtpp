import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { round2, today } from '../../common/util';
import { Prisma } from '@prisma/client';

const sql = Prisma.sql;

// Harga jual (pricelist penjualan) dan harga pokok (pricelist principal)
@Injectable()
export class PricingService {
  constructor(@Inject(DB) private db: Db) {}

  async product(productId: number) {
    const [r] = (await this.db.products.findMany({ where: { id: productId }, include: { template: true } })).map(
      ({ template, ...p }) => ({ p, t: template }),
    );
    return r;
  }

  // Harga jual: pricelist pelanggan (tanggal mulai terbaru, kuantitas minimum terbesar <= qty), jika tidak ada pakai harga jual produk
  async salePrice(productId: number, partnerId: number, qty: number, date = today()) {
    const pr = await this.product(productId);
    const partner = await this.db.partners.findFirst({ where: { id: partnerId } });
    if (partner?.salesPricelistId) {
      const [it] = await this.db.salesPricelistItems.findMany({
        where: {
          AND: [
            { pricelistId: partner.salesPricelistId },
            { productId: productId },
            { minQty: { lte: qty } },
            { OR: [{ dateStart: null }, { dateStart: { lte: date } }] },
            { OR: [{ dateEnd: null }, { dateEnd: { gte: date } }] },
          ],
        },
        orderBy: [{ dateStart: { sort: 'desc', nulls: 'last' } }, { minQty: 'desc' }],
        take: 1,
      });
      if (it)
        return {
          priceUnit: it.fixedPrice ?? pr.t.listPrice,
          discount: it.fixedPrice ? 0 : Number(it.discount),
          source: 'pricelist',
        };
    }
    return { priceUnit: Number(pr.t.listPrice), discount: 0, source: 'produk' };
  }

  // Harga pokok: harga principal pemasok utama yang berlaku hari ini
  async cost(productId: number, qty: number, date = today(), supplierId?: number) {
    const pr = await this.product(productId);
    const sup = supplierId || pr.t.mainSupplierId;
    const conds: any[] = [
      { productTmplId: pr.t.id },
      { minQty: { lte: Math.max(qty, 0) } },
      { OR: [{ dateStart: null }, { dateStart: { lte: date } }] },
      { OR: [{ dateEnd: null }, { dateEnd: { gte: date } }] },
    ];
    if (sup) conds.push({ partnerId: sup });
    const [sp] = await this.db.supplierPrices.findMany({
      where: { AND: conds },
      orderBy: [{ dateStart: { sort: 'desc', nulls: 'last' } }, { minQty: 'desc' }],
      take: 1,
    });
    if (!sp) return { cost: 0, supplierId: sup || null, missing: true };
    return {
      cost: round2(Number(sp.price) * (1 - Number(sp.discount) / 100)),
      supplierId: sp.partnerId,
      missing: false,
    };
  }

  async warehouseOf(partnerId: number) {
    return this.db.warehouses.findFirst({ where: { partnerId: partnerId } });
  }
}
