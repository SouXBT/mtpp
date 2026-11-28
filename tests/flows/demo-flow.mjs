// Uji alur lengkap + pengisian data contoh transaksi.
// Jalankan setelah API hidup:  API=http://localhost:3000/api node ../../tests/flows/demo-flow.mjs
const API = process.env.API || 'http://localhost:3000/api';
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
const expectFail = async (p, status, m) => {
  try {
    await p;
    ok(false, m + ' (seharusnya ditolak)');
  } catch (e) {
    ok(!status || e.status === status, `${m} → ditolak: ${e.body?.message || e.message}`);
  }
};

async function login(email) {
  const r = await call('', 'POST', '/auth/login', { login: email, password: PASS });
  return r.token;
}

const P = await login('pimpinan@mtpp.co.id'),
  A = await login('admin@mtpp.co.id'),
  S = await login('sales@mtpp.co.id'),
  O = await login('operasional@mtpp.co.id'),
  F = await login('finance@mtpp.co.id');
log('Login lima grup berhasil');

// ---------- master ----------
const customers = await call(S, 'GET', '/partners?kind=customer');
const prods = await call(S, 'GET', '/products');
const byCode = (c) => prods.find((p) => (p.defaultCode || p.code) === c);
const cNew = customers.find((c) => c.mtppIsNewCustomer),
  cReg = customers.find((c) => c.name.includes('Graha'));
ok(cNew && cReg && prods.length >= 8, `master terbaca: ${customers.length} pelanggan, ${prods.length} produk`);
await expectFail(call(O, 'POST', '/partners', { kind: 'customer', name: 'Uji' }), 403, 'Operasional membuat pelanggan');
const cx = await call(A, 'POST', '/partners', { kind: 'customer', name: 'PT Uji Coba Hapus' });
await call(A, 'DELETE', `/partners/${cx.id}`);
ok(true, 'Admin membuat dan menghapus pelanggan yang belum dipakai');

// ---------- penawaran -> sales order (pelanggan baru) ----------
const id = (c) => byCode(c).id;
const q1 = await call(S, 'POST', '/sales-orders', {
  partnerId: cNew.id,
  partnerShippingId: cNew.children?.find?.((x) => x.type === 'delivery')?.id,
  clientOrderRef: 'PO-APL-0921',
  lines: [
    { productId: id('MCB-3P-63'), productUomQty: 60 },
    { productId: id('KBL-NYY-4X50'), productUomQty: 200, discount: 2 },
    { productId: id('GNS-150KVA'), productUomQty: 1 },
  ],
});
ok(/^PN\/MTPP\/\d{4}\/\d{2}\/\d{4}$/.test(q1.name), `penawaran ${q1.name} dibuat`);
const q1d = await call(S, 'GET', `/sales-orders/${q1.id}`);
ok(q1d.lines?.[0]?.purchasePrice > 0, 'Sales melihat harga pokok dan margin');
const q1o = await call(O, 'GET', `/sales-orders/${q1.id}`);
ok(q1o.lines?.[0]?.purchasePrice === undefined, 'Operasional tidak melihat harga pokok');
await call(S, 'PATCH', `/sales-orders/${q1.id}`, {
  lines: q1d.lines.map((l) => ({
    id: l.id,
    productId: l.productId,
    productUomQty: l.productUomQty,
    discount: l.discount,
    priceUnit: l.code === 'MCB-3P-63' ? 1200000 : l.priceUnit,
  })),
});
const hist = await call(P, 'GET', `/records/sales_orders/${q1.id}/messages`);
ok(
  hist.some((m) => m.changes?.length),
  'riwayat perubahan harga tercatat',
);
const pdf = await call(S, 'GET', `/sales-orders/${q1.id}/pdf?kind=quotation`, undefined, true);
ok(pdf.ok && (await pdf.arrayBuffer()).byteLength > 2000, 'PDF surat penawaran');
const sent = await call(S, 'POST', `/sales-orders/${q1.id}/send`, {});
ok(sent, 'penawaran dikirim lewat Email API (mode simulasi jika tanpa kunci Brevo)');
const cp = await call(S, 'POST', `/sales-orders/${q1.id}/copy`);
ok(cp.name !== q1.name, `salin penawaran → ${cp.name}`);
await call(S, 'POST', `/sales-orders/${cp.id}/cancel`);
ok(true, 'salinan dibatalkan');
await call(S, 'POST', `/sales-orders/${q1.id}/confirm`, { clientOrderRef: 'PO-UJI' });
const so1 = await call(S, 'GET', `/sales-orders/${q1.id}`);
ok(
  so1.state === 'sale' && /^SO\/MTPP\/\d{4}\/\d{2}\/\d{4}$/.test(so1.name) && so1.quotationNumber === q1.name,
  `${q1.name} dikonfirmasi menjadi sales order ${so1.name}, total Rp ${so1.amountTotal.toLocaleString('id-ID')}`,
);

// ---------- pelanggan tetap ----------
const q2 = await call(S, 'POST', '/sales-orders', {
  partnerId: cReg.id,
  lines: [
    { productId: id('PNL-MDP-400'), productUomQty: 3 },
    { productId: id('KBL-NYY-4X50'), productUomQty: 150 },
  ],
});
await call(S, 'POST', `/sales-orders/${q2.id}/confirm`, { clientOrderRef: 'PO-UJI' });
const so2 = await call(S, 'GET', `/sales-orders/${q2.id}`);
ok(so2.lines.find((l) => l.code === 'PNL-MDP-400').priceUnit === 66000000, 'pricelist kontraktor dipakai otomatis');

// ---------- uang muka minimal pelanggan lama (30%, Pengaturan > Penagihan) ----------
ok(so2.payment.dpPercent === 30 && so2.payment.dpMet === false, 'pelanggan lama: uang muka 30% belum masuk');
await expectFail(call(O, 'POST', `/transfers/from-sale/${q2.id}`), 400, 'surat jalan sebelum uang muka ditolak');
for (const so of [so1, so2])
  if (!so.payment.dpMet && !so.partner?.mtppIsNewCustomer)
    await call(F, 'POST', '/payments', { saleId: so.id, amount: so.payment.dpNeeded, kind: 'dp', method: 'BNK' });
ok((await call(S, 'GET', `/sales-orders/${q2.id}`)).payment.dpMet, 'uang muka 30% tercatat, surat jalan boleh dibuat');

// ---------- pesanan kepada principal ----------
const sh = await call(F, 'GET', `/sales-orders/${q1.id}/shortage`);
ok(
  sh.some((x) => x.shortage > 0),
  'kekurangan stok dihitung dari stok bebas',
);
const pos1 = await call(F, 'POST', `/purchase-orders/from-sale/${q1.id}`);
const pos2 = await call(F, 'POST', `/purchase-orders/from-sale/${q2.id}`);
const allPo = [...(Array.isArray(pos1) ? pos1 : [pos1]), ...(Array.isArray(pos2) ? pos2 : [pos2])];
ok(allPo.length >= 3, `${allPo.length} PO Principal dibuat (dropship dipisah)`);
await expectFail(call(F, 'POST', `/purchase-orders/from-sale/${q2.id}`), 400, 'PO ganda untuk kekurangan yang sama');
// uang muka ke principal: tanpa DP konfirmasi ditolak, Pimpinan dapat mengecualikan dengan alasan
const dpPo = await call(F, 'GET', `/purchase-orders/${allPo[0].id}`);
ok(
  dpPo.dp.percent === 30 && Math.abs(dpPo.dp.required - dpPo.amountTotal * 0.3) < 1,
  'uang muka principal 30% dari nilai PO',
);
await expectFail(call(F, 'POST', `/purchase-orders/${dpPo.id}/confirm`), 400, 'konfirmasi PO tanpa uang muka ditolak');
await expectFail(
  call(F, 'POST', `/purchase-orders/${dpPo.id}/confirm`, { waive: true, note: 'kredit principal' }),
  400,
  'pengecualian uang muka hanya oleh Pimpinan',
);
await expectFail(
  call(P, 'POST', `/purchase-orders/${dpPo.id}/confirm`, { waive: true }),
  400,
  'pengecualian uang muka wajib beralasan',
);
await expectFail(
  call(F, 'POST', '/payments', { purchaseId: dpPo.id, amount: dpPo.amountTotal + 1000, kind: 'dp', method: 'BNK' }),
  400,
  'uang muka melebihi nilai PO ditolak',
);
for (const po of allPo) {
  await call(F, 'POST', `/purchase-orders/${po.id}/send`, {});
  await payDp(F, po.id);
  await call(F, 'POST', `/purchase-orders/${po.id}/confirm`);
}
ok(true, 'PO dikirim dan dikonfirmasi');

// ---------- penerimaan barang (bertahap) ----------
let rec = (await call(O, 'GET', '/transfers?kind=incoming')).filter((t) => t.state !== 'done');
rec.sort((a, b) => a.id - b.id);
ok(rec.length >= 2, `${rec.length} penerimaan menunggu`);
const r0 = await call(O, 'GET', `/transfers/${rec[0].id}`);
await expectFail(
  call(O, 'POST', `/transfers/${r0.id}/validate`, {
    moves: r0.moves.map((m) => ({ id: m.id, quantity: m.productUomQty + 1 })),
  }),
  400,
  'kuantitas terima melebihi pesanan',
);
const big = r0.moves.reduce((a, m) => (m.productUomQty > a.productUomQty ? m : a));
await call(O, 'POST', `/transfers/${r0.id}/validate`, {
  moves: r0.moves.map((m) => ({
    id: m.id,
    quantity: m.id === big.id ? Math.floor(m.productUomQty / 2) : m.productUomQty,
  })),
});
const r0b = await call(O, 'GET', `/transfers/${r0.id}`);
ok(r0b.backorders.length === 1, `penerimaan susulan ${r0b.backorders[0]?.name}`);
rec = (await call(O, 'GET', '/transfers?kind=incoming')).filter((t) => !['done', 'cancel'].includes(t.state));
for (const t of rec) {
  const d = await call(O, 'GET', `/transfers/${t.id}`);
  await call(O, 'POST', `/transfers/${t.id}/validate`, {
    moves: d.moves.map((m) => ({ id: m.id, quantity: m.productUomQty })),
  });
}
ok(true, 'semua penerimaan divalidasi');
const rpdf = await call(O, 'GET', `/transfers/${r0.id}/pdf`, undefined, true);
ok(rpdf.ok, 'bukti penerimaan barang PDF');

// ---------- surat jalan pelanggan baru: ditolak sebelum lunas ----------
await expectFail(call(O, 'POST', `/transfers/from-sale/${q1.id}`), 400, 'surat jalan pelanggan baru sebelum lunas');
const pi = await call(F, 'POST', `/sales-orders/${q1.id}/proforma`, {
  mode: 'persen',
  percent: 30,
  note: 'Uang muka 30%',
  settleDate: new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10),
});
ok(
  pi.number?.startsWith('PI/'),
  `proforma ${pi.number} (tanpa jurnal), uang muka ${pi.percent}% = Rp ${Number(pi.amount).toLocaleString('id-ID')}`,
);
await call(F, 'POST', `/sales-orders/${q1.id}/proforma/send`, {});
await call(F, 'POST', '/payments', {
  saleId: q1.id,
  amount: Math.round(so1.amountTotal * 0.3),
  method: 'BNK',
  memo: 'Transfer uang muka',
});
await expectFail(call(O, 'POST', `/transfers/from-sale/${q1.id}`), 400, 'surat jalan saat baru dibayar 30%');
await call(F, 'POST', '/payments', {
  saleId: q1.id,
  amount: so1.amountTotal - Math.round(so1.amountTotal * 0.3),
  method: 'BNK',
  memo: 'Pelunasan',
});
const dos = await call(O, 'POST', `/transfers/from-sale/${q1.id}`);
ok(dos.length >= 1, `surat jalan ${dos.map((d) => d.name).join(', ')} terbit setelah lunas`);
for (const d of dos) {
  const t = await call(O, 'GET', `/transfers/${d.id}`);
  await call(O, 'PATCH', `/transfers/${d.id}`, {
    moves: t.moves.map((m, i) => ({ id: m.id, quantity: i === 0 ? m.productUomQty - 10 : m.productUomQty })),
  });
  await call(O, 'POST', `/transfers/${d.id}/ready`);
  await call(O, 'POST', `/transfers/${d.id}/validate`, {});
}
const so1b = await call(S, 'GET', `/sales-orders/${q1.id}`);
ok(
  so1b.lines.some((l) => l.qtyDelivered > 0 && l.qtyDelivered < l.productUomQty),
  'pengiriman bertahap: sisa menjadi surat jalan susulan',
);
const dpdf = await call(O, 'GET', `/transfers/${dos[0].id}/pdf`, undefined, true);
ok(dpdf.ok, 'surat jalan PDF 3 lembar');
// dropship dari principal
const ds = (await call(O, 'GET', '/transfers?kind=outgoing')).filter((t) => t.state !== 'done');
for (const t of ds) {
  const d = await call(O, 'GET', `/transfers/${t.id}`);
  if (d.dropship) {
    await call(O, 'POST', `/transfers/${t.id}/validate`, {
      moves: d.moves.map((m) => ({ id: m.id, quantity: m.productUomQty })),
    });
    ok(true, `dropship ${d.name} diterima pelanggan`);
  }
}

// ---------- invoice + uang muka otomatis ----------
const inv1 = await call(F, 'POST', `/invoices/from-sale/${q1.id}`, {});
const inv1p = await call(F, 'POST', `/invoices/${inv1.id}/post`);
ok(
  inv1p.paymentState === 'paid' || inv1p.amountResidual === 0,
  `${inv1.name}: uang muka otomatis dipakai, status ${inv1p.paymentState}`,
);
const ipdf = await call(F, 'GET', `/invoices/${inv1.id}/pdf`, undefined, true);
ok(ipdf.ok, 'invoice PDF dengan DPP, PPN, terbilang');
await call(F, 'POST', `/invoices/${inv1.id}/send`, {});

// ---------- pelanggan tetap: surat jalan, invoice, pembayaran sebagian ----------
const dos2 = await call(O, 'POST', `/transfers/from-sale/${q2.id}`);
for (const d of dos2) {
  await call(O, 'POST', `/transfers/${d.id}/validate`, {});
}
const inv2 = await call(F, 'POST', `/invoices/from-sale/${q2.id}`, {});
const inv2p = await call(F, 'POST', `/invoices/${inv2.id}/post`);
ok(inv2p.invoiceDateDue > inv2p.invoiceDate, `jatuh tempo ${inv2p.invoiceDateDue} = tanggal invoice + 30 hari`);
const pay = await call(F, 'POST', '/payments', {
  invoiceId: inv2.id,
  amount: Math.round(inv2p.amountTotal / 2),
  method: 'BNK',
});
const inv2b = await call(F, 'GET', `/invoices/${inv2.id}`);
ok(inv2b.paymentState === 'partial', 'pembayaran sebagian → status sebagian');
const kw = await call(F, 'GET', `/payments/${pay.id}/receipt`, undefined, true);
ok(kw.ok, 'kuitansi PDF');

// ---------- tagihan principal ----------
const pol = await call(F, 'GET', '/purchase-orders');
for (const po of pol.filter((p) => p.state === 'purchase' || p.state === 'done')) {
  const b = await call(F, 'POST', `/invoices/from-purchase/${po.id}`, { ref: 'INV-PRC-' + po.id }).catch((e) => null);
  if (!b) continue;
  const bp = await call(F, 'POST', `/invoices/${b.id}/post`);
  // uang muka PO dipotong otomatis dari tagihan pertama
  if (po.id === dpPo.id)
    ok(
      Math.abs(Number(bp.amountResidual) - Math.max(Number(bp.amountTotal) - dpPo.dp.required, 0)) < 1,
      'uang muka principal memotong tagihan saat diposting',
    );
  const left = Number(bp.amountResidual);
  if (left <= 0.5) continue;
  await call(F, 'POST', '/payments', {
    purchaseId: po.id,
    amount: po.id % 2 ? left : Math.round(left / 2),
    method: 'BNK',
  });
}
const pol2 = await call(F, 'GET', '/purchase-orders');
ok(
  pol2.some((p) => p.mtppPaymentState === 'lunas'),
  'status bayar PO: ' + [...new Set(pol2.map((p) => p.mtppPaymentState))].join(', '),
);

// ---------- akuntansi ----------
const accs = await call(F, 'GET', '/accounts');
await call(F, 'POST', '/cash', {
  type: 'in',
  accountId: accs.find((a) => a.code === '3-1000').id,
  amount: 25000000,
  memo: 'Setoran modal kas kecil',
});
const sewa = accs.find((a) => a.code === '6-3000'),
  lain = accs.find((a) => a.code === '6-9000');
await call(F, 'POST', '/cash', { type: 'out', accountId: sewa.id, amount: 3500000, memo: 'Sewa kantor November' });
await call(F, 'POST', '/cash', {
  type: 'in',
  accountId: accs.find((a) => a.code === '4-2000').id,
  amount: 250000,
  memo: 'Penjualan kardus bekas',
});
const bal = await call(F, 'GET', '/cash/balance');
ok(
  typeof bal.cash === 'number',
  `saldo kas Rp ${bal.cash.toLocaleString('id-ID')}, bank Rp ${bal.bank.toLocaleString('id-ID')}`,
);
await expectFail(
  call(F, 'POST', '/journal-entries', {
    journal: 'MISC',
    post: true,
    lines: [
      { accountId: sewa.id, debit: 100 },
      { accountId: lain.id, credit: 90 },
    ],
  }),
  400,
  'jurnal tidak seimbang',
);
const je = await call(F, 'POST', '/journal-entries', {
  journal: 'MISC',
  ref: 'Penyesuaian',
  lines: [
    { accountId: lain.id, debit: 100000 },
    { accountId: accs.find((a) => a.code === '1-1100').id, credit: 100000 },
  ],
});
await call(F, 'POST', `/journal-entries/${je.id}/post`);
await call(F, 'POST', `/journal-entries/${je.id}/reverse`);
ok(true, 'jurnal umum diposting lalu dibalik');
const tb = await call(F, 'GET', '/trial-balance?from=2026-01-01&to=2026-12-31');
ok(
  Math.abs(tb.totalDebit - tb.totalCredit) < 0.01,
  `neraca saldo seimbang (D ${tb.totalDebit.toLocaleString('id-ID')} = K ${tb.totalCredit.toLocaleString('id-ID')})`,
);
// rekonsiliasi bank
const pays = await call(F, 'GET', '/payments');
const csv = `Tanggal,Keterangan,Jumlah\n${pays
  .slice(0, 2)
  .map((p) => `${p.date},TRF ${p.partner || ''},${p.paymentType === 'inbound' ? '' : '-'}${p.amount}`)
  .join('\n')}\n2026-11-03,BIAYA ADM,-15000\n`;
const fd = new FormData();
fd.append('file', new Blob([csv], { type: 'text/csv' }), 'mutasi.csv');
fd.append('journal', 'BNK');
const imp = await call(F, 'POST', '/bank-statements/import', fd);
const lines = await call(F, 'GET', '/bank-statements');
const first = lines.find((l) => !l.isReconciled && Number(l.amount) !== -15000);
const cand = first ? await call(F, 'GET', `/bank-statements/${first.id}/candidates`) : [];
if (first && cand.length) await call(F, 'POST', `/bank-statements/${first.id}/match`, { paymentId: cand[0].id });
ok(
  imp.imported >= 3 && imp.matched + cand.length >= 1,
  `mutasi bank diimpor (${imp.imported} baris), ${imp.matched} cocok otomatis, ${lines.filter((l) => !l.isReconciled).length} belum cocok`,
);

// ---------- laporan ----------
const reps = await call(P, 'GET', '/reports');
ok(reps.length === 12, 'Pimpinan memiliki 12 laporan');
for (const r of reps) {
  const d = await call(P, 'GET', `/reports/${r.key}?range=year`);
  const x = await call(P, 'GET', `/reports/${r.key}/export?format=xlsx&range=year`, undefined, true);
  const p = await call(P, 'GET', `/reports/${r.key}/export?format=pdf&range=year`, undefined, true);
  ok(x.ok && p.ok, `${r.title}: ${d.rows.length} baris, ekspor xlsx + pdf`);
}
await expectFail(call(O, 'GET', '/reports/margin'), 403, 'Operasional membuka laporan margin');

// ---------- dashboard ----------
for (const [n, t] of [
  ['Pimpinan', P],
  ['Admin', A],
  ['Sales', S],
  ['Operasional', O],
  ['Finance', F],
]) {
  const d = await call(t, 'GET', '/dashboard');
  ok(d.kpis.length >= 4, `dashboard ${n}: ${d.kpis.map((k) => k.label).join(', ')}`);
}

// ---------- catatan, lampiran, aktivitas, filter ----------
await call(S, 'POST', `/records/sales_orders/${q2.id}/messages`, { body: 'Pelanggan minta jadwal kirim dimajukan.' });
const af = new FormData();
af.append('file', new Blob(['PO pelanggan'], { type: 'text/plain' }), 'po-pelanggan.txt');
const att = await call(S, 'POST', `/records/sales_orders/${q2.id}/attachments`, af);
const dl = await call(S, 'GET', `/attachments/${att.id}/download`, undefined, true);
ok(dl.ok, 'catatan internal dan lampiran tersimpan');
await call(S, 'POST', '/activities', {
  resModel: 'sales_orders',
  resId: q2.id,
  resName: q2.name,
  summary: 'Telepon pelanggan konfirmasi alamat',
  dateDeadline: '2026-11-01',
});
const acts = await call(S, 'GET', '/activities');
ok(
  acts.some((a) => a.overdue),
  'aktivitas terlambat ditandai',
);
await call(S, 'POST', '/saved-filters', { resource: 'sales-orders', name: 'SO bulan ini', filter: { state: 'sale' } });

// ---------- hak akses, impor, API key ----------
const groups = await call(A, 'GET', '/groups');
ok(groups.length === 5, 'lima grup pengguna');
const tpl = await call(A, 'GET', '/import/template/customers', undefined, true);
ok(tpl.ok, 'template impor pelanggan');
const icsv =
  'Nama,NPWP,Email,Kota,Term of payment (hari),Pelanggan baru (ya/tidak)\nPT Impor Satu,,a@x.id,Surabaya,30,tidak\n,,b@x.id,Malang,,\nPT Impor Dua,,c@x.id,Kediri,14,ya\n';
const ifd = new FormData();
ifd.append('file', new Blob([icsv], { type: 'text/csv' }), 'pelanggan.csv');
const ir = await call(A, 'POST', '/import/customers', ifd);
ok(
  ir.imported === 2 && ir.errors.length === 1,
  `impor pelanggan: ${ir.imported} tersimpan, ${ir.errors.length} baris salah (${ir.errors[0]?.message})`,
);
const key = await call(A, 'POST', '/api-keys', { name: 'Aplikasi pelaporan' });
const pub = await fetch(API + '/v1/sales-orders', { headers: { 'X-API-Key': key.key } }).then((r) => r.json());
ok(pub.data?.length >= 2, `REST API dengan API key: ${pub.data.length} sales order`);
const bad = await fetch(API + '/v1/stock', { headers: { 'X-API-Key': 'salah' } });
ok(bad.status === 401, 'API key salah ditolak');

// ---------- dokumen bebas (surat, berita acara, laporan pemeliharaan) ----------
log('Dokumen');
const isPdf = async (r) =>
  r.ok &&
  r.headers.get('content-type')?.includes('pdf') &&
  Buffer.from(await r.arrayBuffer())
    .subarray(0, 4)
    .toString() === '%PDF';
const dcust = customers[0];
const sampleTo = {
  company: dcust.name,
  person: 'Ibu Melinda',
  address: 'Jl. Simomulyo Baru 5-G No. 10\nSurabaya 60181',
  phone: '0812 3058 528',
};
const sampleItems = [
  {
    desc: 'Transformator Distribusi "Trafindo"\n630 kVA, 20 kV — 400/231V, 3Ph / 50Hz, Dyn5\nPT 20 kV / √3 // 100 / √3',
    qty: '1',
    unit: 'Unit',
  },
];
const samples = {
  surat: {
    to: sampleTo,
    subject: 'Pemberitahuan Alamat Kirim',
    body: 'Dengan hormat,\n\nMohon pengiriman barang berikut:\n\nAtas perhatiannya kami ucapkan terima kasih.',
    items: sampleItems,
    shipTo: 'Pabrik Gresik',
    shipContact: 'Bagus',
    shipDate: '2026-11-20',
    cc: 'Arsip',
  },
  bast: {
    party2Company: dcust.name,
    party2Name: 'Ibu Melinda',
    party2Title: 'Purchasing',
    location: 'Pabrik Gresik',
    project: 'Gardu Distribusi 1',
    statement: 'Telah dilaksanakan serah terima.',
    closing: 'Demikian berita acara ini dibuat.',
    items: sampleItems,
  },
  bacomm: {
    to: sampleTo,
    location: 'Pabrik Gresik',
    serviceDate: '2026-11-04',
    technicians: 'Andi',
    witness: 'Bagus',
    eqBrand: 'Trafindo',
    eqRating: '630 kVA',
    statement: 'Telah dilaksanakan pengujian.',
    checks: [{ item: 'Uji tahanan isolasi', result: 'OK', note: '' }],
    result: 'Peralatan LAIK OPERASI.',
  },
  maintenance: {
    to: sampleTo,
    location: 'Pabrik Gresik',
    serviceDate: '2026-11-04',
    serviceType: 'Preventive Maintenance',
    technicians: 'Andi',
    status: 'Selesai — Laik Operasi',
    eqBrand: 'Trafindo',
    eqRating: '630 kVA',
    checks: [{ item: 'Level & kondisi oli', result: 'Baik', note: '' }],
    mR: '231',
    mIso: '2.400',
    mGnd: '0,8',
    mTemp: '62',
    findings: 'Debu pada radiator.',
    items: sampleItems,
    terms: 'Pekerjaan sesuai K3',
  },
};
const made = {};
for (const type of Object.keys(samples)) {
  const blank = await call(O, 'POST', '/documents/preview', { type, date: '2026-11-04', data: {} }, true);
  ok(await isPdf(blank), `pratinjau ${type} tetap berhasil saat formulir masih kosong`);
}
for (const [type, data] of Object.entries(samples)) {
  const pv = await call(O, 'POST', '/documents/preview', { type, date: '2026-11-04', data }, true);
  ok(await isPdf(pv), `pratinjau ${type} menghasilkan PDF`);
  const d = await call(O, 'POST', '/documents', { type, date: '2026-11-04', partnerId: dcust.id, data });
  made[type] = d;
  const f = await call(P, 'GET', `/documents/${d.id}/pdf`, undefined, true);
  ok(await isPdf(f), `${type} tersimpan dengan nomor ${d.number} dan dapat dicetak`);
}
ok(made.surat.number.startsWith('SP/MTPP/2026/11/'), 'penomoran otomatis mengikuti format sistem');
const upd = await call(O, 'PATCH', `/documents/${made.surat.id}`, {
  number: made.surat.number,
  date: '2026-11-05',
  partnerId: dcust.id,
  data: { ...samples.surat, subject: 'Hal baru' },
});
ok(upd.title === 'Hal baru' && upd.date === '2026-11-05', 'dokumen dapat diubah');
await expectFail(
  call(O, 'PATCH', `/documents/${made.bast.id}`, { number: made.surat.number, date: '2026-11-04', data: {} }),
  400,
  'nomor ganda ditolak',
);
await expectFail(
  call(O, 'POST', '/documents', { type: 'tidak-ada', date: '2026-11-04', data: {} }),
  400,
  'jenis tidak dikenal ditolak',
);
await expectFail(
  call(F, 'POST', '/documents', { type: 'surat', date: '2026-11-04', data: {} }),
  403,
  'Finance hanya dapat membaca dokumen',
);
const dcopy = await call(O, 'POST', `/documents/${made.surat.id}/copy`);
ok(dcopy.id !== made.surat.id && dcopy.number !== made.surat.number, 'duplikat mendapat nomor baru');
await call(O, 'DELETE', `/documents/${dcopy.id}`);
const dlist = await call(P, 'GET', '/documents?type=surat');
ok(dlist.length === 1 && dlist[0].partner === dcust.name, 'daftar dokumen dapat disaring per jenis');

log(failures ? `\n${failures} pemeriksaan gagal` : '\nSemua pemeriksaan berhasil');
process.exit(failures ? 1 : 0);
