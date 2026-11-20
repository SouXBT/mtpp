// Data contoh transaksi 3 bulan ke belakang (90 hari sampai hari ini), bertanggal sesuai harinya:
// penawaran, sales order, PO principal, penerimaan, surat jalan, invoice, pembayaran (tepat waktu, terlambat,
// sebagian, cicilan), pelanggan baru dengan DP dan pelunasan, izin kirim Pimpinan, retur pelanggan, retur ke principal.
//
// Syarat: katalog dari mock-data.mjs sudah dimuat, dan API berjalan dengan MOCK_DATE_HEADER=true
// (stack uji sudah memakainya). Setiap request membawa header x-mock-date sehingga nomor dokumen dan tanggalnya
// mengikuti hari simulasi. Skrip menulis data dan menolak berjalan dua kali.
//   API=http://localhost:8081/api node apps/api/scripts/seed/mock-3-bulan.mjs
const API = process.env.API || 'http://localhost:8081/api';
const PASS = process.env.DEMO_PASSWORD || 'mtpp12345';
const DAYS = Number(process.env.DAYS || 90);
const MARK = 'M3-'; // awalan PO pelanggan, penanda data skrip ini

// ---------------------------------------------------------------- dasar
let seed = 20261120;
const rnd = () => {
  // mulberry32: hasil sama setiap kali dijalankan
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const chance = (p) => rnd() < p;
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000));
const wib = () => iso(new Date(Date.now() + 7 * 3600 * 1000));
const END = process.env.END || wib();
const START = addDays(END, -DAYS + 1);
const weekend = (s) => [0, 6].includes(new Date(s + 'T00:00:00Z').getUTCDay());
// geser ke hari kerja berikutnya
const workday = (s) => {
  let d = s;
  while (weekend(d)) d = addDays(d, 1);
  return d;
};

async function call(token, method, path, body, day) {
  const headers = { Authorization: `Bearer ${token}` };
  if (day) headers['x-mock-date'] = day;
  let payload;
  if (method === 'POST' && path === '/payments' && body && !(body instanceof FormData)) {
    // pembayaran pelanggan wajib disertai bukti transfer
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== null) fd.append(k, String(v));
    fd.append('file', new Blob(['%PDF-1.4 bukti transfer contoh'], { type: 'application/pdf' }), 'bukti-transfer.pdf');
    payload = fd;
  } else if (body !== undefined) {
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
  if (!r.ok) {
    const e = new Error(`${method} ${path} -> ${r.status} ${j?.message || t}`);
    e.status = r.status;
    e.msg = String(j?.message || t);
    throw e;
  }
  return j;
}
const login = async (u) => (await call('', 'POST', '/auth/login', { login: `${u}@mtpp.co.id`, password: PASS })).token;
const [P, A, S, O, F] = await Promise.all(['pimpinan', 'admin', 'sales', 'operasional', 'finance'].map(login));

// ---------------------------------------------------------------- pemeriksaan awal
const products = (await call(S, 'GET', '/products')).filter((p) => p.active !== false && Number(p.listPrice) > 0);
if (!products.some((p) => p.code === 'TRF-OIL-400')) {
  console.error('Katalog belum ada. Jalankan dulu: node apps/api/scripts/seed/mock-data.mjs');
  process.exit(1);
}
const probe = await fetch(`${API}/sales-orders/next-number`, {
  headers: { Authorization: `Bearer ${S}`, 'x-mock-date': '2020-01-15' },
});
if (!/2020\/01/.test(await probe.text())) {
  console.error(
    'API belum menerima tanggal simulasi. Jalankan API dengan MOCK_DATE_HEADER=true (stack uji sudah memakainya).',
  );
  process.exit(1);
}
if ((await call(S, 'GET', `/sales-orders?q=${MARK}`)).length) {
  console.error('Data contoh 3 bulan sudah pernah dimuat pada database ini.');
  process.exit(1);
}

// ---------------------------------------------------------------- penjadwal hari demi hari
const queue = [];
const at = (day, label, fn) => {
  if (day > END) return; // jatuh setelah hari ini: dibiarkan terbuka, seperti keadaan nyata
  queue.push({ day: day < START ? START : day, label, fn, n: queue.length });
};
const stats = {};
const count = (k) => (stats[k] = (stats[k] || 0) + 1);
const warn = [];

// ---------------------------------------------------------------- master: pelanggan lama tambahan dan pelanggan baru
const terms = await call(P, 'GET', '/payment-terms');
const top = (days) => terms.find((t) => Number(t.days) === days) || terms.find((t) => Number(t.days) > 0);
const REGULAR = [
  ['PT Wijaya Karya Instalasi', 'Surabaya', 30, 7],
  ['PT Sumber Energi Gresik', 'Gresik', 30, 5],
  ['CV Cahaya Listrik Sidoarjo', 'Sidoarjo', 14, 7],
  ['PT Pabrik Kertas Jatim', 'Mojokerto', 45, 10],
  ['RS Mitra Sehat Malang', 'Malang', 30, 7],
  ['PT Kawasan Industri Rungkut', 'Surabaya', 30, 3],
];
const NEWCOMERS = [
  ['CV Sinar Baru Teknik', 'Pasuruan'],
  ['PT Gudang Dingin Nusantara', 'Surabaya'],
  ['CV Karya Mandiri Elektrik', 'Lamongan'],
];
const regular = [];
for (const [name, city, days, grace] of REGULAR) {
  const c = await call(
    A,
    'POST',
    '/partners',
    { kind: 'customer', name, city, email: `keuangan@${name.toLowerCase().replace(/[^a-z]+/g, '')}.co.id` },
    START,
  );
  await call(
    P,
    'PATCH',
    `/partners/${c.id}`,
    { mtppIsNewCustomer: false, paymentTermId: top(days).id, mtppGraceDays: grace },
    START,
  );
  regular.push({ ...c, days });
}
for (const c of (await call(S, 'GET', '/partners?kind=customer')).filter((x) => !x.mtppIsNewCustomer))
  if (!regular.some((r) => r.id === c.id)) regular.push({ ...c, days: 30 });
const fresh = [];

// ---------------------------------------------------------------- produk: kebanyakan stok, sedikit dropship
const stockItems = products.filter((p) => p.mtppRoute !== 'dropship' && p.type !== 'service');
const dropItems = products.filter((p) => p.mtppRoute === 'dropship');
const qtyFor = (p) => {
  const price = Number(p.listPrice);
  return price > 100e6 ? 1 : price > 20e6 ? int(1, 2) : price > 2e6 ? int(2, 6) : int(5, 40);
};
const orderLines = () => {
  const n = int(1, 3);
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = chance(0.12) && dropItems.length ? pick(dropItems) : pick(stockItems);
    if (!lines.some((l) => l.productId === p.id)) lines.push({ productId: p.id, productUomQty: qtyFor(p) });
  }
  return lines;
};

// ---------------------------------------------------------------- alur satu pesanan
let refNo = 0,
  planned = 0;
function newQuote(day, cust, isNew) {
  at(day, 'penawaran', async (d) => {
    const ref = `${MARK}PO-${String(++refNo).padStart(4, '0')}`;
    const q = await call(
      S,
      'POST',
      '/sales-orders',
      { partnerId: cust.id, clientOrderRef: ref, lines: orderLines() },
      d,
    );
    count('penawaran');
    const sent = chance(0.8);
    if (sent)
      at(workday(addDays(d, int(0, 1))), 'kirim penawaran', (d2) =>
        call(S, 'POST', `/sales-orders/${q.id}/send`, {}, d2),
      );
    const fate = rnd();
    if (fate < 0.68) at(workday(addDays(d, int(1, 6))), 'konfirmasi', (d2) => confirmOrder(d2, q.id, cust, isNew));
    else if (fate < 0.8)
      at(workday(addDays(d, int(5, 20))), 'batal', async (d2) => {
        await call(S, 'POST', `/sales-orders/${q.id}/cancel`, {}, d2);
        count('penawaran batal');
      });
    // sisanya dibiarkan: menunggu jawaban atau kedaluwarsa
  });
}

async function confirmOrder(d, id, cust, isNew) {
  await call(S, 'POST', `/sales-orders/${id}/confirm`, {}, d);
  count('sales order');
  const so = await call(F, 'GET', `/sales-orders/${id}`, undefined, d);
  // kekurangan stok: Finance memesan ke principal
  if ((so.shortage || []).some((x) => x.shortage > 0))
    at(workday(addDays(d, int(0, 2))), 'PO principal', (d2) => purchaseFor(d2, id));
  if (isNew) {
    // pelanggan baru: proforma, DP, pelunasan sebelum kirim
    const total = Number(so.amountTotal);
    const full = chance(0.3);
    const settle = addDays(d, int(10, 21));
    at(d, 'proforma', (d2) =>
      call(
        F,
        'POST',
        `/sales-orders/${id}/proforma`,
        full ? { mode: 'lunas' } : { mode: 'persen', percent: 30, settleDate: settle },
        d2,
      ),
    );
    if (full)
      at(workday(addDays(d, int(1, 4))), 'lunas langsung', async (d2) => {
        await call(
          F,
          'POST',
          '/payments',
          { saleId: id, amount: total, kind: 'lunas', method: 'BNK', memo: 'Transfer pelunasan' },
          d2,
        );
        count('pembayaran lunas langsung');
        at(workday(addDays(d2, 1)), 'kirim', (d3) => deliver(d3, id, 0));
      });
    else {
      const dp = Math.round(total * 0.3);
      at(workday(addDays(d, int(1, 3))), 'DP', async (d2) => {
        await call(
          F,
          'POST',
          '/payments',
          { saleId: id, amount: dp, kind: 'dp', settleDate: settle, method: 'BNK', memo: 'DP 30%' },
          d2,
        );
        count('pembayaran DP');
      });
      // sebagian pelanggan melunasi terlambat dari tanggal yang disepakati
      at(workday(addDays(settle, chance(0.75) ? -int(0, 6) : int(2, 9))), 'pelunasan', async (d2) => {
        await call(
          F,
          'POST',
          '/payments',
          { saleId: id, amount: Math.round((total - dp) * 100) / 100, kind: 'lunas', method: 'BNK', memo: 'Pelunasan' },
          d2,
        );
        count('pembayaran pelunasan');
        at(workday(addDays(d2, 1)), 'kirim', (d3) => deliver(d3, id, 0));
      });
    }
  } else at(workday(addDays(d, int(1, 3))), 'kirim', (d2) => deliver(d2, id, 0));
}

async function purchaseFor(d, soId) {
  let pos;
  try {
    pos = await call(F, 'POST', `/purchase-orders/from-sale/${soId}`, undefined, d);
  } catch (e) {
    if (/Stok mencukupi|sudah/i.test(e.msg)) return;
    throw e;
  }
  for (const po of Array.isArray(pos) ? pos : [pos]) {
    await call(F, 'POST', `/purchase-orders/${po.id}/send`, {}, d);
    await call(F, 'POST', `/purchase-orders/${po.id}/confirm`, undefined, d);
    count('PO principal');
    const arrive = workday(addDays(d, int(3, 12)));
    at(arrive, 'penerimaan', async (d2) => {
      const rec = (await call(O, 'GET', `/transfers?kind=incoming&purchaseId=${po.id}`, undefined, d2)).filter(
        (t) => !['done', 'cancel'].includes(t.state),
      );
      for (const t of rec) {
        const dropship = t.dropship;
        await call(O, 'POST', `/transfers/${t.id}/validate`, {}, d2);
        count(dropship ? 'dropship diterima' : 'penerimaan barang');
      }
      // dropship: surat jalan dari principal ke pelanggan dikonfirmasi saat barang diterima
      const ds = (await call(O, 'GET', `/transfers?kind=outgoing&purchaseId=${po.id}`, undefined, d2)).filter(
        (t) => !['done', 'cancel'].includes(t.state),
      );
      for (const t of ds) {
        try {
          await call(O, 'POST', `/transfers/${t.id}/validate`, {}, d2);
          count('dropship diterima pelanggan');
          at(workday(addDays(d2, int(0, 2))), 'invoice', (d3) => invoice(d3, soId));
        } catch (e) {
          warn.push(`${d2} dropship ${t.name}: ${e.msg}`);
        }
      }
      // tagihan principal beberapa hari kemudian, dibayar sekitar jatuh tempo
      at(workday(addDays(d2, int(2, 6))), 'tagihan principal', async (d3) => {
        try {
          const b = await call(
            F,
            'POST',
            `/invoices/from-purchase/${po.id}`,
            { ref: `INV-${po.name.slice(-4)}`, date: d3 },
            d3,
          );
          await call(F, 'POST', `/invoices/${b.id}/post`, undefined, d3);
          count('tagihan principal');
          at(workday(addDays(d3, int(20, 45))), 'bayar principal', async (d4) => {
            const p = await call(F, 'GET', `/purchase-orders/${po.id}`, undefined, d4);
            if (Number(p.mtppAmountDue) > 0) {
              await call(
                F,
                'POST',
                '/payments',
                { purchaseId: po.id, amount: Number(p.mtppAmountDue), method: 'BNK' },
                d4,
              );
              count('pembayaran principal');
            }
          });
        } catch (e) {
          if (!/Belum ada barang/.test(e.msg)) warn.push(`${d3} tagihan ${po.name}: ${e.msg}`);
        }
      });
    });
  }
}

// surat jalan: pakai stok bebas yang ada; bila tertahan (stok, pembayaran, masa tenggang) dicoba lagi
async function deliver(d, soId, tries) {
  const so = await call(O, 'GET', `/sales-orders/${soId}`, undefined, d);
  if (so.state !== 'sale') return;
  if (so.creditHold?.blocking) {
    // Pimpinan kadang memberi izin kirim; selain itu menunggu tagihan lama dibayar
    if (chance(0.5)) {
      await call(P, 'POST', `/sales-orders/${soId}/release`, { note: 'Pelanggan berjanji melunasi minggu ini' }, d);
      count('izin kirim Pimpinan');
    } else if (tries < 8)
      return at(workday(addDays(d, int(3, 6))), 'kirim (tertahan)', (d2) => deliver(d2, soId, tries + 1));
    else return;
  }
  if (so.deliverable) {
    try {
      await call(O, 'POST', `/transfers/from-sale/${soId}`, undefined, d);
    } catch (e) {
      if (!/Tidak ada sisa/.test(e.msg) && tries >= 8) warn.push(`${d} surat jalan ${so.name}: ${e.msg}`);
    }
  }
  const open = (await call(O, 'GET', `/transfers?kind=outgoing&saleId=${soId}`, undefined, d)).filter(
    (t) => ['draft', 'assigned'].includes(t.state) && !t.dropship,
  );
  let any = false;
  for (const t of open) {
    const x = await call(O, 'GET', `/transfers/${t.id}`, undefined, d);
    const moves = x.moves.map((m) => ({
      id: m.id,
      quantity: Math.max(0, Math.min(Number(m.productUomQty), Number(m.available ?? m.productUomQty))),
    }));
    if (!moves.some((m) => m.quantity > 0)) continue;
    try {
      await call(O, 'POST', `/transfers/${t.id}/validate`, { moves }, d);
      count(x.replacement ? 'surat jalan pengganti retur' : 'surat jalan');
      any = true;
      if (!x.replacement && chance(0.06))
        at(workday(addDays(d, int(2, 5))), 'retur', (d2) => customerReturn(d2, t.id, soId));
    } catch (e) {
      if (tries >= 8) warn.push(`${d} validasi ${t.name}: ${e.msg}`);
    }
  }
  if (any) at(workday(addDays(d, int(0, 2))), 'invoice', (d2) => invoice(d2, soId));
  const after = await call(O, 'GET', `/sales-orders/${soId}`, undefined, d);
  const left = after.lines.some((l) => !l.mtppIsDropship && Number(l.qtyDelivered) < Number(l.productUomQty));
  if (left && tries < 8) at(workday(addDays(d, int(2, 5))), 'kirim (sisa)', (d2) => deliver(d2, soId, tries + 1));
}

async function invoice(d, soId) {
  const so = await call(F, 'GET', `/sales-orders/${soId}`, undefined, d);
  if (so.invoiceStatus !== 'to_invoice') return;
  const inv = await call(F, 'POST', `/invoices/from-sale/${soId}`, { date: d }, d);
  const e = await call(F, 'POST', `/invoices/${inv.id}/post`, undefined, d);
  count('invoice');
  if (chance(0.7)) await call(F, 'POST', `/invoices/${inv.id}/send`, {}, d).catch(() => {});
  const residual = Number(e.amountResidual);
  if (residual <= 0.5) return; // pelanggan baru: sudah lunas lewat uang muka
  const due = e.invoiceDateDue || d;
  const big = residual > 150e6;
  // beberapa invoice besar dicicil (paling banyak 6 jadwal)
  if (big && (stats['jadwal cicilan'] || 0) + planned < 6 && chance(0.35)) {
    planned++;
    return installments(d, e);
  }
  const r = rnd();
  if (r < 0.2) {
    // dibayar sebagian dulu, sisanya belakangan
    at(workday(addDays(due, -int(3, 10))), 'bayar sebagian', async (d2) => {
      const y = await call(F, 'GET', `/invoices/${inv.id}`, undefined, d2);
      const half = Math.min(Math.round(residual * 0.5), Number(y.amountResidual));
      if (half <= 0.5) return;
      await call(F, 'POST', '/payments', { invoiceId: inv.id, amount: half, method: 'BNK' }, d2);
      count('pembayaran invoice sebagian');
      at(workday(addDays(due, int(-2, 20))), 'pelunasan invoice', (d3) => payRest(d3, inv.id));
    });
  } else {
    // kebanyakan tepat waktu, sebagian dalam masa tenggang, sebagian terlambat lama
    const off = r < 0.6 ? -int(0, 8) : r < 0.8 ? int(1, 6) : r < 0.9 ? int(10, 30) : int(35, 75);
    at(workday(addDays(due, off)), 'pembayaran invoice', (d2) => payRest(d2, inv.id));
  }
  if (chance(0.4))
    at(workday(addDays(due, int(1, 3))), 'pengingat', async (d2) => {
      const x = await call(F, 'GET', `/invoices/${inv.id}`, undefined, d2);
      if (Number(x.amountResidual) > 0.5) await call(F, 'POST', `/invoices/${inv.id}/remind`, {}, d2).catch(() => {});
    });
}

async function payRest(d, invId) {
  const x = await call(F, 'GET', `/invoices/${invId}`, undefined, d);
  const left = Number(x.amountResidual);
  if (left <= 0.5) return;
  await call(F, 'POST', '/payments', { invoiceId: invId, amount: left, method: chance(0.9) ? 'BNK' : 'KAS' }, d);
  count('pembayaran invoice');
}

// cicilan 3 termin bulanan untuk invoice besar; tiap termin dibayar sekitar jatuh temponya
function installments(d, e) {
  at(workday(addDays(d, int(3, 7))), 'ajukan cicilan', async (d2) => {
    const x = await call(F, 'GET', `/invoices/${e.id}`, undefined, d2);
    const res = Number(x.amountResidual);
    const base = Math.floor((res / 3) * 100) / 100;
    const first = addDays(x.invoiceDateDue || d2, 0) > d2 ? x.invoiceDateDue : addDays(d2, 14);
    const termins = [0, 1, 2].map((i) => ({
      dateDue: addDays(first, i * 30),
      amount: i === 2 ? Math.round((res - 2 * base) * 100) / 100 : base,
    }));
    await call(F, 'POST', `/invoices/${e.id}/installments`, { termins, note: 'Kesepakatan cicilan 3 kali' }, d2);
    count('jadwal cicilan');
    at(workday(addDays(d2, 1)), 'setujui cicilan', async (d3) => {
      await call(F, 'POST', `/invoices/${e.id}/installments/approve`, undefined, d3);
      for (const t of termins)
        at(workday(addDays(t.dateDue, int(-3, 4))), 'bayar termin', async (d4) => {
          const y = await call(F, 'GET', `/invoices/${e.id}`, undefined, d4);
          const amt = Math.min(t.amount, Number(y.amountResidual));
          if (amt > 0.5) {
            await call(F, 'POST', '/payments', { invoiceId: e.id, amount: amt, method: 'BNK', memo: 'Cicilan' }, d4);
            count('pembayaran termin cicilan');
          }
        });
    });
  });
}

// retur pelanggan: kirim pengganti, nota kredit, atau potongan
async function customerReturn(d, pickingId, soId) {
  const ra = await call(O, 'GET', `/transfers/${pickingId}/returnable`, undefined, d);
  const l = ra.lines.find((x) => x.available > 0);
  if (!l) return;
  const qty = Math.max(1, Math.floor(l.available * 0.2));
  const res = l.qtyInvoiced >= qty ? pick(['ganti', 'ganti', 'nota_kredit', 'potongan']) : 'ganti';
  if (res === 'ganti' && ra.dropship) return;
  const r = await call(
    O,
    'POST',
    '/returns',
    {
      pickingId,
      reason: pick(['rusak', 'rusak', 'tidak_sesuai', 'salah_barang']),
      resolution: res,
      note: 'Dilaporkan pelanggan saat pemeriksaan barang',
      lines: [
        { moveId: l.moveId, quantity: qty, priceUnit: res === 'potongan' ? Math.round(l.netPrice * 0.1) : undefined },
      ],
    },
    d,
  );
  await call(res === 'ganti' ? O : F, 'POST', `/returns/${r.id}/process`, undefined, d);
  count(`retur pelanggan (${res})`);
  if (res === 'ganti') at(workday(addDays(d, int(1, 4))), 'kirim pengganti', (d2) => deliver(d2, soId, 0));
}

// ---------------------------------------------------------------- jadwal 90 hari
for (let d = START; d <= END; d = addDays(d, 1)) {
  if (weekend(d)) continue;
  const n = int(1, 4);
  for (let i = 0; i < n; i++) newQuote(d, pick(regular), false);
}
// pelanggan baru datang di bulan pertama, kedua, dan ketiga
NEWCOMERS.forEach(([name, city], i) => {
  const d = workday(addDays(START, 10 + i * 28));
  at(d, 'pelanggan baru', async (d2) => {
    const c = await call(
      A,
      'POST',
      '/partners',
      { kind: 'customer', name, city, email: `admin@${name.toLowerCase().replace(/[^a-z]+/g, '')}.co.id` },
      d2,
    );
    fresh.push(c);
    count('pelanggan baru');
    newQuote(d2, c, true);
    newQuote(addDays(d2, 12), c, true);
  });
});
// retur ke principal untuk barang rusak, dua minggu sebelum hari ini
at(workday(addDays(END, -14)), 'retur ke principal', async (d) => {
  for (const po of (await call(F, 'GET', '/purchase-orders', undefined, d)).filter((x) =>
    ['purchase', 'done'].includes(x.state),
  )) {
    const ra = await call(F, 'GET', `/purchase-orders/${po.id}/returnable`, undefined, d).catch(() => null);
    const l = ra?.lines.find((x) => x.available > 0);
    if (!l) continue;
    const res = l.invoiced - l.credited >= l.available ? pick(['ganti', 'nota_kredit']) : 'ganti';
    const r = await call(
      F,
      'POST',
      '/purchase-returns',
      {
        purchaseId: po.id,
        resolution: res,
        note: 'Klaim barang rusak dari pelanggan',
        lines: [{ purchaseLineId: l.purchaseLineId, quantity: l.available }],
      },
      d,
    );
    await call(res === 'ganti' ? O : F, 'POST', `/purchase-returns/${r.id}/process`, undefined, d);
    count(`retur ke principal (${res})`);
    if (res === 'ganti') {
      const x = await call(F, 'GET', `/purchase-returns/${r.id}`, undefined, d);
      at(workday(addDays(d, int(4, 9))), 'terima pengganti principal', async (d2) => {
        await call(O, 'POST', `/transfers/${x.receipt.id}/validate`, {}, d2);
        count('penerimaan pengganti principal');
      });
    }
  }
});

// ---------------------------------------------------------------- jalankan
console.log(`Data contoh ${START} sampai ${END}`);
let last = '';
while (queue.length) {
  queue.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.n - b.n));
  const ev = queue.shift();
  if (ev.day !== last && ev.day.endsWith('-01')) console.log(`  ${ev.day.slice(0, 7)} …`);
  last = ev.day;
  try {
    await ev.fn(ev.day);
  } catch (e) {
    warn.push(`${ev.day} ${ev.label}: ${e.message}`);
  }
}
console.log('\nRingkasan:');
for (const [k, v] of Object.entries(stats).sort()) console.log(`  ${k}: ${v}`);
if (warn.length) {
  console.log(`\n${warn.length} langkah dilewati (aturan bisnis menolak, data tetap konsisten):`);
  for (const w of warn.slice(0, 15)) console.log('  -', w);
}
