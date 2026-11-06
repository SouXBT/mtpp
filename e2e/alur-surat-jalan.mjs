// Alur Buat Surat Jalan di Siap Dikirim, dengan klik sungguhan. MENULIS DATA: hanya untuk instance uji mtpp-nav (8081).
// Pakai: node e2e/alur-surat-jalan.mjs   (BASE bawaan http://localhost:8081; keluar dengan kode 1 bila ada yang gagal)
// Jalankan setelah apps/api/scripts/demo-flow.mjs pada database bersih.
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://localhost:8081').replace(/\/$/, '');
if (new URL(BASE).port !== '8081') {
  console.error(`Ditolak: skrip ini menulis data dan hanya boleh berjalan pada port 8081 (BASE=${BASE})`);
  process.exit(2);
}
const SANDI = 'mtpp12345';
let gagal = 0;
const cek = (ok, pesan) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${pesan}`);
  if (!ok) gagal++;
};

const login = async (akun) =>
  (
    await (
      await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: akun, password: SANDI }),
      })
    ).json()
  ).token;
const tokS = await login('sales@mtpp.co.id'),
  tokO = await login('operasional@mtpp.co.id');
const api = async (tok, method, path, body) => {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
  return j;
};
const pelanggan = (await api(tokS, 'GET', '/partners?kind=customer')).find((c) => !c.mtppIsNewCustomer);
const produk = (await api(tokS, 'GET', '/products')).find((p) => p.code === 'KBL-NYY-4X50');
const buatSO = async () => {
  const q = await api(tokS, 'POST', '/sales-orders', {
    partnerId: pelanggan.id,
    lines: [{ productId: produk.id, productUomQty: 1 }],
  });
  await api(tokS, 'POST', `/sales-orders/${q.id}/confirm`, {});
  return api(tokS, 'GET', `/sales-orders/${q.id}`);
};
const dokumenSO = async (so) =>
  (await api(tokO, 'GET', '/transfers?kind=outgoing')).filter((t) => t.origin === so.name);

const a = await buatSO(),
  b = await buatSO(),
  c = await buatSO();
const siap = await api(tokS, 'GET', '/sales-orders/worklist/ready');
cek(
  [a, b, c].every((x) => siap.some((s) => s.id === x.id)),
  'tiga SO uji muncul di daftar Siap Dikirim',
);

const browser = await chromium.launch();
const masuk = async (akun) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input').first().fill(akun);
  await page.locator('input[type=password]').fill(SANDI);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  return page;
};
const buka = async (page) => {
  await page.goto(`${BASE}/stok/siap-dikirim`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
};
const baris = (page, so) => page.locator('tr', { hasText: so.name });
try {
  const page = await masuk('operasional@mtpp.co.id');
  const posts = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/transfers/from-sale/')) posts.push(r.url());
  });

  console.log('Operasional: satu klik');
  await buka(page);
  cek(
    await page
      .getByText(
        'Sales order yang stok bebasnya tersedia dan belum dibuatkan surat jalan. Pelanggan baru tampil setelah lunas.',
        { exact: true },
      )
      .isVisible()
      .catch(() => false),
    'teks sub halaman terbaru',
  );
  const tombolA = baris(page, a).getByRole('button', { name: 'Buat Surat Jalan' });
  cek(await tombolA.isVisible().catch(() => false), 'baris SO punya tombol Buat Surat Jalan');
  await tombolA.click();
  await page.waitForURL(/\/stok\/dok\/\d+$/, { timeout: 10000 }).catch(() => {});
  cek(/\/stok\/dok\/\d+$/.test(page.url()), `surat jalan terbuka (${new URL(page.url()).pathname})`);
  cek((await dokumenSO(a)).length === 1, 'tepat satu dokumen untuk SO pertama');

  console.log('Operasional: klik ganda (POST diperlambat, kunci diuji)');
  posts.length = 0;
  await buka(page);
  await page.route('**/transfers/from-sale/*', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const tombolB = baris(page, b).getByRole('button', { name: 'Buat Surat Jalan' });
  await tombolB.click({ force: true });
  cek(await tombolB.isDisabled(), 'tombol nonaktif selama permintaan berjalan');
  // lepaskan atribut disabled agar klik kedua benar-benar sampai ke penanganan, sehingga yang diuji adalah kuncinya
  await tombolB.evaluate((el) => el.removeAttribute('disabled'));
  await tombolB.click({ force: true });
  await page.waitForTimeout(300); // klik kedua ditahan kunci tanpa pesan, sama seperti tombol PO
  await page.waitForURL(/\/stok\/dok\/\d+$/, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  cek(posts.length === 1, `tepat satu POST (${posts.length})`);
  cek((await dokumenSO(b)).length === 1, 'tepat satu dokumen untuk SO kedua');
  await page.unroute('**/transfers/from-sale/*');

  console.log('Operasional: tab basi');
  await buka(page);
  await api(tokO, 'POST', `/transfers/from-sale/${c.id}`); // dibuatkan dari tab lain setelah daftar dimuat
  posts.length = 0;
  await baris(page, c).getByRole('button', { name: 'Buat Surat Jalan' }).click();
  const pesan = page.locator('.ant-message-notice').filter({ hasText: 'Tidak ada sisa barang yang perlu dikirim' });
  cek(
    await pesan
      .first()
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false),
    'pesan server tampil',
  );
  await page.waitForTimeout(1000);
  cek(posts.length === 1, `satu POST (${posts.length})`);
  cek((await dokumenSO(c)).length === 1, 'tidak ada dokumen ganda untuk SO basi');
  cek((await baris(page, c).count()) === 0, 'daftar diperbarui, SO basi hilang');
  cek(!/\/stok\/dok\//.test(page.url()), 'tetap di halaman daftar');
  console.log('Detail SO');
  const baru = (await api(tokS, 'GET', '/partners?kind=customer')).find((x) => x.mtppIsNewCustomer);
  const qn = await api(tokS, 'POST', '/sales-orders', {
    partnerId: baru.id,
    lines: [{ productId: produk.id, productUomQty: 1 }],
  });
  await api(tokS, 'POST', `/sales-orders/${qn.id}/confirm`, {});
  await page.goto(`${BASE}/penjualan/${qn.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const tn = page.getByRole('button', { name: 'Buat Surat Jalan' });
  cek((await tn.count()) === 1 && (await tn.isDisabled()), 'pelanggan baru belum lunas: tombol nonaktif');
  cek((await tn.getAttribute('title')) === 'Pelanggan baru harus melunasi sales order', 'tooltip alasan tampil');
  const e = await buatSO();
  await page.goto(`${BASE}/penjualan/${e.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: 'Buat Surat Jalan' }).click();
  await page.waitForURL(/\/stok\/dok\/\d+$/, { timeout: 10000 }).catch(() => {});
  cek(
    /\/stok\/dok\/\d+$/.test(page.url()) && (await dokumenSO(e)).length === 1,
    'SO biasa: satu klik membuka surat jalan',
  );
  await page.context().close();

  console.log('Sales: tanpa tombol');
  const d = await buatSO();
  const ps = await masuk('sales@mtpp.co.id');
  await buka(ps);
  cek((await baris(ps, d).count()) === 1, 'Sales melihat SO di daftar');
  cek((await ps.getByRole('button', { name: 'Buat Surat Jalan' }).count()) === 0, 'Sales tidak melihat tombol');
} catch (e) {
  gagal++;
  console.log(`  ✗ galat: ${e.message.slice(0, 400)}`);
}
await browser.close();
console.log(gagal ? `\nGAGAL: ${gagal}` : '\nSemua lulus');
process.exit(gagal ? 1 : 0);
