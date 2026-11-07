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

console.log(gagal ? `${gagal} gagal` : 'Validasi lulus');
process.exit(gagal ? 1 : 0);
