import { Controller, ForbiddenException, Get, Inject, Injectable, Module, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { DB, Db } from '../../db/db.module';
import { AuthUser, CurrentUser } from '../../common/auth';
import { REPORTS_BY_GROUP } from '../../common/menus';
import { PdfService } from '../../common/pdf.service';
import { SettingsService } from '../../common/settings.service';
import { daysBetween, fail, num, round2, rupiah, tglIndo, today } from '../../common/util';
import { StockService } from '../stock/stock.service';
import { StockModule } from '../stock/stock.module';
import { Prisma } from '@prisma/client';

const sql = Prisma.sql;

export interface Col { key: string; title: string; type?: 'money' | 'qty' | 'date' | 'pct' | 'text' }
export interface Report {
  key: string; title: string; period?: string; filters: string[];
  columns: Col[]; rows: any[]; totals?: Record<string, number>;
  chart?: { type: 'line' | 'bar' | 'stacked' | 'pie'; x: string; series: { key: string; title: string }[]; data: any[] };
}

export const REPORT_TITLES: Record<string, string> = {
  penjualan_periode: 'Penjualan per Periode', penjualan_pelanggan: 'Penjualan per Pelanggan', penjualan_produk: 'Penjualan per Produk dan Principal',
  margin: 'Laporan Margin', pembelian_utang: 'Pembelian dan Utang Principal', pesanan_belum_diterima: 'PO Principal yang Belum Diterima',
  stok_gudang: 'Stok per Gudang', pengiriman: 'Pengiriman per Periode', umur_piutang: 'Umur Piutang', kas: 'Laporan Kas',
  status_bayar_po: 'Status Pembayaran PO Principal', buku_besar: 'Buku Besar dan Neraca Saldo',
};

const PAY_STATE: Record<string, string> = { not_paid: 'belum dibayar', partial: 'sebagian', paid: 'lunas', reversed: 'dibalik' };
const INV_STATUS: Record<string, string> = { no: 'belum ditagih', to_invoice: 'belum ditagih', partial: 'sebagian', invoiced: 'sudah ditagih' };
const TR_STATE: Record<string, string> = { draft: 'draf', waiting: 'menunggu', assigned: 'siap', done: 'selesai', cancel: 'batal' };
const bucketOf = (days: number) => (days <= 0 ? 'belum jatuh tempo' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '> 90');
const BUCKETS = ['belum jatuh tempo', '1-30', '31-60', '61-90', '> 90'];
const BUCKET_KEYS = ['b0', 'b30', 'b60', 'b90', 'b91'];

// Rentang periode: from/to eksplisit, atau bulan / kuartal / tahun berjalan
export function period(q: any) {
  const t = today(); const y = +t.slice(0, 4), m = +t.slice(5, 7);
  if (q.from && q.to) return { from: q.from, to: q.to };
  const pad = (n: number) => String(n).padStart(2, '0');
  const end = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  if (q.range === 'quarter') { const qs = Math.floor((m - 1) / 3) * 3 + 1; return { from: `${y}-${pad(qs)}-01`, to: end(y, qs + 2) }; }
  if (q.range === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (q.range === 'all') return { from: '2000-01-01', to: '2099-12-31' };
  return { from: `${y}-${pad(m)}-01`, to: end(y, m) };
}
const periodKey = (d: string, g: string) => {
  if (!d) return '-';
  if (g === 'year') return d.slice(0, 4);
  if (g === 'quarter') return `${d.slice(0, 4)}-K${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`;
  return d.slice(0, 7);
};
const sum = (rows: any[], k: string) => round2(rows.reduce((a, r) => a + Number(r[k] || 0), 0));

// Algoritma 3.5 Penyusunan Data Laporan
@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private db: Db, private stock: StockService) {}
  private async q(query: any) { return (await this.db.$queryRaw(query)) as any[]; }

  // Setiap baris laporan dapat dibuka ke dokumen asalnya (subbab 3.4)
  async build(u: AuthUser, key: string, q: any): Promise<Report> {
    const r = await this.compute(u, key, q);
    const L: Record<string, (x: any) => string | null> = {
      penjualan_periode: (x) => `/penjualan/${x.id}`, penjualan_pelanggan: (x) => `/penjualan/pelanggan/${x.id}`, penjualan_produk: (x) => `/master/produk/${x.pid}`,
      margin: (x) => x.link || null, pembelian_utang: (x) => (x.pid ? `/pengadaan/principal/${x.pid}` : null), pesanan_belum_diterima: (x) => `/pengadaan/${x.id}`,
      stok_gudang: (x) => `/stok?q=${encodeURIComponent(x.code)}`, pengiriman: (x) => `/stok/dok/${x.id}`,
      umur_piutang: (x) => (q.detail === 'true' ? `/penagihan/${x.id}` : `/penagihan?q=${encodeURIComponent(x.customer)}`), kas: (x) => `/akuntansi/jurnal/${x.id}`,
      status_bayar_po: (x) => `/pengadaan/${x.id}`, buku_besar: (x) => `/akuntansi/buku-besar?accountId=${x.id}`,
    };
    for (const row of r.rows) row.link = L[key]?.(row) ?? null;
    for (const row of r.rows) if (row.invoices) delete row.invoices;
    return r;
  }

  async compute(u: AuthUser, key: string, q: any): Promise<Report> {
    if (!(REPORTS_BY_GROUP[u.group] || []).includes(key)) throw new ForbiddenException('Laporan tidak tersedia untuk grup Anda');
    const { from, to } = period(q); const g = q.group || 'month';
    const per = `${tglIndo(from)} s.d. ${tglIndo(to)}`;
    const base = { key, title: REPORT_TITLES[key], period: per, filters: [] as string[] };
    const pid = q.partnerId ? Number(q.partnerId) : null, wid = q.warehouseId ? Number(q.warehouseId) : null;

    switch (key) {
      case 'penjualan_periode': {
        const rows = await this.q(sql`select so.id, so.name, so.date_confirm as date, p.name as customer, so.amount_untaxed::float as untaxed, so.amount_tax::float as tax, so.amount_total::float as total, so.invoice_status
          from sales_orders so join partners p on p.id = so.partner_id where so.state in ('sale','done') and so.date_confirm between ${from} and ${to}
          ${pid ? sql`and so.partner_id = ${pid}` : sql``} order by so.date_confirm, so.id`);
        rows.forEach((r) => (r.invoice_status = INV_STATUS[r.invoice_status] || r.invoice_status));
        // pengelompokan grafik: periode (bulan/kuartal/tahun), pelanggan, produk, atau principal
        const agg: Record<string, number> = {};
        const by = q.by || 'period';
        if (by === 'product' || by === 'principal') {
          const ls = await this.q(sql`select t.name as product, coalesce(sup.name, '-') as principal, l.price_subtotal::float as v from sales_order_lines l join sales_orders so on so.id = l.order_id
            join products pr on pr.id = l.product_id join product_templates t on t.id = pr.product_tmpl_id left join partners sup on sup.id = t.main_supplier_id
            where so.state in ('sale','done') and so.date_confirm between ${from} and ${to} ${pid ? sql`and so.partner_id = ${pid}` : sql``}`);
          for (const l of ls) agg[l[by]] = round2((agg[l[by]] || 0) + l.v);
        } else for (const r of rows) { const k = by === 'customer' ? r.customer : periodKey(r.date, g); agg[k] = round2((agg[k] || 0) + r.untaxed); }
        const cdata = Object.keys(agg).map((k) => ({ period: k, value: agg[k] }));
        if (by === 'period') cdata.sort((x, y) => x.period.localeCompare(y.period)); else cdata.sort((x, y) => y.value - x.value);
        base.filters.push('Kelompok: ' + ({ period: 'periode', customer: 'pelanggan', product: 'produk', principal: 'principal' } as any)[by]);
        return { ...base, columns: [{ key: 'name', title: 'Nomor SO' }, { key: 'date', title: 'Tanggal', type: 'date' }, { key: 'customer', title: 'Pelanggan' }, { key: 'untaxed', title: 'DPP', type: 'money' }, { key: 'tax', title: 'PPN', type: 'money' }, { key: 'total', title: 'Total', type: 'money' }, { key: 'invoice_status', title: 'Status tagih' }],
          rows, totals: { untaxed: sum(rows, 'untaxed'), tax: sum(rows, 'tax'), total: sum(rows, 'total') },
          chart: { type: by === 'period' ? 'line' : 'bar', x: 'period', series: [{ key: 'value', title: 'Penjualan (DPP)' }], data: cdata } };
      }
      case 'penjualan_pelanggan': {
        const rows = await this.q(sql`select p.id, p.name as customer, p.city, count(so.id)::int as orders, sum(so.amount_untaxed)::float as untaxed, sum(so.amount_total)::float as total
          from sales_orders so join partners p on p.id = so.partner_id where so.state in ('sale','done') and so.date_confirm between ${from} and ${to}
          group by p.id order by untaxed desc`);
        const all = sum(rows, 'untaxed');
        rows.forEach((r, i) => { r.rank = i + 1; r.share = all ? round2((r.untaxed / all) * 100) : 0; });
        return { ...base, columns: [{ key: 'rank', title: 'No' }, { key: 'customer', title: 'Pelanggan' }, { key: 'city', title: 'Kota' }, { key: 'orders', title: 'Jumlah SO', type: 'qty' }, { key: 'untaxed', title: 'DPP', type: 'money' }, { key: 'total', title: 'Total', type: 'money' }, { key: 'share', title: 'Porsi', type: 'pct' }],
          rows, totals: { orders: sum(rows, 'orders'), untaxed: all, total: sum(rows, 'total') },
          chart: { type: 'bar', x: 'customer', series: [{ key: 'untaxed', title: 'Sepuluh pelanggan terbesar' }], data: rows.slice(0, 10) } };
      }
      case 'penjualan_produk': {
        const rows = await this.q(sql`select pr.id as pid, pr.default_code as code, t.name as product, sup.name as principal, sum(l.product_uom_qty)::float as qty, u.name as uom, sum(l.price_subtotal)::float as subtotal
          from sales_order_lines l join sales_orders so on so.id = l.order_id join products pr on pr.id = l.product_id join product_templates t on t.id = pr.product_tmpl_id
          join units u on u.id = t.uom_id left join partners sup on sup.id = t.main_supplier_id
          where so.state in ('sale','done') and so.date_confirm between ${from} and ${to} ${pid ? sql`and t.main_supplier_id = ${pid}` : sql``}
          group by pr.id, t.name, sup.name, u.name order by subtotal desc`);
        const byP: Record<string, number> = {};
        for (const r of rows) byP[r.principal || '-'] = round2((byP[r.principal || '-'] || 0) + r.subtotal);
        return { ...base, columns: [{ key: 'code', title: 'Kode' }, { key: 'product', title: 'Produk' }, { key: 'principal', title: 'Principal' }, { key: 'qty', title: 'Kuantitas', type: 'qty' }, { key: 'uom', title: 'Satuan' }, { key: 'subtotal', title: 'Nilai', type: 'money' }],
          rows, totals: { subtotal: sum(rows, 'subtotal') },
          chart: { type: 'pie', x: 'principal', series: [{ key: 'value', title: 'Penjualan per principal' }], data: Object.entries(byP).map(([principal, value]) => ({ principal, value })) } };
      }
      case 'margin': {
        const lines = await this.q(sql`select so.id as soid, p.id as cid, pr.id as pid, so.name, so.date_confirm as date, p.name as customer, t.name as product, l.price_subtotal::float as revenue, (l.purchase_price * l.product_uom_qty)::float as cost
          from sales_order_lines l join sales_orders so on so.id = l.order_id join partners p on p.id = so.partner_id join products pr on pr.id = l.product_id join product_templates t on t.id = pr.product_tmpl_id
          where so.state in ('sale','done') and so.date_confirm between ${from} and ${to}`);
        const by = q.by || 'period';
        const keyOf = (r: any) => (by === 'customer' ? r.customer : by === 'product' ? r.product : by === 'order' ? r.name : periodKey(r.date, g));
        const agg: Record<string, any> = {};
        for (const l of lines) { const k = keyOf(l); agg[k] = agg[k] || { group: k, revenue: 0, cost: 0, link: by === 'customer' ? `/penjualan/pelanggan/${l.cid}` : by === 'product' ? `/master/produk/${l.pid}` : by === 'order' ? `/penjualan/${l.soid}` : null }; agg[k].revenue += l.revenue; agg[k].cost += l.cost; }
        const rows = Object.values(agg).map((r: any) => ({ link: r.link, group: r.group, revenue: round2(r.revenue), costTotal: round2(r.cost), marginTotal: round2(r.revenue - r.cost), marginPercent: r.revenue ? round2(((r.revenue - r.cost) / r.revenue) * 100) : 0 }))
          .sort((a, b) => (by === 'period' ? String(a.group).localeCompare(String(b.group)) : b.marginTotal - a.marginTotal));
        const rev = sum(rows, 'revenue'), cost = sum(rows, 'costTotal');
        base.filters.push('Kelompok: ' + ({ period: 'periode', customer: 'pelanggan', product: 'produk', order: 'sales order' } as any)[by]);
        return { ...base, columns: [{ key: 'group', title: by === 'customer' ? 'Pelanggan' : by === 'product' ? 'Produk' : by === 'order' ? 'Sales order' : 'Periode' }, { key: 'revenue', title: 'Penjualan', type: 'money' }, { key: 'costTotal', title: 'Harga pokok', type: 'money' }, { key: 'marginTotal', title: 'Margin', type: 'money' }, { key: 'marginPercent', title: 'Margin %', type: 'pct' }],
          rows, totals: { revenue: rev, costTotal: cost, marginTotal: round2(rev - cost), marginPercent: rev ? round2(((rev - cost) / rev) * 100) : 0 },
          chart: { type: 'bar', x: 'group', series: [{ key: 'revenue', title: 'Penjualan' }, { key: 'marginTotal', title: 'Margin' }], data: rows.slice(0, 12) } };
      }
      case 'pembelian_utang': {
        const po = await this.q(sql`select p.id, p.name as principal, coalesce(sum(po.amount_total),0)::float as purchased from purchase_orders po join partners p on p.id = po.partner_id
          where po.state in ('purchase','done') and po.date_order between ${from} and ${to} group by p.id`);
        const bills = await this.q(sql`select e.partner_id, p.name as principal, e.invoice_date_due as due, e.amount_residual::float as residual from journal_entries e join partners p on p.id = e.partner_id
          where e.move_type = 'in_invoice' and e.state = 'posted' and e.amount_residual > 0`);
        const map: Record<string, any> = {};
        for (const r of po) map[r.principal] = { pid: r.id, principal: r.principal, purchased: r.purchased, b0: 0, b30: 0, b60: 0, b90: 0, b91: 0, debt: 0 };
        for (const b of bills) {
          const m = (map[b.principal] = map[b.principal] || { pid: b.partner_id, principal: b.principal, purchased: 0, b0: 0, b30: 0, b60: 0, b90: 0, b91: 0, debt: 0 });
          const k = BUCKET_KEYS[BUCKETS.indexOf(bucketOf(daysBetween(b.due || today(), today())))];
          m[k] = round2(m[k] + b.residual); m.debt = round2(m.debt + b.residual);
        }
        const rows = Object.values(map).sort((a: any, b: any) => b.debt - a.debt);
        const cols: Col[] = [{ key: 'principal', title: 'Principal' }, { key: 'purchased', title: 'Pembelian periode', type: 'money' }, ...BUCKETS.map((b, i) => ({ key: BUCKET_KEYS[i], title: b === 'belum jatuh tempo' ? 'Belum jatuh tempo' : b + ' hari', type: 'money' as const })), { key: 'debt', title: 'Sisa utang', type: 'money' }];
        const totals: any = {}; for (const c of cols.slice(1)) totals[c.key] = sum(rows, c.key);
        return { ...base, columns: cols, rows, totals, chart: { type: 'bar', x: 'principal', series: [{ key: 'purchased', title: 'Pembelian' }, { key: 'debt', title: 'Sisa utang' }], data: rows } };
      }
      case 'pesanan_belum_diterima': {
        const rows = await this.q(sql`select po.id, po.name as po, p.name as principal, w.name as warehouse, t.name as product, l.product_qty::float as ordered, l.qty_received::float as received,
            (l.product_qty - l.qty_received)::float as remaining, coalesce(l.date_planned, po.date_planned) as planned, so.name as so
          from purchase_order_lines l join purchase_orders po on po.id = l.order_id join partners p on p.id = po.partner_id left join warehouses w on w.id = po.warehouse_id
          join products pr on pr.id = l.product_id join product_templates t on t.id = pr.product_tmpl_id left join sales_orders so on so.id = po.mtpp_sale_order_id
          where po.state = 'purchase' and po.mtpp_is_dropship = false and l.qty_received < l.product_qty ${pid ? sql`and po.partner_id = ${pid}` : sql``} order by planned nulls last, po.name`);
        const t = today();
        rows.forEach((r) => { r.late = r.planned && r.planned < t ? daysBetween(r.planned, t) : 0; r.status = r.late ? `terlambat ${r.late} hari` : 'tepat waktu'; });
        return { ...base, period: 'Posisi ' + tglIndo(t), columns: [{ key: 'po', title: 'Nomor PO' }, { key: 'so', title: 'Sales order' }, { key: 'principal', title: 'Principal' }, { key: 'product', title: 'Produk' }, { key: 'ordered', title: 'Dipesan', type: 'qty' }, { key: 'received', title: 'Diterima', type: 'qty' }, { key: 'remaining', title: 'Sisa', type: 'qty' }, { key: 'planned', title: 'Perkiraan tiba', type: 'date' }, { key: 'status', title: 'Status' }],
          rows, totals: { remaining: sum(rows, 'remaining') } };
      }
      case 'stok_gudang': {
        const rows = await this.stock.overview({ warehouseId: wid || undefined, q: q.q, low: q.low === 'true' });
        const agg: Record<string, any> = {};
        for (const r of rows) { agg[r.warehouse] = agg[r.warehouse] || { warehouse: r.warehouse, reserved: 0, free: 0 }; agg[r.warehouse].reserved += r.reserved; agg[r.warehouse].free += Math.max(r.free, 0); }
        return { ...base, period: 'Posisi ' + tglIndo(today()), columns: [{ key: 'warehouse', title: 'Gudang' }, { key: 'code', title: 'Kode' }, { key: 'product', title: 'Produk' }, { key: 'physical', title: 'Fisik', type: 'qty' }, { key: 'reserved', title: 'Terikat SO', type: 'qty' }, { key: 'free', title: 'Bebas', type: 'qty' }, { key: 'minQty', title: 'Minimum', type: 'qty' }, { key: 'status', title: 'Status' }],
          rows, totals: { physical: sum(rows, 'physical'), reserved: sum(rows, 'reserved'), free: sum(rows, 'free') },
          chart: { type: 'stacked', x: 'warehouse', series: [{ key: 'reserved', title: 'Stok terikat' }, { key: 'free', title: 'Stok bebas' }], data: Object.values(agg) } };
      }
      case 'pengiriman': {
        const rows = await this.q(sql`select tr.id, tr.name, so.name as so, p.name as customer, tr.scheduled_date as planned, tr.date_done::date::text as done, tr.state, tt.code as type,
            (select coalesce(sum(m.quantity),0) from stock_moves m where m.picking_id = tr.id)::float as qty
          from stock_transfers tr join transfer_types tt on tt.id = tr.picking_type_id left join sales_orders so on so.id = tr.sale_id left join partners p on p.id = tr.partner_id
          where tt.code in ('outgoing','dropship') and tr.state = 'done' and tr.date_done::date between ${from} and ${to} order by tr.date_done`);
        rows.forEach((r) => { r.state = TR_STATE[r.state]; r.type = r.type === 'dropship' ? 'dropship' : 'gudang'; r.onTime = r.planned && r.done > r.planned ? 'terlambat' : 'tepat waktu'; });
        const agg: Record<string, number> = {};
        for (const r of rows) agg[periodKey(r.done, g === 'month' ? 'month' : g)] = (agg[periodKey(r.done, g)] || 0) + 1;
        return { ...base, columns: [{ key: 'name', title: 'Nomor DO' }, { key: 'so', title: 'Sales order' }, { key: 'customer', title: 'Pelanggan' }, { key: 'type', title: 'Rute' }, { key: 'planned', title: 'Rencana kirim', type: 'date' }, { key: 'done', title: 'Tanggal kirim', type: 'date' }, { key: 'qty', title: 'Kuantitas', type: 'qty' }, { key: 'onTime', title: 'Ketepatan' }],
          rows, totals: { qty: sum(rows, 'qty') }, chart: { type: 'bar', x: 'period', series: [{ key: 'count', title: 'Jumlah surat jalan' }], data: Object.keys(agg).sort().map((k) => ({ period: k, count: agg[k] })) } };
      }
      case 'umur_piutang': {
        const inv = await this.q(sql`select e.id, e.name, e.partner_id, p.name as customer, e.invoice_date as date, e.invoice_date_due as due, e.amount_total::float as total, e.amount_residual::float as residual
          from journal_entries e join partners p on p.id = e.partner_id where e.move_type = 'out_invoice' and e.state = 'posted' and e.amount_residual > 0
          ${pid ? sql`and e.partner_id = ${pid}` : sql``} order by p.name, e.invoice_date_due`);
        const t = today(); const map: Record<string, any> = {};
        for (const i of inv) {
          const days = daysBetween(i.due || i.date, t); i.days = Math.max(days, 0); i.bucket = bucketOf(days);
          const m = (map[i.customer] = map[i.customer] || { pid: i.partner_id, customer: i.customer, b0: 0, b30: 0, b60: 0, b90: 0, b91: 0, total: 0, invoices: [] });
          const k = BUCKET_KEYS[BUCKETS.indexOf(i.bucket)]; m[k] = round2(m[k] + i.residual); m.total = round2(m.total + i.residual); m.invoices.push(i);
        }
        const rows = q.detail === 'true' ? inv : Object.values(map).sort((a: any, b: any) => b.total - a.total);
        const cols: Col[] = q.detail === 'true'
          ? [{ key: 'name', title: 'Invoice' }, { key: 'customer', title: 'Pelanggan' }, { key: 'date', title: 'Tanggal', type: 'date' }, { key: 'due', title: 'Jatuh tempo', type: 'date' }, { key: 'days', title: 'Terlambat (hari)', type: 'qty' }, { key: 'bucket', title: 'Kelompok' }, { key: 'residual', title: 'Sisa piutang', type: 'money' }]
          : [{ key: 'customer', title: 'Pelanggan' }, ...BUCKETS.map((b, i) => ({ key: BUCKET_KEYS[i], title: b === 'belum jatuh tempo' ? 'Belum jatuh tempo' : b + ' hari', type: 'money' as const })), { key: 'total', title: 'Total piutang', type: 'money' }];
        const totals: any = {}; for (const c of cols) if (c.type === 'money') totals[c.key] = sum(rows, c.key);
        const chartData = BUCKETS.map((b, i) => ({ bucket: b, value: sum(Object.values(map), BUCKET_KEYS[i]) }));
        return { ...base, period: 'Posisi ' + tglIndo(t), columns: cols, rows, totals, chart: { type: 'bar', x: 'bucket', series: [{ key: 'value', title: 'Sisa piutang' }], data: chartData } };
      }
      case 'kas': {
        const rows = await this.q(sql`select e.id, e.date, e.name, coalesce(e.ref, l.name) as memo, a.name as account, j.code as journal, l.debit::float as receipt, l.credit::float as expense, p.name as partner
          from journal_entry_lines l join journal_entries e on e.id = l.move_id join accounts a on a.id = l.account_id join journals j on j.id = e.journal_id left join partners p on p.id = e.partner_id
          where e.state = 'posted' and j.type in ('cash','bank') and l.account_id = j.default_account_id and e.date between ${from} and ${to} order by e.date, e.id`);
        const [op] = await this.q(sql`select coalesce(sum(l.debit - l.credit),0)::float as b from journal_entry_lines l join journal_entries e on e.id = l.move_id join journals j on j.id = e.journal_id
          where e.state = 'posted' and j.type in ('cash','bank') and l.account_id = j.default_account_id and e.date < ${from}`);
        let run = op?.b || 0; rows.forEach((r) => { run = round2(run + r.receipt - r.expense); r.balance = run; });
        const agg: Record<string, any> = {};
        for (const r of rows) { const k = periodKey(r.date, g); agg[k] = agg[k] || { period: k, receipt: 0, expense: 0 }; agg[k].receipt += r.receipt; agg[k].expense += r.expense; }
        base.filters.push(`Saldo awal ${rupiah(op?.b || 0)}`);
        return { ...base, columns: [{ key: 'date', title: 'Tanggal', type: 'date' }, { key: 'name', title: 'Nomor' }, { key: 'journal', title: 'Jurnal' }, { key: 'partner', title: 'Partner' }, { key: 'memo', title: 'Keterangan' }, { key: 'receipt', title: 'Penerimaan', type: 'money' }, { key: 'expense', title: 'Pengeluaran', type: 'money' }, { key: 'balance', title: 'Saldo', type: 'money' }],
          rows, totals: { receipt: sum(rows, 'receipt'), expense: sum(rows, 'expense'), balance: run },
          chart: { type: 'bar', x: 'period', series: [{ key: 'receipt', title: 'Penerimaan' }, { key: 'expense', title: 'Pengeluaran' }], data: Object.values(agg) } };
      }
      case 'status_bayar_po': {
        const rows = await this.q(sql`select po.id, po.name, p.name as principal, so.name as so, po.date_order as date, po.amount_total::float as total,
            (select coalesce(sum(e.amount_total),0) from journal_entries e where e.mtpp_purchase_order_id = po.id and e.move_type = 'in_invoice' and e.state = 'posted')::float as billed,
            po.mtpp_amount_due::float as due, po.mtpp_payment_state as status
          from purchase_orders po join partners p on p.id = po.partner_id left join sales_orders so on so.id = po.mtpp_sale_order_id
          where po.state in ('purchase','done') and po.date_order between ${from} and ${to} ${pid ? sql`and po.partner_id = ${pid}` : sql``} order by po.date_order, po.id`);
        const agg: Record<string, number> = {}; for (const r of rows) agg[r.status] = (agg[r.status] || 0) + 1;
        return { ...base, columns: [{ key: 'name', title: 'Nomor PO' }, { key: 'so', title: 'Sales order' }, { key: 'principal', title: 'Principal' }, { key: 'date', title: 'Tanggal', type: 'date' }, { key: 'total', title: 'Nilai PO', type: 'money' }, { key: 'billed', title: 'Ditagih', type: 'money' }, { key: 'due', title: 'Sisa utang', type: 'money' }, { key: 'status', title: 'Status bayar' }],
          rows, totals: { total: sum(rows, 'total'), billed: sum(rows, 'billed'), due: sum(rows, 'due') },
          chart: { type: 'pie', x: 'status', series: [{ key: 'count', title: 'Jumlah PO' }], data: Object.entries(agg).map(([status, count]) => ({ status, count })) } };
      }
      case 'buku_besar': {
        const rows = await this.q(sql`
          select a.id, a.code_store as code, a.name, a.account_type as type,
            coalesce(sum(case when e.date < ${from} then l.debit - l.credit end),0)::float as opening,
            coalesce(sum(case when e.date between ${from} and ${to} then l.debit end),0)::float as debit,
            coalesce(sum(case when e.date between ${from} and ${to} then l.credit end),0)::float as credit
          from accounts a left join (journal_entry_lines l join journal_entries e on e.id = l.move_id and e.state = 'posted' and e.date <= ${to}) on l.account_id = a.id
          ${q.accountId ? sql`where a.id = ${Number(q.accountId)}` : sql``}
          group by a.id order by a.code_store`);
        rows.forEach((r) => (r.closing = round2(r.opening + r.debit - r.credit)));
        const list = q.all === 'true' ? rows : rows.filter((r) => r.opening || r.debit || r.credit);
        return { ...base, columns: [{ key: 'code', title: 'Kode' }, { key: 'name', title: 'Akun' }, { key: 'type', title: 'Jenis' }, { key: 'opening', title: 'Saldo awal', type: 'money' }, { key: 'debit', title: 'Debit', type: 'money' }, { key: 'credit', title: 'Kredit', type: 'money' }, { key: 'closing', title: 'Saldo akhir', type: 'money' }],
          rows: list, totals: { debit: sum(list, 'debit'), credit: sum(list, 'credit') } };
      }
    }
    fail('Laporan tidak dikenal');
  }
}

const fmt = (v: any, c: Col) => {
  if (v == null || v === '') return '';
  if (c.type === 'money') return num(v);
  if (c.type === 'qty') return num(v, Number(v) % 1 ? 2 : 0);
  if (c.type === 'pct') return num(v, 2) + '%';
  if (c.type === 'date') return tglIndo(String(v));
  return String(v);
};

@Controller('reports')
export class ReportsController {
  constructor(private r: ReportsService, private pdf: PdfService, private settings: SettingsService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return (REPORTS_BY_GROUP[u.group] || []).map((k) => ({ key: k, title: REPORT_TITLES[k] })); }
  @Get(':key') get(@CurrentUser() u: AuthUser, @Param('key') key: string, @Query() q: any) { return this.r.build(u, key, q); }

  // Ekspor laporan ke spreadsheet atau PDF: judul, periode, filter, tanggal cetak, seluruh baris
  @Get(':key/export')
  async export(@CurrentUser() u: AuthUser, @Param('key') key: string, @Query() q: any, @Res() res: Response) {
    const rep = await this.r.build(u, key, q);
    const company = await this.settings.get('company');
    const printed = `Dicetak ${tglIndo(today())} oleh ${u.name}`;
    const fname = `${rep.title.replace(/\W+/g, '_')}_${today()}`;
    const totalRow = rep.totals ? rep.columns.map((c, i) => (i === 0 ? 'Total' : rep.totals[c.key] !== undefined ? rep.totals[c.key] : null)) : null;
    if (q.format === 'pdf') {
      const rows = rep.rows.map((r) => rep.columns.map((c) => fmt(r[c.key], c)));
      if (totalRow) rows.push(totalRow.map((v, i) => (i === 0 ? 'Total' : v == null ? '' : fmt(v, rep.columns[i]))));
      const buf = await this.pdf.table(rep.title, ['Periode: ' + rep.period, ...rep.filters, printed], rep.columns.map((c) => ({ h: c.title, align: ['money', 'qty', 'pct'].includes(c.type) ? 'right' : 'left' })), rows, rep.columns.length > 6);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname}.pdf"` }).send(buf);
      return;
    }
    const wb = new ExcelJS.Workbook(); wb.creator = 'Sistem Distribusi MTPP';
    const ws = wb.addWorksheet(rep.title.slice(0, 30));
    ws.addRow([rep.title]).font = { bold: true, size: 14 };
    ws.addRow([company.name]); ws.addRow(['Periode: ' + rep.period]);
    for (const f of rep.filters) ws.addRow([f]);
    ws.addRow([printed]); ws.addRow([]);
    const h = ws.addRow(rep.columns.map((c) => c.title));
    h.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A4A' } }; });
    for (const r of rep.rows) ws.addRow(rep.columns.map((c) => (['money', 'qty', 'pct'].includes(c.type) ? Number(r[c.key] ?? 0) : c.type === 'date' && r[c.key] ? String(r[c.key]).slice(0, 10) : r[c.key] ?? '')));
    if (totalRow) ws.addRow(totalRow).font = { bold: true };
    rep.columns.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c.type === 'money' ? 18 : c.type ? 12 : 28; if (c.type === 'money') col.numFmt = '#,##0'; });
    const buf = await wb.xlsx.writeBuffer();
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fname}.xlsx"` }).send(Buffer.from(buf as ArrayBuffer));
  }
}

@Module({ imports: [StockModule], controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}
