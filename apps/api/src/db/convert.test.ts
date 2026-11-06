import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { argsToDb, fieldsOf, fromDb, fromRaw } from './convert';

const midnight = new Date('2026-11-06T00:00:00.000Z');
const clock = new Date('2026-11-06T08:30:00.000Z');

test('kolom date menjadi YYYY-MM-DD', () => {
  assert.deepEqual(fromDb('JournalEntries', { date: midnight }), { date: '2026-11-06' });
});
test('kolom timestamp bernama date tetap Date, meski tepat tengah malam', () => {
  for (const d of [midnight, clock]) assert.deepEqual(fromDb('Messages', { date: d }), { date: d });
});
test('Decimal dan bigint menjadi number', () => {
  assert.deepEqual(fromDb('SalesOrders', { amountTotal: new Prisma.Decimal('12.50'), n: 5n }), {
    amountTotal: 12.5,
    n: 5,
  });
});
test('kolom JSON tidak diubah, termasuk isi yang mirip tanggal', () => {
  const data = { date: '2026-11-06', n: '5' };
  assert.deepEqual(argsToDb('Documents', { data: { data } }), { data: { data } });
  assert.deepEqual(fromDb('Documents', { data }), { data });
});
test('include mengikuti model relasinya', () => {
  const got = fromDb('Payments', { invoice: { invoiceDate: midnight, createDate: midnight }, createDate: midnight });
  assert.deepEqual(got, { invoice: { invoiceDate: '2026-11-06', createDate: midnight }, createDate: midnight });
});
test('string angka untuk kolom Int menjadi number, kolom teks tetap', () => {
  assert.deepEqual(argsToDb('SalesOrders', { where: { partnerId: '5', name: '123' } }), {
    where: { partnerId: 5, name: '123' },
  });
  assert.deepEqual(argsToDb('SalesOrders', { where: { partnerId: { in: ['5', 6] } } }), {
    where: { partnerId: { in: [5, 6] } },
  });
});
test('string tanggal pada filter dan isi baris menjadi Date', () => {
  assert.deepEqual(argsToDb('SalesOrders', { where: { AND: [{ dateOrder: { gte: '2026-11-06' } }] } }), {
    where: { AND: [{ dateOrder: { gte: midnight } }] },
  });
  assert.deepEqual(argsToDb('SalesOrders', { data: [{ dateOrder: '2026-11-06' }] }), {
    data: [{ dateOrder: midnight }],
  });
});
test('nama kolom tidak berpengaruh di luar modelnya: orderBy tidak diubah', () => {
  assert.deepEqual(argsToDb('Messages', { orderBy: { date: 'desc' } }), { orderBy: { date: 'desc' } });
});
test('SQL mentah tanpa model: tengah malam menjadi tanggal, angka menjadi number', () => {
  assert.deepEqual(fromRaw([{ d: midnight, t: clock, n: new Prisma.Decimal('1.5'), c: 2n }]), [
    { d: '2026-11-06', t: clock.toISOString(), n: 1.5, c: 2 },
  ]);
});
test('columns.generated.ts sesuai skema', () => {
  assert.doesNotThrow(() => execFileSync('node', ['scripts/gen/columns.mjs', '--check'], { stdio: 'pipe' }));
});
test('kolom wajib terbaca, kolom opsional tidak; nama akses client diterima', () => {
  assert.equal(fieldsOf('partners').get('name')?.isRequired, true);
  assert.equal(fieldsOf('Partners').get('vat')?.isRequired, false);
  assert.equal(fieldsOf('salesOrders').get('partnerId')?.isRequired, true);
  assert.throws(() => fieldsOf('tidakAda'));
});
