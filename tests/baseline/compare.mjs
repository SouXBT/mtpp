// Membandingkan dua rekaman capture.mjs. Keluar dengan kode 1 bila ada perbedaan.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const [a, b] = process.argv.slice(2);
const A = new Set(readdirSync(a)); const B = new Set(readdirSync(b));
const beda = [];
for (const f of A) if (!B.has(f)) beda.push(`hilang: ${f}`);
for (const f of B) if (!A.has(f)) beda.push(`baru: ${f}`);
for (const f of A) if (B.has(f) && readFileSync(join(a, f), 'utf8') !== readFileSync(join(b, f), 'utf8')) beda.push(`beda: ${f}`);
if (beda.length) { console.log(beda.join('\n')); console.log(`${beda.length} perbedaan dari ${A.size} berkas`); process.exit(1); }
console.log(`Sama: ${A.size} berkas`);
