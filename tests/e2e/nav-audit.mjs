// Audit navigasi: hanya login dan membuka halaman lewat klik menu, tidak menyimpan apa pun.
// Pakai: BASE=http://localhost:8081 node tests/e2e/nav-audit.mjs   (keluar dengan kode 1 bila ada temuan)
// Berlaku untuk menu lama (nav.nav + dropdown .mod) dan menu baru (.topbar/.appbar, .subnav, tombol .mod).
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://localhost:8081').replace(/\/$/, '');
const AKUN = ['pimpinan', 'admin', 'sales', 'operasional', 'finance'].map((n) => `${n}@mtpp.co.id`);
const SANDI = 'mtpp12345';
const LEBAR = [1440, 1240, 1024, 390];
const temuan = [];
const peringatan = [];
const catat = (akun, lebar, halaman, pesan) => {
  const t = `${akun.split('@')[0]} @${lebar} ${halaman}: ${pesan}`;
  if (!temuan.includes(t)) temuan.push(t);
};

const TAUTAN = 'header a[href], .appbar a[href], .subnav a[href], nav.nav a[href]';
const DAFTAR = '.ant-dropdown li, .ant-drawer-open li, .modules-menu a, [role=menu] [role=menuitem]';
const persis = (t) => new RegExp(`^\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);

async function login(page, akun) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input').first().fill(akun);
  await page.locator('input[type=password]').fill(SANDI);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

// Titik awal: satu-satunya pemakaian goto.
const mulai = async (page) => {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
};

// Tautan menu yang tampil: {teks, href}
const tautanTampil = (page) =>
  page.$$eval(TAUTAN, (as) => {
    const w = window.innerWidth;
    const out = [];
    const lihat = new Set();
    for (const a of as) {
      const r = a.getBoundingClientRect();
      const s = getComputedStyle(a);
      if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none') continue;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/') || lihat.has(href)) continue;
      lihat.add(href);
      out.push({ teks: a.textContent.trim(), href });
    }
    return out;
  });

// Klik lalu tunggu URL berubah (atau tetap sama bila memang halaman itu) dan periksa galat.
async function klik(page, akun, lebar, nama, aksi, hrefTujuan) {
  const galat = [];
  const dengar = (r) => {
    if (r.status() === 403 && r.url().includes('/api/')) galat.push(`403 ${new URL(r.url()).pathname}`);
  };
  const sebelum = page.url();
  page.on('response', dengar);
  try {
    await aksi();
  } catch (e) {
    page.off('response', dengar);
    const pesan = `${akun.split('@')[0]} @${lebar} ${nama}: ${e.message.slice(0, 300)}`;
    if (e.message.includes('ant-message')) {
      if (!peringatan.includes(pesan)) peringatan.push(pesan);
    } // tertutup toast: bukan temuan
    else catat(akun, lebar, nama, `tidak bisa diklik (${e.message.slice(0, 300)})`);
    return false;
  }
  if (hrefTujuan) {
    const p = new URL(hrefTujuan, BASE);
    await page
      .waitForFunction(
        ([path, s]) => location.pathname === path && (!s || location.search === s),
        [p.pathname, p.search],
        { timeout: 5000 },
      )
      .catch(() =>
        catat(
          akun,
          lebar,
          nama,
          `klik tidak membuka ${hrefTujuan} (URL sekarang ${new URL(page.url()).pathname + new URL(page.url()).search})`,
        ),
      );
  } else if (page.url() === sebelum) await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
  page.off('response', dengar);
  galat.forEach((g) => catat(akun, lebar, nama, g));
  const teks = await page.evaluate(() => document.body.innerText);
  if (teks.includes('Anda tidak memiliki akses')) catat(akun, lebar, nama, 'teks "Anda tidak memiliki akses"');
  return true;
}

const selTautan = (href) =>
  `header a[href="${href}"], .appbar a[href="${href}"], .subnav a[href="${href}"], nav.nav a[href="${href}"]`;
const klikTautan = async (page, href) => {
  // Toast 403 antd bisa menutupi tautan dan muncul lagi setelah dihapus: tunggu hilang lalu coba ulang (3x, 5 dtk per percobaan).
  let galat;
  for (let i = 0; i < 3; i++) {
    await tungguToast(page);
    try {
      await page.locator(selTautan(href)).locator('visible=true').first().click({ timeout: 5000 });
      return;
    } catch (e) {
      galat = `${e.message.split('\n')[0]} | ${await penghalang(page, selTautan(href))}`;
    }
  }
  throw new Error(galat);
};

// Buka daftar pemilih modul (.mod) dan kembalikan label item; daftar tetap terbuka.
async function bukaPemilih(page) {
  const mod = page.locator('.mod').locator('visible=true').first();
  if ((await mod.count()) === 0) return null;
  await mod.click({ force: true, timeout: 3000 });
  await page
    .locator(DAFTAR)
    .locator('visible=true')
    .first()
    .waitFor({ timeout: 3000 })
    .catch(() => {});
  return (await page.locator(DAFTAR).locator('visible=true').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
}

// Tunggu toast antd hilang (bisa menutupi target klik); maksimal 8 detik.
const tungguToast = (page) =>
  page
    .locator('.ant-message-notice')
    .first()
    .waitFor({ state: 'detached', timeout: 4000 })
    .catch(() => {});

// Elemen yang menutupi titik tengah target (untuk diagnosis klik gagal).
const penghalang = (page, sel) =>
  page
    .evaluate((q) => {
      const el = [...document.querySelectorAll(q)].find((e) => e.getBoundingClientRect().width > 0);
      if (!el) return 'target tidak ada/tersembunyi';
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const t = document.elementFromPoint(x, y);
      return `target (${Math.round(x)},${Math.round(y)}) vw=${innerWidth} tertutup oleh <${t?.tagName.toLowerCase()}> "${(t?.textContent || '').slice(0, 40)}" dalam ${(t?.closest('[class]:not(span)')?.className || '').toString().slice(0, 80)} notice=${document.querySelectorAll('.ant-message-notice').length} ${t === el || el.contains(t) ? '(bukan penghalang)' : ''}`;
    }, sel)
    .catch(() => '?');

const aman = async (f) => {
  try {
    return await f();
  } catch {
    return null;
  }
};

async function auditLebar(browser, akun, lebar) {
  const ctx = await browser.newContext({ viewport: { width: lebar, height: 900 } });
  const page = await ctx.newPage();
  try {
    try {
      await login(page, akun);
    } catch (e) {
      catat(akun, lebar, '/login', `login gagal: ${e.message.split('\n')[0]}`);
      return;
    }
    await mulai(page);
    const awal = await tautanTampil(page);
    // Baris modul harus muat tanpa terpotong (nav bisa digulir, jadi klik saja tidak menangkapnya).
    const potong = await page.evaluate(() => {
      const n = document.querySelector('.nav');
      return n && n.getBoundingClientRect().width > 0 && n.scrollWidth > n.clientWidth + 1
        ? [n.scrollWidth, n.clientWidth]
        : null;
    });
    if (potong) catat(akun, lebar, '/', `baris modul terpotong (${potong[0]}px dalam ${potong[1]}px)`);
    const modulHome = awal.filter((t) => t.href !== '/');
    const hrefModul = new Set(modulHome.map((t) => t.href));
    const entri = modulHome.map((t) => ({ label: t.teks, href: t.href }));

    // Pelajari isi pemilih modul dari halaman modul pertama yang bisa dicapai (menu lama: hanya ada di sana).
    const pemilihDiHome = await aman(() => bukaPemilih(page));
    if (pemilihDiHome) await page.keyboard.press('Escape');
    let labelPemilih = pemilihDiHome;
    if (!labelPemilih && modulHome[0]) {
      await klik(page, akun, lebar, modulHome[0].href, () => klikTautan(page, modulHome[0].href), modulHome[0].href);
      labelPemilih = await aman(() => bukaPemilih(page));
      if (labelPemilih) await page.keyboard.press('Escape');
    }
    for (const l of labelPemilih || [])
      if (l !== 'Beranda' && !entri.some((e) => e.label === l)) entri.push({ label: l });
    if (!entri.length) {
      catat(akun, lebar, '/', 'tidak ada modul yang bisa dipilih di menu');
      return;
    }

    for (const m of entri) {
      const nama = m.href || m.label;
      await mulai(page);
      let sampai = false;
      // 1) tautan modul yang tampil di Beranda; 2) pemilih .mod di Beranda; 3) pemilih .mod dari modul lain.
      if (
        m.href &&
        (await page
          .locator(`header a[href="${m.href}"], .appbar a[href="${m.href}"], nav.nav a[href="${m.href}"]`)
          .locator('visible=true')
          .count()) > 0
      ) {
        sampai = await klik(page, akun, lebar, nama, () => klikTautan(page, m.href), m.href);
      } else {
        let ada = await aman(() => page.locator('.mod').locator('visible=true').count());
        if (!ada && modulHome[0]) {
          await klik(
            page,
            akun,
            lebar,
            modulHome[0].href,
            () => klikTautan(page, modulHome[0].href),
            modulHome[0].href,
          );
          ada = await aman(() => page.locator('.mod').locator('visible=true').count());
        }
        if (ada) {
          const label = m.label;
          const sebelum = page.url();
          sampai = await klik(page, akun, lebar, nama, async () => {
            await tungguToast(page);
            await bukaPemilih(page);
            await page
              .locator(DAFTAR)
              .locator('visible=true')
              .filter({ hasText: persis(label) })
              .first()
              .click({ timeout: 3000 });
          });
          if (sampai) {
            // Verifikasi: URL berubah dari titik awal dan nama modul aktif (teks .mod sendiri atau tautan modul aktif) sama persis dengan item.
            await page.keyboard.press('Escape');
            const aktif = await page.evaluate(() => {
              const mod = document.querySelector('.mod');
              const a = document.querySelector('header a.active, .appbar a.active, .topbar a.active');
              const sendiri = mod
                ? [...mod.childNodes]
                    .filter((n) => n.nodeType === 3)
                    .map((n) => n.textContent)
                    .join('')
                    .trim()
                : null;
              return [sendiri, a && a.textContent.trim()];
            });
            if (page.url() === sebelum) {
              catat(akun, lebar, nama, `memilih "${label}" di .mod tidak mengubah URL`);
              sampai = false;
            } else if (!aktif.some((t) => t === label)) {
              catat(
                akun,
                lebar,
                nama,
                `memilih "${label}" di .mod membuka ${new URL(page.url()).pathname}, modul aktif "${aktif.filter(Boolean).join(' / ')}" tidak sama`,
              );
              sampai = false;
            }
          }
        }
      }
      if (!sampai) {
        catat(akun, lebar, nama, `modul "${m.label}" tidak bisa dicapai lewat klik di lebar ini`);
        continue;
      }

      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      if (sw > iw) catat(akun, lebar, nama, `halaman meluap ke samping (scrollWidth ${sw} > ${iw})`);

      // Submenu yang tampil di lebar ini: klik satu per satu, tanpa goto.
      const subs = (await tautanTampil(page)).filter((t) => t.href !== '/' && !hrefModul.has(t.href));
      const dasar = new URL(page.url());
      for (const s of subs) {
        if (s.href === dasar.pathname + dasar.search) continue; // sedang dibuka
        if (!(await klik(page, akun, lebar, s.href, () => klikTautan(page, s.href), s.href))) continue;
        const [sw2, iw2] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        if (sw2 > iw2) catat(akun, lebar, s.href, `halaman meluap ke samping (scrollWidth ${sw2} > ${iw2})`);
      }
    }
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch();
try {
  await Promise.all(
    AKUN.map(async (akun) => {
      for (const lebar of LEBAR) await auditLebar(browser, akun, lebar);
    }),
  );
} finally {
  await browser.close();
}

peringatan.forEach((w) => console.log('PERINGATAN (tertutup toast, bukan temuan): ' + w));
if (temuan.length) {
  console.log(`TEMUAN (${temuan.length}):`);
  temuan.sort().forEach((t) => console.log(' - ' + t));
  process.exit(1);
}
console.log('Audit navigasi bersih: tidak ada temuan.');
