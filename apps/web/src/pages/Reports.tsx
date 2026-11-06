import { Button, DatePicker, Radio, Segmented, Select, Switch, Table } from 'antd';
import { useState } from 'react';
import { BarChartOutlined, FilePdfOutlined, FileExcelOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import { useFetch, useQueryState } from '../hooks';
import { nf, openFile, tgl } from '../lib';
import { PageHead, Pill } from '../components/ui';
import Chart from '../components/Chart';

const DESC: Record<string, string> = {
  penjualan_periode: 'Sales order terkonfirmasi per bulan, kuartal, atau tahun.',
  penjualan_pelanggan: 'Sepuluh pelanggan terbesar dan porsi penjualannya.',
  penjualan_produk: 'Kuantitas dan nilai per produk serta principal.',
  margin: 'Selisih harga jual dan harga pokok per periode, pelanggan, atau produk.',
  pembelian_utang: 'Nilai pembelian dan sisa utang per principal menurut umur tagihan.',
  pesanan_belum_diterima: 'Barang yang dipesan dari principal tetapi belum tiba.',
  stok_gudang: 'Stok fisik, terikat, dan bebas per gudang principal.',
  pengiriman: 'Surat jalan yang sudah divalidasi per periode.',
  umur_piutang: 'Invoice belum lunas: belum jatuh tempo, 1–30, 31–60, 61–90, dan lebih dari 90 hari.',
  kas: 'Penerimaan dan pengeluaran kas dan bank beserta saldonya.',
  status_bayar_po: 'Status pembayaran setiap PO Principal.',
  buku_besar: 'Saldo awal, mutasi, dan saldo akhir setiap akun (neraca saldo).',
};
const SNAPSHOT = ['stok_gudang', 'umur_piutang', 'pesanan_belum_diterima'];
const GROUPABLE = ['penjualan_periode', 'kas', 'pengiriman', 'margin'];
const CHART_KINDS: Record<string, string> = { bar: 'Batang', line: 'Garis', pie: 'Pie', stacked: 'Bertumpuk' };

export function ReportsHome() {
  const list = useFetch<any[]>('/reports');
  const nav = useNavigate();
  return (
    <>
      <PageHead
        title="Laporan"
        sub="Grafik dan tabel rinci dihitung langsung dari data transaksi; dapat diekspor ke spreadsheet atau PDF."
      />
      <div className="kpis">
        {(list.data || []).map((r) => (
          <div key={r.key} className="kpi link" onClick={() => nav(`/laporan/${r.key}`)}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <BarChartOutlined style={{ color: '#90241D', fontSize: 18 }} />
              <b style={{ fontSize: 16 }}>{r.title}</b>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              {DESC[r.key]}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function ReportView() {
  const { key } = useParams();
  const nav = useNavigate();
  const [kind, setKind] = useState<string>('auto');
  const [qs, set] = useQueryState({ range: SNAPSHOT.includes(key!) ? '' : 'month', group: 'month', by: 'period' });
  const params: any = { ...qs };
  if (qs.from) delete params.range;
  const rep = useFetch<any>(`/reports/${key}`, params);
  const sup = useFetch<any[]>(
    ['penjualan_produk', 'pesanan_belum_diterima', 'status_bayar_po'].includes(key!) ? '/partners' : null,
    { kind: 'supplier' },
  );
  const cus = useFetch<any[]>(['penjualan_periode', 'umur_piutang'].includes(key!) ? '/partners' : null, {
    kind: 'customer',
  });
  const wh = useFetch<any[]>(key === 'stok_gudang' ? '/warehouses' : null);
  const r = rep.data;
  const qstr = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as any).toString();
  const fmt = (c: any) => (v: any) =>
    v == null || v === '' ? (
      ''
    ) : c.type === 'money' ? (
      nf(v)
    ) : c.type === 'qty' ? (
      nf(v, Number(v) % 1 ? 2 : 0)
    ) : c.type === 'pct' ? (
      `${nf(v, 1)}%`
    ) : c.type === 'date' ? (
      tgl(v)
    ) : c.key === 'status' ? (
      <Pill v={v} />
    ) : (
      v
    );
  const cols = (r?.columns || []).map((c: any) => ({
    title: c.title,
    dataIndex: c.key,
    align: ['money', 'qty', 'pct'].includes(c.type) ? 'right' : undefined,
    render: fmt(c),
    sorter: ['money', 'qty', 'pct'].includes(c.type)
      ? (a: any, b: any) => Number(a[c.key] || 0) - Number(b[c.key] || 0)
      : undefined,
  }));
  return (
    <>
      <PageHead
        crumb={{ label: 'Laporan', to: '/laporan' }}
        title={r?.title || ''}
        sub={
          r && (
            <>
              {r.period}
              {r.filters?.length ? ' · ' + r.filters.join(' · ') : ''}
            </>
          )
        }
        extra={
          <>
            <Button icon={<FileExcelOutlined />} onClick={() => openFile(`/reports/${key}/export?format=xlsx&${qstr}`)}>
              Spreadsheet
            </Button>
            <Button icon={<FilePdfOutlined />} onClick={() => openFile(`/reports/${key}/export?format=pdf&${qstr}`)}>
              PDF
            </Button>
          </>
        }
      />
      <div className="toolbar">
        {!SNAPSHOT.includes(key!) && (
          <>
            <Radio.Group
              optionType="button"
              value={qs.from ? 'custom' : qs.range}
              onChange={(e) =>
                e.target.value !== 'custom' && set({ range: e.target.value, from: undefined, to: undefined })
              }
              options={[
                { value: 'month', label: 'Bulan ini' },
                { value: 'quarter', label: 'Kuartal ini' },
                { value: 'year', label: 'Tahun ini' },
                { value: 'all', label: 'Semua' },
                { value: 'custom', label: 'Rentang', disabled: true },
              ]}
            />
            <DatePicker.RangePicker
              format="D MMM YYYY"
              value={qs.from ? [dayjs(qs.from), dayjs(qs.to)] : null}
              onChange={(x) => set({ from: x?.[0]?.format('YYYY-MM-DD'), to: x?.[1]?.format('YYYY-MM-DD') })}
            />
          </>
        )}
        {key === 'penjualan_periode' && (
          <Select
            style={{ width: 190 }}
            value={qs.by}
            onChange={(v) => set({ by: v })}
            options={[
              { value: 'period', label: 'Per periode' },
              { value: 'customer', label: 'Per pelanggan' },
              { value: 'product', label: 'Per produk' },
              { value: 'principal', label: 'Per principal' },
            ]}
          />
        )}
        {GROUPABLE.includes(key!) && key !== 'margin' && (key !== 'penjualan_periode' || qs.by === 'period') && (
          <Select
            style={{ width: 150 }}
            value={qs.group}
            onChange={(v) => set({ group: v })}
            options={[
              { value: 'month', label: 'Per bulan' },
              { value: 'quarter', label: 'Per kuartal' },
              { value: 'year', label: 'Per tahun' },
            ]}
          />
        )}
        {key === 'margin' && (
          <Select
            style={{ width: 190 }}
            value={qs.by}
            onChange={(v) => set({ by: v })}
            options={[
              { value: 'period', label: 'Per periode' },
              { value: 'customer', label: 'Per pelanggan' },
              { value: 'product', label: 'Per produk' },
              { value: 'order', label: 'Per sales order' },
            ]}
          />
        )}
        {key === 'margin' && qs.by === 'period' && (
          <Select
            style={{ width: 150 }}
            value={qs.group}
            onChange={(v) => set({ group: v })}
            options={[
              { value: 'month', label: 'Per bulan' },
              { value: 'quarter', label: 'Per kuartal' },
              { value: 'year', label: 'Per tahun' },
            ]}
          />
        )}
        {sup.data && (
          <Select
            allowClear
            placeholder="Principal"
            style={{ width: 230 }}
            value={qs.partnerId ? +qs.partnerId : undefined}
            onChange={(v) => set({ partnerId: v ? String(v) : undefined })}
            options={sup.data.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        {cus.data && (
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Pelanggan"
            style={{ width: 230 }}
            value={qs.partnerId ? +qs.partnerId : undefined}
            onChange={(v) => set({ partnerId: v ? String(v) : undefined })}
            options={cus.data.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        {wh.data && (
          <Select
            allowClear
            placeholder="Gudang"
            style={{ width: 230 }}
            value={qs.warehouseId ? +qs.warehouseId : undefined}
            onChange={(v) => set({ warehouseId: v ? String(v) : undefined })}
            options={wh.data.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        {key === 'umur_piutang' && (
          <span>
            <Switch checked={qs.detail === 'true'} onChange={(v) => set({ detail: v ? 'true' : undefined })} />{' '}
            <span className="muted">Rinci per invoice</span>
          </span>
        )}
        {key === 'stok_gudang' && (
          <span>
            <Switch checked={qs.low === 'true'} onChange={(v) => set({ low: v ? 'true' : undefined })} />{' '}
            <span className="muted">Hanya stok rendah</span>
          </span>
        )}
      </div>
      {r?.chart && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
            <Segmented
              size="small"
              value={kind}
              onChange={(v) => setKind(String(v))}
              options={[
                { value: 'auto', label: 'Bawaan' },
                ...['bar', 'line', 'pie', ...(r.chart.type === 'stacked' ? ['stacked'] : [])].map((v) => ({
                  value: v,
                  label: CHART_KINDS[v],
                })),
              ]}
            />
          </div>
          <Chart
            spec={r.chart}
            kind={kind as any}
            money={!['pengiriman', 'status_bayar_po', 'stok_gudang'].includes(key!)}
          />
        </div>
      )}
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey={(_: any, i?: number) => String(i)}
          loading={rep.loading}
          dataSource={r?.rows || []}
          columns={cols}
          onRow={(row) => ({ onClick: () => row.link && nav(row.link), className: 'row-link' })}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: 800 }}
          summary={() =>
            r?.totals ? (
              <Table.Summary.Row>
                {r.columns.map((c: any, i: number) => (
                  <Table.Summary.Cell
                    key={c.key}
                    index={i}
                    align={['money', 'qty', 'pct'].includes(c.type) ? 'right' : undefined}
                  >
                    <b>{i === 0 ? 'Total' : r.totals[c.key] !== undefined ? fmt(c)(r.totals[c.key]) : ''}</b>
                  </Table.Summary.Cell>
                ))}
              </Table.Summary.Row>
            ) : null
          }
        />
      </div>
    </>
  );
}
