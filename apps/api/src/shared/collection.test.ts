import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addMonths, allocate, dueState, planError, splitEven, summarize } from './collection';

const plan = [
  { sequence: 1, dateDue: '2026-12-01', amount: 400 },
  { sequence: 2, dateDue: '2027-01-01', amount: 300 },
  { sequence: 3, dateDue: '2027-02-01', amount: 300 },
];

test('pembayaran dialokasikan ke termin terlama', () => {
  const a = allocate(1000, 550, plan);
  assert.deepEqual(
    a.rows.map((x) => [x.paid, x.open, x.status]),
    [
      [400, 0, 'lunas'],
      [50, 250, 'sebagian'],
      [0, 300, 'belum'],
    ],
  );
  assert.equal(a.outside, 0);
});

test('pembayaran sebelum jadwal dibuat tidak dihitung ke termin', () => {
  // invoice 1.200, sudah dibayar 200 saat jadwal 1.000 dibuat, lalu dibayar 100 lagi
  const a = allocate(1200, 900, plan);
  assert.deepEqual(
    a.rows.map((x) => x.paid),
    [100, 0, 0],
  );
});

test('pembayaran lama yang dibatalkan menjadi sisa di luar jadwal', () => {
  const a = allocate(1200, 1100, plan);
  assert.equal(a.outside, 100);
  assert.equal(
    a.rows.reduce((s, x) => s + x.open, 0),
    1000,
  );
});

test('masa tenggang: belum jatuh tempo, tenggang, lewat tenggang, lunas', () => {
  assert.equal(dueState('2026-11-10', 100, 7, '2026-11-10').state, 'belum_jt');
  assert.equal(dueState('2026-11-10', 100, 7, '2026-11-17').state, 'tenggang');
  assert.equal(dueState('2026-11-10', 100, 7, '2026-11-18').state, 'lewat_tenggang');
  assert.equal(dueState('2026-11-10', 100, 0, '2026-11-11').state, 'lewat_tenggang');
  assert.equal(dueState('2026-11-10', 0.4, 7, '2027-01-01').state, 'lunas');
  assert.equal(dueState('2026-11-10', 100, 7, '2026-11-12').graceUntil, '2026-11-17');
});

test('bagi rata: selisih pembulatan di termin terakhir', () => {
  const t = splitEven(1000, 3, '2026-12-01', 30);
  assert.deepEqual(
    t.map((x) => x.amount),
    [333.33, 333.33, 333.34],
  );
  assert.deepEqual(
    t.map((x) => x.dateDue),
    ['2026-12-01', '2026-12-31', '2027-01-30'],
  );
});

test('aturan jadwal cicilan', () => {
  const o = { maxTermins: 12, maxMonths: 12 };
  assert.equal(planError(plan, 1000, '2026-11-01', o), null);
  assert.match(planError(plan.slice(0, 1), 400, '2026-11-01', o)!, /minimal 2/);
  assert.match(planError(plan, 999, '2026-11-01', o)!, /harus sama dengan sisa/);
  assert.match(planError([plan[1], plan[0]], 700, '2026-11-01', o)!, /harus setelah/);
  assert.match(planError(plan, 1000, '2026-12-15', o)!, /sebelum tanggal invoice/);
  assert.match(planError([plan[0], { ...plan[1], dateDue: '2028-01-01' }], 700, '2026-11-01', o)!, /12 bulan/);
  assert.match(planError(splitEven(1300, 13, '2026-11-02', 7), 1300, '2026-11-01', o)!, /paling banyak 12/);
});

test('ringkasan per invoice memakai status terburuk dan jatuh tempo terlama', () => {
  const s = summarize(
    [
      {
        invoiceId: 1,
        name: 'A',
        partnerId: 1,
        customer: 'X',
        date: '2026-10-01',
        due: '2026-10-05',
        open: 50,
        sequence: 1,
        graceDays: 7,
      },
      {
        invoiceId: 1,
        name: 'A',
        partnerId: 1,
        customer: 'X',
        date: '2026-10-01',
        due: '2026-11-30',
        open: 50,
        sequence: 2,
        graceDays: 7,
      },
    ],
    '2026-11-20',
  );
  assert.equal(s.get(1)!.state, 'lewat_tenggang');
  assert.equal(s.get(1)!.due, '2026-10-05');
});

test('pembayaran lama dibatalkan setelah ada pembayaran baru: pembayaran baru tetap ke termin 1', () => {
  // invoice 3.330.000; 1.000.000 dibayar sebelum jadwal; jadwal 2 x 1.165.000; bayar 500.000; yang 1.000.000 dibatalkan
  const t = [
    { sequence: 1, dateDue: '2026-01-10', amount: 1165000 },
    { sequence: 2, dateDue: '2026-02-10', amount: 1165000 },
  ];
  const a = allocate(3330000, 2830000, t, 500000);
  assert.equal(a.rows[0].paid, 500000);
  assert.equal(a.rows[0].open, 665000);
  assert.equal(a.outside, 1000000);
});

test('batas termin terakhir 12 bulan kalender dan tanggal yang tidak ada ditolak', () => {
  assert.equal(addMonths('2026-11-01', 12), '2027-11-01');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  const o = { maxTermins: 12, maxMonths: 12 };
  assert.match(
    String(
      planError(
        [
          { dateDue: '2026-12-08', amount: 50 },
          { dateDue: '2027-11-06', amount: 50 },
        ],
        100,
        '2026-11-01',
        o,
      ),
    ),
    /paling lambat 12 bulan/,
  );
  assert.equal(
    planError(
      [
        { dateDue: '2026-12-08', amount: 50 },
        { dateDue: '2027-11-01', amount: 50 },
      ],
      100,
      '2026-11-01',
      o,
    ),
    null,
  );
  assert.match(
    String(
      planError(
        [
          { dateDue: '2027-02-30', amount: 50 },
          { dateDue: '2027-03-30', amount: 50 },
        ],
        100,
        '2026-11-01',
        o,
      ),
    ),
    /tidak valid/,
  );
});
