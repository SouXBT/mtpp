// Uji alur di luar jalur normal (hasil tinjauan alur 5 November 2026).
// Jalankan setelah demo-flow pada database uji:  API=http://localhost:3000/api node tests/flows/edge-flow.mjs
// Skrip ini menulis data, jadi jangan dijalankan pada database utama.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// RUN_TAG tetap membuat nama data sama antar-jalan sehingga rekaman bisa dibandingkan
const RUN_TAG = process.env.RUN_TAG || Date.now() % 100000;
const API = process.env.API || 'http://localhost:3000/api';
const PASS = process.env.DEMO_PASSWORD || 'mtpp12345';
let passed = 0,
  failed = 0;

async function call(token, method, path, body, raw = false) {
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(API + path, { method, headers, body: payload });
  if (raw) return r;
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  if (!r.ok) {
    const e = new Error(`${method} ${path} -> ${r.status} ${j?.message || t}`);
    e.status = r.status;
    e.msg = j?.message;
    throw e;
  }
  return j;
}
const check = (c, m) => {
  if (c) log.push(`  ✓ ${m}`);
  else {
    errors++;
    log.push(`  ✗ ${m}`);
  }
};
let log = [],
  errors = 0;
const rejected = async (p, status, re, m) => {
  try {
    await p;
    check(false, `${m} (seharusnya ditolak)`);
  } catch (e) {
    check(e.status === status && (!re || re.test(String(e.msg))), `${m} → ${e.status} ${e.msg}`);
  }
};
async function test(name, fn) {
  log = [];
  errors = 0;
  try {
    await fn();
  } catch (e) {
    errors++;
    log.push(`  ✗ galat: ${e.message}`);
  }
  console.log(`${errors ? 'FAIL' : 'PASS'} ${name}`);
  for (const l of log) console.log(l);
  if (errors) failed++;
  else passed++;
}

const login = async (email) => (await call('', 'POST', '/auth/login', { login: email, password: PASS })).token;
const P = await login('pimpinan@mtpp.co.id'),
  A = await login('admin@mtpp.co.id'),
  S = await login('sales@mtpp.co.id'),
  O = await login('operasional@mtpp.co.id'),
  F = await login('finance@mtpp.co.id');
const customers = await call(S, 'GET', '/partners?kind=customer');
const regular = customers.find((c) => c.name.includes('Husada'));
const graha = customers.find((c) => c.name.includes('Graha'));
const suppliers = await call(S, 'GET', '/partners?kind=supplier');
const seedProducts = await call(S, 'GET', '/products');
const code = (c) => seedProducts.find((p) => p.code === c);
const sample = code('MCB-3P-63');

let seq = 0;
// produk baru supaya setiap uji tidak terpengaruh stok uji lain
async function newProduct({ cost = 100000, list = 150000, route } = {}) {
  seq++;
  const c = `UJI-${RUN_TAG}-${seq}`;
  const p = await call(A, 'POST', '/products', {
    code: c,
    defaultCode: c,
    name: `Produk Uji ${c}`,
    uomId: sample.uomId,
    categoryId: sample.categoryId,
    mainSupplierId: suppliers[0].id,
    listPrice: list,
    type: 'product',
    ...(route ? { mtppRoute: route } : {}),
  });
  const all = await call(S, 'GET', '/products');
  const row = all.find((x) => x.id === p.id);
  if (cost)
    await call(F, 'POST', '/supplier-prices', {
      partnerId: suppliers[0].id,
      productTmplId: row.tmplId,
      price: cost,
      discount: 0,
      minQty: 0,
      dateStart: '2026-01-01',
    });
  return { ...row, id: p.id };
}
const newCustomer = async () =>
  call(A, 'POST', '/partners', {
    kind: 'customer',
    name: `PT Pelanggan Uji ${RUN_TAG}-${++seq}`,
    email: 'uji@contoh.id',
  });
const quote = (c, lines, extra = {}) => call(S, 'POST', '/sales-orders', { partnerId: c.id, lines, ...extra });
const confirm = async (q) => {
  await call(S, 'POST', `/sales-orders/${q.id}/confirm`, {});
  return call(S, 'GET', `/sales-orders/${q.id}`);
};
const line = (p, qty, extra = {}) => ({ productId: p.id, productUomQty: qty, ...extra });
const receiveAll = async (poId, qty) => {
  const d = await call(F, 'GET', `/purchase-orders/${poId}`);
  const t = await call(
    O,
    'GET',
    `/transfers/${d.transfers.find((x) => x.state !== 'done' && x.state !== 'cancel').id}`,
  );
  return call(O, 'POST', `/transfers/${t.id}/validate`, {
    moves: t.moves.map((m) => ({ id: m.id, quantity: qty ?? m.productUomQty })),
  });
};
const physical = async (p) => (await call(O, 'GET', `/stock?q=${encodeURIComponent(p.code)}`))[0]?.physical ?? 0;
// PO baru yang kuantitasnya sudah diterima seluruhnya
async function receivedPO(cQty = 3) {
  const p = await newProduct();
  const q = await quote(regular, [line(p, cQty)]);
  await confirm(q);
  const [po] = await call(F, 'POST', `/purchase-orders/from-sale/${q.id}`);
  await call(F, 'POST', `/purchase-orders/${po.id}/confirm`);
  await receiveAll(po.id);
  return { p, q, po };
}
// produk dengan stok fisik n dan tanpa stok terikat
async function withStock(n) {
  const p = await newProduct();
  const q = await quote(regular, [line(p, 1)]);
  await confirm(q);
  const [po] = await call(F, 'POST', `/purchase-orders/from-sale/${q.id}`);
  const d = await call(F, 'GET', `/purchase-orders/${po.id}`);
  await call(F, 'PATCH', `/purchase-orders/${po.id}`, {
    datePlanned: d.datePlanned,
    note: d.note,
    lines: d.lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      productQty: n + 1,
      priceUnit: l.priceUnit,
      mtppSaleLineId: l.mtppSaleLineId,
    })),
  });
  await call(F, 'POST', `/purchase-orders/${po.id}/confirm`);
  await receiveAll(po.id);
  const [ds] = await call(O, 'POST', `/transfers/from-sale/${q.id}`);
  await call(O, 'POST', `/transfers/${ds.id}/validate`, {});
  return p;
}
const invoiced = async (c, p, qty = 1) => {
  const q = await quote(c, [line(p, qty)]);
  await confirm(q);
  const [ds] = await call(O, 'POST', `/transfers/from-sale/${q.id}`);
  await call(O, 'POST', `/transfers/${ds.id}/validate`, {});
  const inv = await call(F, 'POST', `/invoices/from-sale/${q.id}`, {});
  return { q, inv: await call(F, 'POST', `/invoices/${inv.id}/post`) };
};
const pdfText = async (r) => {
  const f = join(mkdtempSync(join(tmpdir(), 'mtpp-')), 'x.pdf');
  writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
};
const balanced = async () => {
  const tb = await call(F, 'GET', '/trial-balance?from=2026-01-01&to=2026-12-31');
  return Math.abs(tb.totalDebit - tb.totalCredit) < 0.01;
};

// ---------- fase 1 ----------
await test('A1 surat jalan dibatasi stok bebas', async () => {
  const p = await withStock(2);
  const a = await quote(regular, [line(p, 2)]);
  await confirm(a);
  const b = await quote(regular, [line(p, 2)]);
  await confirm(b);
  const [db_] = await call(O, 'POST', `/transfers/from-sale/${b.id}`);
  const tb = await call(O, 'GET', `/transfers/${db_.id}`);
  await rejected(
    call(O, 'POST', `/transfers/${db_.id}/validate`, { moves: tb.moves.map((m) => ({ id: m.id, quantity: 2 })) }),
    400,
    /Stok bebas/,
    'SO kedua validasi stok yang terikat SO pertama',
  );
  await call(O, 'PATCH', `/transfers/${db_.id}`, { moves: tb.moves.map((m) => ({ id: m.id, quantity: 2 })) });
  await rejected(
    call(O, 'POST', `/transfers/${db_.id}/ready`),
    400,
    /Stok bebas/,
    'SO kedua Siap Kirim stok yang terikat SO pertama',
  );
  const [da] = await call(O, 'POST', `/transfers/from-sale/${a.id}`);
  const done = await call(O, 'POST', `/transfers/${da.id}/validate`, {});
  check(done.state === 'done', 'SO pertama tetap dapat dikirim');
  check((await physical(p)) === 0, 'stok fisik tidak minus');
  const sa = await call(S, 'GET', `/sales-orders/${b.id}`);
  check(
    sa.shortage.every((x) => x.available >= 0),
    'stok bebas per SO tidak minus',
  );
});

await test('A2 tagihan principal dibalik tidak menjadi lunas', async () => {
  const { po } = await receivedPO();
  const b = await call(F, 'POST', `/invoices/from-purchase/${po.id}`, { ref: 'A2' });
  await call(F, 'POST', `/invoices/${b.id}/post`);
  await call(F, 'POST', `/invoices/${b.id}/reverse`);
  const s = await call(F, 'GET', `/purchase-orders/${po.id}`);
  check(s.mtppPaymentState === 'menunggu tagihan', `status bayar ${s.mtppPaymentState}`);
  check(s.mtppAmountDue === 0, `sisa utang ${s.mtppAmountDue}`);
  check(s.state === 'purchase', `status PO ${s.state}`);
});

await test('A3 pembatalan pembayaran', async () => {
  const p = await withStock(1);
  const { inv } = await invoiced(regular, p);
  const before = await call(F, 'GET', '/cash/balance');
  const pay = await call(F, 'POST', '/payments', { invoiceId: inv.id, amount: inv.amountTotal, method: 'BNK' });
  await rejected(
    call(F, 'POST', `/journal-entries/${pay.moveId}/reverse`),
    400,
    /menu Penagihan/,
    'membalik jurnal pembayaran dari menu Jurnal',
  );
  await rejected(call(S, 'POST', `/payments/${pay.id}/cancel`, {}), 403, null, 'Sales membatalkan pembayaran');
  await call(F, 'POST', `/payments/${pay.id}/cancel`, {});
  const i = await call(F, 'GET', `/invoices/${inv.id}`);
  check(
    i.paymentState === 'not_paid' && i.amountResidual === i.amountTotal,
    `invoice ${i.paymentState}, sisa ${i.amountResidual}`,
  );
  const after = await call(F, 'GET', '/cash/balance');
  check(after.bank === before.bank, `saldo bank kembali (${before.bank} = ${after.bank})`);
  await rejected(call(F, 'POST', `/payments/${pay.id}/cancel`, {}), 400, /sudah dibatalkan/, 'pembatalan ganda');
  // tagihan principal
  const { po } = await receivedPO();
  const b = await call(F, 'POST', `/invoices/from-purchase/${po.id}`, { ref: 'A3' });
  const bp = await call(F, 'POST', `/invoices/${b.id}/post`);
  const paid = await call(F, 'POST', '/payments', { purchaseId: po.id, amount: bp.amountTotal, method: 'BNK' });
  check((await call(F, 'GET', `/purchase-orders/${po.id}`)).mtppPaymentState === 'lunas', 'PO lunas sesudah dibayar');
  await call(F, 'POST', `/payments/${paid.id}/cancel`, {});
  const s = await call(F, 'GET', `/purchase-orders/${po.id}`);
  check(
    s.mtppPaymentState === 'belum dibayar' && s.mtppAmountDue === bp.amountTotal,
    `PO ${s.mtppPaymentState}, sisa ${s.mtppAmountDue}`,
  );
  // uang muka
  const c = await newCustomer();
  const pp = await newProduct();
  const q = await quote(c, [line(pp, 1)]);
  const so = await confirm(q);
  const adv = await call(F, 'POST', '/payments', { saleId: q.id, amount: so.amountTotal, method: 'KAS' });
  check((await call(S, 'GET', `/sales-orders/${q.id}`)).payment.paidFull, 'uang muka tercatat');
  await call(F, 'POST', `/payments/${adv.id}/cancel`, {});
  check(!(await call(S, 'GET', `/sales-orders/${q.id}`)).payment.paidFull, 'uang muka batal, SO kembali belum lunas');
  check(await balanced(), 'neraca saldo seimbang');
});

await test('A4 harga pricelist mengikuti kuantitas (API)', async () => {
  const nyy = code('KBL-NYY-4X50');
  const q1 = await call(S, 'GET', `/products/${nyy.id}/price?partnerId=${graha.id}&qty=1`);
  const q150 = await call(S, 'GET', `/products/${nyy.id}/price?partnerId=${graha.id}&qty=150`);
  check(q1.discount === 0, `qty 1 diskon ${q1.discount}%`);
  check(q150.discount === 5, `qty 150 diskon ${q150.discount}%`);
});

await test('A7 kirim email butuh hak ubah', async () => {
  const p = await newProduct();
  const q = await quote(regular, [line(p, 1)]);
  await rejected(call(P, 'POST', `/sales-orders/${q.id}/send`, {}), 403, null, 'Pimpinan');
  await rejected(call(O, 'POST', `/sales-orders/${q.id}/send`, {}), 403, null, 'Operasional');
  await rejected(call(F, 'POST', `/sales-orders/${q.id}/send`, {}), 403, null, 'Finance');
  check((await call(S, 'GET', `/sales-orders/${q.id}`)).state === 'draft', 'status tetap draf');
  await call(S, 'POST', `/sales-orders/${q.id}/send`, {});
  check((await call(S, 'GET', `/sales-orders/${q.id}`)).state === 'sent', 'Sales dapat mengirim');
  const pp = await withStock(1);
  const { inv } = await invoiced(regular, pp);
  await rejected(call(S, 'POST', `/invoices/${inv.id}/send`, {}), 403, null, 'Sales mengirim invoice');
});

await test('A11 catatan PO tidak bertentangan soal PPN', async () => {
  const { po } = await receivedPO(1);
  const text = await pdfText(await call(F, 'GET', `/purchase-orders/${po.id}/pdf`, undefined, true));
  check(
    !/termasuk PPN/.test(text.replace(/belum termasuk PPN/g, '')) && !/sudah termasuk PPN/.test(text),
    'PDF tidak menyebut harga sudah termasuk PPN',
  );
  check(/PPN 12%/.test(text), 'PDF tetap menambahkan PPN');
});

await test('RCV tidak ada pada pratinjau penomoran', async () => {
  const s = await call(A, 'GET', '/settings/sequences/preview');
  check(!('RCV' in s), `kode: ${Object.keys(s).join(', ')}`);
});

// ---------- fase 2 ----------
await test('A5 nota kredit principal mengurangi tagihan', async () => {
  const { po } = await receivedPO(5);
  const b = await call(F, 'POST', `/invoices/from-purchase/${po.id}`, { ref: 'A5' });
  const bp = await call(F, 'POST', `/invoices/${b.id}/post`);
  await call(F, 'POST', `/invoices/refund-purchase/${po.id}`, { amount: 100000, ref: 'NK-A5' });
  let s = await call(F, 'GET', `/purchase-orders/${po.id}`);
  check(s.mtppAmountDue === bp.amountTotal - 111000, `sisa utang ${s.mtppAmountDue}`);
  await call(F, 'POST', '/payments', { purchaseId: po.id, amount: s.mtppAmountDue, method: 'BNK' });
  s = await call(F, 'GET', `/purchase-orders/${po.id}`);
  const b2 = await call(F, 'GET', `/invoices/${b.id}`);
  check(s.mtppPaymentState === 'lunas', `status bayar ${s.mtppPaymentState}`);
  check(b2.amountResidual === 0 && b2.paymentState === 'paid', `sisa tagihan ${b2.amountResidual} ${b2.paymentState}`);
  await rejected(
    call(F, 'POST', '/payments', { purchaseId: po.id, amount: 1, method: 'BNK' }),
    400,
    null,
    'membayar 1 rupiah lagi',
  );
  await rejected(
    call(F, 'POST', '/payments', { invoiceId: b.id, amount: 1, method: 'BNK' }),
    400,
    null,
    'membayar 1 rupiah lagi lewat tagihan',
  );
  check(await balanced(), 'neraca saldo seimbang');
});

await test('A6 ubah baris SO yang dibuka kembali tidak 500', async () => {
  const relines = (so, qty) => ({
    lines: so.lines.map((l) => ({
      productId: l.productId,
      productUomQty: qty,
      priceUnit: l.priceUnit,
      discount: l.discount,
    })),
  });
  // PO selesai tetap tertaut: ditolak dengan 400
  const { q, po } = await receivedPO(2);
  const b = await call(F, 'POST', `/invoices/from-purchase/${po.id}`, { ref: 'A6' });
  await call(F, 'POST', `/invoices/${b.id}/post`);
  await call(S, 'POST', `/sales-orders/${q.id}/cancel`);
  await call(S, 'POST', `/sales-orders/${q.id}/draft`);
  let so = await call(S, 'GET', `/sales-orders/${q.id}`);
  await rejected(
    call(S, 'PATCH', `/sales-orders/${q.id}`, relines(so, 1)),
    400,
    /Baris sudah dipakai PO Principal PO\//,
    'ubah baris yang tertaut PO selesai',
  );
  // PO dan surat jalan batal: tautan dilepas, perubahan berhasil
  const p2 = await withStock(2);
  const q2 = await quote(regular, [line(p2, 3)]);
  await confirm(q2);
  const [po2] = await call(F, 'POST', `/purchase-orders/from-sale/${q2.id}`);
  const [d2] = await call(O, 'POST', `/transfers/from-sale/${q2.id}`);
  await call(O, 'POST', `/transfers/${d2.id}/cancel`);
  await call(F, 'POST', `/purchase-orders/${po2.id}/cancel`);
  await call(S, 'POST', `/sales-orders/${q2.id}/cancel`);
  await call(S, 'POST', `/sales-orders/${q2.id}/draft`);
  so = await call(S, 'GET', `/sales-orders/${q2.id}`);
  const r = await call(S, 'PATCH', `/sales-orders/${q2.id}`, relines(so, 1));
  check(r.id === q2.id, 'baris dapat diubah sesudah PO dan surat jalan batal');
});

await test('A8 invoice yang dibayar dari uang muka dapat dibalik', async () => {
  const p = await withStock(2);
  const c = await newCustomer();
  const q = await quote(c, [line(p, 1)]);
  const so = await confirm(q);
  const adv = await call(F, 'POST', '/payments', { saleId: q.id, amount: so.amountTotal, method: 'BNK' });
  const [ds] = await call(O, 'POST', `/transfers/from-sale/${q.id}`);
  await call(O, 'POST', `/transfers/${ds.id}/validate`, {});
  const inv = await call(F, 'POST', `/invoices/from-sale/${q.id}`, {});
  const ip = await call(F, 'POST', `/invoices/${inv.id}/post`);
  check(
    ip.paymentState === 'paid' && ip.canReverse === true,
    `invoice ${ip.paymentState}, canReverse ${ip.canReverse}`,
  );
  await rejected(
    call(F, 'POST', `/payments/${adv.id}/cancel`, {}),
    400,
    /batalkan invoice/,
    'uang muka terpakai tidak dapat dibatalkan',
  );
  await call(F, 'POST', `/invoices/${inv.id}/reverse`);
  const i2 = await call(F, 'GET', `/invoices/${inv.id}`);
  check(i2.paymentState === 'reversed', `invoice ${i2.paymentState}`);
  const pays = await call(F, 'GET', `/payments?saleId=${q.id}`);
  check(pays[0].amountApplied === 0, `uang muka tersedia lagi (terpakai ${pays[0].amountApplied})`);
  const inv2 = await call(F, 'POST', `/invoices/from-sale/${q.id}`, {});
  const ip2 = await call(F, 'POST', `/invoices/${inv2.id}/post`);
  check(ip2.paymentState === 'paid', `invoice baru memakai uang muka lagi: ${ip2.paymentState}`);
  const { inv: real } = await invoiced(regular, p);
  await call(F, 'POST', '/payments', { invoiceId: real.id, amount: 1000, method: 'BNK' });
  const r2 = await call(F, 'GET', `/invoices/${real.id}`);
  check(r2.canReverse === false, 'tombol balik disembunyikan bila ada pembayaran nyata');
  await rejected(call(F, 'POST', `/invoices/${real.id}/reverse`), 400, /pembayaran/, 'invoice dengan pembayaran nyata');
  check(await balanced(), 'neraca saldo seimbang');
});

await test('A9 selisih pembulatan uang muka habis pada invoice terakhir', async () => {
  for (const [price, label] of [
    [1000040, 'invoice lebih kecil dari SO'],
    [1000060, 'invoice lebih besar dari SO'],
  ]) {
    const p = await withStock(3);
    const c = await newCustomer();
    const q = await quote(c, [line(p, 3, { priceUnit: price, discount: 0 })]);
    const so = await confirm(q);
    await call(F, 'POST', '/payments', { saleId: q.id, amount: so.amountTotal, method: 'BNK' });
    let [t] = await call(O, 'POST', `/transfers/from-sale/${q.id}`);
    let id = t.id,
      sum = 0,
      last;
    for (let i = 0; i < 3; i++) {
      const d = await call(O, 'GET', `/transfers/${id}`);
      const r = await call(O, 'POST', `/transfers/${id}/validate`, {
        moves: d.moves.map((m) => ({ id: m.id, quantity: 1 })),
      });
      const inv = await call(F, 'POST', `/invoices/from-sale/${q.id}`, {});
      last = await call(F, 'POST', `/invoices/${inv.id}/post`);
      sum += last.amountTotal;
      id = r.backorders?.[0]?.id;
    }
    const pays = await call(F, 'GET', `/payments?saleId=${q.id}`);
    check(
      pays[0].amountApplied === pays[0].amount,
      `${label} (${sum} vs ${so.amountTotal}): uang muka sisa ${pays[0].amount - pays[0].amountApplied}`,
    );
    check(
      last.paymentState === 'paid' && last.amountResidual === 0,
      `invoice terakhir ${last.paymentState}, sisa ${last.amountResidual}`,
    );
  }
  check(await balanced(), 'neraca saldo seimbang');
});

await test('A10 produk tanpa harga principal', async () => {
  const p = await newProduct({ cost: 0 });
  const pr = await call(S, 'GET', `/products/${p.id}/price?partnerId=${regular.id}&qty=1`);
  check(pr.costMissing === true, 'endpoint harga memberi tanda');
  const q = await quote(regular, [line(p, 2)]);
  const so = await confirm(q);
  check(so.lines[0].costMissing === true, 'baris penawaran memberi tanda harga pokok belum ada');
  await rejected(
    call(F, 'POST', `/purchase-orders/from-sale/${q.id}`),
    400,
    /belum ada atau sudah tidak berlaku/,
    'PO tanpa harga principal',
  );
  const e = await newProduct({ cost: 0 });
  await call(F, 'POST', '/supplier-prices', {
    partnerId: suppliers[0].id,
    productTmplId: e.tmplId,
    price: 5000,
    discount: 0,
    minQty: 0,
    dateStart: '2025-01-01',
    dateEnd: '2025-12-31',
  });
  const q2 = await quote(regular, [line(e, 2)]);
  await confirm(q2);
  await rejected(
    call(F, 'POST', `/purchase-orders/from-sale/${q2.id}`),
    400,
    /belum ada atau sudah tidak berlaku/,
    'PO dengan harga principal kedaluwarsa',
  );
});

// ---------- fase 3 ----------
await test('B1 penanda pelanggan baru', async () => {
  const off = await call(A, 'POST', '/partners', {
    kind: 'customer',
    name: `PT Uji Tetap ${++seq}`,
    mtppIsNewCustomer: false,
  });
  check(off.mtppIsNewCustomer === false, 'Admin membuat pelanggan bukan baru');
  const c = await newCustomer();
  check(c.mtppIsNewCustomer === true, 'bawaan tetap pelanggan baru');
  await call(A, 'PATCH', `/partners/${off.id}`, { mtppIsNewCustomer: true });
  check((await call(S, 'GET', `/partners/${off.id}`)).mtppIsNewCustomer === true, 'Admin dapat mengubah penanda');
  const p = await withStock(3);
  const q = await quote(c, [line(p, 2)]);
  const so = await confirm(q);
  await call(F, 'POST', '/payments', { saleId: q.id, amount: so.amountTotal, method: 'BNK' });
  check(
    (await call(S, 'GET', `/partners/${c.id}`)).mtppIsNewCustomer === true,
    'sudah lunas tetapi belum terkirim: masih baru',
  );
  const [d] = await call(O, 'POST', `/transfers/from-sale/${q.id}`);
  const t = await call(O, 'GET', `/transfers/${d.id}`);
  await call(O, 'POST', `/transfers/${d.id}/validate`, { moves: t.moves.map((m) => ({ id: m.id, quantity: 1 })) });
  check(
    (await call(S, 'GET', `/partners/${c.id}`)).mtppIsNewCustomer === true,
    'lunas dan baru terkirim sebagian: masih baru',
  );
  const bo = (await call(O, 'GET', `/transfers/${d.id}`)).backorders[0];
  const bt = await call(O, 'GET', `/transfers/${bo.id}`);
  await call(O, 'POST', `/transfers/${bo.id}/validate`, { moves: bt.moves.map((m) => ({ id: m.id, quantity: 1 })) });
  check(
    (await call(S, 'GET', `/partners/${c.id}`)).mtppIsNewCustomer === false,
    'lunas dan terkirim seluruhnya: bukan baru lagi',
  );
  const msgs = await call(P, 'GET', `/records/partners/${c.id}/messages`);
  check(
    msgs.some((m) => /pelanggan baru/i.test(m.body)),
    'tercatat pada riwayat pelanggan',
  );
  const inv = await call(F, 'POST', `/invoices/from-sale/${q.id}`, {});
  const ip = await call(F, 'POST', `/invoices/${inv.id}/post`);
  check(ip.invoiceDateDue === ip.invoiceDate, 'invoice pesanan pertama tetap jatuh tempo hari itu');
  const q2 = await quote(c, [line(p, 1)]);
  const s2 = await confirm(q2);
  check(s2.canDeliver === true, 'pesanan berikutnya tidak terblokir');
});

await test('B2 Tutup sisa PO', async () => {
  const p = await newProduct();
  const q = await quote(regular, [line(p, 397)]);
  await confirm(q);
  const [po] = await call(F, 'POST', `/purchase-orders/from-sale/${q.id}`);
  await rejected(call(F, 'POST', `/purchase-orders/${po.id}/close-remaining`, {}), 400, null, 'PO belum dikonfirmasi');
  await call(F, 'POST', `/purchase-orders/${po.id}/confirm`);
  await rejected(
    call(F, 'POST', `/purchase-orders/${po.id}/close-remaining`, {}),
    400,
    null,
    'belum ada barang diterima',
  );
  await receiveAll(po.id, 198);
  await rejected(call(S, 'POST', `/purchase-orders/${po.id}/close-remaining`, {}), 403, null, 'Sales menutup PO');
  await call(F, 'POST', `/purchase-orders/${po.id}/close-remaining`, {});
  let s = await call(F, 'GET', `/purchase-orders/${po.id}`);
  check(s.mtppPaymentState === 'menunggu tagihan', `status bayar ${s.mtppPaymentState}`);
  check(
    s.transfers.every((t) => t.state === 'done' || t.state === 'cancel'),
    'penerimaan susulan dibatalkan',
  );
  check(s.lines[0].productQty === 198, `kuantitas pesanan ${s.lines[0].productQty}`);
  const sh = await call(F, 'GET', `/sales-orders/${q.id}/shortage`);
  check(sh[0].onOrder === 0 && sh[0].shortage === 199, `dipesan ${sh[0].onOrder}, kurang ${sh[0].shortage}`);
  const [po2] = await call(F, 'POST', `/purchase-orders/from-sale/${q.id}`);
  check((await call(F, 'GET', `/purchase-orders/${po2.id}`)).lines[0].productQty === 199, 'PO baru untuk sisa 199');
  const b = await call(F, 'POST', `/invoices/from-purchase/${po.id}`, { ref: 'B2' });
  await call(F, 'POST', `/invoices/${b.id}/post`);
  s = await call(F, 'GET', `/purchase-orders/${po.id}`);
  check(s.state === 'done', `PO ${s.state} sesudah tagihan lengkap`);
});

await test('B3 batal SO dengan PO atau uang muka', async () => {
  const c = await newCustomer();
  const p = await newProduct();
  const q = await quote(c, [line(p, 5)]);
  const so = await confirm(q);
  const [po] = await call(F, 'POST', `/purchase-orders/from-sale/${q.id}`);
  await call(F, 'POST', `/purchase-orders/${po.id}/confirm`);
  await call(F, 'POST', '/payments', { saleId: q.id, amount: 200000, method: 'BNK' });
  await rejected(
    call(S, 'POST', `/sales-orders/${q.id}/cancel`),
    400,
    new RegExp(`Batalkan PO Principal ${po.name} dan kembalikan uang muka dulu`),
    'SO dengan PO dan uang muka',
  );
  await call(F, 'POST', `/purchase-orders/${po.id}/cancel`);
  await rejected(call(S, 'POST', `/sales-orders/${q.id}/cancel`), 400, /kembalikan uang muka/i, 'SO dengan uang muka');
  await rejected(
    call(S, 'POST', `/sales-orders/${q.id}/refund-advance`, { amount: 1000, method: 'BNK' }),
    403,
    null,
    'Sales mengembalikan uang muka',
  );
  await rejected(
    call(F, 'POST', `/sales-orders/${q.id}/refund-advance`, { amount: 999999, method: 'BNK' }),
    400,
    /melebihi/,
    'pengembalian melebihi uang muka',
  );
  const before = await call(F, 'GET', '/cash/balance');
  const rf = await call(F, 'POST', `/sales-orders/${q.id}/refund-advance`, {
    amount: 50000,
    method: 'BNK',
    memo: 'Sebagian',
  });
  check((await call(F, 'GET', '/cash/balance')).bank === before.bank - 50000, 'saldo bank berkurang');
  let d = await call(S, 'GET', `/sales-orders/${q.id}`);
  check(
    d.payment.amount === 150000 && d.payment.advanceAvailable === 150000,
    `uang muka ${d.payment.amount}, tersedia ${d.payment.advanceAvailable}`,
  );
  await rejected(
    call(F, 'POST', `/payments/${rf.id}/cancel`, {}),
    400,
    /tidak dapat dibatalkan/,
    'membatalkan pengembalian',
  );
  await rejected(call(F, 'GET', `/payments/${rf.id}/receipt`), 400, null, 'kuitansi pengembalian');
  await call(F, 'POST', `/sales-orders/${q.id}/refund-advance`, { amount: 150000, method: 'KAS' });
  d = await call(S, 'GET', `/sales-orders/${q.id}`);
  check(d.payment.advanceAvailable === 0, 'uang muka habis');
  const r = await call(S, 'POST', `/sales-orders/${q.id}/cancel`);
  check(r.state === 'cancel', 'SO dapat dibatalkan');
  check(await balanced(), 'neraca saldo seimbang');
  void so;
});

await test('B4 B5 catatan dokumen dan principal', async () => {
  const { po } = await receivedPO(1);
  const text = (await pdfText(await call(F, 'GET', `/purchase-orders/${po.id}/pdf`, undefined, true))).replace(
    /\s+/g,
    ' ',
  );
  check(
    /kesepakatan tertulis/.test(text) && !/dikembalikan atas biaya penjual/.test(text),
    'catatan PO tanpa proses retur',
  );
  const pp = await withStock(1);
  const { inv } = await invoiced(regular, pp);
  const it = (await pdfText(await call(F, 'GET', `/invoices/${inv.id}/pdf`, undefined, true))).replace(/\s+/g, ' ');
  check(/kesepakatan tertulis/.test(it), 'catatan invoice selaras');
  const daya = suppliers.find((s) => s.name.includes('Daya Pompa'));
  check(!/sebelum kirim|Uang muka/i.test(daya.supplierNote || ''), `catatan principal: ${daya.supplierNote}`);
});

await test('B6e gudang surat jalan mengikuti stok terikat', async () => {
  const p = await withStock(1);
  const q = await quote(regular, [line(p, 1)]);
  await confirm(q);
  const [d] = await call(O, 'POST', `/transfers/from-sale/${q.id}`);
  const t = await call(O, 'GET', `/transfers/${d.id}`);
  const other = (await call(O, 'GET', '/warehouses')).find((w) => w.id !== t.pickingType.warehouseId);
  await rejected(
    call(O, 'PATCH', `/transfers/${d.id}`, { warehouseId: other.id }),
    400,
    /harus sama dengan gudang stok yang terikat/,
    'pindah ke gudang lain',
  );
  const same = await call(O, 'PATCH', `/transfers/${d.id}`, { warehouseId: t.pickingType.warehouseId });
  check(same.id === d.id, 'gudang yang sama diterima');
});

// ---------- fase 4 ----------
await test('C1 daftar kerja Finance dan Operasional', async () => {
  const has = (rows, q) => rows.some((r) => r.id === q.id);
  const p = await newProduct();
  const q = await quote(regular, [line(p, 2)]);
  await confirm(q);
  check(has(await call(F, 'GET', '/sales-orders/worklist/need-po'), q), 'SO kekurangan stok masuk Perlu PO Principal');
  check(!has(await call(O, 'GET', '/sales-orders/worklist/ready'), q), 'SO tanpa stok tidak masuk Siap Dikirim');
  const [po] = await call(F, 'POST', `/purchase-orders/from-sale/${q.id}`);
  check(!has(await call(F, 'GET', '/sales-orders/worklist/need-po'), q), 'keluar dari daftar sesudah PO dibuat');
  await call(F, 'POST', `/purchase-orders/${po.id}/confirm`);
  await receiveAll(po.id);
  check(has(await call(O, 'GET', '/sales-orders/worklist/ready'), q), 'masuk Siap Dikirim sesudah barang diterima');
  const readyRow = (await call(O, 'GET', '/sales-orders/worklist/ready')).find((r) => r.id === q.id);
  check(
    (await call(O, 'GET', `/sales-orders/${q.id}`)).readyItems === readyRow.items,
    'readyItems di detail SO sama dengan kolom items Siap Dikirim',
  );
  const dashF = await call(F, 'GET', '/dashboard');
  const dashO = await call(O, 'GET', '/dashboard');
  check(
    dashF.kpis.some((k) => k.key === 'need_po' && k.link === '/pengadaan/perlu-pesanan'),
    'angka di Beranda Finance',
  );
  check(
    dashO.kpis.some((k) => k.key === 'ready_ship' && k.link === '/stok/siap-dikirim'),
    'angka di Beranda Operasional',
  );
  await call(O, 'POST', `/transfers/from-sale/${q.id}`);
  check(!has(await call(O, 'GET', '/sales-orders/worklist/ready'), q), 'keluar dari daftar sesudah surat jalan dibuat');
  const c = await newCustomer();
  const ps = await withStock(1);
  const qn = await quote(c, [line(ps, 1)]);
  const sn = await confirm(qn);
  check(!has(await call(O, 'GET', '/sales-orders/worklist/ready'), qn), 'pelanggan baru belum lunas tidak masuk');
  check(
    (await call(O, 'GET', `/sales-orders/${qn.id}`)).readyItems === 0,
    'readyItems 0 untuk pelanggan baru belum lunas',
  );
  await call(F, 'POST', '/payments', { saleId: qn.id, amount: sn.amountTotal, method: 'BNK' });
  check(has(await call(O, 'GET', '/sales-orders/worklist/ready'), qn), 'pelanggan baru lunas masuk');
  check(
    (await call(O, 'GET', `/sales-orders/${qn.id}`)).readyItems ===
      (await call(O, 'GET', '/sales-orders/worklist/ready')).find((r) => r.id === qn.id).items,
    'readyItems pelanggan baru lunas sama dengan daftar',
  );
  check((await call(O, 'GET', `/sales-orders/${q.id}`)).readyItems === 0, 'readyItems 0 bila SO tidak ada di daftar');
});

await test('C2 tombol dan pembayaran invoice', async () => {
  const gns = code('GNS-150KVA');
  const q = await quote(regular, [{ productId: gns.id, productUomQty: 1 }]);
  const so = await confirm(q);
  check(so.deliverable === false, 'SO hanya dropship: Buat Surat Jalan disembunyikan');
  const p = await withStock(2);
  const c = await newCustomer();
  const q2 = await quote(c, [line(p, 2)]);
  const s2 = await confirm(q2);
  check(s2.deliverable === true, 'SO dengan stok: tombol tampil');
  await call(F, 'POST', '/payments', { saleId: q2.id, amount: s2.amountTotal, method: 'BNK' });
  const [d] = await call(O, 'POST', `/transfers/from-sale/${q2.id}`);
  check(
    (await call(S, 'GET', `/sales-orders/${q2.id}`)).deliverable === false,
    'surat jalan terbuka sudah menampung semua sisa',
  );
  const t = await call(O, 'GET', `/transfers/${d.id}`);
  const v = await call(O, 'POST', `/transfers/${d.id}/validate`, {
    moves: t.moves.map((m) => ({ id: m.id, quantity: 1 })),
  });
  const i1 = await call(F, 'POST', `/invoices/from-sale/${q2.id}`, {});
  const ip = await call(F, 'POST', `/invoices/${i1.id}/post`);
  check(
    ip.advances.length === 1 && ip.advances[0].amount === ip.amountTotal,
    `invoice menampilkan uang muka yang dipakainya saja (${ip.advances[0]?.amount} dari SO ${s2.amountTotal})`,
  );
  check(v.backorders.length === 1, 'ada surat jalan susulan');
});

await test('C3 nama dokumen', async () => {
  const p = await withStock(2);
  const q = await quote(regular, [line(p, 2)]);
  await confirm(q);
  const [d] = await call(O, 'POST', `/transfers/from-sale/${q.id}`);
  const t = await call(O, 'GET', `/transfers/${d.id}`);
  const v = await call(O, 'POST', `/transfers/${d.id}/validate`, {
    moves: t.moves.map((m) => ({ id: m.id, quantity: 1 })),
  });
  const bo = await call(O, 'GET', `/transfers/${v.backorders[0].id}`);
  check(bo.backorderName === t.name, `susulan dari ${bo.backorderName}`);
  const text = (await pdfText(await call(O, 'GET', `/transfers/${bo.id}/pdf`, undefined, true))).replace(/\s+/g, ' ');
  check(text.includes('Susulan dari') && text.includes(t.name), 'PDF surat jalan menyebut dokumen asal');
  const { po } = await receivedPO(1);
  const pt = await pdfText(await call(F, 'GET', `/purchase-orders/${po.id}/pdf`, undefined, true));
  check(/PESANAN PRINCIPAL/.test(pt) && /PURCHASE ORDER/i.test(pt), 'judul PDF PO');
});

await test('C5 laporan Admin', async () => {
  const reps = await call(A, 'GET', '/reports');
  check(reps.length === 3, `Admin memiliki ${reps.length} laporan: ${reps.map((r) => r.key).join(', ')}`);
  for (const r of reps) {
    const d = await call(A, 'GET', `/reports/${r.key}?range=year`);
    check(Array.isArray(d.rows), `${r.title}: ${d.rows.length} baris`);
  }
  await rejected(call(A, 'GET', '/reports/margin'), 403, null, 'Admin membuka laporan margin');
  check((await call(P, 'GET', '/reports')).length === 12, 'Pimpinan tetap 12 laporan');
});

// ---------- fase 5 ----------
await test('Fase 5 mode demo dan email simulasi', async () => {
  const r = await fetch(API + '/auth/config');
  const cfg = await r.json();
  check(r.ok && cfg.demo === true, 'konfigurasi publik menyatakan mode demo');
  check(Object.keys(cfg).length === 1, 'konfigurasi publik tidak membocorkan data lain');
  const p = await newProduct();
  const q = await quote(regular, [line(p, 1)]);
  await call(S, 'POST', `/sales-orders/${q.id}/send`, {});
  await new Promise((d) => setTimeout(d, 2500));
  const s = (await call(S, 'GET', `/sales-orders/${q.id}`)).emailStatus;
  check(s?.state === 'simulasi', `status email ${s?.state}`);
});

await test('T5 kirim penawaran kosong ditolak, kirim order tetap jalan', async () => {
  const p = await newProduct();
  const empty = await quote(regular, []);
  await rejected(
    call(S, 'POST', `/sales-orders/${empty.id}/send`, {}),
    400,
    /^Penawaran belum memiliki baris produk$/,
    'penawaran tanpa baris',
  );
  const zero = await quote(regular, [line(p, 1, { priceUnit: 0 })]);
  await rejected(
    call(S, 'POST', `/sales-orders/${zero.id}/send`, {}),
    400,
    /^Total penawaran masih Rp 0$/,
    'penawaran bertotal 0',
  );
  const ok = await quote(regular, [line(p, 1)]);
  await confirm(ok);
  const r = await call(S, 'POST', `/sales-orders/${ok.id}/send`, { kind: 'order' });
  check(!!r && r.state !== 'gagal', `pengiriman order pada SO tetap berhasil (${r?.state})`);
});

await test('C6 daftar Perlu PO: paidAmount dan PO ganda ditolak', async () => {
  const p = await newProduct();
  const q = await quote(regular, [line(p, 2)]);
  await confirm(q);
  const row = (await call(F, 'GET', '/sales-orders/worklist/need-po')).find((r) => r.id === q.id);
  check(typeof row?.paidAmount === 'number', `baris daftar punya paidAmount bertipe number (${row?.paidAmount})`);
  check(row?.paidAmount === 0, 'paidAmount 0 sebelum ada pembayaran');
  await call(F, 'POST', '/payments', { saleId: q.id, amount: 1000, method: 'KAS' });
  const row2 = (await call(F, 'GET', '/sales-orders/worklist/need-po')).find((r) => r.id === q.id);
  check(row2?.paidAmount === 1000, `paidAmount mengikuti pembayaran (${row2?.paidAmount})`);
  const made = await call(F, 'POST', `/purchase-orders/from-sale/${q.id}`);
  check(made.length === 1, 'PO pertama terbentuk');
  await rejected(
    call(F, 'POST', `/purchase-orders/from-sale/${q.id}`),
    400,
    /Stok mencukupi; tidak ada barang yang perlu dipesan|sudah ada/,
    'PO kedua untuk SO yang sama',
  );
});

// Hanya untuk lingkungan uji: psql pada proyek compose mtpp-nav, bukan instance utama
const ROOT = new URL('../..', import.meta.url).pathname;
const psqlNav = (query) =>
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      'mtpp-nav',
      '-f',
      'docker-compose.yml',
      '-f',
      'infra/compose/test.yml',
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'mtpp',
      '-d',
      'mtpp',
      '-At',
      '-c',
      query,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
const PN = /^PN\/MTPP\/\d{4}\/\d{2}\/\d{4}$/,
  SO = /^SO\/MTPP\/\d{4}\/\d{2}\/\d{4}$/;
const seqOf = (n) => Number(n.split('/').pop());
const messages = (id) => call(P, 'GET', `/records/sales_orders/${id}/messages`);

await test('T7 penawaran PN, konfirmasi memberi SO, nomor penawaran tetap dan bisa dicari', async () => {
  const p = await newProduct();
  const q = await quote(regular, [line(p, 1)]);
  check(PN.test(q.name) && q.quotationNumber === q.name, `penawaran bernomor PN (${q.name})`);
  const so = await call(S, 'POST', `/sales-orders/${q.id}/confirm`, {});
  check(
    SO.test(so.name) && so.quotationNumber === q.name,
    `konfirmasi memberi nomor SO (${so.name}), nomor penawaran tetap`,
  );
  check(so.state === 'sale' && !!so.dateConfirm, 'status menjadi sale dengan tanggal konfirmasi');
  const msgs = await messages(q.id);
  const m = msgs.find((x) => x.body.includes('dikonfirmasi'));
  check(m?.body.includes(q.name) && m?.body.includes(so.name), `riwayat menyebut perubahan nomor: ${m?.body}`);
  const c = m?.changes.find((x) => x.field === 'Nomor');
  check(c?.oldValueChar === q.name && c?.newValueChar === so.name, 'riwayat mencatat nomor lama dan baru');
  check(
    m?.changes.some((x) => x.field === 'Status' && x.newValueChar === 'Sales Order'),
    'riwayat mencatat perubahan status',
  );
  const found = await call(S, 'GET', `/sales-orders?q=${encodeURIComponent(q.name)}&state=sale,done`);
  check(
    found.some((r) => r.id === q.id),
    'dapat dicari dengan nomor PN',
  );
  check(
    (await call(S, 'GET', `/sales-orders?q=${encodeURIComponent(so.name)}&state=sale,done`)).some((r) => r.id === q.id),
    'dapat dicari dengan nomor SO',
  );
  const pdf = await call(S, 'GET', `/sales-orders/${q.id}/pdf?kind=quotation`, undefined, true);
  check(pdf.status === 200, `PDF penawaran pada SO terkonfirmasi berstatus ${pdf.status}`);
  check(
    pdf.headers.get('content-disposition')?.includes(`${q.name.replace(/\//g, '-')}.pdf`),
    `nama berkas PDF memakai nomor penawaran (${pdf.headers.get('content-disposition')})`,
  );
  const qt = await pdfText(pdf);
  check(
    qt.includes('SURAT PENAWARAN HARGA') && qt.includes(q.name) && !qt.includes(so.name),
    'isi PDF penawaran memakai nomor PN',
  );
  const opdf = await call(S, 'GET', `/sales-orders/${q.id}/pdf?kind=order`, undefined, true);
  const ot = await pdfText(opdf);
  check(ot.includes(so.name) && !ot.includes(q.name), 'isi PDF sales order memakai nomor SO');
  const n = await quote(regular, [line(p, 1)]);
  check(
    PN.test(n.name) && seqOf(n.name) === seqOf(q.name) + 1,
    `nomor PN tidak dipakai ulang setelah menjadi SO (${q.name} → ${n.name})`,
  );
  const pv = await call(A, 'GET', '/settings/sequences/preview');
  check(seqOf(pv.PN) === seqOf(n.name) + 1 && pv.PN.startsWith('PN/MTPP/'), `pratinjau Penomoran memuat PN (${pv.PN})`);
});

await test('T7 batal, draf, konfirmasi ulang: nomor SO sama', async () => {
  const p = await newProduct();
  const q = await quote(regular, [line(p, 1)]);
  const so = await call(S, 'POST', `/sales-orders/${q.id}/confirm`, {});
  await call(S, 'POST', `/sales-orders/${q.id}/cancel`);
  const d = await call(S, 'POST', `/sales-orders/${q.id}/draft`);
  check(
    d.state === 'draft' && d.name === so.name && d.quotationNumber === q.name,
    'kembali ke draf: nomor SO dan PN tetap',
  );
  const again = await call(S, 'POST', `/sales-orders/${q.id}/confirm`, {});
  check(
    again.state === 'sale' && again.name === so.name && again.quotationNumber === q.name,
    `konfirmasi ulang: nomor SO sama (${again.name})`,
  );
  const m = (await messages(q.id)).filter((x) => x.body.includes('dikonfirmasi'));
  check(
    m.length === 2 && !m[0].changes.some((x) => x.field === 'Nomor'),
    'konfirmasi ulang tidak mencatat perubahan nomor',
  );
  const batal = await quote(regular, [line(p, 1)]);
  await call(S, 'POST', `/sales-orders/${batal.id}/cancel`);
  await call(S, 'POST', `/sales-orders/${batal.id}/draft`);
  const fresh = await call(S, 'POST', `/sales-orders/${batal.id}/confirm`, {});
  check(
    SO.test(fresh.name) && fresh.quotationNumber === batal.name,
    'penawaran yang batal sebelum dikonfirmasi tetap mendapat SO saat dikonfirmasi',
  );
  const kosong = await quote(regular, []);
  await rejected(
    call(S, 'POST', `/sales-orders/${kosong.id}/confirm`, {}),
    400,
    /^Penawaran belum memiliki baris produk$/,
    'konfirmasi tanpa baris ditolak',
  );
  const tetap = await call(S, 'GET', `/sales-orders/${kosong.id}`);
  check(tetap.name === kosong.name && tetap.state === 'draft', 'nomor tidak berubah saat konfirmasi ditolak');
  await rejected(
    call(S, 'POST', `/sales-orders/${q.id}/confirm`, {}),
    400,
    /^Hanya penawaran berstatus Draf atau Terkirim yang dapat dikonfirmasi$/,
    'konfirmasi SO yang sudah berjalan ditolak',
  );
});

await test('T7 konfirmasi membawa PO Pelanggan dan tanggal kirim', async () => {
  const p = await newProduct();
  const q = await quote(regular, [line(p, 1)], { clientOrderRef: 'PO-LAMA', commitmentDate: '2026-12-01' });
  const a = await call(S, 'POST', `/sales-orders/${q.id}/confirm`, {
    clientOrderRef: 'PO-BARU',
    commitmentDate: '2026-12-15',
  });
  check(a.clientOrderRef === 'PO-BARU' && a.commitmentDate === '2026-12-15', 'nilai baru tersimpan saat konfirmasi');
  const r = await quote(regular, [line(p, 1)], { clientOrderRef: 'PO-TETAP', commitmentDate: '2026-12-01' });
  const b = await call(S, 'POST', `/sales-orders/${r.id}/confirm`, { clientOrderRef: 'PO-GANTI' });
  check(b.clientOrderRef === 'PO-GANTI' && b.commitmentDate === '2026-12-01', 'tanggal yang tidak dikirim tetap');
  const c = await quote(regular, [line(p, 1)], { clientOrderRef: 'PO-TETAP-2', commitmentDate: '2026-12-02' });
  const d = await call(S, 'POST', `/sales-orders/${c.id}/confirm`, {});
  check(d.clientOrderRef === 'PO-TETAP-2' && d.commitmentDate === '2026-12-02', 'tanpa isian, nilai lama tetap');
});

await test('T7 ubah nomor penawaran manual', async () => {
  const p = await newProduct();
  const stamp = RUN_TAG;
  const a = await quote(regular, [line(p, 1)]),
    b = await quote(regular, [line(p, 1)]);
  const manual = `PN/MANUAL/${stamp}`;
  const u = await call(S, 'PATCH', `/sales-orders/${a.id}`, { name: manual });
  check(u.name === manual && u.quotationNumber === manual, 'nomor penawaran ikut berubah');
  await rejected(
    call(S, 'PATCH', `/sales-orders/${a.id}`, { name: b.name }),
    400,
    /^Nomor sudah dipakai dokumen lain$/,
    'nomor PN milik dokumen lain ditolak',
  );
  const bso = await call(S, 'POST', `/sales-orders/${b.id}/confirm`, {});
  await rejected(
    call(S, 'PATCH', `/sales-orders/${a.id}`, { name: b.name }),
    400,
    /^Nomor sudah dipakai dokumen lain$/,
    'nomor penawaran dokumen yang sudah menjadi SO ditolak',
  );
  await rejected(
    call(S, 'PATCH', `/sales-orders/${a.id}`, { name: bso.name }),
    400,
    /^Nomor sudah dipakai dokumen lain$/,
    'nomor SO dokumen lain ditolak',
  );
  await rejected(
    quote(regular, [line(p, 1)], { name: b.name }),
    400,
    /^Nomor sudah dipakai dokumen lain$/,
    'penawaran baru dengan nomor penawaran dokumen lain ditolak',
  );
  const so = await call(S, 'POST', `/sales-orders/${a.id}/confirm`, {});
  check(
    SO.test(so.name) && so.quotationNumber === manual,
    'nomor manual tetap sebagai nomor penawaran setelah konfirmasi',
  );
  await call(S, 'POST', `/sales-orders/${a.id}/cancel`);
  await call(S, 'POST', `/sales-orders/${a.id}/draft`);
  await rejected(
    call(S, 'PATCH', `/sales-orders/${a.id}`, { name: `SO/MANUAL/${stamp}` }),
    400,
    /^Nomor sales order tidak dapat diubah$/,
    'draf bekas SO: ganti nomor ditolak',
  );
  const tetap = await call(S, 'GET', `/sales-orders/${a.id}`);
  check(tetap.name === so.name && tetap.quotationNumber === manual, 'draf bekas SO: kedua nomor tidak berubah');
  const lagi = await call(S, 'POST', `/sales-orders/${a.id}/confirm`, {});
  check(
    lagi.name === so.name && lagi.quotationNumber === manual,
    'draf bekas SO: konfirmasi ulang memakai SO yang sama',
  );
  const m = `SO/MTPP/2026/01/M${stamp}`;
  const c = await quote(regular, [line(p, 1)], { name: m });
  check(c.name === m && c.quotationNumber === m, 'nomor manual berawalan SO tersimpan sebagai nomor penawaran');
  const cs = await call(S, 'POST', `/sales-orders/${c.id}/confirm`, {});
  check(
    SO.test(cs.name) && cs.name !== m && cs.quotationNumber === m,
    `nomor manual berawalan SO: konfirmasi memberi SO baru (${cs.name})`,
  );
});

await test('T7 dua konfirmasi bersamaan', async () => {
  const p = await newProduct();
  for (let i = 0; i < 3; i++) {
    const q = await quote(regular, [line(p, 1)]);
    const rs = await Promise.allSettled([
      call(S, 'POST', `/sales-orders/${q.id}/confirm`, {}),
      call(S, 'POST', `/sales-orders/${q.id}/confirm`, {}),
    ]);
    const won = rs.filter((r) => r.status === 'fulfilled'),
      lost = rs.filter((r) => r.status === 'rejected');
    check(won.length === 1 && lost.length === 1, `putaran ${i + 1}: tepat satu berhasil (${won.length})`);
    check(
      lost[0]?.reason?.status === 400 &&
        /^Hanya penawaran berstatus Draf atau Terkirim yang dapat dikonfirmasi$/.test(lost[0]?.reason?.msg),
      `putaran ${i + 1}: yang kalah ditolak 400 (${lost[0]?.reason?.msg})`,
    );
    const d = await call(S, 'GET', `/sales-orders/${q.id}`);
    check(SO.test(d.name) && d.name === won[0]?.value?.name, `putaran ${i + 1}: nomor SO hanya satu (${d.name})`);
    check(
      (await messages(q.id)).filter((x) => x.body.includes('dikonfirmasi')).length === 1,
      `putaran ${i + 1}: riwayat konfirmasi hanya satu`,
    );
    check(
      psqlNav(`select count(*) from sales_orders where name = '${d.name}'`).trim() === '1',
      `putaran ${i + 1}: nomor SO tidak ganda`,
    );
  }
});

await test('T7 penawaran lama bernomor SO tidak diubah', async () => {
  const p = await newProduct();
  const q = await quote(regular, [line(p, 1)]);
  const lama = `SO/MTPP/2026/01/${String(q.id).padStart(4, '0')}`;
  psqlNav(`update sales_orders set name = '${lama}', mtpp_quotation_number = null where id = ${q.id}`);
  const pdf = await call(S, 'GET', `/sales-orders/${q.id}/pdf?kind=quotation`, undefined, true);
  check(pdf.status === 200 && (await pdfText(pdf)).includes(lama), 'PDF penawaran lama memakai nomor lama');
  const so = await call(S, 'POST', `/sales-orders/${q.id}/confirm`, {});
  check(
    so.state === 'sale' && so.name === lama && so.quotationNumber === null,
    `konfirmasi tidak mengubah nomor (${so.name})`,
  );
  const m = (await messages(q.id)).find((x) => x.body.includes('dikonfirmasi'));
  check(!m?.changes.some((x) => x.field === 'Nomor'), 'riwayat tidak mencatat perubahan nomor');
  const r = await quote(regular, [line(p, 1)]);
  const lama2 = `SO/MTPP/2026/01/${String(r.id).padStart(4, '0')}`;
  psqlNav(`update sales_orders set name = '${lama2}', mtpp_quotation_number = null where id = ${r.id}`);
  const rs = await Promise.allSettled([
    call(S, 'POST', `/sales-orders/${r.id}/confirm`, {}),
    call(S, 'POST', `/sales-orders/${r.id}/confirm`, {}),
  ]);
  check(
    rs.filter((x) => x.status === 'fulfilled').length === 1,
    'dua konfirmasi bersamaan pada penawaran lama: tepat satu berhasil',
  );
});

await test('T7 penawaran lama diganti ke nomor PN tidak menyumbat penomoran', async () => {
  const p = await newProduct();
  const q = await quote(regular, [line(p, 1)]);
  const lama = `SO/MTPP/2026/01/${String(q.id).padStart(4, '0')}`;
  psqlNav(`update sales_orders set name = '${lama}', mtpp_quotation_number = null where id = ${q.id}`);
  const pn = (await call(S, 'GET', '/sales-orders/next-number')).number;
  check(PN.test(pn), `next-number mengintip PN (${pn})`);
  const u = await call(S, 'PATCH', `/sales-orders/${q.id}`, { name: pn });
  check(u.name === pn && u.quotationNumber === pn, `nomor baru menjadi nomor penawaran (${pn})`);
  const b = await quote(regular, [line(p, 1)]);
  check(
    PN.test(b.name) && seqOf(b.name) === seqOf(pn) + 1,
    `penawaran berikutnya tetap berhasil dan nomor bertambah (${b.name})`,
  );
  const c = await call(S, 'POST', `/sales-orders/${b.id}/copy`);
  check(seqOf(c.name) === seqOf(b.name) + 1, `salin penawaran tetap berhasil (${c.name})`);
  const so = await call(S, 'POST', `/sales-orders/${q.id}/confirm`, {});
  check(
    SO.test(so.name) && so.quotationNumber === pn,
    `saat dikonfirmasi mendapat SO (${so.name}), nomor penawaran tetap`,
  );
});

await test('T7 dasbor Penawaran terkirim menghitung nomor PN', async () => {
  const p = await newProduct();
  const quotes = async () => (await call(P, 'GET', '/dashboard')).kpis.find((k) => k.key === 'quotes').value;
  const before = await quotes();
  const q = await quote(regular, [line(p, 1)]);
  await call(S, 'POST', `/sales-orders/${q.id}/send`, {});
  let after = before;
  for (let i = 0; i < 10 && after === before; i++) {
    await new Promise((d) => setTimeout(d, 500));
    after = await quotes();
  }
  check(after === before + 1, `penawaran terkirim bertambah (${before} → ${after})`);
  const s = await call(S, 'GET', `/sales-orders/${q.id}`);
  check(s.state === 'sent' && s.name === q.name, 'status menjadi Terkirim, nomor tetap PN');
  const log = psqlNav(`select document_name from email_logs where model = 'sales_orders' and res_id = ${q.id}`).trim();
  check(log === q.name, `log email memakai nomor penawaran (${log})`);
});

await test('T1 syarat penawaran: bawaan, PDF penawaran vs order, salin, ubah, dokumen lama, setting tanpa kunci baru', async () => {
  const p = await newProduct();
  const DP = 'DP 30% saat PO diterima, 70% sebelum barang dikirim',
    FOT = 'Franco On Truck Surabaya',
    STD = 'IEC / SPLN / SLI / ANSI';
  const flat = (t) => t.replace(/\s+/g, ' ');
  const pdfOf = async (id, kind) => {
    const r = await call(S, 'GET', `/sales-orders/${id}/pdf?kind=${kind}`, undefined, true);
    return { status: r.status, text: flat(await pdfText(r)) };
  };
  const q = await quote(regular, [line(p, 1)]);
  check(q.mtppTermPayment === DP, `DP 30/70 bawaan (${q.mtppTermPayment})`);
  check(
    q.mtppTermHandover === FOT && q.mtppTermStandard === STD,
    `bawaan penyerahan dan standar (${q.mtppTermHandover} | ${q.mtppTermStandard})`,
  );
  const qp = await pdfOf(q.id, 'quotation');
  check(
    qp.status === 200 && qp.text.includes(FOT) && qp.text.includes(STD) && qp.text.includes(DP),
    'PDF penawaran memuat penyerahan, standar, dan pembayaran',
  );
  check(
    qp.text.includes('Penyerahan') && qp.text.includes('Standar'),
    'PDF penawaran memuat label Penyerahan dan Standar',
  );
  check(!qp.text.includes('Term of payment'), 'PDF penawaran tidak memuat Term of payment');
  await call(S, 'POST', `/sales-orders/${q.id}/confirm`, {});
  const op = await pdfOf(q.id, 'order');
  check(
    op.status === 200 && op.text.includes('Term of payment'),
    'PDF order setelah konfirmasi masih memuat Term of payment',
  );
  check(
    !op.text.includes('Penyerahan / Delivery term') && !op.text.includes('Standar / Standard'),
    'PDF order tidak mendapat baris penawaran baru',
  );
  check(!op.text.includes('DP 30%') && !op.text.includes('Pembayaran / Payment'), 'PDF order tidak memuat teks DP');
  const c = await call(S, 'POST', `/sales-orders/${q.id}/copy`);
  check(
    c.mtppTermHandover === FOT && c.mtppTermStandard === STD && c.mtppTermPayment === DP,
    'salin penawaran membawa kedua nilai baru',
  );
  const e = await quote(regular, [line(p, 1)]);
  const u = await call(S, 'PATCH', `/sales-orders/${e.id}`, {
    mtppTermHandover: 'Franco Gudang Pembeli Malang',
    mtppTermStandard: 'IEC 60076',
    mtppTermPayment: 'Tunai sebelum kirim',
  });
  check(
    u.mtppTermHandover === 'Franco Gudang Pembeli Malang' && u.mtppTermStandard === 'IEC 60076',
    'PATCH oleh Sales menyimpan penyerahan dan standar',
  );
  const ep = await pdfOf(e.id, 'quotation');
  check(
    ep.text.includes('Franco Gudang Pembeli Malang') &&
      ep.text.includes('IEC 60076') &&
      ep.text.includes('Tunai sebelum kirim'),
    'teks yang diubah tercetak di PDF penawaran',
  );
  const old = await quote(regular, [line(p, 1)]);
  psqlNav(`update sales_orders set mtpp_term_handover = null, mtpp_term_standard = null where id = ${old.id}`);
  const od = await pdfOf(old.id, 'quotation');
  check(
    od.status === 200 && !od.text.includes('Penyerahan') && !od.text.includes('Standar') && !/\bnull\b/.test(od.text),
    'dokumen lama tanpa kedua nilai: PDF 200 tanpa baris Penyerahan, Standar, atau "null"',
  );
  const before = await call(A, 'GET', '/settings');
  try {
    await call(A, 'PUT', '/settings/terms', {
      payment: 'Tersimpan lama',
      delivery: 'Kirim 1 minggu',
      validityDays: 14,
      warranty: 'Garansi 6 bulan',
    });
    const n = await quote(regular, [line(p, 1)]);
    check(
      n.mtppTermHandover === FOT && n.mtppTermStandard === STD,
      'setting tersimpan tanpa kunci baru: penawaran baru tetap mendapat bawaan',
    );
    check(n.mtppTermPayment === 'Tersimpan lama', 'kunci yang ada di setting tersimpan tetap dipakai');
  } finally {
    await call(A, 'PUT', '/settings/terms', before.terms);
  }
  check(
    JSON.stringify((await call(A, 'GET', '/settings')).terms) === JSON.stringify(before.terms),
    'setting terms dipulihkan',
  );
  // jatuh tempo invoice tetap mengikuti Term of Payment pelanggan
  const { inv } = await invoiced(regular, await withStock(1));
  const days = Number(
    psqlNav(
      `select t.days from partners p join payment_terms t on t.id = p.property_payment_term_id where p.id = ${regular.id}`,
    ).trim(),
  );
  const due = psqlNav(`select invoice_date_due - invoice_date from journal_entries where id = ${inv.id}`).trim();
  check(Number.isFinite(days) && Number(due) === days, `jatuh tempo invoice = ${days} hari term pelanggan (${due})`);
});

await test('PO pelanggan: konfirmasi menyimpan, mempertahankan, dan mengosongkan', async () => {
  const p = await withStock(3);
  const poOf = async (id) => (await call(S, 'GET', `/sales-orders/${id}`)).clientOrderRef ?? null;
  const poLog = async (id) => (await messages(id)).filter((m) => JSON.stringify(m).includes('PO Pelanggan')).length;
  const a = await quote(regular, [line(p, 1)]);
  await call(S, 'POST', `/sales-orders/${a.id}/confirm`, { clientOrderRef: ' PO-A ' });
  check((await poOf(a.id)) === 'PO-A', 'confirm dengan clientOrderRef menyimpan nilai (dipangkas)');
  check((await poLog(a.id)) === 1, 'perubahan PO tercatat sekali di riwayat');
  const b = await quote(regular, [line(p, 1)], { clientOrderRef: 'PO-B' });
  await call(S, 'POST', `/sales-orders/${b.id}/confirm`, {});
  check((await poOf(b.id)) === 'PO-B', 'confirm tanpa field mempertahankan nilai lama');
  const n = await quote(regular, [line(p, 1)], { clientOrderRef: 'PO-N' });
  await call(S, 'POST', `/sales-orders/${n.id}/confirm`, { clientOrderRef: null });
  check(
    (await poOf(n.id)) === 'PO-N' && (await poLog(n.id)) === 0,
    'clientOrderRef null mempertahankan nilai lama (bukan teks "null")',
  );
  const c = await quote(regular, [line(p, 1)], { clientOrderRef: 'PO-C' });
  await call(S, 'POST', `/sales-orders/${c.id}/confirm`, { clientOrderRef: 'PO-C' });
  check((await poOf(c.id)) === 'PO-C' && (await poLog(c.id)) === 0, 'nilai yang sama tidak mencatat perubahan palsu');
  const d = await quote(regular, [line(p, 1)], { clientOrderRef: 'PO-D' });
  await call(S, 'POST', `/sales-orders/${d.id}/confirm`, { clientOrderRef: '' });
  check((await poOf(d.id)) === null, "confirm dengan '' mengosongkan nilai menjadi null");
});

console.log(`\nRingkasan edge-flow: ${passed} lulus, ${failed} gagal`);
process.exit(failed ? 1 : 0);
