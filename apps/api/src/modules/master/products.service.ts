import { nowDate } from '../../shared/clock';
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser, stripCost } from '../../shared/auth';
import { checkColumnTypes } from '../../shared/validation';
import { pick, safeDelete } from '../../shared/crud';
import { fail, must } from '../../shared/util';
import { PricingService } from './pricing.service';

const T_FIELDS = ['name', 'uomId', 'categoryId', 'mainSupplierId', 'listPrice', 'descriptionSale', 'mtppRoute', 'type'];

// Master produk (C.d), kategori dan satuan (C.h)
@Injectable()
export class ProductsService {
  constructor(
    @Inject(DB) private db: Db,
    private pricing: PricingService,
  ) {}

  async list(u: AuthUser, q: any) {
    const where: any[] = [];
    if (q.q)
      where.push({
        OR: [
          { template: { name: { contains: `${q.q}`, mode: 'insensitive' } } },
          { defaultCode: { contains: `${q.q}`, mode: 'insensitive' } },
        ],
      });
    if (q.active !== 'all') where.push({ active: q.active === 'false' ? false : true });
    const rows = (
      await this.db.products.findMany({
        where: where.length ? { AND: where } : undefined,
        include: {
          template: {
            include: {
              uom: { select: { name: true } },
              category: { select: { name: true } },
              mainSupplier: { select: { name: true } },
            },
          },
        },
        orderBy: { defaultCode: 'asc' },
      })
    ).map(({ template: t, ...p }) => ({
      id: p.id,
      code: p.defaultCode,
      active: p.active,
      tmplId: t.id,
      name: t.name,
      listPrice: t.listPrice,
      uomId: t.uomId,
      uom: t.uom.name,
      categoryId: t.categoryId,
      category: t.category?.name ?? null,
      mainSupplierId: t.mainSupplierId,
      supplier: t.mainSupplier?.name ?? null,
      mtppRoute: t.mtppRoute,
      descriptionSale: t.descriptionSale,
      type: t.type,
    }));
    if (!u.canSeeCost) return rows;
    const out = [];
    for (const r of rows) out.push({ ...r, purchasePrice: (await this.pricing.cost(r.id, 1)).cost });
    return out;
  }

  async price(u: AuthUser, id: number, q: any) {
    const partnerId = Number(q.partnerId);
    if (!Number.isInteger(partnerId) || partnerId < 1 || partnerId > 2147483647)
      fail('Pilih pelanggan dulu untuk melihat harga produk');
    const sp = await this.pricing.salePrice(id, partnerId, +q.qty || 1);
    const c = await this.pricing.cost(id, +q.qty || 1);
    const pr = await this.pricing.product(id);
    const w = pr.t.mainSupplierId ? await this.pricing.warehouseOf(pr.t.mainSupplierId) : null;
    return stripCost(u, {
      ...sp,
      purchasePrice: c.cost,
      costMissing: c.missing,
      warehouseId: w?.id || null,
      name: `[${pr.p.defaultCode}] ${pr.t.name}`,
      dropship: pr.t.mtppRoute === 'dropship',
    });
  }

  async create(u: AuthUser, b: any) {
    if (!b.code || !b.name || !b.uomId) fail('Kode, nama, dan satuan wajib diisi');
    checkColumnTypes('ProductTemplates', b, T_FIELDS);
    return this.db.$transaction(async (tx) => {
      const t = await tx.productTemplates.create({ data: { ...pick(b, T_FIELDS), createUid: u.id } as any });
      const p = await tx.products.create({ data: { productTmplId: t.id, defaultCode: b.code } });
      return { id: p.id };
    });
  }

  async update(id: number, b: any) {
    const p = must(await this.db.products.findFirst({ where: { id: id } }), 'Produk');
    checkColumnTypes('ProductTemplates', b, [...T_FIELDS, 'active']);
    await this.db.$transaction(async (tx) => {
      const tv = pick(b, [...T_FIELDS, 'active']);
      if (Object.keys(tv).length)
        await tx.productTemplates.updateMany({
          where: { id: p.productTmplId },
          data: { ...tv, writeDate: nowDate() },
        });
      const pv = pick(b, ['active']);
      if (b.code) (pv as any).defaultCode = b.code;
      if (Object.keys(pv).length) await tx.products.updateMany({ where: { id: id }, data: pv });
    });
    return { ok: true };
  }

  async remove(id: number) {
    const p = must(await this.db.products.findFirst({ where: { id: id } }), 'Produk');
    return safeDelete(() =>
      this.db.$transaction(async (tx) => {
        await tx.supplierPrices.deleteMany({ where: { productTmplId: p.productTmplId } });
        await tx.products.deleteMany({ where: { id: id } });
        await tx.productTemplates.deleteMany({ where: { id: p.productTmplId } });
      }),
    );
  }
}
