// Alur PO pelanggan sebagai Sales, dengan klik sungguhan. MENULIS DATA: hanya untuk instance uji mtpp-nav (8081).
// Pakai: node tests/e2e/alur-po-pelanggan.mjs   (BASE bawaan http://localhost:8081; keluar dengan kode 1 bila ada yang gagal)
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://localhost:8081').replace(/\/$/, '');
if (new URL(BASE).port !== '8081') {
  console.error(`Ditolak: skrip ini menulis data dan hanya boleh berjalan pada port 8081 (BASE=${BASE})`);
  process.exit(2);
}
const SANDI = 'mtpp12345';
const HINT = 'PO dari pelanggan dicatat di sini: buka atau buat penawaran, isi PO Pelanggan, lalu konfirmasi.';
let gagal = 0;
const cek = (ok, pesan) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${pesan}`);
  if (!ok) gagal++;
};

// Penyiapan data lewat API (bukan bagian yang diuji)
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
const token = await login('sales@mtpp.co.id');
const api = async (method, path, body) => {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
const pelanggan = (await api('GET', '/partners?kind=customer'))[0];
const produk = (await api('GET', '/products')).find((p) => p.code === 'MCB-3P-63');
const baris = [{ productId: produk.id, productUomQty: 1 }];
const buat = (extra = {}) => api('POST', '/sales-orders', { partnerId: pelanggan.id, lines: baris, ...extra });
const ambil = (id) => api('GET', `/sales-orders/${id}`);

const a = await buat({ clientOrderRef: 'PO-LAMA' }); // dialog harus menampilkan nilai ini
const b = await buat(); // sumber nomor ganda
const c = await buat();
const d = await buat({ clientOrderRef: 'PO-SIMPAN' }); // batal dan nilai halaman vs dialog                                // konfirmasi dengan nomor ganda belum tersimpan

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input').first().fill('sales@mtpp.co.id');
  await page.locator('input[type=password]').fill(SANDI);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => {});

  console.log('Halaman Penawaran');
  await page.locator('a[href^="/penjualan"]:visible').first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  const subnavQuote = page.locator('a[href="/penjualan?tab=quote"]:visible, a[href="/penjualan"]:visible').first();
  if (await subnavQuote.count()) {
    await subnavQuote.click();
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  cek(
    page.url().includes('/penjualan'),
    `halaman penjualan terbuka (${new URL(page.url()).pathname + new URL(page.url()).search})`,
  );
  cek(
    await page
      .getByText(HINT, { exact: true })
      .isVisible()
      .catch(() => false),
    'tab Penawaran menampilkan teks petunjuk PO',
  );

  console.log('Dialog konfirmasi');
  await page.getByText(a.name, { exact: true }).first().click();
  await page.waitForURL(new RegExp(`/penjualan/${a.id}$`));
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: 'Konfirmasi' }).click();
  const dialog = page.locator('.ant-modal-confirm');
  await dialog.waitFor();
  const kolom = dialog.getByLabel('PO Pelanggan');
  cek((await kolom.inputValue()) === 'PO-LAMA', 'kolom PO Pelanggan berisi nilai saat ini');
  cek(await dialog.getByText('Baris produk akan terkunci', { exact: false }).isVisible(), 'teks peringatan tetap ada');
  await kolom.fill('  PO-BARU-1  ');
  await dialog.getByRole('button', { name: 'Konfirmasi' }).click();
  await page
    .waitForFunction(() => document.body.innerText.includes('Sales order dikonfirmasi'), null, { timeout: 10000 })
    .catch(() => {});
  const sa = await ambil(a.id);
  cek(
    sa.state === 'sale' && sa.clientOrderRef === 'PO-BARU-1',
    `Konfirmasi menyimpan PO (state=${sa.state}, PO=${sa.clientOrderRef})`,
  );

  console.log('Batal, buka lagi, dan nilai halaman berbeda dari dialog');
  await page.goto(`${BASE}/penjualan/${d.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: 'Konfirmasi' }).click();
  await dialog.waitFor();
  await dialog.getByLabel('PO Pelanggan').fill('PO-KETIK-BATAL');
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Konfirmasi' }).click();
  await dialog.waitFor();
  cek(
    (await dialog.getByLabel('PO Pelanggan').inputValue()) === 'PO-SIMPAN',
    'setelah Batal dan buka lagi, kolom kembali ke nilai tersimpan',
  );
  cek((await ambil(d.id)).clientOrderRef === 'PO-SIMPAN', 'Batal tidak mengubah nilai tersimpan');
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.ant-form-item', { hasText: 'PO Pelanggan' }).locator('input').fill('PO-HALAMAN');
  await page.getByRole('button', { name: 'Konfirmasi' }).click();
  await dialog.waitFor();
  cek(
    (await dialog.getByLabel('PO Pelanggan').inputValue()) === 'PO-HALAMAN',
    'dialog memuat nilai kolom halaman yang belum tersimpan',
  );
  await dialog.getByLabel('PO Pelanggan').fill('PO-DIALOG');
  await dialog.getByRole('button', { name: 'Konfirmasi' }).click();
  await page
    .waitForFunction(() => document.body.innerText.includes('Sales order dikonfirmasi'), null, { timeout: 10000 })
    .catch(() => {});
  const sd = await ambil(d.id);
  cek(
    sd.state === 'sale' && sd.clientOrderRef === 'PO-DIALOG',
    `hasil akhir nilai dialog (state=${sd.state}, PO=${sd.clientOrderRef})`,
  );

  console.log('PO wajib untuk pelanggan lama');
  await page.goto(`${BASE}/penjualan/${b.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: 'Konfirmasi' }).click();
  await dialog.waitFor();
  cek(await dialog.getByRole('button', { name: 'Konfirmasi' }).isDisabled(), 'tanpa PO, tombol Konfirmasi nonaktif');
  await dialog.getByLabel('PO Pelanggan').fill('PO-SEMENTARA');
  cek(
    await dialog.getByRole('button', { name: 'Konfirmasi' }).isEnabled(),
    'setelah PO diisi, tombol Konfirmasi aktif',
  );
  await dialog.getByLabel('PO Pelanggan').fill('');
  cek((await ambil(b.id)).state === 'draft', 'tanpa PO, penawaran tetap draf');
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await dialog.waitFor({ state: 'hidden' });

  console.log('Nomor ganda belum tersimpan');
  await page.goto(`${BASE}/penjualan/${c.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('.ant-form-item', { hasText: 'Nomor dokumen' }).locator('input').fill(b.name);
  await page.getByRole('button', { name: 'Konfirmasi' }).click();
  await dialog.waitFor();
  await dialog.getByLabel('PO Pelanggan').fill('PO-TIDAK-BOLEH');
  await dialog.getByRole('button', { name: 'Konfirmasi' }).click();
  await page.waitForTimeout(2000);
  const sc = await ambil(c.id);
  cek(sc.state === 'draft', `konfirmasi berhenti, dokumen tetap draf (state=${sc.state})`);
  cek(!sc.clientOrderRef, `nilai PO tidak tersimpan (PO=${sc.clientOrderRef ?? 'null'})`);

  console.log('Tab Sales Order');
  await page.goto(`${BASE}/penjualan?tab=order`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  cek(await page.getByText('Sales Order', { exact: true }).first().isVisible(), 'tab Sales Order terbuka');
  cek(
    !(await page
      .getByText(HINT, { exact: true })
      .isVisible()
      .catch(() => false)),
    'tab Sales Order tidak menampilkan petunjuk',
  );
} catch (e) {
  gagal++;
  console.log(`  ✗ galat: ${e.message.slice(0, 400)}`);
}
await browser.close();
console.log(gagal ? `\nGAGAL: ${gagal}` : '\nSemua lulus');
process.exit(gagal ? 1 : 0);
