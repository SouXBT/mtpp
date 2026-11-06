// Navigasi atas: modul (tebal, bergaris bawah) diikuti sub-menu, sesuai mockup Claude Design
export interface NavItem { label: string; to: string; menu?: string | string[]; match?: string }
export interface Module { key: string; label: string; to: string; menu?: string | string[]; items: NavItem[]; reports?: boolean }

export const MODULES: Module[] = [
  { key: 'beranda', label: 'Beranda', to: '/', items: [] },
  { key: 'penjualan', label: 'Penjualan', to: '/penjualan', menu: 'penjualan', items: [
    { label: 'Penawaran', to: '/penjualan?tab=quote', menu: 'penjualan', match: 'tab=quote' },
    { label: 'Sales Order', to: '/penjualan?tab=order', menu: 'penjualan', match: 'tab=order' },
  ] },
  { key: 'pengadaan', label: 'Pengadaan', to: '/pengadaan', menu: ['pengadaan', 'pricelist_principal'], items: [
    { label: 'PO Principal', to: '/pengadaan', menu: 'pengadaan' },
    { label: 'Perlu PO Principal', to: '/pengadaan/perlu-pesanan', menu: 'pengadaan' },
    { label: 'Tagihan Principal', to: '/pengadaan/tagihan', menu: 'pengadaan' },
    { label: 'Pricelist Principal', to: '/pengadaan/pricelist', menu: 'pricelist_principal' },
  ] },
  { key: 'stok', label: 'Stok', to: '/stok', menu: ['stok', 'gudang'], items: [
    { label: 'Stok per Gudang', to: '/stok', menu: 'stok' },
    { label: 'Penerimaan Barang', to: '/stok/penerimaan', menu: 'gudang' },
    { label: 'Siap Dikirim', to: '/stok/siap-dikirim', menu: 'gudang' },
    { label: 'Surat Jalan', to: '/stok/surat-jalan', menu: 'gudang' },
    { label: 'Stok Minimum', to: '/stok/minimum', menu: 'stok' },
    { label: 'Mutasi', to: '/stok/mutasi', menu: 'stok' },
  ] },
  { key: 'penagihan', label: 'Penagihan', to: '/penagihan', menu: 'penagihan', items: [
    { label: 'Siap Ditagih', to: '/penagihan/siap', menu: 'penagihan' },
    { label: 'Invoice', to: '/penagihan', menu: 'penagihan' },
    { label: 'Pembayaran', to: '/penagihan/pembayaran', menu: 'penagihan' },
  ] },
  { key: 'akuntansi', label: 'Akuntansi', to: '/akuntansi/kas', menu: 'akuntansi', items: [
    { label: 'Kas', to: '/akuntansi/kas' }, { label: 'Jurnal', to: '/akuntansi/jurnal' }, { label: 'Bagan Akun', to: '/akuntansi/akun' },
    { label: 'Buku Besar', to: '/akuntansi/buku-besar' }, { label: 'Neraca Saldo', to: '/akuntansi/neraca-saldo' }, { label: 'Rekonsiliasi Bank', to: '/akuntansi/rekonsiliasi' },
  ] },
  { key: 'dokumen', label: 'Surat & Berita Acara', to: '/dokumen?type=all', menu: 'dokumen', items: [
    { label: 'Semua', to: '/dokumen?type=all', match: 'type=all' },
    { label: 'Surat Resmi', to: '/dokumen?type=surat', match: 'type=surat' },
    { label: 'BA Serah Terima', to: '/dokumen?type=bast', match: 'type=bast' },
    { label: 'BA Commissioning', to: '/dokumen?type=bacomm', match: 'type=bacomm' },
    { label: 'Laporan Pemeliharaan', to: '/dokumen?type=maintenance', match: 'type=maintenance' },
  ] },
  { key: 'master', label: 'Master', to: '/master/pelanggan', menu: ['pelanggan', 'principal', 'produk', 'top', 'pricelist_jual'], items: [
    { label: 'Pelanggan', to: '/master/pelanggan', menu: 'pelanggan' }, { label: 'Principal', to: '/master/principal', menu: 'principal' },
    { label: 'Produk', to: '/master/produk', menu: 'produk' }, { label: 'Kategori & Satuan', to: '/master/kategori', menu: 'produk' },
    { label: 'Term of Payment', to: '/master/top', menu: 'top' }, { label: 'Pricelist Penjualan', to: '/master/pricelist', menu: 'pricelist_jual' },
  ] },
  { key: 'pengaturan', label: 'Pengaturan', to: '/pengaturan/pengguna', menu: ['pengguna', 'email', 'perusahaan', 'pengaturan'], items: [
    { label: 'Pengguna', to: '/pengaturan/pengguna', menu: 'pengguna' }, { label: 'Grup', to: '/pengaturan/grup', menu: 'pengguna' },
    { label: 'Email Keluar', to: '/pengaturan/email', menu: 'email' }, { label: 'Perusahaan', to: '/pengaturan/perusahaan', menu: 'perusahaan' },
    { label: 'Format Cetak', to: '/pengaturan/dokumen', menu: 'pengaturan' }, { label: 'Impor Data', to: '/pengaturan/impor', menu: 'pengaturan' },
    { label: 'API Key', to: '/pengaturan/api', menu: 'pengaturan' },
  ] },
  { key: 'laporan', label: 'Laporan', to: '/laporan', reports: true, items: [] },
];

type Me = { perms?: Record<string, { read?: boolean }>; reports?: string[] } | null;

// Modul dan submenu yang boleh dilihat peran ini; modul yang semua submenunya terlarang ikut disembunyikan.
export function visibleModules(me: Me): Module[] {
  const can = (m?: string | string[]) => !m || (Array.isArray(m) ? m : [m]).some((x) => me?.perms?.[x]?.read);
  return MODULES.filter((m) => (m.reports ? (me?.reports?.length || 0) > 0 : can(m.menu)))
    .map((m) => ({ ...m, items: m.items.filter((i) => can(i.menu)) }))
    .filter((m) => m.items.length > 0 || MODULES.find((x) => x.key === m.key)!.items.length === 0);
}

export const moduleEntry = (m: Module) => m.items[0]?.to ?? m.to;

// Modul pemilik halaman; null untuk halaman di luar menu (profil) dan modul yang tidak boleh dilihat.
export function activeModule(pathname: string, mods: Module[]): Module | null {
  const seg = pathname.split('/')[1] || 'beranda';
  return mods.find((m) => m.key === seg) || null;
}

// Submenu yang menyala. Item bertanda `match` (query) dicocokkan dari URL atau petunjuk halaman; sisanya lewat awalan rute terpanjang.
export function activeItem(pathname: string, search: string, m: Module, hint?: string | null): NavItem | null {
  if (!m.items.length) return null;
  if (m.items.some((i) => i.match)) {
    const byHint = hint && m.items.find((i) => i.match === hint);
    if (byHint) return byHint;
    const base = m.to.split('?')[0];
    const rest = pathname.slice(base.length);
    if (rest === '') {
      const hit = m.items.find((i) => i.match && search.replace(/^\?/, '').split('&').includes(i.match));
      if (hit) return hit;
      return /[?&](tab|type)=/.test(search) ? null : m.items[0];
    }
    if (rest === '/baru' || m.key === 'dokumen') return m.items[0];
    return null;
  }
  if (m.key === 'stok' && pathname.startsWith('/stok/dok/')) return null;
  let best: NavItem | null = null; let len = -1;
  for (const i of m.items) {
    const p = i.to.split('?')[0];
    if ((pathname === p || pathname.startsWith(p + '/')) && p.length > len) { best = i; len = p.length; }
  }
  return best;
}
