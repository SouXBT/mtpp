// Contoh aplikasi lain yang membaca data lewat REST API (hanya baca, header X-API-Key).
// Jalankan: API=http://localhost:8080/api MTPP_API_KEY=mtpp_xxx node scripts/api-client.mjs
const API = process.env.API || 'http://localhost:3000/api';
const KEY = process.env.MTPP_API_KEY;
if (!KEY) { console.error('Isi MTPP_API_KEY (buat di Pengaturan → API Key)'); process.exit(1); }

async function get(path) {
  const r = await fetch(API + path, { headers: { 'X-API-Key': KEY } });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
}
const rp = (n) => 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID');

const so = await get('/v1/sales-orders?state=sale&limit=10');
console.log('Sales order berjalan:');
for (const o of so.data) console.log(`  ${o.name}  ${o.customer.padEnd(30)} ${rp(o.amountTotal)}  (${o.invoiceStatus})`);

const inv = await get('/v1/invoices?paymentState=not_paid');
console.log(`\nInvoice belum dibayar: ${inv.data.length}, total sisa ${rp(inv.data.reduce((a, i) => a + Number(i.amountResidual), 0))}`);

const st = await get('/v1/stock');
const low = st.data.filter((x) => x.status === 'stok rendah');
console.log(`\nStok rendah (${low.length}):`);
for (const x of low) console.log(`  ${x.code} ${x.product} @ ${x.warehouse}: bebas ${x.free}, minimum ${x.minQty}`);
