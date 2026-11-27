import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
// muat .env sederhana tanpa paket tambahan
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

// Produksi (APP_ENV=production) tidak boleh berjalan dengan rahasia JWT kosong atau bawaan.
// NODE_ENV tidak dipakai karena image Docker selalu production, termasuk saat demo lokal.
const DEFAULT_JWT_SECRETS = [
  'ganti-rahasia-ini',
  'ganti-rahasia',
  'ganti-dengan-rahasia-panjang',
  'ganti-dengan-rahasia-panjang-acak',
];
if (
  process.env.APP_ENV === 'production' &&
  (!process.env.JWT_SECRET || DEFAULT_JWT_SECRETS.includes(process.env.JWT_SECRET))
) {
  console.error('JWT_SECRET kosong atau masih bawaan. Isi rahasia yang panjang dan acak sebelum menjalankan produksi.');
  process.exit(1);
}

// Nilai contoh dari .env.example diketahui siapa pun yang membaca repositori.
const placeholder =
  process.env.WEBHOOK_TOKEN === 'ganti-token-webhook'
    ? 'WEBHOOK_TOKEN'
    : /:(ganti-password-database|mtpp)@/.test(process.env.DATABASE_URL || '')
      ? 'DB_PASSWORD'
      : null;
if (process.env.APP_ENV === 'production' && placeholder) {
  console.error(`${placeholder} masih bawaan. Isi nilai yang panjang dan acak sebelum menjalankan produksi.`);
  process.exit(1);
}

async function bootstrap() {
  const { db } = await import('./db/db.module');
  const log = new Logger('MTPP');
  // migrasi database dijalankan oleh `prisma migrate deploy` sebelum proses ini (lihat Dockerfile)
  if (process.env.SEED_ON_EMPTY !== 'false') {
    const { seedIfEmpty } = await import('./db/seed');
    await seedIfEmpty(db, log);
  }
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  const { appValidationPipe } = await import('./shared/validation');
  app.useGlobalPipes(appValidationPipe());
  const { AppErrorFilter } = await import('./shared/error.filter');
  app.useGlobalFilters(new AppErrorFilter());
  app.setGlobalPrefix('api');
  const { clock, mockDateEnabled } = await import('./shared/clock');
  if (mockDateEnabled()) {
    log.warn('MOCK_DATE_HEADER aktif: header x-mock-date mengganti tanggal transaksi (hanya untuk data contoh)');
    app.use((req: any, _res: any, next: () => void) => {
      const d = String(req.headers['x-mock-date'] || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) clock.run(d, next);
      else next();
    });
  }
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') || true });
  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  log.log(`API berjalan di http://localhost:${port}/api`);
}
bootstrap();
