import { Controller, Get, Inject, Module } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser, CurrentUser } from '../../common/auth';
import { addDays, daysBetween, round2, today } from '../../common/util';
import { StockModule } from '../stock/stock.module';
import { StockService } from '../stock/stock.service';
import { SalesModule } from '../sales/sales.module';
import { SalesService } from '../sales/sales.service';
import { Prisma } from '@prisma/client';

const sql = Prisma.sql;

// Dashboard per peran (fitur A.b): angka dan grafik dari data transaksi terbaru
@Controller('dashboard')
export class DashboardController {
  constructor(
    @Inject(DB) private db: Db,
    private stock: StockService,
    private sales: SalesService,
  ) {}
  private async q(query: any) {
    return (await this.db.$queryRaw(query)) as any[];
  }
  private async one(query: any) {
    return (await this.q(query))[0] || {};
  }

  @Get()
  async get(@CurrentUser() u: AuthUser) {
    const t = today();
    const m0 = t.slice(0, 8) + '01';
    const out: any = {
      group: u.group,
      groupName: u.groupName,
      name: u.name,
      today: t,
      kpis: [],
      charts: [],
      lists: [],
    };
    const k = (key: string, label: string, value: number, opts: any = {}) =>
      out.kpis.push({ key, label, value, ...opts });

    // aktivitas milik pengguna (semua peran)
    const acts = await this.q(
      sql`select id, res_model, res_id, res_name, summary, date_deadline from activities where user_id = ${u.id} and done = false order by date_deadline limit 8`,
    );
    out.activities = acts.map((a) => ({ ...a, overdue: a.date_deadline < t }));
    const lowRows = u.perms.stok?.read ? await this.stock.overview({ low: true }) : [];
    out.lowStock = lowRows.length;

    const sales6 = async () => {
      const rows = await this.q(
        sql`select to_char(date_confirm::date,'YYYY-MM') as period, sum(amount_untaxed)::float as value from sales_orders where state in ('sale','done') and date_confirm >= ${addDays(m0, -210).slice(0, 8) + '01'} group by 1 order by 1`,
      );
      return {
        key: 'sales6',
        title: 'Penjualan per bulan (DPP)',
        type: 'bar',
        x: 'period',
        series: [{ key: 'value', title: 'Penjualan' }],
        data: rows,
      };
    };
    const aging = async () => {
      const inv = await this.q(
        sql`select invoice_date_due as due, amount_residual::float as r from journal_entries where move_type = 'out_invoice' and state = 'posted' and amount_residual > 0`,
      );
      const b = { 'belum jatuh tempo': 0, '1-30': 0, '31-60': 0, '61-90': 0, '> 90': 0 } as Record<string, number>;
      for (const i of inv) {
        const d = daysBetween(i.due || t, t);
        const key = d <= 0 ? 'belum jatuh tempo' : d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '> 90';
        b[key] = round2(b[key] + i.r);
      }
      return {
        key: 'aging',
        title: 'Umur piutang',
        type: 'bar',
        x: 'bucket',
        series: [{ key: 'value', title: 'Sisa piutang' }],
        data: Object.entries(b).map(([bucket, value]) => ({ bucket, value })),
      };
    };
    const overdue = async () =>
      this.one(
        sql`select count(*)::int as n, coalesce(sum(amount_residual),0)::float as v from journal_entries where move_type = 'out_invoice' and state = 'posted' and amount_residual > 0 and invoice_date_due < ${t}`,
      );
    const cash = async () =>
      this.one(
        sql`select coalesce(sum(l.debit - l.credit),0)::float as v from journal_entry_lines l join journal_entries e on e.id = l.move_id join journals j on j.id = e.journal_id where e.state = 'posted' and j.type in ('cash','bank') and l.account_id = j.default_account_id`,
      );

    switch (u.group) {
      case 'PIMPINAN': {
        // susunan mengikuti mockup beranda (Gambar 3.3): penjualan, penawaran, pengiriman, piutang; lalu pengadaan, stok, dan kas
        const pm0 = addDays(m0, -1).slice(0, 8) + '01';
        const s = await this.one(
          sql`select coalesce(sum(amount_untaxed),0)::float as v, count(*)::int as n from sales_orders where state in ('sale','done') and date_confirm >= ${m0}`,
        );
        const sp = await this.one(
          sql`select coalesce(sum(amount_untaxed),0)::float as v from sales_orders where state in ('sale','done') and date_confirm >= ${pm0} and date_confirm < ${m0}`,
        );
        const qs = await this.one(
          sql`select count(distinct res_id)::int as n from email_logs where model = 'sales_orders' and (document_name like 'PN/%' or document_name like 'SO/%') and sent_at >= ${m0}::date`,
        );
        const qw = await this.one(sql`select count(*)::int as n from sales_orders where state = 'sent'`);
        const wk = addDays(t, -((new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7));
        const dl = await this
          .one(sql`select count(*) filter (where tr.state = 'done' and tr.date_done::date >= ${wk})::int as done,
            count(*) filter (where tr.state not in ('done','cancel') and tr.scheduled_date < ${t})::int as late
          from stock_transfers tr join transfer_types tt on tt.id = tr.picking_type_id where tt.code in ('outgoing','dropship')`);
        const mg = await this.one(
          sql`select coalesce(sum(l.price_subtotal - l.purchase_price * l.product_uom_qty),0)::float as v from sales_order_lines l join sales_orders so on so.id = l.order_id where so.state in ('sale','done') and so.date_confirm >= ${m0}`,
        );
        const debt = await this.one(
          sql`select coalesce(sum(amount_residual),0)::float as v, count(*)::int as n from journal_entries where move_type = 'in_invoice' and state = 'posted' and amount_residual > 0`,
        );
        const od = await overdue();
        const c = await cash();
        const growth = sp.v ? round2(((s.v - sp.v) / sp.v) * 100) : null;
        k('sales', 'Penjualan bulan ini', s.v, {
          money: true,
          hint:
            growth === null
              ? `${s.n} sales order`
              : `${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)}% dibanding bulan lalu`,
          tone: growth !== null && growth >= 0 ? 'success' : undefined,
          link: '/laporan/penjualan_periode',
        });
        k('quotes', 'Penawaran terkirim', qs.n, {
          hint: `${qw.n} menunggu jawaban pelanggan`,
          link: '/penjualan?tab=quote',
        });
        k('deliveries', 'Pengiriman minggu ini', dl.done, {
          hint: dl.late ? `${dl.late} melewati tanggal rencana` : 'tidak ada yang terlambat',
          tone: dl.late ? 'danger' : undefined,
          link: '/laporan/pengiriman',
        });
        k('overdue', 'Piutang jatuh tempo', od.v, {
          money: true,
          hint: `${od.n} invoice belum dibayar`,
          tone: od.n ? 'danger' : undefined,
          link: '/laporan/umur_piutang',
        });
        k('margin', 'Margin bulan ini', mg.v, {
          money: true,
          hint: s.v ? `${round2((mg.v / s.v) * 100)}% dari penjualan` : '\u00a0',
          link: '/laporan/margin',
        });
        k('debt', 'Utang principal', debt.v, {
          money: true,
          hint: `${debt.n} tagihan belum lunas`,
          link: '/laporan/pembelian_utang',
        });
        k('low', 'Stok rendah', lowRows.length, {
          hint: 'produk di bawah stok minimum',
          tone: lowRows.length ? 'warning' : undefined,
          link: '/laporan/stok_gudang?low=true',
        });
        k('cash', 'Saldo kas dan bank', c.v, { money: true, link: '/laporan/kas' });
        out.charts.push(await sales6(), await aging());
        out.lists.push({
          key: 'top',
          title: 'Pelanggan terbesar bulan ini',
          columns: ['Pelanggan', 'Penjualan'],
          rows: (
            await this.q(
              sql`select p.name, sum(so.amount_untaxed)::float as v from sales_orders so join partners p on p.id = so.partner_id where so.state in ('sale','done') and so.date_confirm >= ${m0} group by p.name order by v desc limit 5`,
            )
          ).map((r) => [r.name, { money: r.v }]),
        });
        break;
      }
      case 'SALES': {
        const qo = await this.one(
          sql`select count(*)::int as n, coalesce(sum(amount_total),0)::float as v from sales_orders where state in ('draft','sent')`,
        );
        const exp = await this.one(
          sql`select count(*)::int as n from sales_orders where state in ('draft','sent') and validity_date < ${t}`,
        );
        const so = await this.one(
          sql`select count(*)::int as n, coalesce(sum(amount_untaxed),0)::float as v from sales_orders where state in ('sale','done') and date_confirm >= ${m0}`,
        );
        const em = await this.one(
          sql`select count(*)::int as n from email_logs where state in ('gagal','ditolak') and sent_at > now() - interval '14 days'`,
        );
        k('quotes', 'Penawaran terbuka', qo.n, {
          hint: `nilai Rp ${Math.round(qo.v).toLocaleString('id-ID')}`,
          link: '/penjualan?tab=quote',
        });
        k('expired', 'Penawaran kedaluwarsa', exp.n, {
          tone: exp.n ? 'warning' : undefined,
          link: '/penjualan?tab=quote&expired=true',
        });
        k('orders', 'Sales order bulan ini', so.v, {
          money: true,
          hint: `${so.n} pesanan`,
          link: '/penjualan?tab=order',
        });
        k('email', 'Email gagal (14 hari)', em.n, {
          tone: em.n ? 'danger' : undefined,
          link: '/pengaturan/email?state=gagal',
        });
        out.charts.push(await sales6());
        out.lists.push({
          key: 'recent',
          title: 'Penawaran terbaru',
          columns: ['Nomor', 'Pelanggan', 'Total', 'Status'],
          rows: (
            await this.q(
              sql`select so.id, so.name, p.name as c, so.amount_total::float as v, so.state from sales_orders so join partners p on p.id = so.partner_id order by so.id desc limit 6`,
            )
          ).map((r) => [{ text: r.name, link: `/penjualan/${r.id}` }, r.c, { money: r.v }, { tag: r.state }]),
        });
        break;
      }
      case 'OPERASIONAL': {
        const rc = await this.one(
          sql`select count(*)::int as n, count(*) filter (where tr.scheduled_date < ${t})::int as late from stock_transfers tr join transfer_types tt on tt.id = tr.picking_type_id where tt.code = 'incoming' and tr.state in ('waiting','assigned','draft')`,
        );
        const dl = await this.one(
          sql`select count(*)::int as n, count(*) filter (where tr.scheduled_date < ${t})::int as late, count(*) filter (where tr.scheduled_date = ${t})::int as today from stock_transfers tr join transfer_types tt on tt.id = tr.picking_type_id where tt.code in ('outgoing','dropship') and tr.state in ('waiting','assigned','draft')`,
        );
        k('receipts', 'Penerimaan menunggu', rc.n, {
          hint: `${rc.late} terlambat`,
          tone: rc.late ? 'warning' : undefined,
          link: '/stok/penerimaan',
        });
        const ready = await this.sales.readyToShip();
        k('ready_ship', 'Siap Dikirim', ready.length, {
          hint: 'sales order belum dibuatkan surat jalan',
          tone: ready.length ? 'warning' : undefined,
          link: '/stok/siap-dikirim',
        });
        k('deliveries', 'Surat jalan belum dikirim', dl.n, {
          hint: `${dl.today} dijadwalkan hari ini`,
          link: '/stok/surat-jalan',
        });
        k('late', 'Pengiriman terlambat', dl.late, {
          tone: dl.late ? 'danger' : undefined,
          link: '/stok/surat-jalan?late=true',
        });
        k('low', 'Stok rendah', lowRows.length, {
          tone: lowRows.length ? 'warning' : undefined,
          link: '/stok?low=true',
        });
        const st = await this.stock.overview({});
        const agg: Record<string, any> = {};
        for (const r of st) {
          agg[r.warehouse] = agg[r.warehouse] || { warehouse: r.warehouse, reserved: 0, free: 0 };
          agg[r.warehouse].reserved += r.reserved;
          agg[r.warehouse].free += Math.max(r.free, 0);
        }
        out.charts.push({
          key: 'stock',
          title: 'Stok per gudang',
          type: 'stacked',
          x: 'warehouse',
          series: [
            { key: 'reserved', title: 'Terikat' },
            { key: 'free', title: 'Bebas' },
          ],
          data: Object.values(agg),
        });
        out.lists.push({
          key: 'schedule',
          title: 'Jadwal pengiriman',
          columns: ['Nomor', 'Pelanggan', 'Rencana', 'Status'],
          rows: (
            await this.q(
              sql`select tr.id, tr.name, p.name as c, tr.scheduled_date as d, tr.state from stock_transfers tr join transfer_types tt on tt.id = tr.picking_type_id left join partners p on p.id = tr.partner_id where tt.code in ('outgoing','dropship') and tr.state not in ('done','cancel') order by tr.scheduled_date nulls last limit 8`,
            )
          ).map((r) => [
            { text: r.name, link: `/stok/dok/${r.id}` },
            r.c,
            { date: r.d, late: r.d && r.d < t },
            { tag: r.state, kind: 'tr' },
          ]),
        });
        out.lists.push({
          key: 'low',
          title: 'Stok rendah',
          columns: ['Produk', 'Gudang', 'Bebas', 'Minimum'],
          rows: lowRows.slice(0, 8).map((r) => [r.product, r.warehouse, r.free, r.minQty]),
        });
        break;
      }
      case 'FINANCE': {
        const ti = await this.one(
          sql`select count(*)::int as n from sales_orders where state = 'sale' and invoice_status in ('to_invoice','partial')`,
        );
        const od = await overdue();
        const bills = await this.one(
          sql`select count(*)::int as n, coalesce(sum(amount_residual),0)::float as v from journal_entries where move_type = 'in_invoice' and state = 'posted' and amount_residual > 0 and invoice_date_due <= ${addDays(t, 7)}`,
        );
        const c = await cash();
        const need = await this.sales.needPurchase();
        k('need_po', 'Perlu PO Principal', need.length, {
          hint: 'sales order kekurangan stok',
          tone: need.length ? 'warning' : undefined,
          link: '/pengadaan/perlu-pesanan',
        });
        const pre = await this
          .q(sql`select so.id, so.name, p.name as c, so.amount_total::float as total, coalesce((select sum(case when payment_type = 'outbound' then -amount else amount end) from payments where mtpp_sale_order_id = so.id and state <> 'cancel'),0)::float as paid
          from sales_orders so join partners p on p.id = so.partner_id where so.state = 'sale' and p.mtpp_is_new_customer = true order by so.id desc`);
        const unpaid = pre.filter((r) => r.paid < r.total - 0.5);
        const bank = await this.one(
          sql`select count(*)::int as n from bank_statement_lines where is_reconciled = false`,
        );
        k('toinvoice', 'Sales order siap ditagih', ti.n, { link: '/penagihan/siap' });
        k('overdue', 'Piutang jatuh tempo', od.v, {
          money: true,
          hint: `${od.n} invoice`,
          tone: od.n ? 'danger' : undefined,
          link: '/laporan/umur_piutang',
        });
        k('bills', 'Tagihan principal ≤ 7 hari', bills.v, {
          money: true,
          hint: `${bills.n} tagihan`,
          link: '/pengadaan/tagihan',
        });
        k('cash', 'Saldo kas dan bank', c.v, {
          money: true,
          hint: `${bank.n} mutasi bank belum cocok`,
          link: '/akuntansi/kas',
        });
        out.charts.push(await aging());
        out.lists.push({
          key: 'due',
          title: 'Invoice mendekati jatuh tempo (7 hari)',
          columns: ['Invoice', 'Pelanggan', 'Jatuh tempo', 'Sisa'],
          rows: (
            await this
              .q(sql`select e.id, e.name, p.name as c, e.invoice_date_due as d, e.amount_residual::float as v from journal_entries e join partners p on p.id = e.partner_id
          where e.move_type = 'out_invoice' and e.state = 'posted' and e.amount_residual > 0 and e.invoice_date_due <= ${addDays(t, 7)} order by e.invoice_date_due limit 8`)
          ).map((r) => [
            { text: r.name, link: `/penagihan/${r.id}` },
            r.c,
            { date: r.d, late: r.d < t },
            { money: r.v },
          ]),
        });
        out.lists.push({
          key: 'proforma',
          title: 'Pelanggan baru menunggu pelunasan',
          columns: ['Sales order', 'Pelanggan', 'Total', 'Sudah dibayar'],
          rows: unpaid
            .slice(0, 8)
            .map((r) => [{ text: r.name, link: `/penjualan/${r.id}` }, r.c, { money: r.total }, { money: r.paid }]),
        });
        break;
      }
      case 'ADMIN': {
        const cnt = await this
          .one(sql`select (select count(*) from users where active)::int as users, (select count(*) from partners where customer_rank > 0 and active and type = 'company')::int as customers,
          (select count(*) from partners where supplier_rank > 0 and active)::int as principals, (select count(*) from products where active)::int as products,
          (select count(*) from email_logs where state in ('gagal','ditolak'))::int as email`);
        k('users', 'Pengguna aktif', cnt.users, { link: '/pengaturan/pengguna' });
        k('customers', 'Pelanggan', cnt.customers, { link: '/master/pelanggan' });
        k('principals', 'Principal dan gudang', cnt.principals, { link: '/master/principal' });
        k('products', 'Produk', cnt.products, { link: '/master/produk' });
        out.lists.push({
          key: 'email',
          title: 'Email gagal terkirim',
          columns: ['Dokumen', 'Penerima', 'Status'],
          rows: (
            await this.q(
              sql`select document_name, email_to, state from email_logs where state in ('gagal','ditolak') order by id desc limit 8`,
            )
          ).map((r) => [r.document_name, r.email_to, { tag: r.state }]),
        });
        break;
      }
    }
    return out;
  }
}

@Module({ imports: [StockModule, SalesModule], controllers: [DashboardController] })
export class DashboardModule {}
