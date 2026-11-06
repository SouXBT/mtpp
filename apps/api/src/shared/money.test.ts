import assert from 'node:assert/strict';
import { test } from 'node:test';
import { round2, roundRp, terbilang } from './util';
import { SettingsService } from './settings.service';
import { salePayments } from './status';
import { StockService } from '../modules/stock/stock.service';

const taxSettings = (rate: number, dppNum: number, dppDen: number) => {
  const svc = new SettingsService({} as never);
  (svc as unknown as { get: () => Promise<unknown> }).get = async () => ({ rate, dppNum, dppDen, label: 'PPN' });
  return svc;
};

test('pembulatan uang', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(10.1 + 20.2), 30.3);
  assert.equal(roundRp(1000.5), 1001);
});
test('PPN 12% x 11/12 dari DPP', async () => {
  const t = await taxSettings(12, 11, 12).tax(1_000_000);
  assert.equal(t.dppNilaiLain, 916667);
  assert.equal(t.tax, 110000);
  assert.equal(t.rate, 12);
});
test('PPN nol pada nilai nol', async () => {
  assert.equal((await taxSettings(12, 11, 12).tax(0)).tax, 0);
});
test('uang muka dikurangi pengembalian, sisa, dan pembayaran invoice', async () => {
  const tx = {
    payments: {
      findMany: async (q: { select?: unknown }) =>
        q.select
          ? [{ amount: 200 }]
          : [
              { paymentType: 'inbound', amount: 1000, amountApplied: 300 },
              { paymentType: 'outbound', amount: 100, amountApplied: 0 },
            ],
    },
  };
  assert.deepEqual(await salePayments(tx, 1), { advance: 900, available: 700, amount: 1100 });
});
test('SO yang dikonfirmasi lebih dulu memiliki stok lebih dulu', async () => {
  const stock = new StockService({} as never);
  const line = (id: number, dateConfirm: string, qty: number, delivered = 0) => ({
    productUomQty: qty,
    qtyDelivered: delivered,
    order: { id, dateConfirm },
  });
  const tx = {
    salesOrders: { findFirst: async () => ({ id: 5, dateConfirm: '2026-11-05' }) },
    salesOrderLines: {
      findMany: async () => [
        line(1, '2026-11-01', 10, 4), // lebih dulu: sisa 6
        line(4, '2026-11-05', 2), // tanggal sama, id lebih kecil: 2
        line(6, '2026-11-05', 50), // tanggal sama, id lebih besar: tidak dihitung
        line(7, '2026-11-09', 50), // lebih lambat: tidak dihitung
        line(2, '2026-11-02', 3, 9), // terkirim melebihi pesanan: 0
      ],
    },
  };
  assert.equal(await stock.reservedAhead(1, 1, 5, tx), 8);
});
test('terbilang rupiah', () => {
  assert.match(terbilang(1500).toLowerCase(), /seribu lima ratus/);
});
