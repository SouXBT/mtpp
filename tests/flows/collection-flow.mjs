// Uji alur penagihan lanjutan: masa tenggang per pelanggan, blokir dan izin kirim, cicilan, dan retur pelanggan.
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
const [do1] = await deliver(so1);
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

// ---------- retur: kirim pengganti ----------
const ra = await call(O, 'GET', `/transfers/${do1.id}/returnable`);
const mv = ra.lines[0];
ok(mv.available === 10, `surat jalan ${do1.name}: 10 unit dapat diretur`);
await expectFail(
  call(O, 'POST', '/returns', {
    pickingId: do1.id,
    reason: 'rusak',
    resolution: 'ganti',
    lines: [{ moveId: mv.moveId, quantity: 11 }],
  }),
  400,
  'retur melebihi kuantitas terkirim',
  /melebihi/,
);
const g = await call(O, 'POST', '/returns', {
  pickingId: do1.id,
  reason: 'rusak',
  resolution: 'ganti',
  note: 'Casing retak saat dibongkar',
  lines: [{ moveId: mv.moveId, quantity: 2 }],
});
ok(/^RET\/MTPP\/\d{4}\/\d{2}\/\d{4}$/.test(g.name) && g.state === 'draft', `retur ${g.name} dibuat (Draf)`);
await expectFail(call(F, 'POST', `/returns/${g.id}/process`), 403, 'Finance memproses kirim pengganti (hak gudang)');
await call(O, 'POST', `/returns/${g.id}/process`);
const so1b = await call(S, 'GET', `/sales-orders/${so1}`);
ok(so1b.state === 'sale' && Number(so1b.lines[0].qtyDelivered) === 8, 'SO kembali menunggu 2 unit pengganti');
const stock = await call(O, 'GET', `/stock?q=${encodeURIComponent(prod.defaultCode || prod.code)}`);
ok(
  stock.some((r) => Number(r.damaged) === 2),
  'stok Barang Rusak bertambah 2',
);
const inv1c = await call(F, 'GET', `/invoices/${inv1.id}`);
ok(near(inv1c.amountTotal, i1.amountTotal), 'invoice tidak berubah pada kirim pengganti');
const g2 = await call(O, 'GET', `/returns/${g.id}`);
ok(!!g2.replacementPicking, `surat jalan pengganti ${g2.replacementPicking?.name} dibuat otomatis`);
await expectFail(
  call(O, 'POST', `/transfers/from-sale/${so1}`),
  400,
  'surat jalan ganda untuk barang pengganti',
  /Tidak ada sisa/,
);
const so1r = await call(S, 'GET', `/sales-orders/${so1}`);
ok(
  Number(so1r.lines[0].qtyReturned) === 2 &&
    so1r.transfers.some((t) => t.id === g2.replacementPicking.id && t.replacement),
  'SO: kolom Diretur 2 dan surat jalan bertanda pengganti retur',
);
const outList = await call(O, 'GET', `/transfers?kind=outgoing&saleId=${so1}`);
ok(
  outList.find((t) => t.id === g2.replacementPicking.id)?.replacement === true,
  'daftar surat jalan menandai pengganti retur',
);
await stockFor(so1);
const rep = await call(O, 'GET', `/transfers/${g2.replacementPicking.id}`);
ok(rep.replacement?.name === g.name && !rep.paymentBlock, 'detail surat jalan menyebut retur asal');
await call(O, 'PATCH', `/transfers/${rep.id}`, {
  moves: rep.moves.map((m) => ({ id: m.id, quantity: m.productUomQty })),
});
await call(O, 'POST', `/transfers/${rep.id}/validate`, {});
const rpdf = await call(O, 'GET', `/transfers/${rep.id}/pdf`, undefined, true);
ok(rpdf.ok, 'surat jalan pengganti retur PDF');
const so1c = await call(S, 'GET', `/sales-orders/${so1}`);
ok(
  Number(so1c.lines[0].qtyDelivered) === 10 && so1c.invoiceStatus === 'invoiced',
  'pengganti terkirim; tidak ada tagihan baru',
);

// ---------- retur: nota kredit ----------
const nk = await call(S, 'POST', '/returns', {
  pickingId: do1.id,
  reason: 'tidak_sesuai',
  resolution: 'nota_kredit',
  lines: [{ moveId: mv.moveId, quantity: 1 }],
});
ok(near(nk.amountUntaxed, mv.netPrice), 'nota kredit memakai harga neto SO');
await expectFail(
  call(O, 'POST', `/returns/${nk.id}/process`),
  403,
  'Operasional memproses nota kredit (hak penagihan)',
);
const before = Number((await call(F, 'GET', `/invoices/${inv1.id}`)).amountResidual);
const nk2 = await call(F, 'POST', `/returns/${nk.id}/process`);
const after = Number((await call(F, 'GET', `/invoices/${inv1.id}`)).amountResidual);
ok(
  nk2.refundEntry && near(before - after, nk2.amountTotal),
  `nota kredit ${nk2.refundEntry?.name} mengurangi sisa invoice ${nk2.amountTotal}`,
);
const cn = await call(F, 'GET', `/invoices/${nk2.refundEntry.id}`);
const acc = cn.lines.map((l) => l.account).join(' | ');
ok(/4-1100/.test(acc) && /2-1300/.test(acc) && /1-1300/.test(acc), 'jurnal: Retur Penjualan + PPN Keluaran / Piutang');
const ra2 = await call(O, 'GET', `/transfers/${do1.id}/returnable`);
ok(ra2.lines[0].available === 7, 'sisa yang dapat diretur dari surat jalan asal: 7');
const ba = await call(O, 'GET', `/returns/${g.id}/pdf`, undefined, true);
ok(ba.ok && (await ba.arrayBuffer()).byteLength > 2000, 'berita acara barang bermasalah PDF');

// ---------- retur: potongan dan pengembalian dana ----------
const mv2 = (await call(O, 'GET', `/transfers/${do2.id}/returnable`)).lines[0];
await expectFail(
  call(S, 'POST', '/returns', {
    pickingId: do2.id,
    reason: 'rusak',
    resolution: 'potongan',
    lines: [{ moveId: mv2.moveId, quantity: 1, priceUnit: 1000 }],
  }),
  400,
  'potongan untuk barang yang belum ditagih',
  /belum ditagih/,
);
await expectFail(
  call(S, 'POST', '/returns', { pickingId: do2.id, reason: 'rusak', resolution: 'ganti', lines: [] }),
  400,
  'retur tanpa barang',
);
const inv2 = await call(F, 'POST', `/invoices/from-sale/${so2}`, {});
await call(F, 'POST', `/invoices/${inv2.id}/post`);
const i2 = await call(F, 'GET', `/invoices/${inv2.id}`);
await call(F, 'POST', '/payments', { invoiceId: inv2.id, amount: Number(i2.amountResidual), method: 'BNK' });
const pt = await call(S, 'POST', '/returns', {
  pickingId: do2.id,
  reason: 'rusak',
  resolution: 'potongan',
  note: 'Cat tergores, pelanggan tetap memakai barang',
  lines: [{ moveId: mv2.moveId, quantity: 1, priceUnit: 50000 }],
});
const pt2 = await call(F, 'POST', `/returns/${pt.id}/process`);
ok(pt2.creditLeft > 0 && near(pt2.creditLeft, pt2.amountTotal), `invoice sudah lunas: sisa kredit ${pt2.creditLeft}`);
await expectFail(
  call(F, 'POST', `/returns/${pt.id}/refund`, { amount: pt2.creditLeft + 1000 }),
  400,
  'pengembalian melebihi kredit',
  /melebihi/,
);
const pt3 = await call(F, 'POST', `/returns/${pt.id}/refund`, { amount: pt2.creditLeft, method: 'BNK' });
ok(pt3.creditLeft === 0 && pt3.refunds.length === 1, 'sisa kredit dikembalikan kepada pelanggan');
const st2 = await call(O, 'GET', `/stock?q=${encodeURIComponent(prod.defaultCode || prod.code)}`);
ok(
  st2.some((r) => Number(r.damaged) === 3),
  'potongan tidak menambah Barang Rusak (tetap 3)',
);

// ---------- batal retur draf ----------
const dr = await call(O, 'POST', '/returns', {
  pickingId: do1.id,
  reason: 'lainnya',
  resolution: 'ganti',
  lines: [{ moveId: mv.moveId, quantity: 1 }],
});
await call(O, 'POST', `/returns/${dr.id}/cancel`);
await expectFail(call(O, 'POST', `/returns/${dr.id}/process`), 400, 'memproses retur yang dibatalkan');
const so1Detail = await call(S, 'GET', `/sales-orders/${so1}`);
ok(so1Detail.returns.length === 3, 'SO menampilkan tiga retur');

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
  /tidak boleh sebelum/,
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

// ---------- retur ke principal ----------
// stok produk uji bisa berasal dari stok awal; buat PO yang benar-benar menerima produk ini ke gudang yang sama
const stRow = (await call(O, 'GET', `/stock?q=${encodeURIComponent(prod.defaultCode || prod.code)}`)).find(
  (r) => r.damaged > 0,
);
const so3 = await order(Math.max(Math.ceil(stRow.free), 0) + 5);
await stockFor(so3);
// PO mana pun yang memasok produk uji ke gudang tempat barang rusak disimpan
let po1 = null,
  prr = null,
  pl = null;
for (const po of (await call(F, 'GET', '/purchase-orders'))
  .filter((x) => ['purchase', 'done'].includes(x.state))
  .slice(0, 40)) {
  const r = await call(F, 'GET', `/purchase-orders/${po.id}/returnable`);
  const l = r.lines.find((x) => x.productId === prod.id && x.damaged > 0 && x.received >= 3);
  if (l) {
    po1 = po;
    prr = r;
    pl = l;
    break;
  }
}
ok(!!pl, `PO ${po1?.name} memasok produk uji`);
ok(pl.damaged === 3, `stok Barang Rusak untuk ${po1.name}: ${pl.damaged}`);
await expectFail(
  call(O, 'POST', '/purchase-returns', {
    purchaseId: po1.id,
    resolution: 'ganti',
    lines: [{ purchaseLineId: pl.purchaseLineId, quantity: 4 }],
  }),
  400,
  'retur ke principal melebihi barang rusak',
  /melebihi/,
);
const rg = await call(O, 'POST', '/purchase-returns', {
  purchaseId: po1.id,
  resolution: 'ganti',
  note: 'Klaim casing retak',
  lines: [{ purchaseLineId: pl.purchaseLineId, quantity: 2 }],
});
ok(/^RP\/MTPP\//.test(rg.name), `retur ke principal ${rg.name}`);
await expectFail(
  call(O, 'POST', '/purchase-returns', {
    purchaseId: po1.id,
    resolution: 'ganti',
    lines: [{ purchaseLineId: pl.purchaseLineId, quantity: 2 }],
  }),
  400,
  'stok rusak yang sudah dipakai retur draf lain',
  /melebihi/,
);
const rg2 = await call(O, 'POST', `/purchase-returns/${rg.id}/process`);
ok(rg2.state === 'done' && rg2.receipt, `penerimaan barang pengganti ${rg2.receipt?.name}`);
const before3 = (await call(O, 'GET', `/stock?q=${encodeURIComponent(prod.defaultCode || prod.code)}`)).find(
  (r) => r.damaged > 0 || r.physical > 0,
);
await call(O, 'POST', `/transfers/${rg2.receipt.id}/validate`, {});
const after3 = (await call(O, 'GET', `/stock?q=${encodeURIComponent(prod.defaultCode || prod.code)}`)).find(
  (r) => r.warehouseId === before3.warehouseId,
);
ok(
  after3.damaged === 1 && after3.physical === before3.physical + 2,
  'Barang Rusak berkurang 2, stok fisik bertambah 2 dari pengganti',
);
await expectFail(
  call(F, 'POST', '/purchase-returns', {
    purchaseId: po1.id,
    resolution: 'nota_kredit',
    lines: [{ purchaseLineId: pl.purchaseLineId, quantity: 1 }],
  }),
  400,
  'nota kredit principal sebelum tagihan',
  /belum ditagih/,
);
const bill = await call(F, 'POST', `/invoices/from-purchase/${po1.id}`, { ref: 'TAG-UJI' });
await call(F, 'POST', `/invoices/${bill.id}/post`);
const dueBefore = Number((await call(F, 'GET', `/purchase-orders/${po1.id}`)).mtppAmountDue);
const rn = await call(F, 'POST', '/purchase-returns', {
  purchaseId: po1.id,
  resolution: 'nota_kredit',
  lines: [{ purchaseLineId: pl.purchaseLineId, quantity: 1 }],
});
await expectFail(
  call(O, 'POST', `/purchase-returns/${rn.id}/process`),
  403,
  'Operasional memproses nota kredit principal',
);
const rn2 = await call(F, 'POST', `/purchase-returns/${rn.id}/process`);
const dueAfter = Number((await call(F, 'GET', `/purchase-orders/${po1.id}`)).mtppAmountDue);
ok(
  rn2.refundEntry && near(dueBefore - dueAfter, rn2.amountTotal),
  `nota kredit ${rn2.refundEntry?.name} mengurangi utang ${rn2.amountTotal}`,
);
const rpp = await call(F, 'GET', `/purchase-returns/${rn.id}/pdf`, undefined, true);
ok(rpp.ok, 'bukti retur ke principal PDF');
const tb = await call(F, 'GET', '/reports/neraca_saldo').catch(() => null);
void tb;

log(failures ? `\n${failures} pemeriksaan GAGAL` : '\nSemua pemeriksaan alur penagihan dan retur lolos');
process.exit(failures ? 1 : 0);
