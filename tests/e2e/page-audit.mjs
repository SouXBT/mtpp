// Audit halaman: buka setiap halaman daftar dan beberapa halaman detail untuk tiap peran, lalu catat
// galat JavaScript, console error, respons API 5xx/4xx yang tidak wajar, dan toast galat.
// Hanya membaca (GET dan membuka halaman), tidak menyimpan apa pun, jadi aman juga untuk :8080.
// Pakai: BASE=http://localhost:8081 node tests/e2e/page-audit.mjs   (keluar dengan kode 1 bila ada temuan)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = (process.env.BASE || 'http://localhost:8081').replace(/\/$/, '');
const API = `${BASE}/api`;
const AKUN = (process.env.AKUN || 'pimpinan,admin,sales,operasional,finance').split(',');
const SANDI = process.env.DEMO_PASSWORD || 'mtpp12345';
const DETAIL = Number(process.env.DETAIL || 3); // halaman detail per jenis

const DAFTAR = [
  '/',
  '/profil',
  '/penjualan',
  '/penjualan?tab=order',
  '/penjualan/pelanggan',
  '/penjualan/pricelist',
  '/penagihan/pembayaran?tab=so',
  '/pengadaan',
  '/pengadaan/tagihan',
  '/pengadaan/pricelist',
  '/pengadaan/principal',
  '/pengadaan/perlu-pesanan',
  '/stok',
  '/stok?low=true',
  '/stok/penerimaan',
  '/stok/siap-dikirim',
  '/stok/surat-jalan',
  '/stok/minimum',
  '/stok/mutasi',
  '/penagihan',
  '/penagihan/menunggu-bayar',
  '/penagihan/siap',
  '/penagihan/pembayaran',
  '/akuntansi/kas',
  '/akuntansi/jurnal',
  '/akuntansi/akun',
  '/akuntansi/buku-besar',
  '/akuntansi/neraca-saldo',
  '/akuntansi/rekonsiliasi',
  '/master/pelanggan',
  '/master/principal',
  '/master/produk',
  '/master/kategori',
  '/master/top',
  '/master/pricelist',
  '/pengaturan/pengguna',
  '/pengaturan/grup',
  '/pengaturan/email',
  '/pengaturan/perusahaan',
  '/pengaturan/dokumen',
  '/pengaturan/impor',
  '/pengaturan/api',
  '/dokumen',
  '/laporan',
];

// [api daftar, rute detail, menu izin]
const JENIS = [
  ['/sales-orders', (id) => `/penjualan/${id}`, 'penjualan'],
  ['/purchase-orders', (id) => `/pengadaan/${id}`, 'pengadaan'],
  ['/invoices?type=invoice', (id) => `/penagihan/${id}`, 'penagihan'],
  ['/invoices?type=bill', (id) => `/pengadaan/tagihan/${id}`, 'pengadaan'],
  ['/transfers?kind=outgoing', (id) => `/stok/dok/${id}`, 'gudang'],
  ['/transfers?kind=incoming', (id) => `/stok/dok/${id}`, 'gudang'],
  ['/partners?kind=customer', (id) => `/penjualan/pelanggan/${id}`, 'pelanggan'],
  ['/partners?kind=supplier', (id) => `/pengadaan/principal/${id}`, 'principal'],
  ['/products', (id) => `/master/produk/${id}`, 'produk'],
  ['/journal-entries', (id) => `/akuntansi/jurnal/${id}`, 'akuntansi'],
  ['/documents', (id) => `/dokumen/${id}`, 'dokumen'],
];

// izin baca per halaman diambil dari menu aplikasi (apps/web/src/app/nav.ts): item menu dan modulnya
const NAV = readFileSync(new URL('../../apps/web/src/app/nav.ts', import.meta.url), 'utf8');
const MENU_OF = {
  // halaman di luar submenu
  '/penjualan/pelanggan': 'pelanggan',
  '/penjualan/pricelist': 'pricelist_jual',
  '/pengadaan/principal': 'principal',
};
for (const m of NAV.matchAll(/to: '([^']+)',\s*menu: ('[^']+'|\[[^\]]+\])/g))
  MENU_OF[m[1]] = m[2].startsWith('[') ? m[2].match(/'[^']+'/g).map((x) => x.slice(1, -1)) : m[2].slice(1, -1);
// item menu tanpa menu sendiri (misalnya Akuntansi) memakai menu modulnya
const asMenu = (m) => (m.startsWith('[') ? m.match(/'[^']+'/g).map((x) => x.slice(1, -1)) : m.slice(1, -1));
for (const block of NAV.split(/\n  \{\n/).slice(1)) {
  const mod = block.match(/\n    menu: ('[^']+'|\[[^\]]+\])/);
  if (!mod) continue;
  for (const it of block.matchAll(/\{ label: '[^']+', to: '([^']+)'(?:, menu: ('[^']+'|\[[^\]]+\]))?/g))
    if (!it[2] && !MENU_OF[it[1]]) MENU_OF[it[1]] = asMenu(mod[1]);
}
// rute di luar menu (detail dan halaman lain): menu modul dari awalan alamat
const PREFIX = {
  '/penjualan': 'penjualan',
  '/pengadaan': 'pengadaan',
  '/stok': ['stok', 'gudang'],
  '/penagihan': 'penagihan',
  '/akuntansi': 'akuntansi',
  '/dokumen': 'dokumen',
  '/laporan': 'laporan',
};
const moduleMenu = (path) => {
  const k = Object.keys(PREFIX).find((x) => path === x || path.startsWith(x + '/'));
  return k ? PREFIX[k] : null;
};

const temuan = [];
const catat = (akun, hal, pesan) => {
  const t = `${akun} ${hal}: ${pesan}`;
  if (!temuan.includes(t)) temuan.push(t);
};

async function token(akun) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: `${akun}@mtpp.co.id`, password: SANDI }),
  });
  return (await r.json()).token;
}

async function detailRute(tok) {
  const me = await (await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  const out = [];
  for (const [path, rute, menu] of JENIS) {
    if (me?.perms && !me.perms[menu]?.read) continue;
    const r = await fetch(API + path, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) continue;
    const rows = await r.json();
    const list = Array.isArray(rows) ? rows : rows.rows || [];
    // yang terbaru dan yang terlama, supaya data dengan keadaan berbeda ikut terbuka
    const pilih = [...list.slice(0, Math.ceil(DETAIL / 2)), ...list.slice(-Math.floor(DETAIL / 2))];
    for (const x of pilih) if (x?.id) out.push(rute(x.id));
  }
  return [...new Set(out)];
}

const browser = await chromium.launch();
for (const akun of AKUN) {
  const tok = await token(akun);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let hal = '';
  page.on('pageerror', (e) => catat(akun, hal, `galat JS: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 403 dan 404 dicatat lewat respons di bawah; pesan React/Ant Design lain tetap temuan
    if (/Failed to load resource/.test(t)) return;
    catat(akun, hal, `console: ${t.slice(0, 200)}`);
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/')) return;
    if (r.status() >= 500) catat(akun, hal, `${r.status()} ${r.request().method()} ${u.pathname}${u.search}`);
    else if (r.status() >= 400 && r.status() !== 401)
      catat(akun, hal, `${r.status()} ${r.request().method()} ${u.pathname}${u.search}`);
  });
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input').first().fill(`${akun}@mtpp.co.id`);
  await page.locator('input[type=password]').fill(SANDI);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 15000 });
  const me = await (await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  // halaman yang tidak ada di menu peran ini tidak dibuka (akan 403 dengan benar): izin per item menu
  const menuOk = (p) => {
    const path = p.split('?')[0];
    const ms = MENU_OF[p] || MENU_OF[path] || moduleMenu(path);
    return !ms || [ms].flat().some((m) => me?.perms?.[m]?.read);
  };
  const rute = [...DAFTAR.filter(menuOk), ...(await detailRute(tok)).filter(menuOk)];
  for (const r of rute) {
    hal = r;
    try {
      await page.goto(BASE + r, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      const toast = await page.locator('.ant-message-error').allTextContents();
      for (const t of toast) catat(akun, r, `toast galat: ${t.slice(0, 200)}`);
      const kosong = await page.evaluate(() => !document.querySelector('main.page')?.textContent?.trim());
      if (kosong) catat(akun, r, 'halaman kosong');
    } catch (e) {
      catat(akun, r, `gagal dibuka: ${e.message.slice(0, 200)}`);
    }
  }
  console.log(`${akun}: ${rute.length} halaman diperiksa`);
  await ctx.close();
}
await browser.close();
if (temuan.length) {
  console.log(`\n${temuan.length} temuan:`);
  for (const t of temuan) console.log('  -', t);
  process.exit(1);
}
console.log('Audit halaman bersih: tidak ada temuan.');
