interface Order {
  state: string;
  shortage?: { shortage: number }[];
  partner?: { mtppIsNewCustomer?: boolean };
  payment?: { paidFull?: boolean };
  readyItems?: number;
  canDeliver?: boolean;
  invoiceStatus?: string;
  invoices?: { moveType: string; state: string; paymentState?: string }[];
  transfers?: { code?: string; state: string }[];
}

// Langkah berikutnya di detail sales order, menurut keadaan yang sama dengan tombol aksinya.
export function nextSteps(o: Order): string[] {
  const out: string[] = [];
  if (o.state === 'sale') {
    if ((o.shortage || []).some((x) => x.shortage > 0)) out.push('Berikutnya: Finance membuat PO Principal.');
    if (o.partner?.mtppIsNewCustomer && !o.payment?.paidFull) out.push('Berikutnya: Finance mencatat pembayaran pelanggan.');
    else if (o.canDeliver && (o.readyItems || 0) > 0) out.push('Berikutnya: Operasional membuat surat jalan.');
    if ((o.transfers || []).some((t) => t.code === 'outgoing' && ['draft', 'waiting', 'assigned'].includes(t.state))) out.push('Berikutnya: Operasional memvalidasi surat jalan.');
  }
  if (['sale', 'done'].includes(o.state)) {
    const inv = (o.invoices || []).filter((i) => i.moveType === 'out_invoice');
    if (inv.some((i) => i.state === 'draft')) out.push('Berikutnya: Finance memposting invoice.');
    else if (o.invoiceStatus === 'to_invoice') out.push('Berikutnya: Finance membuat invoice.');
    if (inv.some((i) => i.state === 'posted' && ['not_paid', 'partial'].includes(i.paymentState || ''))) out.push('Berikutnya: Finance mencatat pembayaran invoice.');
  }
  return out;
}
