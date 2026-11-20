import { round2 } from './util';

// Uang muka SO setelah dikurangi pengembalian, sisa yang belum terpakai, dan pembayaran atas invoice SO
export async function salePayments(tx: any, saleId: number) {
  const rows = await tx.payments.findMany({
    where: { AND: [{ mtppSaleOrderId: saleId }, { state: { not: 'cancel' } }] },
  });
  const inbound = rows.filter((p: any) => p.paymentType !== 'outbound');
  const advance = round2(
    rows.reduce((a: number, p: any) => a + (p.paymentType === 'outbound' ? -1 : 1) * Number(p.amount), 0),
  );
  const available = round2(inbound.reduce((a: number, p: any) => a + Number(p.amount) - Number(p.amountApplied), 0));
  const onInvoices = (
    await tx.payments.findMany({
      // hanya uang masuk; pengembalian dana atas nota kredit retur bukan pembayaran pelanggan
      where: {
        AND: [
          { mtppSaleOrderId: null },
          { state: { not: 'cancel' } },
          { paymentType: 'inbound' },
          { invoice: { saleId } },
        ],
      },
      select: { amount: true },
    })
  ).reduce((a: number, p: any) => a + Number(p.amount), 0);
  return { advance, available, amount: round2(advance + onInvoices) };
}

// Penanda pelanggan baru berakhir saat sales order terkirim seluruhnya dan lunas
export async function graduateCustomer(
  tx: any,
  saleId: number,
  chatter: { log: (...a: any[]) => Promise<any> },
  uid?: number,
) {
  const so = await tx.salesOrders.findFirst({ where: { id: saleId }, include: { partner: true } });
  if (!so?.partner?.mtppIsNewCustomer || !['sale', 'done'].includes(so.state)) return;
  const lines = await tx.salesOrderLines.findMany({ where: { orderId: saleId } });
  if (!lines.length || !lines.every((l: any) => Number(l.qtyDelivered) >= Number(l.productUomQty))) return;
  const paid = await salePayments(tx, saleId);
  if (paid.amount < Number(so.amountTotal) - 0.5) return;
  await tx.partners.updateMany({ where: { id: so.partnerId }, data: { mtppIsNewCustomer: false } });
  await chatter.log(
    'partners',
    so.partnerId,
    uid,
    `Tidak lagi pelanggan baru: ${so.name} sudah terkirim seluruhnya dan lunas`,
    [{ field: 'Pelanggan baru', old: 'ya', new: 'tidak' }],
    tx,
  );
}

// Status penagihan sales order dan status Selesai
export async function refreshSale(tx: any, saleId: number) {
  const o = await tx.salesOrders.findFirst({ where: { id: saleId } });
  if (!o || !['sale', 'done'].includes(o.state)) return;
  const lines = await tx.salesOrderLines.findMany({ where: { orderId: saleId } });
  const allInv = lines.every((l: any) => Number(l.qtyInvoiced) >= Number(l.productUomQty));
  const anyInv = lines.some((l: any) => Number(l.qtyInvoiced) > 0);
  const toInv = lines.some((l: any) => Number(l.qtyDelivered) > Number(l.qtyInvoiced));
  const allDel = lines.every((l: any) => Number(l.qtyDelivered) >= Number(l.productUomQty));
  const invoiceStatus = allInv ? 'invoiced' : toInv ? 'to_invoice' : anyInv ? 'partial' : 'no';
  const state = allInv && allDel ? 'done' : 'sale';
  await tx.salesOrders.updateMany({ where: { id: saleId }, data: { invoiceStatus, state } });
}

// Algoritma 3.3: status pembayaran pesanan kepada principal
export async function refreshPurchase(tx: any, poId: number) {
  const po = await tx.purchaseOrders.findFirst({ where: { id: poId } });
  if (!po) return;
  const bills = await tx.journalEntries.findMany({
    where: {
      AND: [{ purchaseId: poId }, { moveType: { in: ['in_invoice', 'in_refund'] } }, { state: { not: 'cancel' } }],
    },
  });
  // tagihan yang dibalik beserta jurnal pembaliknya tidak lagi dihitung
  const posted = bills.filter((b: any) => b.state === 'posted' && b.paymentState !== 'reversed' && !b.reversedEntryId);
  let due = 0;
  for (const t of posted) due += (t.moveType === 'in_refund' ? -1 : 1) * Number(t.amountResidual);
  const lines = await tx.purchaseOrderLines.findMany({ where: { orderId: poId } });
  const notReceived = lines.some((l: any) => Number(l.qtyReceived) < Number(l.productQty));
  const needBill = lines.some((l: any) => Number(l.qtyReceived) > Number(l.qtyInvoiced));
  const invoices = posted.filter((b: any) => b.moveType === 'in_invoice');
  let st: string;
  if (bills.some((b: any) => b.state === 'draft')) st = 'belum dikonfirmasi';
  else if (!invoices.length) st = notReceived ? 'menunggu barang' : needBill ? 'menunggu tagihan' : 'tidak ada tagihan';
  else if (invoices.every((b: any) => b.paymentState === 'paid')) st = 'lunas';
  else if (invoices.some((b: any) => b.paymentState === 'paid' || b.paymentState === 'partial')) st = 'sebagian';
  else st = 'belum dibayar';
  const allRecv = !notReceived,
    allBilled = lines.every((l: any) => Number(l.qtyInvoiced) >= Number(l.productQty));
  const complete = allRecv && allBilled;
  const state = po.state === 'purchase' && complete ? 'done' : po.state === 'done' && !complete ? 'purchase' : po.state;
  await tx.purchaseOrders.updateMany({
    where: { id: poId },
    data: { mtppPaymentState: st, mtppAmountDue: round2(Math.max(due, 0)), state },
  });
}
