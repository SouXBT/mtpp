import { BadRequestException, NotFoundException } from '@nestjs/common';

export const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const roundRp = (n: number) => Math.round(Number(n));
export const today = () => {
  // tanggal hari ini di zona WIB (UTC+7)
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};
export const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000);
export const fail: (msg: string) => never = (msg) => {
  throw new BadRequestException(msg);
};
// hasil query sudah dinormalkan db.module (date = string, numeric = number), berbeda dari tipe statis Prisma
export const must = (v: any, what = 'Data'): any => {
  if (v === undefined || v === null) throw new NotFoundException(`${what} tidak ditemukan`);
  return v;
};
export const num = (n: number, d = 0) =>
  Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
// rupiah selalu dengan dua desimal, mis. 1.500.000,00
export const idr = (n: number) => num(n, 2);
export const rupiah = (n: number) => 'Rp ' + idr(n);
export const tglIndo = (iso?: string | null) => {
  if (!iso) return '-';
  const b = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${b[m - 1]} ${y}`;
};

// jumlah dalam huruf (bahasa Indonesia)
const SAT = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
function tb(n: number): string {
  n = Math.floor(n);
  if (n < 12) return SAT[n];
  if (n < 20) return tb(n - 10) + ' belas';
  if (n < 100) return tb(Math.floor(n / 10)) + ' puluh' + (n % 10 ? ' ' + tb(n % 10) : '');
  if (n < 200) return 'seratus' + (n - 100 ? ' ' + tb(n - 100) : '');
  if (n < 1000) return tb(Math.floor(n / 100)) + ' ratus' + (n % 100 ? ' ' + tb(n % 100) : '');
  if (n < 2000) return 'seribu' + (n - 1000 ? ' ' + tb(n - 1000) : '');
  if (n < 1e6) return tb(Math.floor(n / 1000)) + ' ribu' + (n % 1000 ? ' ' + tb(n % 1000) : '');
  if (n < 1e9) return tb(Math.floor(n / 1e6)) + ' juta' + (n % 1e6 ? ' ' + tb(n % 1e6) : '');
  if (n < 1e12) return tb(Math.floor(n / 1e9)) + ' miliar' + (n % 1e9 ? ' ' + tb(n % 1e9) : '');
  return tb(Math.floor(n / 1e12)) + ' triliun' + (n % 1e12 ? ' ' + tb(n % 1e12) : '');
}
const ONES_EN = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS_EN = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function under1000(x: number) {
  let o = '';
  if (x >= 100) {
    o += ONES_EN[Math.floor(x / 100)] + ' hundred';
    x %= 100;
    if (x) o += ' ';
  }
  if (x >= 20) {
    o += TENS_EN[Math.floor(x / 10)];
    if (x % 10) o += '-' + ONES_EN[x % 10];
  } else if (x > 0) o += ONES_EN[x];
  return o;
}
export const terbilangEn = (v: number) => {
  let n = Math.abs(Math.round(v));
  if (n === 0) return 'Zero rupiah';
  const out: string[] = [];
  for (const [g, name] of [
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand'],
  ] as [number, string][]) {
    if (n >= g) {
      out.push(under1000(Math.floor(n / g)) + ' ' + name);
      n %= g;
    }
  }
  if (n > 0) out.push(under1000(n));
  const s = out.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1) + ' rupiah';
};
export const terbilang = (n: number) => {
  const s = Math.round(n) === 0 ? 'nol' : tb(Math.round(n));
  return (s.charAt(0).toUpperCase() + s.slice(1) + ' rupiah').replace(/\s+/g, ' ');
};
