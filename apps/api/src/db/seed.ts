// Data awal: grup + hak akses default, pengguna contoh, bagan akun, jurnal, dan master contoh.
// Dijalankan otomatis saat database masih kosong, atau manual: npm run seed
import * as bcrypt from 'bcryptjs';
import { DEFAULT_MATRIX, MENUS } from '../shared/menus';
import { createWarehouse } from '../shared/warehouse';

const GROUPS = [
  {
    code: 'PIMPINAN',
    name: 'Pimpinan',
    comment: 'Direksi dan manajer: term of payment, pricelist jual, seluruh laporan',
  },
  { code: 'ADMIN', name: 'Admin', comment: 'Master data, pengguna, pengaturan, impor data awal' },
  { code: 'SALES', name: 'Sales', comment: 'Penawaran, sales order, margin' },
  { code: 'OPERASIONAL', name: 'Operasional', comment: 'Penerimaan barang, surat jalan, stok' },
  { code: 'FINANCE', name: 'Finance', comment: 'PO Principal, tagihan, invoice, pembayaran, akuntansi' },
];
export const DEMO_USERS = [
  { name: 'Hendra Wijaya', login: 'pimpinan@mtpp.co.id', group: 'PIMPINAN' },
  { name: 'Rina Kusuma', login: 'admin@mtpp.co.id', group: 'ADMIN' },
  { name: 'Marco Sutedjo', login: 'sales@mtpp.co.id', group: 'SALES' },
  { name: 'Bryant Santoso', login: 'operasional@mtpp.co.id', group: 'OPERASIONAL' },
  { name: 'Shannon Tan', login: 'finance@mtpp.co.id', group: 'FINANCE' },
];
export const DEMO_PASSWORD = 'mtpp12345';

const ACCOUNTS: [string, string, string][] = [
  ['1-1100', 'Kas', 'asset'],
  ['1-1200', 'Bank BCA', 'asset'],
  ['1-1300', 'Piutang Usaha', 'asset'],
  ['1-1400', 'PPN Masukan', 'asset'],
  ['1-1500', 'Uang Muka Pembelian', 'asset'],
  ['1-2100', 'Peralatan Kantor', 'asset'],
  ['2-1100', 'Utang Usaha', 'liability'],
  ['2-1200', 'Uang Muka Pelanggan', 'liability'],
  ['2-1300', 'PPN Keluaran', 'liability'],
  ['2-1400', 'Utang Lain-lain', 'liability'],
  ['3-1000', 'Modal Disetor', 'equity'],
  ['3-2000', 'Laba Ditahan', 'equity'],
  ['3-9000', 'Ekuitas Saldo Awal', 'equity'],
  ['4-1000', 'Penjualan', 'income'],
  ['4-1100', 'Retur Penjualan', 'income'],
  ['4-2000', 'Pendapatan Lain-lain', 'income'],
  ['5-1000', 'Pembelian Barang Dagang', 'expense'],
  ['6-1000', 'Beban Gaji', 'expense'],
  ['6-2000', 'Beban Pengiriman', 'expense'],
  ['6-3000', 'Beban Sewa', 'expense'],
  ['6-4000', 'Beban Administrasi Bank', 'expense'],
  ['6-9000', 'Beban Lain-lain', 'expense'],
];

export async function seed(db: any, opts: { demo?: boolean } = {}) {
  await db.$transaction(async (tx: any) => {
    // grup dan hak akses CRUD per menu
    const gs = await tx.groups.createManyAndReturn({ data: GROUPS });
    for (const g of gs) {
      const m = DEFAULT_MATRIX[g.code];
      await tx.groupPermissions.createMany({
        data: MENUS.map((x) => {
          const p = m[x.key] || '';
          return {
            groupId: g.id,
            menu: x.key,
            permRead: p.includes('R'),
            permCreate: p.includes('C'),
            permWrite: p.includes('U'),
            permDelete: p.includes('D'),
          };
        }),
      });
    }
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    for (const u of DEMO_USERS) {
      const p = await tx.partners.create({ data: { name: u.name, email: u.login, type: 'user' } });
      const usr = await tx.users.create({ data: { partnerId: p.id, login: u.login, password: hash } });
      await tx.groupUsers.create({ data: { gid: gs.find((g: any) => g.code === u.group).id, uid: usr.id } });
    }

    // lokasi bantu
    await tx.locations.createMany({
      data: [
        { name: 'Principal', completeName: 'Partner/Principal', usage: 'supplier' },
        { name: 'Pelanggan', completeName: 'Partner/Pelanggan', usage: 'customer' },
        { name: 'Penyesuaian', completeName: 'Virtual/Penyesuaian Stok', usage: 'inventory' },
      ],
    });

    // bagan akun dan jurnal
    const acc = await tx.accounts.createManyAndReturn({
      data: ACCOUNTS.map(([code, name, accountType]) => ({ code, name, accountType })),
    });
    const A = (c: string) => acc.find((a: any) => a.code === c).id;
    await tx.journals.createMany({
      data: [
        { name: 'Invoice Pelanggan', code: 'INV', type: 'sale', defaultAccountId: A('4-1000') },
        { name: 'Tagihan Principal', code: 'BILL', type: 'purchase', defaultAccountId: A('5-1000') },
        { name: 'Bank', code: 'BNK', type: 'bank', defaultAccountId: A('1-1200') },
        { name: 'Kas', code: 'KAS', type: 'cash', defaultAccountId: A('1-1100') },
        { name: 'Pemakaian Uang Muka', code: 'UMM', type: 'general' },
        { name: 'Jurnal Umum', code: 'MISC', type: 'general' },
      ],
    });

    // term of payment dan satuan, kategori
    const terms = await tx.paymentTerms.createManyAndReturn({
      data: [
        { name: 'Tunai', days: 0 },
        { name: '14 hari', days: 14 },
        { name: '30 hari', days: 30 },
        { name: '45 hari', days: 45 },
        { name: '60 hari', days: 60 },
      ],
    });
    const units = await tx.units.createManyAndReturn({
      data: [{ name: 'Unit' }, { name: 'Meter' }, { name: 'Set' }, { name: 'Pcs' }, { name: 'Roll' }],
    });
    const cats = await tx.productCategories.createManyAndReturn({
      data: [
        { name: 'Panel Listrik' },
        { name: 'Kabel' },
        { name: 'Pompa' },
        { name: 'Genset' },
        { name: 'Aksesoris' },
      ],
    });
    if (opts.demo === false) return;

    const T = (d: number) => terms.find((t: any) => t.days === d).id;
    const U = (n: string) => units.find((u: any) => u.name === n).id;
    const C = (n: string) => cats.find((c: any) => c.name === n).id;

    // principal beserta gudangnya
    const princ: any[] = [];
    for (const p of [
      {
        name: 'PT Sinar Elektrik Nusantara',
        city: 'Surabaya',
        street: 'Jl. Rungkut Industri III No. 12',
        email: 'order@sinarelektrik.co.id',
        phone: '031-8432100',
        supplierNote: 'Pembayaran 30 hari setelah tagihan',
        wh: 'Gudang Sinar Elektrik Rungkut',
      },
      {
        name: 'PT Kabel Prima Indonesia',
        city: 'Sidoarjo',
        street: 'Jl. Raya Waru No. 88',
        email: 'sales@kabelprima.co.id',
        phone: '031-8661234',
        supplierNote: 'Pembayaran 45 hari',
        wh: 'Gudang Kabel Prima Waru',
      },
      {
        name: 'PT Daya Pompa Mandiri',
        city: 'Gresik',
        street: 'Kawasan Industri Gresik Blok C2',
        email: 'cs@dayapompa.co.id',
        phone: '031-3981122',
        supplierNote: 'Pembayaran 30 hari setelah tagihan',
        wh: 'Gudang Daya Pompa Gresik',
      },
    ]) {
      const x = await tx.partners.create({
        data: {
          name: p.name,
          city: p.city,
          street: p.street,
          email: p.email,
          phone: p.phone,
          supplierNote: p.supplierNote,
          supplierRank: 1,
        },
      });
      const w = await createWarehouse(tx, x.id, p.wh);
      princ.push({ ...x, warehouse: w });
    }

    // produk dan pricelist principal
    const prods: any[] = [];
    const list = [
      {
        code: 'PNL-MDP-400',
        name: 'Panel MDP 400A Form 2',
        cat: 'Panel Listrik',
        uom: 'Unit',
        sup: 0,
        price: 68500000,
        cost: 54000000,
        disc: 5,
      },
      {
        code: 'PNL-SDP-100',
        name: 'Panel SDP 100A Outdoor',
        cat: 'Panel Listrik',
        uom: 'Unit',
        sup: 0,
        price: 18750000,
        cost: 14200000,
        disc: 0,
      },
      {
        code: 'MCB-3P-63',
        name: 'MCB 3 Phase 63A',
        cat: 'Aksesoris',
        uom: 'Pcs',
        sup: 0,
        price: 1250000,
        cost: 880000,
        disc: 10,
      },
      {
        code: 'KBL-NYY-4X50',
        name: 'Kabel NYY 4x50 mm²',
        cat: 'Kabel',
        uom: 'Meter',
        sup: 1,
        price: 465000,
        cost: 372000,
        disc: 0,
      },
      {
        code: 'KBL-NYM-3X2.5',
        name: 'Kabel NYM 3x2,5 mm²',
        cat: 'Kabel',
        uom: 'Roll',
        sup: 1,
        price: 1150000,
        cost: 910000,
        disc: 3,
      },
      {
        code: 'PMP-SUB-5HP',
        name: 'Pompa Submersible 5 HP',
        cat: 'Pompa',
        uom: 'Unit',
        sup: 2,
        price: 24500000,
        cost: 19100000,
        disc: 0,
      },
      {
        code: 'PMP-BST-2HP',
        name: 'Pompa Booster 2 HP',
        cat: 'Pompa',
        uom: 'Unit',
        sup: 2,
        price: 9800000,
        cost: 7350000,
        disc: 0,
      },
      {
        code: 'GNS-150KVA',
        name: 'Genset Silent 150 kVA',
        cat: 'Genset',
        uom: 'Set',
        sup: 2,
        price: 465000000,
        cost: 398000000,
        disc: 0,
        route: 'dropship',
      },
    ];
    for (const p of list) {
      const t = await tx.productTemplates.create({
        data: {
          name: p.name,
          uomId: U(p.uom),
          categoryId: C(p.cat),
          mainSupplierId: princ[p.sup].id,
          listPrice: p.price,
          mtppRoute: p.route || 'stock',
          descriptionSale: `${p.name}, garansi pabrik 12 bulan`,
        },
      });
      const pr = await tx.products.create({ data: { productTmplId: t.id, defaultCode: p.code } });
      await tx.supplierPrices.create({
        data: {
          partnerId: princ[p.sup].id,
          productTmplId: t.id,
          price: p.cost,
          discount: p.disc,
          minQty: 0,
          dateStart: '2026-01-01',
        },
      });
      prods.push({ ...pr, tmpl: t, sup: princ[p.sup], route: p.route || 'stock' });
    }

    // pricelist penjualan untuk pelanggan proyek
    const pl = await tx.salesPricelists.create({ data: { name: 'Pricelist Kontraktor 2026' } });
    await tx.salesPricelistItems.createMany({
      data: [
        { pricelistId: pl.id, productId: prods[3].id, discount: 5, minQty: 100, dateStart: '2026-01-01' },
        { pricelistId: pl.id, productId: prods[0].id, fixedPrice: 66000000, minQty: 1, dateStart: '2026-01-01' },
      ],
    });

    // pelanggan dan alamat kirim
    for (const c of [
      {
        name: 'PT Graha Bangun Sentosa',
        city: 'Surabaya',
        street: 'Jl. HR Muhammad No. 150',
        email: 'purchasing@grahabangun.co.id',
        phone: '031-7345566',
        vat: '01.234.567.8-614.000',
        cat: 'Kontraktor',
        term: 30,
        pl: true,
        isNew: false,
        addr: [['Proyek Apartemen Citraland', 'Jl. Citraland Utama Blok A, Surabaya']],
      },
      {
        name: 'CV Mitra Teknik Mandiri',
        city: 'Malang',
        street: 'Jl. Soekarno Hatta No. 21',
        email: 'admin@mitrateknik.co.id',
        phone: '0341-412233',
        vat: '02.345.678.9-623.000',
        cat: 'Panel maker',
        term: 45,
        pl: false,
        isNew: false,
        addr: [],
      },
      {
        name: 'RS Husada Medika',
        city: 'Sidoarjo',
        street: 'Jl. Pahlawan No. 9',
        email: 'logistik@husadamedika.id',
        phone: '031-8941200',
        vat: '03.456.789.0-617.000',
        cat: 'Rumah sakit',
        term: 14,
        pl: false,
        isNew: false,
        addr: [['Gedung Rawat Inap Baru', 'Jl. Pahlawan No. 11, Sidoarjo']],
      },
      {
        name: 'PT Anugerah Pangan Lestari',
        city: 'Pasuruan',
        street: 'Kawasan PIER Blok B-7',
        email: 'procurement@anugerahpangan.co.id',
        phone: '0343-655100',
        vat: '04.567.890.1-624.000',
        cat: 'Pabrik',
        term: 0,
        pl: false,
        isNew: true,
        addr: [['Pabrik Unit 2', 'Kawasan PIER Blok D-3, Pasuruan']],
      },
    ]) {
      const x = await tx.partners.create({
        data: {
          name: c.name,
          city: c.city,
          street: c.street,
          email: c.email,
          phone: c.phone,
          vat: c.vat,
          category: c.cat,
          customerRank: 1,
          paymentTermId: T(c.term),
          salesPricelistId: c.pl ? pl.id : null,
          mtppIsNewCustomer: c.isNew,
        },
      });
      for (const [n, st] of c.addr)
        await tx.partners.create({ data: { parentId: x.id, type: 'delivery', name: n, street: st, city: c.city } });
    }

    // stok awal dan stok minimum
    const inv = (await tx.locations.findMany({})).find((l: any) => l.usage === 'inventory');
    const stockQ: [number, number][] = [
      [0, 2],
      [1, 3],
      [2, 40],
      [3, 600],
      [4, 25],
      [5, 2],
      [6, 6],
    ];
    for (const [i, q] of stockQ) {
      const p = prods[i];
      const [loc] = (await tx.locations.findMany({})).filter(
        (l: any) => l.warehouseId === p.sup.warehouse.id && l.usage === 'internal',
      );
      await tx.stockBalances.create({ data: { productId: p.id, locationId: loc.id, quantity: q } });
      await tx.stockMoves.create({
        data: {
          productId: p.id,
          locationId: inv.id,
          locationDestId: loc.id,
          productUomQty: q,
          quantity: q,
          state: 'done',
        },
      });
    }
    await tx.stockRules.createMany({
      data: [
        { productId: prods[2].id, warehouseId: prods[2].sup.warehouse.id, minQty: 50 },
        { productId: prods[3].id, warehouseId: prods[3].sup.warehouse.id, minQty: 300 },
        { productId: prods[6].id, warehouseId: prods[6].sup.warehouse.id, minQty: 2 },
      ],
    });
  });
}

export async function seedIfEmpty(db: any, log?: { log: (m: string) => void }) {
  const n = await db.groups.count();
  if (n > 0) return;
  await seed(db, { demo: process.env.SEED_DEMO !== 'false' });
  log?.log(
    `Data awal dibuat. Login contoh: ${DEMO_USERS.map((u) => u.login).join(', ')} (kata sandi ${DEMO_PASSWORD})`,
  );
}

if (require.main === module) {
  (async () => {
    const { db } = await import('./db.module');
    await seedIfEmpty(db, console);
    await db.$disconnect();
  })();
}
