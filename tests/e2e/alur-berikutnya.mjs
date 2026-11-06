// Alur SO -> surat jalan -> invoice -> bayar dengan klik sungguhan; mencatat keterangan "Berikutnya" di detail SO tiap tahap.
// MENULIS DATA: hanya untuk instance uji mtpp-nav (8081). Jalankan setelah demo-flow pada database bersih.
import { chromium } from 'playwright';
const BASE = (process.env.BASE || 'http://localhost:8081').replace(/\/$/, '');
if (new URL(BASE).port !== '8081') {
  console.error('Ditolak: hanya port 8081');
  process.exit(2);
}
const SANDI = 'mtpp12345';
let gagal = 0;
const cek = (ok, m) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${m}`);
  if (!ok) gagal++;
};
const login = async (a) =>
  (
    await (
      await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: a, password: SANDI }),
      })
    ).json()
  ).accessToken ?? (await 0);
const tok = {};
for (const a of ['sales', 'finance']) {
  const r = await (
    await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: `${a}@mtpp.co.id`, password: SANDI }),
    })
  ).json();
  tok[a] = r.accessToken || r.access_token || r.token;
}
const api = async (t, method, path, body) => {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const x = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${x.slice(0, 200)}`);
  return JSON.parse(x);
};
const pel = (await api(tok.sales, 'GET', '/partners?kind=customer')).find((c) => !c.mtppIsNewCustomer);
const prod = (await api(tok.sales, 'GET', '/products')).find((p) => p.code === 'KBL-NYY-4X50');
const q = await api(tok.sales, 'POST', '/sales-orders', {
  partnerId: pel.id,
  lines: [{ productId: prod.id, productUomQty: 1 }],
});
await api(tok.sales, 'POST', `/sales-orders/${q.id}/confirm`, {});
const so = await api(tok.sales, 'GET', `/sales-orders/${q.id}`);

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
const idle = (p) => p.waitForLoadState('networkidle').catch(() => {});
const catat = async (p, tahap) => {
  await p.goto(`${BASE}/penjualan/${so.id}`, { waitUntil: 'domcontentloaded' });
  await idle(p);
  await p.locator('.card').first().waitFor({ timeout: 10000 });
  await p.waitForTimeout(800);
  const n = p.getByRole('note', { name: 'Langkah berikutnya' });
  const teks = (await n.isVisible().catch(() => false))
    ? (await n.innerText()).replace(/\n+/g, ' | ')
    : '(tidak ada keterangan)';
  const buat = await p
    .getByRole('button', { name: 'Buat Invoice' })
    .isVisible()
    .catch(() => false);
  console.log(`[${tahap}] Berikutnya: ${teks} ; tombol Buat Invoice tampil=${buat}`);
  return { teks, buat };
};
const klikModal = async (p) => {
  await p.locator('.ant-modal-confirm-btns .ant-btn-primary').click();
  await idle(p);
};
try {
  const adm = await masuk('sales@mtpp.co.id');
  const ops = await masuk('operasional@mtpp.co.id');
  const fin = await masuk('finance@mtpp.co.id');

  let r = await catat(adm, '1 SO terkonfirmasi');
  cek(
    r.teks.includes('Operasional membuat surat jalan') && !r.teks.includes('invoice'),
    'tahap 1: hanya buat surat jalan (invoice menunggu pengiriman)',
  );

  await ops.goto(`${BASE}/stok/siap-dikirim`, { waitUntil: 'domcontentloaded' });
  await idle(ops);
  await ops.locator('tr', { hasText: so.name }).getByRole('button', { name: 'Buat Surat Jalan' }).click();
  await ops.waitForURL(/\/stok\/dok\/\d+$/, { timeout: 10000 });
  await idle(ops);
  r = await catat(adm, '2 surat jalan draf');
  cek(
    r.teks.includes('Operasional memvalidasi surat jalan') && !r.teks.includes('membuat surat jalan'),
    'tahap 2: validasi surat jalan',
  );

  const sjUrl = ops.url();
  // tunggu server selesai memvalidasi; tanpa ini keterangan bisa terbaca sebelum transaksinya selesai
  const tervalidasi = ops.waitForResponse(
    (x) => /\/transfers\/\d+\/validate/.test(x.url()) && x.request().method() === 'POST',
  );
  await ops.getByRole('button', { name: 'Validasi', exact: true }).click();
  await klikModal(ops);
  await tervalidasi;
  r = await catat(adm, '3 surat jalan tervalidasi');
  cek(
    !r.teks.includes('surat jalan') && r.teks.includes('Finance membuat invoice'),
    'tahap 3: tinggal membuat invoice',
  );

  await fin.goto(`${BASE}/penjualan/${so.id}`, { waitUntil: 'domcontentloaded' });
  await idle(fin);
  cek(
    await fin.getByRole('button', { name: 'Buat Invoice' }).isVisible(),
    'tahap 3: Finance melihat tombol Buat Invoice',
  );
  await fin.getByRole('button', { name: 'Buat Invoice' }).click();
  await fin.waitForURL(/\/penagihan\/\d+$/, { timeout: 10000 });
  await idle(fin);
  const invUrl = fin.url();
  r = await catat(adm, '4 invoice draf');
  cek(
    r.teks.includes('Finance memposting invoice') && !r.teks.includes('membuat invoice') && !r.buat,
    'tahap 4: posting; tombol Buat Invoice hilang',
  );

  await fin.goto(`${BASE}/penjualan/${so.id}`, { waitUntil: 'domcontentloaded' });
  await idle(fin);
  await fin.waitForTimeout(800);
  cek(
    !(await fin.getByRole('button', { name: 'Buat Invoice' }).isVisible()),
    'tahap 4: Finance tidak melihat tombol Buat Invoice saat invoice draf ada',
  );
  await fin.goto(invUrl, { waitUntil: 'domcontentloaded' });
  await idle(fin);
  await fin.getByRole('button', { name: 'Posting', exact: true }).click();
  await fin
    .getByText('Invoice diposting', { exact: false })
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await idle(fin);
  r = await catat(adm, '5 invoice posted belum dibayar');
  cek(r.teks.includes('Finance mencatat pembayaran invoice') && !r.buat, 'tahap 5: pembayaran invoice');

  const invId = invUrl.split('/').pop();
  const inv = await api(tok.finance, 'GET', `/invoices/${invId}`);
  await fin.goto(invUrl, { waitUntil: 'domcontentloaded' });
  await idle(fin);
  await fin.getByRole('button', { name: 'Catat Pembayaran' }).click();
  await fin.locator('.ant-modal').waitFor();
  await fin.locator('.ant-modal-footer .ant-btn-primary').click();
  await idle(fin);
  r = await catat(adm, '6 invoice lunas');
  cek(!r.teks.includes('pembayaran invoice') && !r.buat, 'tahap 6: tanpa langkah pembayaran');

  console.log('Beranda Operasional');
  await ops.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await idle(ops);
  const jadwal = await ops
    .locator('.ant-card, section, div')
    .filter({ hasText: 'Jadwal pengiriman' })
    .last()
    .innerText()
    .catch(() => '');
  console.log(jadwal.replace(/\n+/g, ' | ').slice(0, 600));
  cek(!/Penawaran/.test(jadwal), 'jadwal pengiriman Beranda Operasional tanpa label Penawaran');
} catch (e) {
  console.log('GALAT', e.message);
  gagal++;
}
await browser.close();
console.log(gagal ? `${gagal} gagal` : 'Semua lulus');
process.exit(gagal ? 1 : 0);
