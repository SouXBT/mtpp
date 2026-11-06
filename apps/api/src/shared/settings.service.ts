import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../db/db.module';
import { roundRp } from './util';

export const DEFAULT_SETTINGS: Record<string, any> = {
  company: {
    name: 'PT Mentari Timur Prima Perkasa',
    tagline: 'Pengadaan Transformator & MV Cubicle · Instalasi · Maintenance',
    street: 'Jl. Wonorejo II / 112\nSurabaya 60263, Jawa Timur, Indonesia',
    city: 'Surabaya',
    npwp: '',
    phone: '+62 31 531 4780',
    fax: '+62 31 547 9430',
    email: 'info@mtpp.co.id',
    website: '',
    signerName: 'Purnomohadi S.',
    signerTitle: 'Direktur',
    signerPhone: '081 131 8978',
    logoAttachmentId: null,
  },
  tax: { rate: 12, dppNum: 11, dppDen: 12, label: 'PPN' },
  terms: {
    payment: 'DP 30% saat PO diterima, 70% sebelum barang dikirim',
    handover: 'Franco On Truck Surabaya',
    standard: 'IEC / SPLN / SLI / ANSI',
    delivery: 'Pengiriman 2–4 minggu setelah PO diterima.',
    validityDays: 30,
    warranty: 'Garansi 12 bulan sesuai ketentuan pabrik.',
  },
  po_terms: { note: 'Mohon konfirmasi ketersediaan barang dan tanggal kirim.' },
  bank: {
    text: 'Bank Central Asia — KCP Kedungdoro, Surabaya\nNo. Rekening 103.023.8938 a.n. PT Mentari Timur Prima Perkasa',
  },
  doc_notes: {
    invoice:
      'Barang yang sudah dibeli tidak dapat ditukar atau dikembalikan, kecuali ada kesepakatan tertulis\nPembayaran dengan cheque / giro bilyet dinyatakan lunas setelah clearing\nPembayaran melebihi batas waktu yang disepakati dikenakan bunga 3% per bulan',
    surat_jalan:
      'Barang diterima dalam keadaan baik dan lengkap\nPemeriksaan kondisi fisik barang dilakukan pada saat penerimaan\nSurat jalan ini harap ditandatangani dan dikembalikan 1 (satu) lembar',
    po: 'Harga belum termasuk PPN; PPN dihitung terpisah pada dokumen ini\nHarga sudah termasuk biaya pengiriman ke alamat tujuan\nFaktur pajak dan surat jalan wajib dilampirkan pada saat pengiriman\nBarang yang tidak sesuai spesifikasi diselesaikan melalui kesepakatan tertulis dengan penjual',
  },
  accounts: {
    receivable: '1-1300',
    payable: '2-1100',
    taxOut: '2-1300',
    taxIn: '1-1400',
    income: '4-1000',
    expense: '5-1000',
    advance: '2-1200',
    opening: '3-9000',
    cash: '1-1100',
    bank: '1-1200',
    roundingIncome: '4-2000',
    roundingExpense: '6-9000',
  },
};

@Injectable()
export class SettingsService {
  constructor(@Inject(DB) private db: Db) {}
  async get<T = any>(key: string): Promise<T> {
    const r = await this.db.settings.findFirst({ where: { key: key } });
    return { ...(DEFAULT_SETTINGS[key] || {}), ...((r?.value as any) || {}) };
  }
  async all() {
    const out: any = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = await this.get(k);
    return out;
  }
  async set(key: string, value: any) {
    await this.db.settings.upsert({ where: { key }, create: { key, value }, update: { value } });
    return this.get(key);
  }
  // PPN: tarif x DPP nilai lain (efektif 11% untuk 12% x 11/12), dibulatkan per dokumen
  async tax(untaxed: number) {
    const t = await this.get('tax');
    const dpp = untaxed * (Number(t.dppNum) / Number(t.dppDen));
    return {
      dppNilaiLain: roundRp(dpp),
      tax: roundRp((dpp * Number(t.rate)) / 100),
      rate: Number(t.rate),
      label: t.label,
    };
  }
}
