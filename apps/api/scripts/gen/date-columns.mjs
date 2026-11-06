// Menghasilkan src/db/date-columns.generated.ts: kolom @db.Date per model.
// Metadata Prisma saat berjalan tidak memuat tipe asli kolom, jadi dibaca dari berkas skema.
// Jalankan dari apps/api setelah mengubah skema: npm run db:gen-dates
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const out = {};
for (const f of readdirSync('prisma/schema').sort()) {
  for (const m of readFileSync(`prisma/schema/${f}`, 'utf8').matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const cols = [...m[2].matchAll(/^\s+(\w+)\s+DateTime\??\s.*@db\.Date\b/gm)].map((x) => x[1]);
    if (cols.length) out[m[1]] = cols;
  }
}
const body = Object.keys(out)
  .sort()
  .map((k) => `  ${k}: [${out[k].map((c) => `'${c}'`).join(', ')}],`)
  .join('\n');
writeFileSync(
  'src/db/date-columns.generated.ts',
  `// Dihasilkan oleh scripts/gen/date-columns.mjs. Jangan diubah manual.\nexport const DATE_COLUMNS: Record<string, string[]> = {\n${body}\n};\n`,
);
