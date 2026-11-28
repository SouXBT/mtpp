interface Order {
  state: string;
  shortage?: { shortage: number }[];
  partner?: { mtppIsNewCustomer?: boolean };
  payment?: { paidFull?: boolean; amount?: number };
  mtppSettleDate?: string | null;
  readyItems?: number;
  canDeliver?: boolean;
  invoiceStatus?: string;
  invoices?: { id?: number; moveType: string; state: string; paymentState?: string }[];
  transfers?: { id?: number; code?: string; state: string }[];
  purchaseOrders?: { id?: number; name?: string; state: string }[];
  creditHold?: { blocking?: boolean };
}

const tglPendek = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

export type StepAction = 'po' | 'pay' | 'hold' | 'deliver' | 'validate' | 'post' | 'invoice' | 'payinv' | 'waitpo';
export interface Step {
  text: string;
  action: StepAction;
}

// Langkah berikutnya di detail sales order, menurut keadaan yang sama dengan tombol aksinya.
// action menunjuk tombol yang ditampilkan di samping teksnya (bila peran pengguna boleh melakukannya).
export function nextStepItems(o: Order): Step[] {
  const out: Step[] = [];
  const add = (text: string, action: StepAction) => out.push({ text, action });
  if (o.state === 'sale') {
    if ((o.shortage || []).some((x) => x.shortage > 0)) add('Berikutnya: Finance membuat PO Principal.', 'po');
    const waiting = (o.purchaseOrders || []).filter((p) => ['draft', 'sent', 'purchase'].includes(p.state));
    if (waiting.length)
      add(
        `Menunggu barang dari principal (${waiting.map((p) => p.name).join(', ')}); surat jalan untuk sisanya dibuat setelah barang diterima.`,
        'waitpo',
      );
    if (o.partner?.mtppIsNewCustomer && !o.payment?.paidFull)
      add(
        Number(o.payment?.amount || 0) > 0 && o.mtppSettleDate
          ? `Berikutnya: Finance menagih pelunasan sisa paling lambat ${tglPendek(o.mtppSettleDate)}, lalu mencatatnya dengan bukti transfer.`
          : 'Berikutnya: Finance mencatat pembayaran pelanggan (uang muka atau langsung lunas) beserta bukti transfer.',
        'pay',
      );
    else if (o.creditHold?.blocking)
      add('Berikutnya: Finance menagih tagihan yang lewat masa tenggang, atau Pimpinan memberi izin kirim.', 'hold');
    else if (o.canDeliver && (o.readyItems || 0) > 0) add('Berikutnya: Operasional membuat surat jalan.', 'deliver');
    if ((o.transfers || []).some((t) => t.code === 'outgoing' && ['draft', 'waiting', 'assigned'].includes(t.state)))
      add('Berikutnya: Operasional memvalidasi surat jalan.', 'validate');
  }
  if (['sale', 'done'].includes(o.state)) {
    const inv = (o.invoices || []).filter((i) => i.moveType === 'out_invoice');
    if (inv.some((i) => i.state === 'draft')) add('Berikutnya: Finance memposting invoice.', 'post');
    else if (o.invoiceStatus === 'to_invoice') add('Berikutnya: Finance membuat invoice.', 'invoice');
    if (inv.some((i) => i.state === 'posted' && ['not_paid', 'partial'].includes(i.paymentState || '')))
      add('Berikutnya: Finance mencatat pembayaran invoice.', 'payinv');
  }
  return out;
}

export function nextSteps(o: Order): string[] {
  return nextStepItems(o).map((x) => x.text);
}
