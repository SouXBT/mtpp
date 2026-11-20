import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeItem, activeModule, moduleEntry, visibleModules } from './nav.ts';

const perm = (...menus: string[]) => Object.fromEntries(menus.map((m) => [m, { read: true }]));
const sales = perm(
  'penjualan',
  'pengadaan',
  'pricelist_principal',
  'stok',
  'gudang',
  'penagihan',
  'dokumen',
  'pelanggan',
  'principal',
  'produk',
  'top',
  'pricelist_jual',
  'email',
  'perusahaan',
);
const mods = visibleModules({ perms: sales, reports: ['margin'] });
const get = (k: string) => mods.find((m) => m.key === k)!;

test('modul dan submenu disaring menurut izin', () => {
  assert.deepEqual(
    get('pengaturan').items.map((i) => i.label),
    ['Email Keluar', 'Perusahaan'],
  );
  assert.equal(
    mods.find((m) => m.key === 'akuntansi'),
    undefined,
  );
  assert.equal(
    visibleModules({ perms: perm('pengguna') }).some((m) => m.key === 'laporan'),
    false,
  );
  assert.equal(visibleModules(null).length, 1); // hanya Beranda
});

test('titik masuk modul', () => {
  assert.equal(moduleEntry(get('pengaturan')), '/pengaturan/email');
  assert.equal(moduleEntry(get('penjualan')), '/penjualan?tab=quote');
  assert.equal(moduleEntry(get('laporan')), '/laporan');
});

test('modul aktif', () => {
  assert.equal(activeModule('/akuntansi/kas', mods), null);
  assert.equal(activeModule('/profil', mods), null);
  assert.equal(activeModule('/', mods)!.key, 'beranda');
});

test('submenu aktif', () => {
  const peng = get('pengadaan');
  assert.equal(activeItem('/pengadaan/12', '', peng)!.to, '/pengadaan');
  assert.equal(activeItem('/pengadaan/tagihan/5', '', peng)!.to, '/pengadaan/tagihan');
  const jual = get('penjualan');
  assert.equal(activeItem('/penjualan', '', jual)!.match, 'tab=quote');
  assert.equal(activeItem('/penjualan', '?tab=order', jual)!.match, 'tab=order');
  assert.equal(activeItem('/penjualan', '?tab=cancel', jual), null);
  assert.equal(activeItem('/penjualan/baru', '', jual)!.match, 'tab=quote');
  assert.equal(activeItem('/penjualan/7', '', jual, 'tab=order')!.match, 'tab=order');
  assert.equal(activeItem('/penjualan/7', '', jual), null);
  assert.equal(activeItem('/penjualan/pembayaran', '', jual)!.to, '/penjualan/pembayaran');
  assert.equal(activeItem('/pengadaan/retur/3', '', peng)!.to, '/pengadaan/retur');
  const dok = get('dokumen');
  assert.equal(activeItem('/dokumen/9', '', dok)!.match, 'type=all');
  assert.equal(activeItem('/dokumen', '?type=surat', dok)!.match, 'type=surat');
  assert.equal(activeItem('/pengadaan/12', '', peng, 'tab=order')!.to, '/pengadaan');
  assert.equal(activeItem('/stok/dok/3', '', get('stok')), null);
});
