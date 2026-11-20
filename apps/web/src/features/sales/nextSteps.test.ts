import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextSteps } from './nextSteps.ts';

const PO = 'Berikutnya: Finance membuat PO Principal.';
const BAYAR =
  'Berikutnya: Finance mencatat pembayaran pelanggan (uang muka atau langsung lunas) beserta bukti transfer.';
const KIRIM = 'Berikutnya: Operasional membuat surat jalan.';
const POSTING = 'Berikutnya: Finance memposting invoice.';
const BAYARINV = 'Berikutnya: Finance mencatat pembayaran invoice.';
const VALIDASI = 'Berikutnya: Operasional memvalidasi surat jalan.';
const TAGIH = 'Berikutnya: Finance membuat invoice.';

test('langkah berikutnya menurut keadaan SO', () => {
  assert.deepEqual(nextSteps({ state: 'draft', shortage: [{ shortage: 1 }] }), []);
  assert.deepEqual(nextSteps({ state: 'cancel', readyItems: 1, canDeliver: true }), []);
  assert.deepEqual(nextSteps({ state: 'sale', shortage: [{ shortage: 2 }] }), [PO]);
  assert.deepEqual(nextSteps({ state: 'sale', shortage: [{ shortage: 0 }] }), []);
  assert.deepEqual(
    nextSteps({
      state: 'sale',
      partner: { mtppIsNewCustomer: true },
      payment: { paidFull: false },
      readyItems: 1,
      canDeliver: false,
    }),
    [BAYAR],
  );
  assert.deepEqual(nextSteps({ state: 'sale', readyItems: 1, canDeliver: true }), [KIRIM]);
  assert.deepEqual(nextSteps({ state: 'sale', readyItems: 0, canDeliver: true }), []);
  assert.deepEqual(nextSteps({ state: 'done', invoiceStatus: 'to_invoice' }), [TAGIH]);
  assert.deepEqual(
    nextSteps({
      state: 'sale',
      shortage: [{ shortage: 1 }],
      readyItems: 1,
      canDeliver: true,
      invoiceStatus: 'to_invoice',
    }),
    [PO, KIRIM, TAGIH],
  );
  assert.deepEqual(nextSteps({ state: 'done', invoiceStatus: 'invoiced' }), []);
});

test('invoice draf memposting, bukan membuat', () => {
  const inv = [{ moveType: 'out_invoice', state: 'draft' }];
  assert.deepEqual(nextSteps({ state: 'sale', invoiceStatus: 'to_invoice', invoices: inv }), [POSTING]);
  assert.deepEqual(nextSteps({ state: 'done', invoiceStatus: 'to_invoice', invoices: inv }), [POSTING]);
});

test('invoice posted belum lunas meminta pembayaran', () => {
  const p = (paymentState: string) => [{ moveType: 'out_invoice', state: 'posted', paymentState }];
  assert.deepEqual(nextSteps({ state: 'sale', invoiceStatus: 'invoiced', invoices: p('not_paid') }), [BAYARINV]);
  assert.deepEqual(nextSteps({ state: 'sale', invoiceStatus: 'to_invoice', invoices: p('partial') }), [
    TAGIH,
    BAYARINV,
  ]);
  assert.deepEqual(nextSteps({ state: 'done', invoiceStatus: 'invoiced', invoices: p('paid') }), []);
});

test('surat jalan keluar yang belum selesai memberi langkah validasi', () => {
  for (const st of ['draft', 'waiting', 'assigned'])
    assert.deepEqual(nextSteps({ state: 'sale', transfers: [{ code: 'outgoing', state: st }] }), [VALIDASI]);
  assert.deepEqual(nextSteps({ state: 'sale', transfers: [{ code: 'outgoing', state: 'done' }] }), []);
  assert.deepEqual(nextSteps({ state: 'sale', transfers: [{ code: 'incoming', state: 'draft' }] }), []);
});

test('pelanggan baru lunas dengan stok memberi KIRIM; invoiceStatus partial tanpa TAGIH', () => {
  assert.deepEqual(
    nextSteps({
      state: 'sale',
      partner: { mtppIsNewCustomer: true },
      payment: { paidFull: true },
      readyItems: 2,
      canDeliver: true,
    }),
    [KIRIM],
  );
  assert.deepEqual(nextSteps({ state: 'sale', invoiceStatus: 'partial' }), []);
});

test('tagihan lewat masa tenggang menahan surat jalan', () => {
  const s = nextSteps({ state: 'sale', canDeliver: false, readyItems: 2, creditHold: { blocking: true } });
  assert.ok(s.some((x) => x.includes('lewat masa tenggang')));
  assert.ok(!s.some((x) => x.includes('membuat surat jalan')));
});

test('pelanggan baru sudah DP: tagih pelunasan pada tanggal yang disepakati', () => {
  const s = nextSteps({
    state: 'sale',
    partner: { mtppIsNewCustomer: true },
    payment: { paidFull: false, amount: 1000 },
    mtppSettleDate: '2026-12-04',
  });
  assert.ok(s.some((x) => x.includes('menagih pelunasan sisa paling lambat') && x.includes('2026')));
});
