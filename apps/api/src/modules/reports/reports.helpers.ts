export interface Col {
  key: string;
  title: string;
  type?: 'money' | 'qty' | 'date' | 'pct' | 'text';
}

export const REPORT_TITLES: Record<string, string> = {
  penjualan_periode: 'Penjualan per Periode',
  penjualan_pelanggan: 'Penjualan per Pelanggan',
  penjualan_produk: 'Penjualan per Produk dan Principal',
  margin: 'Laporan Margin',
  pembelian_utang: 'Pembelian dan Utang Principal',
  pesanan_belum_diterima: 'PO Principal yang Belum Diterima',
  stok_gudang: 'Stok per Gudang',
  pengiriman: 'Pengiriman per Periode',
  umur_piutang: 'Umur Piutang',
  kas: 'Laporan Kas',
  status_bayar_po: 'Status Pembayaran PO Principal',
  buku_besar: 'Buku Besar dan Neraca Saldo',
};
