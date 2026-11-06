import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser, checkPerm } from '../../shared/auth';
import { pick, safeDelete } from '../../shared/crud';
import { fail, must } from '../../shared/util';

const kindMenu = (k: string) => (k === 'supplier' ? 'principal' : 'pelanggan');

const P_FIELDS = ['name', 'vat', 'email', 'phone', 'street', 'city', 'category', 'supplierNote'];

const PIMPINAN_FIELDS = ['paymentTermId', 'mtppIsNewCustomer', 'salesPricelistId'];

// Master pelanggan (C.b), principal dan gudang (C.c), alamat kirim (E.i), term of payment (B.a)
@Injectable()
export class PartnersService {
  constructor(@Inject(DB) private db: Db) {}

  async list(u: AuthUser, q: any) {
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

  async get(u: AuthUser, id: number) {
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

  async create(u: AuthUser, b: any) {
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

  async update(u: AuthUser, id: number, b: any) {
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

  async remove(u: AuthUser, id: number) {
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
  async addAddress(id: number, b: any) {
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

  async editAddress(aid: number, b: any) {
    const [r] = await this.db.partners.updateManyAndReturn({
      where: { AND: [{ id: aid }, { type: 'delivery' }] },
      data: pick(b, ['name', 'street', 'city', 'phone', 'active']),
    });
    return must(r, 'Alamat');
  }

  delAddress(aid: number) {
    return safeDelete(() => this.db.partners.deleteMany({ where: { AND: [{ id: aid }, { type: 'delivery' }] } }));
  }
}
