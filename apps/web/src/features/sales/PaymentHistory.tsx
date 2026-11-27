import { Select, Table, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { useFetch, useQueryState } from '../../shared/hooks';
import { idr, openFile, tgl } from '../../shared/lib';
import { emptyText, PageHead, SearchBar } from '../../shared/ui';
import { GroupSelect, groupCols, groupRows } from '../../shared/ui';
import { ProofLink } from '../billing/Billing';

const KIND_COLOR: Record<string, string> = {
  uang_muka: 'gold',
  pelunasan: 'green',
  lunas_langsung: 'green',
  invoice: 'blue',
  hangus: 'red',
  batal: 'default',
};

// Riwayat penagihan per sales order: uang muka ke-n, pelunasan, lunas langsung, pembayaran invoice, uang muka hangus
// embedded: tampil sebagai tab di Penagihan > Pembayaran, tanpa judul halaman sendiri
export function PaymentHistory({ embedded = false }: { embedded?: boolean }) {
  const [qs, set] = useQueryState({});
  const list = useFetch<any[]>('/sales-orders/payment-history', { q: qs.q, kind: qs.kind });
  return (
    <>
      {!embedded && (
        <PageHead
          title="Riwayat Pembayaran"
          sub="Uang muka dan pelunasan pelanggan per sales order, beserta sisa, tanggal pelunasan, dan bukti transfer."
        />
      )}
      <SearchBar
        resource="payment-history"
        value={qs.q}
        onChange={(q) => set({ q })}
        filter={qs}
        onApply={(f) => set(f)}
      >
        <Select
          allowClear
          placeholder="Jenis"
          style={{ width: 190 }}
          value={qs.kind}
          onChange={(v) => set({ kind: v })}
          options={[
            { value: 'uang_muka', label: 'Uang muka' },
            { value: 'pelunasan,lunas_langsung', label: 'Pelunasan / lunas langsung' },
            { value: 'invoice', label: 'Pembayaran invoice' },
            { value: 'hangus', label: 'Uang muka hangus' },
            { value: 'batal', label: 'Dibatalkan' },
          ]}
        />
        <GroupSelect
          value={qs.group}
          onChange={(v) => set({ group: v })}
          options={[{ value: 'sale', label: 'Per sales order' }]}
        />
      </SearchBar>
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          key={`${qs.group || 'none'}-${list.data?.length || 0}`}
          rowKey="id"
          loading={list.loading}
          dataSource={groupRows(
            list.data,
            qs.group,
            qs.group === 'sale' ? (r) => `${r.sale} · ${r.partner}` : undefined,
          )}
          expandable={{ defaultExpandAllRows: true }}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          locale={{ emptyText: emptyText(qs, 'Belum ada pembayaran pelanggan.') }}
          columns={groupCols(
            [
              { title: 'Tanggal', dataIndex: 'date', render: tgl },
              { title: 'Nomor', dataIndex: 'name', render: (v: any) => <b>{v}</b> },
              {
                title: 'Sales order',
                dataIndex: 'sale',
                render: (v: any, r: any) => (r.__group ? v : <Link to={`/penjualan/${r.saleId}`}>{v}</Link>),
              },
              { title: 'Pelanggan', dataIndex: 'partner' },
              {
                title: 'Jenis',
                dataIndex: 'kindLabel',
                render: (v: any, r: any) =>
                  r.__group ? null : (
                    <>
                      <Tag color={KIND_COLOR[r.kind]}>{v}</Tag>
                      {r.invoice && <Link to={`/penagihan/${r.invoiceId}`}>{r.invoice}</Link>}
                    </>
                  ),
              },
              { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: (v: any) => idr(v) },
              {
                title: 'Sisa sesudahnya',
                dataIndex: 'remaining',
                align: 'right',
                render: (v: any) => (v == null ? '-' : idr(v)),
              },
              {
                title: 'Pelunasan paling lambat',
                dataIndex: 'settleDate',
                render: (v: any, r: any) =>
                  !v || !(r.remaining > 0.5) ? '-' : <span className={r.settleLate ? 'loss' : ''}>{tgl(v)}</span>,
              },
              { title: 'Bukti', key: 'b', render: (_: any, r: any) => (r.__group ? null : <ProofLink p={r} />) },
              {
                title: '',
                key: 'k',
                render: (_: any, r: any) =>
                  !r.__group &&
                  typeof r.id === 'number' &&
                  r.kind !== 'batal' && <a onClick={() => openFile(`/payments/${r.id}/receipt`)}>Kuitansi</a>,
              },
            ],
            ['amount'],
          )}
        />
      </div>
    </>
  );
}
