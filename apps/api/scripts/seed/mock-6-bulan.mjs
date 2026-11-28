// Data contoh transaksi 6 bulan ke belakang (180 hari sampai hari ini), bertanggal sesuai harinya, dengan pembukuan
// yang masuk akal untuk distributor sekelas MTPP:
//   - saldo awal modal di bank dan kas (impor saldo awal, sehari sebelum periode);
//   - sekitar 3-6 penawaran per minggu ditambah pesanan proyek rutin, omzet beberapa miliar per bulan;
//   - stok selalu datang dari pembelian: PO karena kekurangan SO dan isi ulang stok minimum tiap Senin,
//     lalu penerimaan, tagihan principal, dan pembayaran (uang muka 30% sebelum PO dikonfirmasi);
//   - pelanggan lama dengan termin, masa tenggang, cicilan, pengingat, dan izin kirim Pimpinan;
//     pelanggan baru dengan proforma, DP, dan pelunasan sebelum kirim;
//   - beban operasional bulanan (gaji, sewa, listrik, transportasi, ATK, administrasi bank);
//   - setoran PPN masa tiap tanggal 15 bulan berikutnya (PPN Keluaran dikurangi PPN Masukan);
//   - di akhir: semua stok di atas batas minimum lewat PO yang diterima, dan periode sampai akhir bulan lalu dikunci.
//
// Syarat: stack uji (-p mtpp-nav, MOCK_DATE_HEADER=true) dengan database baru, lalu katalog tanpa transaksi contoh:
//   API=http://localhost:8081/api KATALOG_SAJA=1 node apps/api/scripts/seed/mock-data.mjs
//   API=http://localhost:8081/api node apps/api/scripts/seed/mock-6-bulan.mjs
// Setiap request membawa header x-mock-date sehingga nomor dan tanggal dokumen mengikuti hari simulasi.
// Skrip menulis data dan menolak berjalan dua kali. Jangan dijalankan pada database utama (:8080).
const API = process.env.API || 'http://localhost:8081/api';
const PASS = process.env.DEMO_PASSWORD || 'mtpp12345';
const DAYS = Number(process.env.DAYS || 180);
const MARK = 'M6-'; // awalan PO pelanggan, penanda data skrip ini

// ---------------------------------------------------------------- dasar
let seed = 20261128;
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

// PO principal wajib uang muka (Pengaturan → Syarat PO, bawaan 30%) sebelum dikonfirmasi
async function payDp(token, poId, day) {
  const po = await call(token, 'GET', `/purchase-orders/${poId}`, undefined, day);
  if (po.dp?.due > 0.5)
    await call(
      token,
      'POST',
      '/payments',
      { purchaseId: poId, amount: po.dp.due, kind: 'dp', method: 'BNK', memo: `Uang muka ${po.name}` },
      day,
    );
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
  console.error('Data contoh 6 bulan sudah pernah dimuat pada database ini.');
  process.exit(1);
}

// ---------------------------------------------------------------- saldo awal: modal disetor di bank dan kas
// sehari sebelum periode; persediaan awal (stok dari katalog) tidak dinilai karena persediaan memakai metode periodik
const MODAL_BANK = Number(process.env.MODAL_BANK || 25e9),
  MODAL_KAS = Number(process.env.MODAL_KAS || 150e6);
{
  const opening = addDays(START, -1);
  const csv = [
    'account,debit,credit,date',
    `1-1200,${MODAL_BANK},0,${opening}`,
    `1-1100,${MODAL_KAS},0,${opening}`,
    `3-1000,0,${MODAL_BANK + MODAL_KAS},${opening}`,
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'opening_balance.csv');
  const r = await fetch(`${API}/import/opening_balance`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${A}`, 'x-mock-date': opening },
    body: form,
  });
  const j = await r.json();
  if (!r.ok || j.errors?.length) {
    console.error('Saldo awal gagal diimpor:', JSON.stringify(j.errors ?? j));
    process.exit(1);
  }
}

// ---------------------------------------------------------------- penjadwal hari demi hari
const queue = [];
const at = (day, label, fn) => {
  if (day > END) return; // jatuh setelah hari ini: dibiarkan terbuka, seperti keadaan nyata
  queue.push({ day: day < START ? START : day, label, fn, n: queue.length });
};
// PPN per masa (bulan): keluaran dari invoice yang diposting, masukan dari tagihan principal yang diposting
const VAT = {};
const vat = (d, k, amt) => {
  const m = d.slice(0, 7);
  VAT[m] = VAT[m] || { out: 0, in: 0 };
  VAT[m][k] = Math.round((VAT[m][k] + amt) * 100) / 100;
};
const stats = {};
const count = (k) => (stats[k] = (stats[k] || 0) + 1);
const warn = [];

// ---------------------------------------------------------------- master: pelanggan lama tambahan dan pelanggan baru
const terms = await call(P, 'GET', '/payment-terms');
const top = (days) => terms.find((t) => Number(t.days) === days) || terms.find((t) => Number(t.days) > 0);
// [nama, kota, termin (hari), masa tenggang (hari), NPWP]
const FINANCE = {
  PJD: ['PT Pembangkit Jawa Daya', 'Gresik', 30, 7, '01.234.567.8-901.000'],
  IBN: ['PT Industri Baja Nusantara', 'Sidoarjo', 45, 10, '02.345.678.9-012.000'],
  ELK: ['CV Elektrindo Makmur', 'Surabaya', 14, 5, ''],
};
const REGULAR = [
  ...Object.values(FINANCE),
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
  ['PT Anugerah Pangan Lestari', 'Probolinggo'],
  ['CV Bintang Timur Elektrik', 'Jombang'],
];
const regular = [];
for (const [name, city, days, grace, vat] of REGULAR) {
  const c = await call(
    A,
    'POST',
    '/partners',
    {
      kind: 'customer',
      name,
      city,
      vat: vat || undefined,
      email: `keuangan@${name.toLowerCase().replace(/[^a-z]+/g, '')}.co.id`,
    },
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
// kuantitas wajar per baris: barang mahal satu unit, kabel per puluhan meter, komponen kecil beberapa buah
const qtyFor = (p) => {
  const price = Number(p.listPrice);
  if (p.uom === 'Meter' || /^KBL-/.test(p.code)) return 50 * int(1, 6);
  return price > 100e6 ? 1 : price > 20e6 ? int(1, 2) : price > 2e6 ? int(1, 4) : int(5, 30);
};
// barang di atas Rp 300 juta jarang dipesan; kebanyakan pesanan berisi panel, meter, kabel, dan komponen
const weighted = () => {
  for (;;) {
    const p = pick(stockItems);
    if (Number(p.listPrice) <= 300e6 || chance(0.15)) return p;
  }
};
const orderLines = () => {
  const n = int(1, 3);
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = chance(0.05) && dropItems.length ? pick(dropItems) : weighted();
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

// nomor PO dari pelanggan; pelanggan lama wajib mengirim PO sebelum pesanan dikonfirmasi
// nomor urut, bukan acak, supaya urutan acak data contoh tidak bergeser
let poSeq = 0;
const custPo = (d) => `PO-${d.slice(2, 4)}${d.slice(5, 7)}-${String(++poSeq).padStart(4, '0')}`;

async function confirmOrder(d, id, cust, isNew) {
  await call(S, 'POST', `/sales-orders/${id}/confirm`, { clientOrderRef: custPo(d) }, d);
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
  for (const po of Array.isArray(pos) ? pos : [pos]) await processPO(d, po, soId, 'PO principal');
}

// isi ulang stok minimum tiap Senin (Finance): PO per principal sampai 2x batas minimum
async function replenish(d, arriveDays = [3, 10]) {
  let pos;
  try {
    pos = await call(F, 'POST', '/purchase-orders/replenish', undefined, d);
  } catch (e) {
    if (/tidak ada yang perlu dipesan/.test(e.msg)) return [];
    throw e;
  }
  for (const po of pos) await processPO(d, po, null, 'PO isi ulang stok', arriveDays);
  return pos;
}

// kirim, uang muka 30%, konfirmasi, penerimaan, tagihan, dan pembayaran satu PO
async function processPO(d, po, soId, label, arriveDays = [3, 12]) {
  {
    await call(F, 'POST', `/purchase-orders/${po.id}/send`, {}, d);
    await payDp(F, po.id, d);
    await call(F, 'POST', `/purchase-orders/${po.id}/confirm`, undefined, d);
    count(label);
    const arrive = arriveDays[1] === 0 ? d : workday(addDays(d, int(arriveDays[0], arriveDays[1])));
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
          if (soId) at(workday(addDays(d2, int(0, 2))), 'invoice', (d3) => invoice(d3, soId));
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
            { ref: `INV-${po.name.split('/').slice(-3).join('')}`, date: d3 },
            d3,
          );
          const pb = await call(F, 'POST', `/invoices/${b.id}/post`, undefined, d3);
          vat(d3, 'in', Number(pb.amountTax));
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
  let so = await call(O, 'GET', `/sales-orders/${soId}`, undefined, d);
  if (so.state !== 'sale') return;
  // pelanggan lama: uang muka minimal (30%, Pengaturan > Penagihan) ditransfer sebelum barang dikirim
  if (!so.partner?.mtppIsNewCustomer && so.payment?.dpMet === false) {
    const short = Math.ceil((so.payment.dpNeeded - so.payment.amount) * 100) / 100;
    await call(
      F,
      'POST',
      '/payments',
      { saleId: soId, amount: short, kind: 'dp', method: 'BNK', memo: `Uang muka ${so.payment.dpPercent}%` },
      d,
    );
    count('uang muka pelanggan lama');
    so = await call(O, 'GET', `/sales-orders/${soId}`, undefined, d);
  }
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
      count('surat jalan');
      any = true;
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
  vat(d, 'out', Number(e.amountTax));
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
      at(workday(addDays(due, -int(0, 2))), 'pelunasan invoice', (d3) => payRest(d3, inv.id));
    });
  } else {
    // semua pelanggan membayar paling lambat pada jatuh tempo: tidak ada yang menunggak
    const off = -int(0, 8);
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
  // pembayaran pelanggan lewat transfer bank; tunai hanya untuk tagihan kecil
  const method = left < 15e6 && chance(0.5) ? 'KAS' : 'BNK';
  await call(F, 'POST', '/payments', { invoiceId: invId, amount: left, method }, d);
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
        at(workday(addDays(t.dateDue, -int(0, 3))), 'bayar termin', async (d4) => {
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

// ---------------------------------------------------------------- pesanan proyek dari MTPP Finance
const byCode = (code) => {
  const p = products.find((x) => x.code === code);
  if (!p) throw new Error(`produk ${code} tidak ada`);
  return p;
};
const customer = (key) => regular.find((c) => c.name === FINANCE[key][0]);
// pesanan pasti jadi: penawaran dikirim, dikonfirmasi 1-3 hari kemudian; dp = persen uang muka sebelum kirim
function projectOrder(day, key, project, lines, dp) {
  at(day, `pesanan ${project}`, async (d) => {
    const cust = customer(key);
    const ref = `${MARK}PO-${String(++refNo).padStart(4, '0')}`;
    const q = await call(
      S,
      'POST',
      '/sales-orders',
      {
        partnerId: cust.id,
        clientOrderRef: `${ref} ${project}`,
        lines: lines.map(([code, qty]) => ({ productId: byCode(code).id, productUomQty: qty })),
      },
      d,
    );
    count('penawaran');
    count('pesanan proyek');
    await call(S, 'POST', `/sales-orders/${q.id}/send`, {}, d);
    at(workday(addDays(d, int(1, 3))), 'konfirmasi proyek', async (d2) => {
      if (!dp) return confirmOrder(d2, q.id, cust, false);
      // seperti jurnal MTPP Finance "DP 30% PO cubicle IBN (uang muka pelanggan)"
      await call(S, 'POST', `/sales-orders/${q.id}/confirm`, { clientOrderRef: custPo(d2) }, d2);
      count('sales order');
      const so = await call(F, 'GET', `/sales-orders/${q.id}`, undefined, d2);
      if ((so.shortage || []).some((x) => x.shortage > 0))
        at(workday(addDays(d2, int(0, 2))), 'PO principal', (d3) => purchaseFor(d3, q.id));
      const settle = addDays(d2, 30);
      await call(F, 'POST', `/sales-orders/${q.id}/proforma`, { mode: 'persen', percent: dp, settleDate: settle }, d2);
      at(workday(addDays(d2, int(2, 5))), 'DP proyek', async (d3) => {
        await call(
          F,
          'POST',
          '/payments',
          {
            saleId: q.id,
            amount: Math.round(Number(so.amountTotal) * dp) / 100,
            kind: 'dp',
            settleDate: settle,
            method: 'BNK',
            memo: `DP ${dp}% ${project}`,
          },
          d3,
        );
        count('pembayaran DP');
        at(workday(addDays(d3, int(1, 3))), 'kirim', (d4) => deliver(d4, q.id, 0));
      });
    });
  });
}
// trafo untuk Gardu PJD Unit 3 sekitar tanggal 12 tiap bulan (MTPP Finance: penjualan trafo PJD bulanan)
const PJD_LINES = [
  [
    ['TRF-OIL-400', 2],
    ['TRF-BUCHHOLZ', 2],
    ['TRF-BREATHER', 2],
  ],
  [
    ['TRF-OIL-630', 1],
    ['TRF-OIL-400', 1],
  ],
  [
    ['TRF-OIL-800', 1],
    ['TRF-BUCHHOLZ', 1],
  ],
];
// suku cadang Maintenance Elektrindo sekitar tanggal 18 tiap bulan (MTPP Finance: jasa pemeliharaan bulanan)
const ELK_LINES = [
  ['MCB-IC60', 20],
  ['KTR-TESYS-D', 6],
  ['SPD-IPRD', 2],
  ['MTR-IEM3100', 4],
];
for (let m = START.slice(0, 7), i = 0; m <= END.slice(0, 7); i++) {
  const pjd = workday(`${m}-12`),
    elk = workday(`${m}-18`);
  // trafo PJD tiap dua bulan, suku cadang Elektrindo tiap bulan
  if (pjd >= START && i % 2 === 0) projectOrder(pjd, 'PJD', 'Gardu PJD Unit 3', PJD_LINES[(i / 2) % PJD_LINES.length]);
  if (elk >= START) projectOrder(elk, 'ELK', 'Maintenance Elektrindo', ELK_LINES);
  m = addDays(`${m}-01`, 32).slice(0, 7);
}
// cubicle untuk IBN Line B, satu pesanan besar dengan DP 30% (MTPP Finance: DP 300 juta)
projectOrder(
  workday(addDays(START, 20)),
  'IBN',
  'Cubicle IBN Line B',
  [
    ['CUB-SM6-IM', 2],
    ['CUB-SM6-QM', 2],
    ['CUB-SM6-DM1A', 1],
    ['CUB-RM6', 1],
  ],
  30,
);

// ---------------------------------------------------------------- beban operasional bulanan dari MTPP Finance
// akun yang belum ada di bagan akun ditambahkan; dibayar lewat bank pada tanggalnya
const accounts = await call(F, 'GET', '/accounts');
const account = async (code, name) => {
  const a = accounts.find((x) => x.code === code);
  if (a) return a.id;
  const n = await call(F, 'POST', '/accounts', { code, name, accountType: 'expense' });
  accounts.push(n);
  return n.id;
};
const accId = (code) => {
  const a = accounts.find((x) => x.code === code);
  if (!a) throw new Error(`akun ${code} tidak ada`);
  return a.id;
};
const GAJI = await account('6-1000', 'Beban Gaji');
const SEWA = await account('6-3000', 'Beban Sewa');
const BANKFEE = await account('6-4000', 'Beban Administrasi Bank');
const TRANS = await account('6-5000', 'Beban Transportasi & Perjalanan');
const ATK = await account('6-6000', 'Beban Kantor & ATK');
const UTIL = await account('6-7000', 'Beban Listrik, Air & Komunikasi');
const KIRIM = await account('6-2000', 'Beban Pengiriman');
// [tanggal, akun, nilai (rupiah, sudah bulat), keterangan]
const OPEX = [
  [5, SEWA, () => 15e6, 'Sewa kantor dan gudang transit'],
  [10, UTIL, () => int(38, 52) * 1e5, 'Listrik, air, telepon, internet'],
  [15, ATK, () => int(18, 35) * 1e5, 'Keperluan kantor dan ATK'],
  [20, TRANS, () => int(55, 95) * 1e5, 'Transportasi dan perjalanan dinas'],
  [22, KIRIM, () => int(60, 140) * 1e5, 'Ongkos kirim barang ke pelanggan'],
  [25, GAJI, () => 86e6, 'Gaji karyawan'],
  [28, BANKFEE, () => int(35, 60) * 1e4, 'Biaya administrasi bank'],
];
const bankAcc = accId('1-1200');
const kasAcc = accId('1-1100');
// ATK dan transportasi dibayar dari kas kecil, sisanya lewat bank
const PETTY = new Set([ATK, TRANS]);
const months = [];
for (let m = START.slice(0, 7); m <= END.slice(0, 7); m = addDays(`${m}-01`, 32).slice(0, 7)) months.push(m);
for (const m of months)
  for (const [dd, acc, amt, name] of OPEX) {
    const day = workday(`${m}-${String(dd).padStart(2, '0')}`);
    if (day < START || day > END) continue;
    at(day, 'beban operasional', async (d) => {
      const v = amt();
      await call(
        F,
        'POST',
        '/journal-entries',
        {
          date: d,
          ref: `${name} ${m}`,
          post: true,
          lines: [
            { accountId: acc, debit: v, name },
            { accountId: PETTY.has(acc) ? kasAcc : bankAcc, credit: v, name },
          ],
        },
        d,
      );
      count('jurnal beban operasional');
    });
  }

// setor PPN masa: tanggal 15 bulan berikutnya, PPN Keluaran dikurangi PPN Masukan; lebih bayar dikompensasikan
let vatCarry = 0;
for (const m of months) {
  const day = workday(`${addDays(`${m}-01`, 32).slice(0, 7)}-15`);
  if (day > END) continue;
  at(day, 'setor PPN', async (d) => {
    const v = VAT[m] || { out: 0, in: 0 };
    const credit = Math.round((v.in + vatCarry) * 100) / 100;
    const due = Math.round((v.out - credit) * 100) / 100;
    if (v.out <= 0) {
      vatCarry = credit;
      return;
    }
    const used = due > 0 ? credit : v.out; // masukan yang dikreditkan pada masa ini
    vatCarry = due > 0 ? 0 : Math.round((credit - v.out) * 100) / 100;
    const lines = [{ accountId: accId('2-1300'), debit: v.out, name: `PPN Keluaran masa ${m}` }];
    if (used > 0) lines.push({ accountId: accId('1-1400'), credit: used, name: `PPN Masukan masa ${m}` });
    if (due > 0) lines.push({ accountId: bankAcc, credit: due, name: `Setor PPN masa ${m}` });
    await call(F, 'POST', '/journal-entries', { date: d, ref: `Setor PPN masa ${m}`, post: true, lines }, d);
    count(due > 0 ? 'setor PPN' : 'PPN lebih bayar dikompensasikan');
  });
}

// isi ulang stok minimum tiap Senin
for (let d = START; d <= END; d = addDays(d, 1))
  if (new Date(d + 'T00:00:00Z').getUTCDay() === 1) at(d, 'isi ulang stok', (d2) => replenish(d2));

// ---------------------------------------------------------------- jadwal penawaran 180 hari
for (let d = START; d <= END; d = addDays(d, 1)) {
  if (weekend(d)) continue;
  // sekitar 3-6 penawaran per minggu, sedikit naik menjelang akhir tahun
  const busy = d.slice(5, 7) >= '10' ? 0.1 : 0;
  const n = chance(0.5 + busy) ? (chance(0.18) ? 2 : 1) : 0;
  for (let i = 0; i < n; i++) newQuote(d, pick(regular), false);
}
// pelanggan baru datang tersebar selama enam bulan
NEWCOMERS.forEach(([name, city], i) => {
  const d = workday(addDays(START, 15 + i * Math.floor(DAYS / (NEWCOMERS.length + 1))));
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
// ---------------------------------------------------------------- akhir periode
// isi ulang terakhir pada hari ini, barang diterima hari ini juga, sehingga semua stok di atas batas minimum
await (async () => {
  try {
    // barang PO yang masih dalam perjalanan datang hari ini
    for (const t of (await call(O, 'GET', '/transfers?kind=incoming', undefined, END)).filter(
      (x) => !['done', 'cancel'].includes(x.state) && !x.dropship,
    )) {
      try {
        await call(O, 'POST', `/transfers/${t.id}/validate`, {}, END);
        count('penerimaan barang');
      } catch (e) {
        warn.push(`${END} penerimaan ${t.name}: ${e.msg}`);
      }
    }
    const pos = await replenish(END, [0, 0]);
    // penerimaan dan tagihan yang baru dijadwalkan dijalankan sekarang (hari ini)
    while (queue.length) {
      queue.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.n - b.n));
      const ev = queue.shift();
      if (ev.day > END) continue;
      try {
        await ev.fn(ev.day);
      } catch (e) {
        warn.push(`${ev.day} ${ev.label}: ${e.message}`);
      }
    }
    if (pos.length) stats['PO isi ulang akhir periode'] = pos.length;
  } catch (e) {
    warn.push(`isi ulang akhir: ${e.message}`);
  }
  // semua invoice pelanggan dan tagihan principal yang masih terbuka dilunasi hari ini: tidak ada yang menunggak
  for (const type of ['out', 'bill']) {
    const open = await call(
      F,
      'GET',
      `/invoices?type=${type}&state=posted&paymentState=not_paid,partial`,
      undefined,
      END,
    );
    for (const x of open) {
      const e = x.e || x;
      if (!['out_invoice', 'in_invoice'].includes(e.moveType)) continue;
      try {
        if (e.moveType === 'out_invoice') await payRest(END, e.id);
        else {
          const y = await call(F, 'GET', `/invoices/${e.id}`, undefined, END);
          const left = Number(y.amountResidual);
          if (left > 0.5) {
            await call(F, 'POST', '/payments', { invoiceId: e.id, amount: left, method: 'BNK' }, END);
            count('pembayaran principal');
          }
        }
      } catch (err) {
        warn.push(`${END} pelunasan ${e.name}: ${err.msg || err.message}`);
      }
    }
  }
  const after = await call(O, 'GET', '/stock', undefined, END);
  const notSafe = after.filter((r) => r.minQty != null && r.status !== 'aman');
  if (notSafe.length) warn.push(`stok belum aman: ${notSafe.map((r) => `${r.code} (${r.status})`).join(', ')}`);
  else stats['stok aman (produk dengan stok minimum)'] = after.filter((r) => r.minQty != null).length;
  // kunci periode sampai akhir bulan lalu: bulan berjalan tetap terbuka untuk koreksi
  const lock = addDays(`${END.slice(0, 7)}-01`, -1);
  try {
    await call(F, 'PUT', '/settings/lock_date', { date: lock }, END);
    stats[`periode dikunci sampai`] = lock;
  } catch (e) {
    warn.push(`kunci periode: ${e.message}`);
  }
})();

// enam pelanggan baru tanpa transaksi, siap dipakai mencoba alur proforma, uang muka, dan pelunasan
for (const [name, city] of [
  ['PT Cahaya Energi Madura', 'Bangkalan'],
  ['CV Mitra Listrik Kediri', 'Kediri'],
  ['PT Sentosa Baja Gresik', 'Gresik'],
  ['CV Prima Daya Malang', 'Malang'],
  ['PT Samudra Logistik Tuban', 'Tuban'],
  ['CV Terang Abadi Mojokerto', 'Mojokerto'],
]) {
  try {
    await call(
      A,
      'POST',
      '/partners',
      { kind: 'customer', name, city, email: `admin@${name.toLowerCase().replace(/[^a-z]+/g, '')}.co.id` },
      END,
    );
    count('pelanggan baru tanpa transaksi');
  } catch (e) {
    warn.push(`pelanggan ${name}: ${e.msg || e.message}`);
  }
}

console.log('\nRingkasan:');
for (const [k, v] of Object.entries(stats).sort()) console.log(`  ${k}: ${v}`);
if (warn.length) {
  console.log(`\n${warn.length} langkah dilewati (aturan bisnis menolak, data tetap konsisten):`);
  for (const w of warn.slice(0, 15)) console.log('  -', w);
}
