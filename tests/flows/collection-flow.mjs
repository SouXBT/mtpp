// Uji alur penagihan lanjutan: masa tenggang per pelanggan, blokir dan izin kirim, dan cicilan.
// Berdiri sendiri (membuat pelanggan, SO, PO, dan stoknya sendiri). Hanya untuk stack uji -p mtpp-nav:
//   API=http://localhost:8081/api node tests/flows/collection-flow.mjs
const API = process.env.API || 'http://localhost:8081/api';
const PASS = process.env.DEMO_PASSWORD || 'mtpp12345';
let failures = 0;
const log = (...a) => console.log(...a);
const ok = (c, m) => {
  if (c) log('  ✓', m);
  else {
    failures++;
    log('  ✗', m);
  }
};

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

async function call(token, method, path, body, raw = false) {
  body = withProof(method, path, body);
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
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
    e.body = j;
    throw e;
  }
  return j;
}

// PO principal wajib uang muka (Pengaturan → Syarat PO, bawaan 30%) sebelum dikonfirmasi
async function payDp(token, poId) {
  const po = await call(token, 'GET', `/purchase-orders/${poId}`, undefined);
  if (po.dp?.due > 0.5)
    await call(token, 'POST', '/payments', {
      purchaseId: poId,
      amount: po.dp.due,
      kind: 'dp',
      method: 'BNK',
      memo: `Uang muka ${po.name}`,
    });
}
const expectFail = async (p, status, m, re) => {
  try {
    await p;
    ok(false, m + ' (seharusnya ditolak)');
  } catch (e) {
    const msg = e.body?.message || e.message;
    ok((!status || e.status === status) && (!re || re.test(msg)), `${m} → ditolak: ${msg}`);
  }
};
const login = async (email) => (await call('', 'POST', '/auth/login', { login: email, password: PASS })).token;
const day = (n) => {
  const d = new Date(Date.now() + 7 * 3600 * 1000 + n * 86400000);
  return d.toISOString().slice(0, 10);
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

const P = await login('pimpinan@mtpp.co.id'),
  A = await login('admin@mtpp.co.id'),
  S = await login('sales@mtpp.co.id'),
  O = await login('operasional@mtpp.co.id'),
  F = await login('finance@mtpp.co.id');
log('Login lima grup berhasil');

// ---------- persiapan: pelanggan lama dengan TOP 30 hari dan masa tenggang 5 hari ----------
const terms = await call(P, 'GET', '/payment-terms');
const top30 = terms.find((t) => Number(t.days) === 30);
const cust = await call(A, 'POST', '/partners', {
  kind: 'customer',
  name: `PT Uji Penagihan ${Date.now()}`,
  email: 'uji-penagihan@example.com',
});
await expectFail(
  call(P, 'PATCH', `/partners/${cust.id}`, { mtppGraceDays: 200 }),
  400,
  'masa tenggang 200 hari',
  /0 sampai 90/,
);
await call(P, 'PATCH', `/partners/${cust.id}`, { mtppIsNewCustomer: false, paymentTermId: top30.id, mtppGraceDays: 5 });
await call(A, 'PATCH', `/partners/${cust.id}`, { mtppGraceDays: 30 });
const c1 = await call(P, 'GET', `/partners/${cust.id}`);
ok(
  c1.mtppGraceDays === 5 && !c1.mtppIsNewCustomer,
  'Pimpinan menetapkan masa tenggang 5 hari; Admin tidak dapat mengubahnya',
);

const prods = await call(S, 'GET', '/products');
const prod = prods.find(
  (p) => (p.route || p.mtppRoute) !== 'dropship' && p.type !== 'service' && Number(p.listPrice) > 0,
);
ok(!!prod, `produk uji ${prod?.defaultCode || prod?.code}`);

// SO dikonfirmasi lalu stoknya dipenuhi lewat PO Principal dan penerimaan
async function order(qty) {
  const q = await call(S, 'POST', '/sales-orders', {
    partnerId: cust.id,
    paymentTermId: top30.id,
    lines: [{ productId: prod.id, productUomQty: qty, mtppIsDropship: false }],
  });
  await call(S, 'POST', `/sales-orders/${q.id}/confirm`, {});
  return q.id;
}
async function stockFor(soId) {
  const sh = await call(F, 'GET', `/sales-orders/${soId}/shortage`);
  if (!sh.some((x) => x.shortage > 0)) return;
  const pos = await call(F, 'POST', `/purchase-orders/from-sale/${soId}`);
  for (const po of Array.isArray(pos) ? pos : [pos]) {
    await call(F, 'POST', `/purchase-orders/${po.id}/send`, {});
    await payDp(F, po.id);
    await call(F, 'POST', `/purchase-orders/${po.id}/confirm`);
    const rec = (await call(O, 'GET', `/transfers?kind=incoming&purchaseId=${po.id}`)).filter(
      (t) => t.state !== 'done',
    );
    for (const t of rec) await call(O, 'POST', `/transfers/${t.id}/validate`, {});
  }
}
async function deliver(soId) {
  const dos = await call(O, 'POST', `/transfers/from-sale/${soId}`);
  for (const d of dos) await call(O, 'POST', `/transfers/${d.id}/validate`, {});
  return dos;
}

const so1 = await order(10);
await stockFor(so1);
await deliver(so1);
const inv1 = await call(F, 'POST', `/invoices/from-sale/${so1}`, { date: day(-60) });
await call(F, 'POST', `/invoices/${inv1.id}/post`);
let i1 = await call(F, 'GET', `/invoices/${inv1.id}`);
ok(i1.invoiceDateDue === day(-30), `invoice ${i1.name} jatuh tempo ${i1.invoiceDateDue} (60 hari lalu + 30)`);
ok(i1.dueState === 'lewat_tenggang' && i1.graceDays === 5, 'status: lewat masa tenggang (5 hari)');
const listLate = await call(F, 'GET', '/invoices?type=invoice&dueState=lewat_tenggang');
ok(
  listLate.some((x) => x.id === inv1.id),
  'filter daftar invoice "lewat masa tenggang"',
);

// ---------- blokir surat jalan dan izin kirim Pimpinan ----------
const so2 = await order(3);
let s2 = await call(S, 'GET', `/sales-orders/${so2}`);
ok(s2.creditHold.blocking && s2.creditHold.invoices[0]?.name === i1.name, 'SO baru: peringatan tagihan lewat tenggang');
ok(s2.canDeliver === false, 'tombol surat jalan nonaktif');
await stockFor(so2);
await expectFail(
  call(O, 'POST', `/transfers/from-sale/${so2}`),
  400,
  'surat jalan untuk pelanggan dengan tagihan lewat tenggang',
  /masa tenggang/,
);
await expectFail(
  call(S, 'POST', `/sales-orders/${so2}/release`, { note: 'x' }),
  400,
  'Sales memberi izin kirim',
  /Pimpinan/,
);
await expectFail(call(P, 'POST', `/sales-orders/${so2}/release`, {}), 400, 'izin kirim tanpa alasan', /alasan/);
await call(P, 'POST', `/sales-orders/${so2}/release`, { note: 'Janji bayar minggu depan' });
s2 = await call(S, 'GET', `/sales-orders/${so2}`);
ok(s2.creditHold.released && !s2.creditHold.blocking && s2.canDeliver, 'Pimpinan mengizinkan kirim untuk SO ini');
const [do2] = await deliver(so2);
ok(!!do2, `surat jalan ${do2.name} terbit setelah izin`);

// ---------- cicilan ----------
const res1 = Number(i1.amountResidual);
const t1 = Math.round((res1 / 3) * 100) / 100;
const plan = [
  { dateDue: day(-2), amount: t1 },
  { dateDue: day(30), amount: t1 },
  { dateDue: day(60), amount: Math.round((res1 - 2 * t1) * 100) / 100 },
];
await expectFail(
  call(S, 'POST', `/invoices/${inv1.id}/installments`, { termins: plan }),
  403,
  'Sales mengajukan cicilan',
);
await expectFail(
  call(F, 'POST', `/invoices/${inv1.id}/installments`, { termins: [plan[0], plan[1]] }),
  400,
  'jumlah termin tidak sama dengan sisa tagihan',
  /harus sama dengan sisa/,
);
await expectFail(
  call(F, 'POST', `/invoices/${inv1.id}/installments`, { termins: [plan[1], plan[0], plan[2]] }),
  400,
  'termin tidak berurutan',
  /harus setelah/,
);
i1 = await call(F, 'POST', `/invoices/${inv1.id}/installments`, { termins: plan, note: 'Kesepakatan 3x' });
ok(
  i1.installments.state === 'draft' && i1.dueState === 'lewat_tenggang',
  'jadwal diajukan; belum berlaku sebelum disetujui',
);
i1 = await call(F, 'POST', `/invoices/${inv1.id}/installments/approve`);
ok(i1.installments.state === 'approved', 'jadwal cicilan disetujui pengguna dengan hak ubah penagihan');
ok(
  i1.dueState === 'tenggang' && i1.dueDate === day(-2),
  `jatuh tempo efektif termin 1 (${i1.dueDate}), status masa tenggang`,
);
s2 = await call(S, 'GET', `/sales-orders/${so2}`);
ok(s2.creditHold.invoices.length === 0, 'setelah cicilan disetujui, pelanggan tidak lagi lewat tenggang');
await call(F, 'POST', '/payments', { invoiceId: inv1.id, amount: t1 + 100000, method: 'BNK' });
i1 = await call(F, 'GET', `/invoices/${inv1.id}`);
const [r1, r2] = i1.installments.rows;
ok(
  r1.status === 'lunas' && r2.status === 'sebagian' && near(r2.paid, 100000),
  'pembayaran dialokasikan: termin 1 lunas, termin 2 sebagian',
);
ok(i1.dueState === 'belum_jt' && i1.dueDate === day(30), 'jatuh tempo efektif pindah ke termin 2');
await call(F, 'POST', `/invoices/${inv1.id}/remind`, {});
ok(true, 'email pengingat pembayaran (mode simulasi)');
const ipdf = await call(F, 'GET', `/invoices/${inv1.id}/pdf`, undefined, true);
ok(ipdf.ok, 'invoice PDF dengan jadwal cicilan');
const aging = await call(F, 'GET', '/reports/umur_piutang?detail=true');
ok(
  aging.rows.some((r) => r.name === `${i1.name} (cicilan 2)`) &&
    aging.rows.some((r) => r.name === `${i1.name} (cicilan 3)`),
  'umur piutang dipecah per termin cicilan',
);

// ---------- tanggal penawaran ----------
await expectFail(
  call(S, 'POST', '/sales-orders', { partnerId: cust.id, dateOrder: day(0), validityDate: day(0), lines: [] }),
  400,
  'berlaku sampai sama dengan tanggal penawaran',
  /harus setelah tanggal penawaran/,
);
const pq = await call(S, 'POST', '/sales-orders', { partnerId: cust.id, lines: [] });
await expectFail(
  call(S, 'PATCH', `/sales-orders/${pq.id}`, { validityDate: day(-1), dateOrder: day(0) }),
  400,
  'berlaku sampai sebelum tanggal penawaran',
  /harus setelah/,
);
ok(pq.validityDate > pq.dateOrder, `penawaran baru berlaku sampai ${pq.validityDate}`);

// ---------- pelanggan baru: proforma, DP dengan tanggal pelunasan, bukti transfer, pelunasan ----------
const nc = await call(A, 'POST', '/partners', { kind: 'customer', name: `PT Uji DP ${Date.now()}` });
async function newOrder(qty) {
  const q = await call(S, 'POST', '/sales-orders', {
    partnerId: nc.id,
    lines: [{ productId: prod.id, productUomQty: qty, mtppIsDropship: false }],
  });
  await call(S, 'POST', `/sales-orders/${q.id}/confirm`, {});
  return call(S, 'GET', `/sales-orders/${q.id}`);
}
const n1 = await newOrder(2);
const tot = Number(n1.amountTotal);
await expectFail(
  call(F, 'POST', `/sales-orders/${n1.id}/proforma`, { mode: 'persen', percent: 30 }),
  400,
  'proforma DP tanpa tanggal pelunasan',
  /tanggal pelunasan/,
);
await call(F, 'POST', `/sales-orders/${n1.id}/proforma`, { mode: 'persen', percent: 30, settleDate: day(10) });
const ppdf = await call(F, 'GET', `/sales-orders/${n1.id}/pdf?kind=proforma`, undefined, true);
ok(ppdf.ok, 'proforma DP 30% dengan tanggal pelunasan');
const noProof = await fetch(`${API}/payments`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${F}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ saleId: n1.id, amount: 1000, kind: 'dp', settleDate: day(10) }),
});
ok(noProof.status === 400 && /bukti/i.test((await noProof.json()).message), 'pembayaran tanpa bukti transfer ditolak');
const dp = Math.round(tot * 0.3);
await expectFail(
  call(F, 'POST', '/payments', { saleId: n1.id, amount: dp, kind: 'dp', settleDate: day(-1), date: day(0) }),
  400,
  'tanggal pelunasan sebelum tanggal bayar',
  /harus setelah tanggal pembayaran/,
);
await call(F, 'POST', '/payments', { saleId: n1.id, amount: dp, kind: 'dp', settleDate: day(10) });
let n1d = await call(S, 'GET', `/sales-orders/${n1.id}`);
ok(
  n1d.mtppSettleDate === day(10) && !n1d.payment.paidFull,
  `DP dicatat; pelunasan paling lambat ${n1d.mtppSettleDate}`,
);
await expectFail(
  call(F, 'POST', '/payments', { saleId: n1.id, amount: 1000, kind: 'lunas' }),
  400,
  'pelunasan kurang dari sisa',
  /Pelunasan harus sebesar sisa/,
);
await call(F, 'POST', '/payments', { saleId: n1.id, amount: tot - dp, kind: 'lunas' });
n1d = await call(S, 'GET', `/sales-orders/${n1.id}`);
ok(n1d.payment.paidFull, 'pelunasan mencatat SO lunas');
const n2 = await newOrder(1);
await call(F, 'POST', `/sales-orders/${n2.id}/proforma`, { mode: 'lunas' });
const n2d = await call(S, 'GET', `/sales-orders/${n2.id}`);
ok(n2d.mtppDpMode === 'lunas' && near(n2d.mtppDpAmount, n2d.amountTotal), 'proforma langsung lunas = total SO');
await call(F, 'POST', '/payments', { saleId: n2.id, amount: Number(n2d.amountTotal), kind: 'lunas' });
const h1 = await call(S, 'GET', `/sales-orders/payment-history?q=${encodeURIComponent(n1d.name)}`);
ok(
  h1.length === 2 &&
    h1.some((x) => x.kind === 'uang_muka' && x.kindLabel === 'Uang muka ke-1' && x.remaining > 0) &&
    h1.some((x) => x.kind === 'pelunasan' && x.remaining === 0) &&
    h1.every((x) => x.proof),
  'Riwayat Pembayaran: uang muka ke-1 lalu pelunasan, keduanya dengan bukti',
);
const h2 = await call(S, 'GET', `/sales-orders/payment-history?q=${encodeURIComponent(n2d.name)}`);
ok(h2.length === 1 && h2[0].kind === 'lunas_langsung', 'Riwayat Pembayaran: lunas langsung');
const kw = await call(F, 'GET', `/payments/${h1.find((x) => x.kind === 'uang_muka').id}/receipt`, undefined, true);
ok(kw.ok, 'kuitansi uang muka dengan total, terbayar, dan sisa');
const proofDl = await call(F, 'GET', `/attachments/${h1[0].proof.id}/download`, undefined, true);
ok(proofDl.ok, 'bukti transfer dapat diunduh');

// ---------- masa tenggang proforma: bawaan 7 hari, paling sedikit 7 hari, boleh diatur lebih lama ----------
{
  const nx = await newOrder(1);
  const d0 = await call(F, 'POST', `/sales-orders/${nx.id}/proforma`, { mode: 'lunas' });
  ok(d0.graceDays === 7 && d0.dueDate === day(7), `proforma tanpa isian: bayar paling lambat ${d0.dueDate} (7 hari)`);
  const d14 = await call(F, 'POST', `/sales-orders/${nx.id}/proforma`, { mode: 'lunas', graceDays: 14 });
  ok(d14.dueDate === day(14), `proforma 14 hari: bayar paling lambat ${d14.dueDate}`);
  await expectFail(
    call(F, 'POST', `/sales-orders/${nx.id}/proforma`, { mode: 'lunas', graceDays: 3 }),
    400,
    'masa tenggang proforma 3 hari (kurang dari 7)',
    /7 sampai 90/,
  );
  await expectFail(
    call(F, 'POST', `/sales-orders/${nx.id}/proforma`, { mode: 'lunas', graceDays: 91 }),
    400,
    'masa tenggang proforma 91 hari',
    /7 sampai 90/,
  );
  await expectFail(
    call(A, 'PUT', '/settings/collection', { proformaGraceDays: 5 }),
    400,
    'bawaan masa tenggang proforma 5 hari',
    /7 sampai 90/,
  );
  const xp = await call(F, 'GET', `/sales-orders/${nx.id}/pdf?kind=proforma`, undefined, true);
  ok(xp.ok, 'PDF proforma dengan batas bayar');
}

// ---------- pembayaran dari SO setelah sebagian dibayar lewat invoice: sisa memperhitungkan invoice ----------
{
  const pc = await call(A, 'POST', '/partners', { kind: 'customer', name: `PT Uji Riwayat ${Date.now()}` });
  await call(P, 'PATCH', `/partners/${pc.id}`, { mtppIsNewCustomer: false, paymentTermId: top30.id });
  const q = await call(S, 'POST', '/sales-orders', {
    partnerId: pc.id,
    paymentTermId: top30.id,
    lines: [{ productId: prod.id, productUomQty: 1, mtppIsDropship: false }],
  });
  await call(S, 'POST', `/sales-orders/${q.id}/confirm`, {});
  await stockFor(q.id);
  await deliver(q.id);
  const inv = await call(F, 'POST', `/invoices/from-sale/${q.id}`, {});
  await call(F, 'POST', `/invoices/${inv.id}/post`);
  const total = Number((await call(S, 'GET', `/sales-orders/${q.id}`)).amountTotal);
  const part = Math.round(total * 0.4);
  await call(F, 'POST', '/payments', { invoiceId: inv.id, amount: part, method: 'BNK' });
  // pelanggan ditandai baru lagi, sehingga sisa dicatat dari tombol Catat Pembayaran di SO
  await call(A, 'PATCH', `/partners/${pc.id}`, { mtppIsNewCustomer: true });
  const rest = Math.round((total - part) * 100) / 100;
  await expectFail(
    call(F, 'POST', '/payments', { saleId: q.id, amount: total, kind: 'lunas' }),
    400,
    'pelunasan dari SO sebesar nilai penuh padahal sebagian sudah dibayar',
    /sisa nilai sales order/,
  );
  await call(F, 'POST', '/payments', { saleId: q.id, amount: rest, kind: 'lunas' });
  // nomor berubah dari PN menjadi SO saat dikonfirmasi
  const soName = (await call(S, 'GET', `/sales-orders/${q.id}`)).name;
  const hist = await call(S, 'GET', `/sales-orders/payment-history?q=${encodeURIComponent(soName)}`);
  ok(
    hist.length === 2 &&
      hist.some((h) => h.kind === 'invoice') &&
      hist.some((h) => h.kind === 'pelunasan' && h.remaining === 0),
    `Riwayat Pembayaran: pembayaran invoice lalu pelunasan dari SO (${hist.map((h) => h.kindLabel).join(', ')})`,
  );
  const invAfter = await call(F, 'GET', `/invoices/${inv.id}`);
  ok(invAfter.paymentState === 'paid', 'pelunasan dari SO langsung melunasi invoice');
  const pl = await call(F, 'GET', `/payments?saleId=${q.id}`);
  ok(
    pl.length === 2 && pl.every((p) => p.sale === soName),
    'daftar pembayaran per SO memuat pembayaran invoice dan SO',
  );
  await expectFail(
    call(F, 'POST', '/payments', { saleId: q.id, amount: 1000, kind: 'dp', settleDate: day(5) }),
    400,
    'pembayaran untuk SO yang sudah lunas',
    /sudah lunas/,
  );
}

// ---------- permintaan bersamaan: tidak ada dokumen atau pembayaran ganda ----------
{
  const settle = async (ps) => (await Promise.allSettled(ps)).filter((r) => r.status === 'fulfilled').length;
  const so = await order(2);
  await stockFor(so);
  // surat jalan: tiga permintaan bersamaan hanya membuat satu dokumen
  const okDo = await settle([1, 2, 3].map(() => call(O, 'POST', `/transfers/from-sale/${so}`)));
  const dos = (await call(O, 'GET', `/transfers?kind=outgoing&saleId=${so}`)).filter((t) => t.state !== 'cancel');
  ok(okDo === 1 && dos.length === 1, `surat jalan bersamaan: ${okDo} berhasil, ${dos.length} dokumen`);
  // validasi bersamaan: stok hanya berkurang sekali
  const before = (await call(O, 'GET', `/stock?q=${encodeURIComponent(prod.defaultCode || prod.code)}`))[0];
  const okVal = await settle([1, 2, 3].map(() => call(O, 'POST', `/transfers/${dos[0].id}/validate`, {})));
  const after = (await call(O, 'GET', `/stock?q=${encodeURIComponent(prod.defaultCode || prod.code)}`))[0];
  const line = (await call(S, 'GET', `/sales-orders/${so}`)).lines[0];
  ok(
    okVal === 1 && Number(line.qtyDelivered) === 2 && near(before.physical - after.physical, 2),
    `validasi bersamaan: ${okVal} berhasil, terkirim ${line.qtyDelivered}, stok fisik turun ${before.physical - after.physical}`,
  );
  // invoice: dua permintaan bersamaan hanya membuat satu draf
  const okInv = await settle([1, 2].map(() => call(F, 'POST', `/invoices/from-sale/${so}`, {})));
  const invs = (await call(F, 'GET', '/invoices?type=invoice')).filter((x) => x.saleId === so);
  ok(okInv === 1 && invs.length === 1, `invoice bersamaan: ${okInv} berhasil, ${invs.length} invoice`);
  // posting bersamaan: qty tertagih tidak berlipat
  const okPost = await settle([1, 2, 3].map(() => call(F, 'POST', `/invoices/${invs[0].id}/post`)));
  const line2 = (await call(S, 'GET', `/sales-orders/${so}`)).lines[0];
  ok(
    okPost === 1 && Number(line2.qtyInvoiced) === 2,
    `posting bersamaan: ${okPost} berhasil, tertagih ${line2.qtyInvoiced}`,
  );
  // pembayaran bersamaan sebesar sisa: hanya satu yang diterima
  const inv = await call(F, 'GET', `/invoices/${invs[0].id}`);
  const okPay = await settle(
    [1, 2, 3].map(() =>
      call(F, 'POST', '/payments', { invoiceId: inv.id, amount: Number(inv.amountResidual), method: 'BNK' }),
    ),
  );
  const inv2 = await call(F, 'GET', `/invoices/${inv.id}`);
  ok(
    okPay === 1 && inv2.paymentState === 'paid',
    `pembayaran bersamaan: ${okPay} berhasil, status ${inv2.paymentState}`,
  );
  // kredit nota dan invoice yang sudah lunas tidak dapat dibayar
  await expectFail(
    call(F, 'POST', '/payments', { invoiceId: inv.id, amount: 0.4, method: 'BNK' }),
    400,
    'membayar invoice yang sudah lunas',
    /sudah lunas/,
  );
}

// ---------- cicilan: pengajuan dan persetujuan bersamaan tidak membuat termin dobel ----------
{
  const so = await order(1);
  await stockFor(so);
  await deliver(so);
  const draft = await call(F, 'POST', `/invoices/from-sale/${so}`, {});
  const inv = await call(F, 'POST', `/invoices/${draft.id}/post`);
  const res = Number(inv.amountResidual);
  const half = Math.floor((res / 2) * 100) / 100;
  const termins = [
    { dateDue: day(30), amount: half },
    { dateDue: day(60), amount: Math.round((res - half) * 100) / 100 },
  ];
  const okSet = (
    await Promise.allSettled(
      [1, 2].map(() => call(F, 'POST', `/invoices/${inv.id}/installments`, { termins, note: 'Uji bersamaan' })),
    )
  ).filter((r) => r.status === 'fulfilled').length;
  let i2 = await call(F, 'GET', `/invoices/${inv.id}`);
  ok(
    okSet >= 1 && i2.installments.rows.length === 2,
    `pengajuan cicilan bersamaan: ${i2.installments.rows.length} termin`,
  );
  // pembayaran masuk sebelum disetujui: persetujuan ditolak karena sisa tagihan berubah
  await call(F, 'POST', '/payments', { invoiceId: inv.id, amount: 1000, method: 'BNK' });
  await expectFail(
    call(F, 'POST', `/invoices/${inv.id}/installments/approve`, {}),
    400,
    'menyetujui jadwal setelah sisa tagihan berubah',
    /Sisa tagihan berubah/,
  );
  await call(F, 'DELETE', `/invoices/${inv.id}/installments`);
  i2 = await call(F, 'GET', `/invoices/${inv.id}`);
  ok(!i2.installments.rows.length, 'jadwal cicilan dibatalkan');
}

// ---------- isi ulang stok minimum: PO sampai 2x minimum, barang dalam perjalanan ikut dihitung ----------
{
  const code = prod.defaultCode || prod.code;
  const row = (await call(O, 'GET', `/stock?q=${encodeURIComponent(code)}`))[0];
  const min = Math.max(Math.ceil(Number(row.free)), 0) + 5;
  const rule = await call(O, 'POST', '/stock-rules', { productId: prod.id, warehouseId: row.warehouseId, minQty: min });
  const plan = await call(F, 'GET', '/purchase-orders/replenish/plan');
  const it = plan.find((x) => x.productId === prod.id && x.warehouseId === row.warehouseId);
  ok(
    !!it && it.qty === Math.ceil(2 * min - (Number(row.free) + it.incoming)),
    `rencana isi ulang ${code}: pesan ${it?.qty} (bebas ${it?.free}, dalam perjalanan ${it?.incoming}, minimum ${min})`,
  );
  await expectFail(call(S, 'POST', '/purchase-orders/replenish'), 403, 'Sales membuat PO isi ulang');
  const res = await Promise.allSettled([1, 2].map(() => call(F, 'POST', '/purchase-orders/replenish')));
  const made = res.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  const mine = [];
  for (const po of made) {
    const d = await call(F, 'GET', `/purchase-orders/${po.id}`);
    if (d.lines.some((l) => l.productId === prod.id)) mine.push(d);
  }
  ok(
    mine.length === 1 &&
      !mine[0].saleId &&
      Number(mine[0].lines.find((l) => l.productId === prod.id).productQty) === it.qty,
    `isi ulang bersamaan: ${mine.length} PO untuk ${code}, tanpa sales order`,
  );
  const again = await call(F, 'GET', '/purchase-orders/replenish/plan');
  ok(!again.some((x) => x.productId === prod.id), 'PO yang belum datang ikut dihitung: tidak dipesan dua kali');
  for (const po of made) await call(F, 'POST', `/purchase-orders/${po.id}/cancel`);
  await call(O, 'DELETE', `/stock-rules/${rule.id}`);
}

const tb = await call(F, 'GET', '/reports/neraca_saldo').catch(() => null);
void tb;

log(failures ? `\n${failures} pemeriksaan GAGAL` : '\nSemua pemeriksaan alur penagihan lolos');
process.exit(failures ? 1 : 0);
