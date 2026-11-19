import { addDays, round2 } from './util';

// Penagihan piutang pelanggan: cicilan, masa tenggang, dan potongan piutang per tanggal jatuh tempo.
// Fungsi murni di bagian atas diuji di collection.test.ts; fungsi basis data di bagian bawah.

export const DUE_STATE: Record<string, string> = {
  belum_jt: 'Belum jatuh tempo',
  tenggang: 'Masa tenggang',
  lewat_tenggang: 'Lewat masa tenggang',
  lunas: 'Lunas',
};

export interface Termin {
  id?: number;
  sequence: number;
  dateDue: string;
  amount: number;
  state?: string;
  note?: string | null;
}

// Jadwal dibuat untuk sisa tagihan saat itu; yang sudah dibayar sebelumnya (offset) tidak masuk termin.
// Pembayaran sesudahnya (total - sisa - offset) dialokasikan ke termin dari jatuh tempo terlama.
export function allocate(total: number, residual: number, termins: Termin[]) {
  const sorted = [...termins].sort((a, b) => a.sequence - b.sequence);
  const planned = round2(sorted.reduce((a, x) => a + Number(x.amount), 0));
  const offset = round2(total - planned);
  let paid = round2(Math.max(total - residual - offset, 0));
  const rows = sorted.map((x) => {
    const amount = round2(Number(x.amount));
    const p = round2(Math.min(paid, amount));
    paid = round2(paid - p);
    const open = round2(amount - p);
    return { ...x, amount, paid: p, open, status: open <= 0.5 ? 'lunas' : p > 0 ? 'sebagian' : 'belum' };
  });
  // sisa di luar jadwal: muncul bila pembayaran lama dibatalkan setelah jadwal dibuat
  const outside = round2(Math.max(residual - rows.reduce((a, x) => a + x.open, 0), 0));
  return { rows, outside };
}

// Status penagihan satu bagian piutang menurut tanggal jatuh tempo dan masa tenggang pelanggan
export function dueState(due: string | null | undefined, open: number, graceDays: number, today: string) {
  if (open <= 0.5) return { state: 'lunas', graceUntil: null as string | null };
  if (!due) return { state: 'belum_jt', graceUntil: null };
  const graceUntil = addDays(due, Math.max(graceDays, 0));
  if (today <= due) return { state: 'belum_jt', graceUntil };
  if (today <= graceUntil) return { state: 'tenggang', graceUntil };
  return { state: 'lewat_tenggang', graceUntil };
}

// Bagi rata sisa tagihan menjadi n termin; selisih pembulatan masuk termin terakhir
export function splitEven(residual: number, n: number, firstDue: string, everyDays: number): Termin[] {
  const base = Math.floor((residual / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) => ({
    sequence: i + 1,
    dateDue: addDays(firstDue, i * everyDays),
    amount: i === n - 1 ? round2(residual - base * (n - 1)) : base,
  }));
}

// Aturan jadwal cicilan. Mengembalikan pesan kesalahan pertama, atau null bila jadwal sah.
export function planError(
  termins: { dateDue: string; amount: number }[],
  residual: number,
  invoiceDate: string,
  opts: { maxTermins: number; maxMonths: number },
) {
  if (termins.length < 2) return 'Cicilan minimal 2 termin';
  if (termins.length > opts.maxTermins) return `Cicilan paling banyak ${opts.maxTermins} termin`;
  for (const [i, x] of termins.entries()) {
    if (!x.dateDue) return `Tanggal jatuh tempo termin ${i + 1} belum diisi`;
    if (!(Number(x.amount) > 0)) return `Nominal termin ${i + 1} harus lebih dari 0`;
    if (x.dateDue < invoiceDate) return `Jatuh tempo termin ${i + 1} sebelum tanggal invoice`;
    if (i && x.dateDue <= termins[i - 1].dateDue) return `Jatuh tempo termin ${i + 1} harus setelah termin ${i}`;
  }
  const last = termins[termins.length - 1].dateDue;
  if (last > addDays(invoiceDate, opts.maxMonths * 31))
    return `Termin terakhir paling lambat ${opts.maxMonths} bulan setelah tanggal invoice`;
  const sum = round2(termins.reduce((a, x) => a + Number(x.amount), 0));
  if (Math.abs(sum - round2(residual)) > 0.009)
    return `Jumlah termin (${sum.toFixed(2)}) harus sama dengan sisa tagihan (${round2(residual).toFixed(2)})`;
  return null;
}

// ---------------------------------------------------------------- basis data

export const COLLECTION_DEFAULTS = {
  graceDays: 7,
  blockDelivery: true,
  maxInstallments: 12,
  maxMonths: 12,
  returnDays: 7,
};

export async function collectionSettings(tx: any) {
  const r = await tx.settings.findFirst({ where: { key: 'collection' } });
  return { ...COLLECTION_DEFAULTS, ...((r?.value as any) || {}) };
}

export const graceOf = (partner: { mtppGraceDays?: number | null } | null | undefined, def: number) =>
  partner?.mtppGraceDays ?? def;

export interface Slice {
  invoiceId: number;
  name: string;
  partnerId: number;
  customer: string;
  date: string;
  due: string | null;
  open: number;
  sequence: number | null;
  graceDays: number;
}

// Piutang terbuka dipecah per tanggal jatuh tempo: termin cicilan yang disetujui memakai tanggal terminnya,
// sisanya memakai jatuh tempo invoice. Dipakai umur piutang, beranda, daftar invoice, dan blokir pengiriman.
export async function receivableSlices(tx: any, f: { partnerId?: number; invoiceIds?: number[] } = {}) {
  const cfg = await collectionSettings(tx);
  const invs = await tx.journalEntries.findMany({
    where: {
      AND: [
        { moveType: 'out_invoice' },
        { state: 'posted' },
        { amountResidual: { gt: 0 } },
        ...(f.partnerId ? [{ partnerId: f.partnerId }] : []),
        ...(f.invoiceIds ? [{ id: { in: f.invoiceIds } }] : []),
      ],
    },
    include: {
      partner: { select: { name: true, mtppGraceDays: true } },
      installments: { where: { state: 'approved' }, orderBy: { sequence: 'asc' } },
    },
    orderBy: { invoiceDateDue: 'asc' },
  });
  const out: Slice[] = [];
  for (const e of invs) {
    const base = {
      invoiceId: e.id,
      name: e.name,
      partnerId: e.partnerId,
      customer: e.partner?.name ?? '-',
      date: e.invoiceDate || e.date,
      graceDays: graceOf(e.partner, cfg.graceDays),
    };
    const residual = Number(e.amountResidual);
    if (!e.installments.length) {
      out.push({ ...base, due: e.invoiceDateDue, open: residual, sequence: null });
      continue;
    }
    const a = allocate(Number(e.amountTotal), residual, e.installments);
    for (const x of a.rows) if (x.open > 0.5) out.push({ ...base, due: x.dateDue, open: x.open, sequence: x.sequence });
    if (a.outside > 0.5) out.push({ ...base, due: e.invoiceDateDue, open: a.outside, sequence: null });
  }
  return out;
}

// Ringkasan per invoice: jatuh tempo efektif (termin terbuka terlama) dan status masa tenggang terburuk
export function summarize(slices: Slice[], today: string) {
  const by = new Map<number, { due: string | null; state: string; graceUntil: string | null; overdue: boolean }>();
  const rank: Record<string, number> = { lunas: 0, belum_jt: 1, tenggang: 2, lewat_tenggang: 3 };
  for (const s of slices) {
    const d = dueState(s.due, s.open, s.graceDays, today);
    const cur = by.get(s.invoiceId);
    const overdue = !!s.due && s.due < today;
    if (!cur) by.set(s.invoiceId, { due: s.due, state: d.state, graceUntil: d.graceUntil, overdue });
    else {
      if (rank[d.state] > rank[cur.state]) Object.assign(cur, { state: d.state, graceUntil: d.graceUntil });
      if (s.due && (!cur.due || s.due < cur.due)) cur.due = s.due;
      cur.overdue = cur.overdue || overdue;
    }
  }
  return by;
}

// Invoice pelanggan yang sudah lewat masa tenggang; menjadi alasan blokir surat jalan
export async function pastGrace(tx: any, partnerId: number, today: string) {
  const slices = await receivableSlices(tx, { partnerId });
  const sum = summarize(slices, today);
  return slices
    .filter((s) => sum.get(s.invoiceId)?.state === 'lewat_tenggang')
    .filter((s, i, a) => a.findIndex((x) => x.invoiceId === s.invoiceId) === i)
    .map((s) => ({ id: s.invoiceId, name: s.name, graceUntil: sum.get(s.invoiceId)!.graceUntil }));
}
