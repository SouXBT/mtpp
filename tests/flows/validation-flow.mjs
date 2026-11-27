// Validasi masukan: isian rusak ditolak dengan pesan jelas, kelonggaran lama tetap jalan.
// MENULIS DATA, hanya untuk lingkungan uji. Jalankan: API=http://localhost:8081/api node tests/flows/validation-flow.mjs
const API = process.env.API || 'http://localhost:8081/api';
const PASS = process.env.DEMO_PASSWORD || 'mtpp12345';
let gagal = 0;
const cek = (ok, m) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${m}`);
  if (!ok) gagal++;
};
const call = async (t, method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    j = text;
  }
  return { status: r.status, body: j };
};
const login = async (u) =>
  (await call('', 'POST', '/auth/login', { login: `${u}@mtpp.co.id`, password: PASS })).body.token;
const S = await login('sales');
const A = await login('admin');
const F = await login('finance');
const partner = (await call(S, 'GET', '/partners?kind=customer')).body[0];
const ditolak = async (t, method, path, body, pola, nama) => {
  const r = await call(t, method, path, body);
  cek(
    r.status === 400 && typeof r.body.message === 'string' && pola.test(r.body.message),
    `${nama} -> ${r.status} ${r.body.message}`,
  );
};

await ditolak(
  S,
  'POST',
  '/sales-orders',
  { partnerId: 'abc' },
  /partnerId harus berupa angka/,
  'partnerId bukan angka',
);
await ditolak(
  S,
  'POST',
  '/sales-orders',
  { partnerId: partner.id, lines: 'x' },
  /lines harus berupa daftar/,
  'lines bukan daftar',
);
await ditolak(
  S,
  'POST',
  '/sales-orders',
  { partnerId: partner.id, dateOrder: 'kemarin' },
  /dateOrder harus berupa tanggal/,
  'tanggal rusak',
);
await ditolak(
  S,
  'POST',
  '/sales-orders',
  { partnerId: partner.id, name: 123 },
  /name harus berupa teks/,
  'nama bukan teks',
);
await ditolak(
  F,
  'POST',
  '/payments',
  { invoiceId: 'abc', amount: 100 },
  /invoiceId harus berupa angka/,
  'invoiceId bukan angka',
);
await ditolak(
  A,
  'PATCH',
  `/partners/${partner.id}`,
  { paymentTermId: 'abc' },
  /harus berupa angka/,
  'kolom pelanggan salah tipe',
);
await ditolak(
  A,
  'POST',
  '/units',
  { name: 'Uji', relativeFactor: 'abc' },
  /harus berupa angka/,
  'kolom CRUD salah tipe',
);

await ditolak(
  S,
  'POST',
  '/sales-orders',
  { partnerId: partner.id, dateOrder: '2026-02-31' },
  /dateOrder harus berupa tanggal/,
  'tanggal yang tidak ada',
);
await ditolak(S, 'POST', '/sales-orders', { partnerId: 1.5 }, /partnerId harus berupa angka bulat/, 'ID desimal');
await ditolak(
  S,
  'POST',
  '/sales-orders',
  { partnerId: 99999999999 },
  /partnerId harus berupa angka bulat/,
  'ID terlalu besar',
);
await ditolak(S, 'PATCH', '/auth/profile', { name: null }, /name harus berupa teks/, 'nama profil null');
await ditolak(A, 'PATCH', '/users/1', { login: '' }, /login wajib diisi/, 'login kosong');
await ditolak(A, 'PATCH', '/users/1', { name: null }, /name wajib diisi/, 'nama pengguna null');
await ditolak(A, 'PATCH', `/partners/${partner.id}`, { name: '' }, /name wajib diisi/, 'nama pelanggan kosong');
const tanpaTop = await call(S, 'POST', '/sales-orders', { partnerId: partner.id, paymentTermId: '', lines: [] });
cek(
  tanpaTop.status === 201,
  `paymentTermId '' memakai bawaan pelanggan -> ${tanpaTop.status} ${tanpaTop.body.message || ''}`,
);

const longgar = await call(S, 'POST', '/sales-orders', {
  partnerId: String(partner.id),
  partnerShippingId: '',
  validityDate: '',
  kolomTakDikenal: 'diabaikan',
  lines: [],
});
cek(
  longgar.status === 201,
  `string angka, '' dan kolom tak dikenal tetap diterima -> ${longgar.status} ${longgar.body.message || ''}`,
);
cek(longgar.body.partnerShippingId === null, `'' menjadi kosong (${longgar.body.partnerShippingId})`);
const salah = await call(S, 'POST', '/sales-orders', { partnerId: 999999 });
cek(salah.status !== 500, `pelanggan tidak ada tetap pesan biasa -> ${salah.status}`);

// Harga produk butuh pelanggan: tanpa pelanggan yang sah harus pesan jelas, bukan galat server.
const produk = (await call(S, 'GET', '/products')).body[0];
for (const [q, ket] of [
  ['', 'tanpa pelanggan'],
  ['?partnerId=abc', 'pelanggan bukan angka'],
  ['?partnerId=1.5', 'pelanggan desimal'],
  ['?partnerId=99999999999', 'pelanggan di luar rentang'],
]) {
  const r = await call(S, 'GET', `/products/${produk.id}/price${q}`);
  cek(r.status === 400 && /pelanggan/i.test(r.body.message), `harga ${ket} -> ${r.status} ${r.body.message || ''}`);
}
const harga = await call(S, 'GET', `/products/${produk.id}/price?partnerId=${partner.id}&qty=2`);
cek(harga.status === 200 && typeof harga.body.priceUnit === 'number', `harga dengan pelanggan -> ${harga.status}`);
const tanpaData = await call(S, 'GET', `/products/${produk.id}/price?partnerId=999999`);
cek(tanpaData.status === 200, `pelanggan tidak terdaftar tetap harga daftar -> ${tanpaData.status}`);

// ---------- pengaman akuntansi (mengikuti validasi account.move Odoo) ----------
const akun = (await call(F, 'GET', '/accounts')).body;
const acc = (code) => akun.find((a) => a.code === code).id;
const entri = (lines, extra = {}) => call(F, 'POST', '/journal-entries', { lines, post: true, ...extra });
await ditolak(
  F,
  'POST',
  '/journal-entries',
  { post: true, lines: [{ accountId: acc('1-1200'), debit: 1000, credit: 1000 }] },
  /debit dan kredit sekaligus/,
  'baris berisi debit dan kredit sekaligus',
);
await ditolak(
  F,
  'POST',
  '/journal-entries',
  {
    post: true,
    lines: [
      { accountId: acc('1-1200'), debit: 0 },
      { accountId: acc('3-1000'), credit: 0 },
    ],
  },
  /bernilai nol/,
  'jurnal bernilai nol',
);
await ditolak(
  F,
  'POST',
  '/journal-entries',
  {
    post: true,
    lines: [
      { accountId: acc('1-1300'), debit: 5000 },
      { accountId: acc('4-2000'), credit: 5000 },
    ],
  },
  /hanya diisi lewat invoice, tagihan, atau pembayaran/,
  'jurnal manual ke akun piutang (akun kontrol)',
);
await ditolak(
  F,
  'POST',
  '/journal-entries',
  {
    post: true,
    lines: [
      { accountId: acc('1-1200'), debit: 5000 },
      { accountId: acc('3-1000'), credit: 4000 },
    ],
  },
  /tidak seimbang/,
  'jurnal tidak seimbang',
);
const ok1 = await entri([
  { accountId: acc('1-1200'), debit: 7000, name: 'Uji setoran' },
  { accountId: acc('3-1000'), credit: 7000, name: 'Uji setoran' },
]);
cek(ok1.status === 201 && ok1.body.state === 'posted', `jurnal seimbang diposting -> ${ok1.status}`);
const rv1 = await call(F, 'POST', `/journal-entries/${ok1.body.id}/reverse`);
cek(rv1.status === 201, `jurnal dibalik -> ${rv1.status} ${rv1.body.message || ''}`);
await ditolak(
  F,
  'POST',
  `/journal-entries/${ok1.body.id}/reverse`,
  undefined,
  /sudah dibalik/,
  'jurnal dibalik dua kali',
);
await ditolak(
  F,
  'POST',
  `/journal-entries/${rv1.body.id}/reverse`,
  undefined,
  /jurnal pembalik/,
  'jurnal pembalik dibalik lagi',
);
// akun yang diarsipkan
const kode = `9-${String(Date.now()).slice(-4)}`;
const arsip = await call(F, 'POST', '/accounts', { code: kode, name: 'Akun uji arsip', accountType: 'expense' });
cek(arsip.status === 201, `akun uji dibuat -> ${arsip.status} ${arsip.body.message || ''}`);
await call(F, 'PATCH', `/accounts/${arsip.body.id}`, { active: false });
await ditolak(
  F,
  'POST',
  '/journal-entries',
  {
    post: true,
    lines: [
      { accountId: arsip.body.id, debit: 1000 },
      { accountId: acc('1-1200'), credit: 1000 },
    ],
  },
  /diarsipkan/,
  'akun yang diarsipkan',
);
await ditolak(
  F,
  'POST',
  '/journal-entries',
  { post: true, lines: [{ debit: 1000 }, { accountId: acc('1-1200'), credit: 1000 }] },
  /wajib memiliki akun/,
  'baris jurnal tanpa akun',
);
// kunci periode
await ditolak(F, 'PUT', '/settings/lock_date', { date: '2999-01-01' }, /masa depan/, 'tanggal kunci di masa depan');
const kunci = await call(F, 'PUT', '/settings/lock_date', { date: '2020-01-31' });
cek(kunci.status === 200 && kunci.body.date === '2020-01-31', `periode dikunci sampai 2020-01-31 -> ${kunci.status}`);
await ditolak(
  F,
  'POST',
  '/journal-entries',
  {
    post: true,
    date: '2020-01-15',
    lines: [
      { accountId: acc('1-1200'), debit: 1000 },
      { accountId: acc('3-1000'), credit: 1000 },
    ],
  },
  /sudah dikunci/,
  'jurnal di periode terkunci',
);
const sesudah = await entri(
  [
    { accountId: acc('1-1200'), debit: 1000 },
    { accountId: acc('3-1000'), credit: 1000 },
  ],
  { date: '2020-02-03', post: false },
);
cek(sesudah.status === 201, `jurnal draf setelah tanggal kunci tetap boleh -> ${sesudah.status}`);
await ditolak(
  F,
  'PUT',
  '/settings/lock_date',
  { date: '2020-02-29' },
  /masih ada dokumen draf/i,
  'kunci periode yang masih punya draf',
);
await call(F, 'DELETE', `/journal-entries/${sesudah.body.id}`);
const buka = await call(F, 'PUT', '/settings/lock_date', { date: null });
cek(buka.status === 200 && buka.body.date === null, `kunci periode dibuka -> ${buka.status}`);
// pencocokan mutasi bank yang tidak ada
const mut = await call(F, 'POST', '/bank-statements/999999/match', { paymentId: 1 });
cek(mut.status === 404 || mut.status === 400, `mutasi bank yang tidak ada ditolak -> ${mut.status}`);

console.log(gagal ? `${gagal} gagal` : 'Validasi lulus');
process.exit(gagal ? 1 : 0);
