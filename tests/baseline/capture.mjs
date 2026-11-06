// Merekam respons GET dan teks PDF agar restrukturisasi bisa dibuktikan tidak mengubah perilaku.
// Pakai: API=http://localhost:8081/api node tests/baseline/capture.mjs <folder-keluaran>
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = (process.env.API || 'http://localhost:8081/api').replace(/\/$/, '');
const PASS = process.env.DEMO_PASSWORD || 'mtpp12345';
const out = process.argv[2];
if (!out) { console.error('Sebutkan folder keluaran'); process.exit(2); }
mkdirSync(out, { recursive: true });

const ROLES = ['pimpinan', 'admin', 'sales', 'operasional', 'finance'];
const LISTS = [
  'journals', 'journal-entries', 'cash/balance', 'ledger', 'trial-balance', 'bank-statements',
  'settings', 'settings/sequences/preview', 'api-keys', 'activities', 'saved-filters', 'import',
  'sales-orders', 'sales-orders/next-number', 'sales-orders/worklist/need-po', 'sales-orders/worklist/ready',
  'purchase-orders', 'auth/config', 'auth/me', 'dashboard', 'partners', 'products', 'supplier-prices/view',
  'menus', 'users', 'groups', 'documents', 'documents/next-number', 'emails', 'stock', 'stock/moves', 'transfers',
  'invoices', 'payments', 'reports', 'payment-terms', 'units', 'categories', 'supplier-prices', 'pricelists',
  'pricelist-items', 'warehouses', 'stock-rules',
];
const DETAILS = { 'sales-orders': ['', '/shortage'], 'purchase-orders': [''], partners: [''], users: [''], documents: [''], transfers: [''], invoices: [''], 'journal-entries': [''], products: ['/price'] };
const PDFS = ['sales-orders', 'purchase-orders', 'transfers', 'invoices', 'documents'];

// Nilai yang berubah tiap jalan diganti teks tetap; bentuknya (timestamp atau tanggal) tetap terekam.
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const VOLATILE = new Set(['token', 'key', 'keyHash', 'password', 'messageId', 'providerMessageId', 'path', 'storedName', 'url', 'prefix', 'importBatch']);
function clean(v, key) {
  if (key && VOLATILE.has(key) && v != null) return `<${key}>`;
  if (typeof v === 'string' && STAMP.test(v)) return '<timestamp>';
  if (Array.isArray(v)) return v.map((x) => clean(x));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, k)]));
  return v;
}
// Urutan baris bertanggal sama pada kedua laporan ini tidak tetap antar-jalan (sudah begitu sebelum restrukturisasi),
// jadi dibandingkan tanpa urutan dan tanpa saldo berjalan.
const UNORDERED = new Set(['ledger', 'dashboard']);
function canon(v) {
  if (Array.isArray(v)) return v.map(canon).map((x) => JSON.stringify(x)).sort().map((x) => JSON.parse(x));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'balance').map(([k, x]) => [k, canon(x)]));
  return v;
}
async function get(token, path) {
  const r = await fetch(`${API}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const t = await r.text();
  let body; try { body = clean(JSON.parse(t)); if (UNORDERED.has(path)) body = canon(body); } catch { body = r.ok ? '<bukan-json>' : t; }
  return { status: r.status, body };
}
const file = (s) => s.replace(/[^\w.-]+/g, '_');
const save = (name, data) => writeFileSync(join(out, `${file(name)}.json`), JSON.stringify(data, null, 1) + '\n');

for (const role of ROLES) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: `${role}@mtpp.co.id`, password: PASS }) });
  if (!r.ok) throw new Error(`login ${role}: ${r.status}`);
  const { token } = await r.json();
  const lists = {};
  for (const p of LISTS) { lists[p] = await get(token, p); save(`${role}.${p}`, lists[p]); }
  for (const [p, subs] of Object.entries(DETAILS)) {
    const rows = lists[p]?.body;
    if (!Array.isArray(rows)) continue;
    for (const row of rows.slice(0, 40)) for (const s of subs) save(`${role}.${p}.${row.id}${s}`, await get(token, `${p}/${row.id}${s}`));
  }
  const reports = lists.reports?.body;
  if (Array.isArray(reports)) for (const rep of reports) { const k = rep.key ?? rep; save(`${role}.report.${k}`, await get(token, `reports/${k}`)); }
  if (role !== 'pimpinan') continue;
  const tmp = mkdtempSync(join(tmpdir(), 'mtpp-pdf-'));
  for (const p of PDFS) {
    const rows = lists[p]?.body;
    if (!Array.isArray(rows)) continue;
    for (const row of rows.slice(0, 3)) {
      const res = await fetch(`${API}/${p}/${row.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { save(`pdf.${p}.${row.id}`, { status: res.status }); continue; }
      const f = join(tmp, 'x.pdf');
      writeFileSync(f, Buffer.from(await res.arrayBuffer()));
      writeFileSync(join(out, `${file(`pdf.${p}.${row.id}`)}.txt`), execFileSync('pdftotext', ['-layout', f, '-']));
    }
  }
}
console.log(`Tersimpan di ${out}`);
