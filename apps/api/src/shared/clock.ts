import { AsyncLocalStorage } from 'node:async_hooks';

// Tanggal simulasi untuk mengisi data contoh beberapa bulan ke belakang (scripts/seed/mock-3-bulan.mjs).
// Hanya aktif bila MOCK_DATE_HEADER=true dan APP_ENV bukan production: header "x-mock-date: YYYY-MM-DD"
// membuat today() dan nowDate() pada request itu memakai tanggal tersebut (jam tetap jam sekarang).
export const clock = new AsyncLocalStorage<string>();

export const mockDateEnabled = () => process.env.MOCK_DATE_HEADER === 'true' && process.env.APP_ENV !== 'production';

export function mockDay(): string | undefined {
  return clock.getStore();
}

// waktu sekarang; pada request bertanggal simulasi, tanggalnya diganti dengan tanggal simulasi (WIB)
export function nowDate(): Date {
  const d = clock.getStore();
  if (!d) return new Date();
  const wib = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(11, 23);
  return new Date(`${d}T${wib}+07:00`);
}
