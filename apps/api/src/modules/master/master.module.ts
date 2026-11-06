import { Body, Controller, Delete, Get, Inject, Module, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser, CurrentUser, Perm, checkPerm, stripCost } from '../../shared/auth';
import { makeCrud, pick, safeDelete } from '../../shared/crud';
import { fail, must } from '../../shared/util';
import { PricingService } from './pricing.service';
import { Prisma } from '@prisma/client';

const sql = Prisma.sql;

const kindMenu = (k: string) => (k === 'supplier' ? 'principal' : 'pelanggan');
const P_FIELDS = ['name', 'vat', 'email', 'phone', 'street', 'city', 'category', 'supplierNote'];
const PIMPINAN_FIELDS = ['paymentTermId', 'mtppIsNewCustomer', 'salesPricelistId'];

// Master pelanggan (C.b), principal dan gudang (C.c), alamat kirim (E.i), term of payment (B.a)
@Controller('partners')
export class PartnersController {
  constructor(@Inject(DB) private db: Db) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query() q: any) {
    const kind = q.kind || 'customer';
    checkPerm(u, kindMenu(kind), 'read');
    const where: any[] = [
      { type: 'company' },
      kind === 'supplier' ? { supplierRank: { gt: 0 } } : { customerRank: { gt: 0 } },
    ];
    if (q.q)
      where.push({
        OR: [
          { name: { contains: `${q.q}`, mode: 'insensitive' } },
          { email: { contains: `${q.q}`, mode: 'insensitive' } },
          { city: { contains: `${q.q}`, mode: 'insensitive' } },
        ],
      });
    if (q.active !== 'all') where.push({ active: q.active === 'false' ? false : true });
    const rows = await this.db.partners.findMany({
      where: { AND: where },
      include: { paymentTerm: true, pricelist: true, warehouses: true },
      orderBy: { name: 'asc' },
    });
    return rows;
  }

  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const p = must(
      await this.db.partners.findFirst({
        where: { id: id },
        include: { children: true, paymentTerm: true, pricelist: true, warehouses: true },
      }),
      'Partner',
    );
    checkPerm(u, kindMenu(p.supplierRank > 0 ? 'supplier' : 'customer'), 'read');
    const so = { n: await this.db.salesOrders.count({ where: { partnerId: id, state: { in: ['draft', 'sent'] } } }) };
    const sale = { n: await this.db.salesOrders.count({ where: { partnerId: id, state: { in: ['sale', 'done'] } } }) };
    const inv = { n: await this.db.journalEntries.count({ where: { partnerId: id, moveType: 'out_invoice' } }) };
    const po = { n: await this.db.purchaseOrders.count({ where: { partnerId: id } }) };
    return {
      ...p,
      addresses: p.children.filter((c) => c.type === 'delivery'),
      counts: { quotations: Number(so.n), orders: Number(sale.n), invoices: Number(inv.n), purchases: Number(po.n) },
    };
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() b: any) {
    const kind = b.kind || 'customer';
    checkPerm(u, kindMenu(kind), 'create');
    if (!b.name) fail('Nama wajib diisi');
    const v: any = {
      ...pick(b, P_FIELDS),
      type: 'company',
      customerRank: kind === 'customer' ? 1 : 0,
      supplierRank: kind === 'supplier' ? 1 : 0,
      createUid: u.id,
    };
    if (kind === 'customer') v.mtppIsNewCustomer = true;
    if (u.group === 'PIMPINAN') Object.assign(v, pick(b, PIMPINAN_FIELDS));
    if (u.group === 'ADMIN') Object.assign(v, pick(b, ['mtppIsNewCustomer']));
    return this.db.$transaction(async (tx) => {
      const p = await tx.partners.create({ data: v });
      if (kind === 'supplier') {
        // setiap principal memiliki satu gudang tersendiri beserta lokasi stoknya
        const code = 'G' + String(p.id).padStart(3, '0');
        const w = await tx.warehouses.create({
          data: { partnerId: p.id, name: b.warehouseName || `Gudang ${b.name}`, code },
        });
        await tx.locations.create({
          data: { warehouseId: w.id, name: 'Stok', completeName: `${code}/Stok`, usage: 'internal' },
        });
        await tx.transferTypes.createMany({
          data: [
            { warehouseId: w.id, name: 'Penerimaan Barang', code: 'incoming', sequenceCode: 'RCV' },
            { warehouseId: w.id, name: 'Surat Jalan', code: 'outgoing', sequenceCode: 'DO' },
          ],
        });
      }
      return p;
    });
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    const p = must(await this.db.partners.findFirst({ where: { id: id } }), 'Partner');
    const menu = kindMenu(p.supplierRank > 0 ? 'supplier' : 'customer');
    checkPerm(u, menu, 'write');
    const v: any = { ...pick(b, [...P_FIELDS, 'active']), writeUid: u.id, writeDate: new Date() };
    // Pimpinan menetapkan term of payment, penanda pelanggan baru, dan pricelist penjualan
    if (u.group === 'PIMPINAN') Object.assign(v, pick(b, PIMPINAN_FIELDS));
    // Admin juga dapat menetapkan penanda pelanggan baru; penanda berakhir otomatis (graduateCustomer)
    if (u.group === 'ADMIN') Object.assign(v, pick(b, ['mtppIsNewCustomer']));
    if (b.warehouseName && p.supplierRank > 0)
      await this.db.warehouses.updateMany({ where: { partnerId: id }, data: { name: b.warehouseName } });
    const [r] = await this.db.partners.updateManyAndReturn({ where: { id: id }, data: v });
    return r;
  }

  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const p = must(await this.db.partners.findFirst({ where: { id: id } }), 'Partner');
    checkPerm(u, kindMenu(p.supplierRank > 0 ? 'supplier' : p.type === 'delivery' ? 'customer' : 'customer'), 'delete');
    return safeDelete(() =>
      this.db.$transaction(async (tx) => {
        if (p.supplierRank > 0) {
          const w = await tx.warehouses.findFirst({ where: { partnerId: id } });
          if (w) {
            await tx.transferTypes.deleteMany({ where: { warehouseId: w.id } });
            await tx.locations.deleteMany({ where: { warehouseId: w.id } });
            await tx.warehouses.deleteMany({ where: { id: w.id } });
          }
        }
        await tx.partners.deleteMany({ where: { parentId: id } });
        await tx.partners.deleteMany({ where: { id: id } });
      }),
    );
  }

  // alamat kirim pelanggan
  @Post(':id/addresses')
  @Perm('pelanggan', 'write')
  async addAddress(@Param('id', ParseIntPipe) id: number, @Body() b: any) {
    if (!b.street) fail('Alamat wajib diisi');
    const r = await this.db.partners.create({
      data: {
        parentId: id,
        type: 'delivery',
        name: b.name || 'Alamat kirim',
        street: b.street,
        city: b.city,
        phone: b.phone,
      },
    });
    return r;
  }
  @Patch('addresses/:aid')
  @Perm('pelanggan', 'write')
  async editAddress(@Param('aid', ParseIntPipe) aid: number, @Body() b: any) {
    const [r] = await this.db.partners.updateManyAndReturn({
      where: { AND: [{ id: aid }, { type: 'delivery' }] },
      data: pick(b, ['name', 'street', 'city', 'phone', 'active']),
    });
    return must(r, 'Alamat');
  }
  @Delete('addresses/:aid')
  @Perm('pelanggan', 'write')
  delAddress(@Param('aid', ParseIntPipe) aid: number) {
    return safeDelete(() => this.db.partners.deleteMany({ where: { AND: [{ id: aid }, { type: 'delivery' }] } }));
  }
}

const T_FIELDS = ['name', 'uomId', 'categoryId', 'mainSupplierId', 'listPrice', 'descriptionSale', 'mtppRoute', 'type'];

// Master produk (C.d), kategori dan satuan (C.h)
@Controller('products')
export class ProductsController {
  constructor(
    @Inject(DB) private db: Db,
    private pricing: PricingService,
  ) {}

  @Get()
  @Perm('produk', 'read')
  async list(@CurrentUser() u: AuthUser, @Query() q: any) {
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

  @Get(':id/price')
  @Perm('produk', 'read')
  async price(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() q: any) {
    const sp = await this.pricing.salePrice(id, +q.partnerId, +q.qty || 1);
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

  @Post()
  @Perm('produk', 'create')
  async create(@CurrentUser() u: AuthUser, @Body() b: any) {
    if (!b.code || !b.name || !b.uomId) fail('Kode, nama, dan satuan wajib diisi');
    return this.db.$transaction(async (tx) => {
      const t = await tx.productTemplates.create({ data: { ...pick(b, T_FIELDS), createUid: u.id } as any });
      const p = await tx.products.create({ data: { productTmplId: t.id, defaultCode: b.code } });
      return { id: p.id };
    });
  }

  @Patch(':id')
  @Perm('produk', 'write')
  async update(@Param('id', ParseIntPipe) id: number, @Body() b: any) {
    const p = must(await this.db.products.findFirst({ where: { id: id } }), 'Produk');
    await this.db.$transaction(async (tx) => {
      const tv = pick(b, [...T_FIELDS, 'active']);
      if (Object.keys(tv).length)
        await tx.productTemplates.updateMany({
          where: { id: p.productTmplId },
          data: { ...tv, writeDate: new Date() },
        });
      const pv = pick(b, ['active']);
      if (b.code) (pv as any).defaultCode = b.code;
      if (Object.keys(pv).length) await tx.products.updateMany({ where: { id: id }, data: pv });
    });
    return { ok: true };
  }

  @Delete(':id')
  @Perm('produk', 'delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
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
  providers: [PricingService],
  exports: [PricingService],
})
export class MasterModule {}
