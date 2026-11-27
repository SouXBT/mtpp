// Data contoh MTPP Distribusi: katalog produk dari website MTPP (src/content/products.ts),
// sedangkan harga, stok, kontak principal, dan transaksinya adalah data contoh. Nama dan NPWP principal
// Trafindo dan Schneider diambil dari data contoh MTPP Finance (pembukuan-mtpp).
// Jalankan: API=http://localhost:8080/api node apps/api/scripts/seed/mock-data.mjs
// Skrip ini menulis data dan menolak berjalan dua kali pada database yang sama.
const API = process.env.API || 'http://localhost:8081/api';
const PASS = process.env.DEMO_PASSWORD || 'mtpp12345';

// pembayaran pelanggan wajib disertai bukti transfer: kirim sebagai multipart dengan berkas contoh
const withProof = (method, path, body) => {
  if (method !== 'POST' || path !== '/payments' || !body || body instanceof FormData) return body;
  // uang muka SO wajib punya tanggal pelunasan sisa; skrip lama memakai 14 hari setelah tanggal bayar
  if (body.saleId && !body.settleDate && !body.kind) {
    const d = new Date((body.date ? Date.parse(body.date) : Date.now()) + 14 * 86400000);
    body = { ...body, settleDate: d.toISOString().slice(0, 10) };
  }
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== null) fd.append(k, String(v));
  fd.append('file', new Blob(['%PDF-1.4 bukti transfer uji'], { type: 'application/pdf' }), 'bukti-transfer.pdf');
  return fd;
};

async function call(token, method, path, body) {
  body = withProof(method, path, body);
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(API + path, { method, headers, body: payload });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${j?.message || t}`);
  return j;
}
const login = async (u) => (await call('', 'POST', '/auth/login', { login: `${u}@mtpp.co.id`, password: PASS })).token;
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function importRows(token, kind, rows) {
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => csvCell(r[k])).join(','))].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), `${kind}.csv`);
  const r = await fetch(`${API}/import/${kind}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const j = await r.json();
  if (!r.ok || j.errors?.length) throw new Error(`impor ${kind}: ${JSON.stringify(j.errors?.slice(0, 5) ?? j)}`);
  console.log(`  ${kind}: ${j.imported} baris`);
}

const TRAFINDO = 'PT Trafindo Prima Perkasa',
  SCHNEIDER = 'Schneider Electric Indonesia',
  SUPREME = 'Supreme Cable',
  KMI = 'Kabelmetal Indonesia',
  VOKSEL = 'Voksel Electric',
  EV = 'Principal EV Seri PEVC';
const CAT = {
  trafo: 'Transformator Distribusi',
  panel: 'Cubicle & Panel TM',
  meter: 'Power Meter & Proteksi',
  kabel: 'Kabel Listrik',
  ev: 'EV Charging Station',
};

// [nama, kota, gudang, catatan pembayaran, NPWP]
const PRINCIPALS = [
  [TRAFINDO, 'Jakarta', 'Gudang Trafindo', 'Pembayaran 30 hari setelah barang diterima', '03.456.789.0-123.000'],
  [
    SCHNEIDER,
    'Jakarta',
    'Gudang Schneider Electric',
    'Pembayaran 30 hari setelah barang diterima',
    '04.567.890.1-234.000',
  ],
  [SUPREME, 'Jakarta', 'Gudang Supreme Cable', 'Pembayaran 45 hari setelah barang diterima'],
  [KMI, 'Jakarta', 'Gudang Kabelmetal', 'Pembayaran 45 hari setelah barang diterima'],
  [VOKSEL, 'Bogor', 'Gudang Voksel', 'Pembayaran 45 hari setelah barang diterima'],
  [EV, 'Surabaya', 'Gudang EV Charger', 'Pembayaran 14 hari setelah barang diterima'],
];

// [kode, nama, satuan, kategori, principal, harga jual contoh, harga principal contoh, stok contoh, rute]
const PRODUCTS = [
  [
    'TRF-OIL-400',
    'Transformator Distribusi Oil Immersed 20 kV/400 V 400 kVA',
    'Unit',
    'trafo',
    TRAFINDO,
    215000000,
    172000000,
    3,
  ],
  [
    'TRF-OIL-630',
    'Transformator Distribusi Oil Immersed 20 kV/400 V 630 kVA',
    'Unit',
    'trafo',
    TRAFINDO,
    298000000,
    238000000,
    2,
  ],
  [
    'TRF-OIL-800',
    'Transformator Distribusi Oil Immersed 20 kV/400 V 800 kVA',
    'Unit',
    'trafo',
    TRAFINDO,
    365000000,
    292000000,
    1,
  ],
  [
    'TRF-OIL-1250',
    'Transformator Distribusi Oil Immersed 20 kV/400 V 1250 kVA',
    'Unit',
    'trafo',
    TRAFINDO,
    515000000,
    412000000,
    1,
  ],
  [
    'TRF-OIL-1600',
    'Transformator Distribusi Oil Immersed 20 kV/400 V 1600 kVA',
    'Unit',
    'trafo',
    TRAFINDO,
    640000000,
    512000000,
    0,
  ],
  [
    'TRF-OIL-2500',
    'Transformator Distribusi Oil Immersed 20 kV/400 V 2500 kVA',
    'Unit',
    'trafo',
    TRAFINDO,
    945000000,
    756000000,
    0,
  ],
  ['TRF-CAST', 'Transformator Cast Resin (Dry Type)', 'Unit', 'trafo', TRAFINDO, 720000000, 576000000, 0],
  [
    'TRF-DAYA-36',
    'Trafo Daya Tegangan Menengah hingga 36 kV',
    'Unit',
    'trafo',
    TRAFINDO,
    1650000000,
    1320000000,
    0,
    'dropship',
  ],
  ['TRF-BUCHHOLZ', 'Buchholz Relay', 'Pcs', 'trafo', TRAFINDO, 6500000, 4900000, 8],
  ['TRF-BREATHER', 'Silica Gel Breather', 'Pcs', 'trafo', TRAFINDO, 1400000, 1000000, 15],
  ['CUB-SM6-IM', 'Cubicle SM6 IM (Air Insulated Switchgear, 24 kV)', 'Unit', 'panel', SCHNEIDER, 98000000, 80000000, 4],
  [
    'CUB-SM6-QM',
    'Cubicle SM6 QM (Air Insulated Switchgear, 24 kV)',
    'Unit',
    'panel',
    SCHNEIDER,
    112000000,
    92000000,
    3,
  ],
  [
    'CUB-SM6-DM1A',
    'Cubicle SM6 DM1-A (Air Insulated Switchgear, 24 kV)',
    'Unit',
    'panel',
    SCHNEIDER,
    245000000,
    201000000,
    1,
  ],
  ['CUB-PREMSET', 'Cubicle PremSet (Shielded Solid Insulation)', 'Unit', 'panel', SCHNEIDER, 185000000, 151000000, 2],
  ['CUB-RM6', 'RM6 Ring Main Unit 24 kV', 'Unit', 'panel', SCHNEIDER, 268000000, 220000000, 2],
  ['PNL-LVMDP', 'Panel Assembly MDP / LVMDP', 'Unit', 'panel', SCHNEIDER, 158000000, 121000000, 0],
  ['PNL-LVSDP', 'Panel Assembly LVSDP', 'Unit', 'panel', SCHNEIDER, 46500000, 35500000, 3],
  ['PNL-KAPASITOR', 'Panel Kapasitor', 'Unit', 'panel', SCHNEIDER, 72000000, 55000000, 1],
  ['MTR-PM2000', 'Power Meter EasyLogic PM2000', 'Pcs', 'meter', SCHNEIDER, 4250000, 3350000, 24],
  ['MTR-PM5000', 'Power Meter PowerLogic PM5000', 'Pcs', 'meter', SCHNEIDER, 11800000, 9400000, 12],
  ['MTR-PM8000', 'Power Meter PowerLogic PM8000', 'Pcs', 'meter', SCHNEIDER, 42500000, 34000000, 0],
  ['MTR-IEM3100', 'Energy Meter DIN-Rail Acti9 iEM3100', 'Pcs', 'meter', SCHNEIDER, 3150000, 2450000, 30],
  ['MTR-IEM3200', 'Energy Meter DIN-Rail Acti9 iEM3200', 'Pcs', 'meter', SCHNEIDER, 3650000, 2850000, 18],
  ['ACB-MTZ', 'Air Circuit Breaker MasterPact MTZ', 'Unit', 'meter', SCHNEIDER, 124000000, 99000000, 2],
  ['MCCB-NSX', 'Moulded Case CB ComPact NSX', 'Pcs', 'meter', SCHNEIDER, 8900000, 7000000, 20],
  ['MCCB-CVS', 'Moulded Case CB EasyPact CVS', 'Pcs', 'meter', SCHNEIDER, 3400000, 2600000, 35],
  ['MCB-IC60', 'MCB Acti9 iC60', 'Pcs', 'meter', SCHNEIDER, 385000, 285000, 150],
  ['SPD-IPRD', 'Surge Protection Acti9 iPRD', 'Pcs', 'meter', SCHNEIDER, 2950000, 2250000, 16],
  ['KTR-TESYS-D', 'Kontaktor TeSys D', 'Pcs', 'meter', SCHNEIDER, 1250000, 950000, 40],
  ['KAP-VARSET', 'VarSet Capacitor Bank', 'Unit', 'meter', SCHNEIDER, 88000000, 69000000, 1],
  ['ENC-PRISMA', 'Prisma Enclosure', 'Unit', 'meter', SCHNEIDER, 26500000, 20500000, 5],
  ['KBL-NYA', 'Kabel NYA', 'Meter', 'kabel', SUPREME, 18500, 14500, 2500],
  ['KBL-NYM', 'Kabel NYM', 'Meter', 'kabel', SUPREME, 27500, 21500, 2000],
  ['KBL-NYY', 'Kabel NYY 0,6/1 kV', 'Meter', 'kabel', SUPREME, 125000, 98000, 1200],
  ['KBL-NYFGBY', 'Kabel NYFGbY Berarmor', 'Meter', 'kabel', KMI, 285000, 226000, 600],
  ['KBL-N2XY', 'Kabel N2XY Isolasi XLPE', 'Meter', 'kabel', KMI, 195000, 154000, 800],
  ['KBL-N2XSY', 'Kabel N2XSY Isolasi XLPE', 'Meter', 'kabel', KMI, 310000, 248000, 300],
  ['KBL-N2XSEFGBY', 'Kabel N2XSEFGbY 12/20 kV Berarmor', 'Meter', 'kabel', KMI, 685000, 548000, 100],
  ['KBL-NFA2X', 'Kabel NFA2X-T Twisted Aluminium', 'Meter', 'kabel', VOKSEL, 42500, 33000, 1500],
  ['KBL-AAAC', 'Penghantar AAAC', 'Meter', 'kabel', VOKSEL, 38500, 30000, 1500],
  ['KBL-NYMHY', 'Kabel Kontrol NYMHY', 'Meter', 'kabel', VOKSEL, 21500, 16500, 1000],
  ['EV-AC-7-1', 'EV Charger PEVC-AC-7-1 (AC 7 kW, 1 outlet)', 'Unit', 'ev', EV, 28500000, 22500000, 6],
  ['EV-AC-22-1', 'EV Charger PEVC-AC-22-1 (AC 22 kW, 1 outlet)', 'Unit', 'ev', EV, 46500000, 37000000, 4],
  ['EV-DC-30-1', 'EV Charger PEVC-DC-30-1 (DC 30 kW, 1 outlet)', 'Unit', 'ev', EV, 285000000, 228000000, 2],
  ['EV-DC-60-2', 'EV Charger PEVC-DC-60-2 (DC 60 kW, 2 outlet)', 'Unit', 'ev', EV, 465000000, 372000000, 1],
  ['EV-DC-120-2', 'EV Charger PEVC-DC-120-2 (DC 120 kW, 2 outlet)', 'Unit', 'ev', EV, 785000000, 628000000, 0],
  [
    'EV-DC-240-2',
    'EV Charger PEVC-DC-240-2 (DC 240 kW, 2 outlet)',
    'Unit',
    'ev',
    EV,
    1350000000,
    1080000000,
    0,
    'dropship',
  ],
  ['EV-AC-WCN', 'EV Charger AC.WCN.1SC (AC Wall Mount)', 'Unit', 'ev', EV, 32500000, 26000000, 3],
  ['EV-AC-CORE', 'EV Charger AC.CORE.1SC (AC Floor Stand)', 'Unit', 'ev', EV, 54000000, 43000000, 2],
];

const [A, S, F, O] = await Promise.all(['admin', 'sales', 'finance', 'operasional'].map(login));

const before = await call(A, 'GET', '/products');
if (before.some((p) => p.code === PRODUCTS[0][0])) {
  console.error('Data contoh sudah ada, tidak ada yang diubah.');
  process.exit(1);
}

console.log('Master');
await importRows(
  A,
  'principals',
  PRINCIPALS.map(([name, city, warehouseName, supplierNote, vat]) => ({
    name,
    vat: vat || '',
    email: `order@${name.toLowerCase().replace(/[^a-z]/g, '')}.contoh.test`,
    city,
    warehouseName,
    supplierNote,
  })),
);
await importRows(
  A,
  'products',
  PRODUCTS.map(([code, name, uom, cat, principal, listPrice, , , route]) => ({
    code,
    name,
    uom,
    category: CAT[cat],
    principal,
    listPrice,
    route: route || 'stock',
  })),
);
await importRows(
  A,
  'supplier_prices',
  PRODUCTS.map(([code, , , , principal, , price]) => ({
    principal,
    code,
    price,
    discount: 0,
    minQty: 0,
    dateStart: '2026-01-01',
  })),
);
const warehouseOf = Object.fromEntries(PRINCIPALS.map(([n, , w]) => [n, w]));
await importRows(
  A,
  'initial_stock',
  PRODUCTS.filter((p) => p[7] > 0).map(([code, , , , principal, , , qty]) => ({
    code,
    warehouse: warehouseOf[principal],
    qty,
  })),
);

// produk dan principal contoh lama diarsipkan, bukan dihapus
const OLD_CODES = [
  'PNL-MDP-400',
  'PNL-SDP-100',
  'MCB-3P-63',
  'KBL-NYY-4X50',
  'KBL-NYM-3X2.5',
  'PMP-SUB-5HP',
  'PMP-BST-2HP',
  'GNS-150KVA',
];
for (const p of before.filter((x) => OLD_CODES.includes(x.code)))
  await call(A, 'PATCH', `/products/${p.id}`, { active: false });
for (const p of (await call(A, 'GET', '/partners?kind=supplier')).filter((x) =>
  /Sinar Elektrik|Kabel Prima|Daya Pompa/.test(x.name),
))
  await call(A, 'PATCH', `/partners/${p.id}`, { active: false });

const products = await call(A, 'GET', '/products');
const pid = (code) => {
  const p = products.find((x) => x.code === code);
  if (!p) throw new Error(`produk ${code} tidak ada`);
  return p.id;
};
const warehouses = await call(O, 'GET', '/warehouses');
const gudang = (principal) => {
  const w = warehouses.find((x) => x.name === warehouseOf[principal]);
  if (!w) throw new Error(`gudang ${principal} tidak ada`);
  return w.id;
};
for (const [code, principal, minQty] of [
  ['MTR-PM5000', SCHNEIDER, 15],
  ['TRF-OIL-800', TRAFINDO, 2],
  ['KBL-N2XSEFGBY', KMI, 300],
  ['EV-DC-60-2', EV, 2],
])
  await call(O, 'POST', '/stock-rules', { productId: pid(code), warehouseId: gudang(principal), minQty });
const customers = await call(S, 'GET', '/partners?kind=customer');
const cust = (name) => {
  const c = customers.find((x) => x.name.includes(name));
  if (!c) throw new Error(`pelanggan ${name} tidak ada`);
  return c.id;
};

const quote = (partner, ref, lines) =>
  call(S, 'POST', '/sales-orders', {
    partnerId: cust(partner),
    clientOrderRef: ref,
    lines: lines.map(([c, q]) => ({ productId: pid(c), productUomQty: q })),
  });
const confirm = (q) => call(S, 'POST', `/sales-orders/${q.id}/confirm`, {});
const asList = (x) => (Array.isArray(x) ? x : [x]);
async function deliver(soId) {
  for (const t of asList(await call(O, 'POST', `/transfers/from-sale/${soId}`))) {
    const d = await call(O, 'GET', `/transfers/${t.id}`);
    await call(O, 'POST', `/transfers/${t.id}/validate`, {
      moves: d.moves.map((m) => ({ id: m.id, quantity: m.productUomQty })),
    });
  }
}
async function invoice(soId) {
  const inv = await call(F, 'POST', `/invoices/from-sale/${soId}`, {});
  return call(F, 'POST', `/invoices/${inv.id}/post`);
}

console.log('Transaksi');
const q1 = await quote('Husada', null, [
  ['TRF-OIL-630', 1],
  ['CUB-SM6-IM', 2],
]);
console.log(`  ${q1.name}: penawaran draf`);

const q2 = await quote('Graha', 'PO-GBS-2026-101', [
  ['MTR-PM5000', 4],
  ['MCB-IC60', 40],
]);
await call(S, 'POST', `/sales-orders/${q2.id}/send`, {});
console.log(`  ${q2.name}: penawaran terkirim`);

const so3 = await confirm(
  await quote('Graha', 'PO-GBS-2026-102', [
    ['TRF-OIL-1600', 1],
    ['PNL-LVMDP', 1],
  ]),
);
console.log(`  ${so3.name}: stok kurang, menunggu PO Principal`);

const so4 = await confirm(
  await quote('Mitra', 'PO-MTM-0417', [
    ['KBL-NYY', 200],
    ['MCCB-NSX', 6],
  ]),
);
console.log(`  ${so4.name}: siap dikirim`);

const so5 = await confirm(await quote('Husada', 'PO-RSHM-3321', [['EV-DC-120-2', 1]]));
for (const po of asList(await call(F, 'POST', `/purchase-orders/from-sale/${so5.id}`)))
  await call(F, 'POST', `/purchase-orders/${po.id}/confirm`);
console.log(`  ${so5.name}: PO Principal dikonfirmasi, menunggu penerimaan`);

const so6 = await confirm(await quote('Anugerah', 'PO-APL-0921', [['MTR-IEM3100', 10]]));
console.log(`  ${so6.name}: pelanggan baru, menunggu pelunasan`);

const so7 = await confirm(
  await quote('Mitra', 'PO-MTM-0388', [
    ['CUB-RM6', 1],
    ['KBL-N2XSY', 50],
  ]),
);
await deliver(so7.id);
console.log(`  ${so7.name}: terkirim, siap ditagih`);

const so8 = await confirm(
  await quote('Graha', 'PO-GBS-2026-097', [
    ['EV-AC-22-1', 2],
    ['KBL-NYFGBY', 100],
  ]),
);
await deliver(so8.id);
const inv8 = await invoice(so8.id);
await call(F, 'POST', '/payments', {
  invoiceId: inv8.id,
  amount: Math.round(inv8.amountTotal / 2),
  method: 'BNK',
  memo: 'Pembayaran sebagian (contoh)',
});
console.log(`  ${so8.name}: invoice ${inv8.name} dibayar sebagian`);

const so9 = await confirm(await quote('Husada', 'PO-RSHM-3307', [['TRF-OIL-400', 1]]));
await deliver(so9.id);
const inv9 = await invoice(so9.id);
await call(F, 'POST', '/payments', {
  invoiceId: inv9.id,
  amount: inv9.amountTotal,
  method: 'BNK',
  memo: 'Pelunasan (contoh)',
});
console.log(`  ${so9.name}: invoice ${inv9.name} lunas`);

console.log('Selesai.');
