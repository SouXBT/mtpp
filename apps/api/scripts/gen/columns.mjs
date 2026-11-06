// Menghasilkan src/db/columns.generated.ts: kolom @db.Date dan kolom wajib per model.
// Metadata Prisma saat berjalan tidak memuat keduanya, jadi dibaca dari berkas skema.
// Jalankan dari apps/api setelah mengubah skema: npm run db:gen-columns
// --check hanya memeriksa kesesuaian tanpa menulis berkas.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const SCALARS = 'String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json';
const dates = {};
const required = {};
for (const f of readdirSync('prisma/schema').sort()) {
  for (const m of readFileSync(`prisma/schema/${f}`, 'utf8').matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const d = [...m[2].matchAll(/^\s+(\w+)\s+DateTime\??\s.*@db\.Date\b/gm)].map((x) => x[1]);
    if (d.length) dates[m[1]] = d;
    required[m[1]] = [...m[2].matchAll(new RegExp(`^\\s+(\\w+)\\s+(?:${SCALARS})\\s`, 'gm'))].map((x) => x[1]);
  }
}
const block = (name, o) =>
  `export const ${name}: Record<string, string[]> = {\n${Object.keys(o)
    .sort()
    .map((k) => `  ${k}: [${o[k].map((c) => `'${c}'`).join(', ')}],`)
    .join('\n')}\n};\n`;
const text = `// Dihasilkan oleh scripts/gen/columns.mjs. Jangan diubah manual.\n${block('DATE_COLUMNS', dates)}\n${block('REQUIRED_COLUMNS', required)}`;
const FILE = 'src/db/columns.generated.ts';
if (process.argv.includes('--check')) {
  if (readFileSync(FILE, 'utf8').replace(/[\s,]/g, '') !== text.replace(/[\s,]/g, '')) {
    console.error(`${FILE} tidak sesuai skema. Jalankan: npm run db:gen-columns`);
    process.exit(1);
  }
} else {
  writeFileSync(FILE, text);
}
