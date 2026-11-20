import { useState } from 'react';
import { Alert, Button, DatePicker, Descriptions, Input, InputNumber, Modal, Radio, Select, Table } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCan } from '../../app/auth';
import { useFetch, useQueryState } from '../../shared/hooks';
import { api, idr, openFile, qf, rp, run, tgl, today } from '../../shared/lib';
import { LABEL, emptyText, PageHead, Pill, SearchBar } from '../../shared/ui';
import Chatter from '../../shared/Chatter';

const RES: Record<string, string> = {
  ganti: 'Principal mengirim barang pengganti',
  nota_kredit: 'Nota kredit dari principal',
};
const HELP: Record<string, string> = {
  ganti: 'Barang keluar dari lokasi Barang Rusak dan penerimaan barang pengganti dibuat untuk Operasional.',
  nota_kredit:
    'Barang keluar dari lokasi Barang Rusak dan nota kredit mengurangi utang ke principal. Hanya untuk barang yang sudah ditagih principal.',
};

// Retur barang dari stok Barang Rusak ke principal atas satu PO
export function PurchaseReturnModal({ purchaseId, onClose }: { purchaseId: number; onClose: (r?: any) => void }) {
  const src = useFetch<any>(`/purchase-orders/${purchaseId}/returnable`);
  const [resolution, setResolution] = useState('ganti');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [qty, setQty] = useState<Record<number, number>>({});
  const lines = src.data?.lines || [];
  const total = lines.reduce(
    (a: number, l: any) => a + (resolution === 'nota_kredit' ? Number(qty[l.purchaseLineId] || 0) * l.priceUnit : 0),
    0,
  );
  const none = !src.loading && !lines.some((l: any) => l.available > 0);
  return (
    <Modal
      open
      width={760}
      title={`Retur ke principal dari ${src.data?.po?.name || ''}`}
      okText="Buat Retur"
      cancelText="Batal"
      okButtonProps={{ disabled: none }}
      onCancel={() => onClose()}
      onOk={async () => {
        const r = await run(
          api.post('/purchase-returns', {
            purchaseId,
            date,
            resolution,
            note,
            lines: lines
              .filter((l: any) => Number(qty[l.purchaseLineId]) > 0)
              .map((l: any) => ({ purchaseLineId: l.purchaseLineId, quantity: qty[l.purchaseLineId] })),
          }),
          'Retur ke principal dibuat',
        );
        if (r) onClose(r);
      }}
    >
      {none && (
        <Alert
          style={{ marginBottom: 8 }}
          type="info"
          showIcon
          message="Tidak ada stok Barang Rusak dari PO ini. Barang rusak masuk ke lokasi itu lewat retur pelanggan."
        />
      )}
      <div className="toolbar">
        <span>
          Tanggal{' '}
          <DatePicker
            allowClear={false}
            format="D MMM YYYY"
            value={dayjs(date)}
            onChange={(d) => d && setDate(d.format('YYYY-MM-DD'))}
          />
        </span>
        <Radio.Group
          optionType="button"
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          options={Object.entries(RES).map(([value, label]) => ({ value, label }))}
        />
      </div>
      <div className="muted" style={{ marginBottom: 8 }}>
        {HELP[resolution]}
      </div>
      <Table<any>
        size="small"
        rowKey="purchaseLineId"
        loading={src.loading}
        pagination={false}
        dataSource={lines}
        columns={[
          { title: 'Produk', dataIndex: 'product', render: (v, r) => `[${r.code}] ${v}` },
          { title: 'Diterima', dataIndex: 'received', align: 'right', render: qf },
          { title: 'Barang rusak', dataIndex: 'damaged', align: 'right', render: qf },
          ...(resolution === 'nota_kredit'
            ? [{ title: 'Tertagih', dataIndex: 'invoiced', align: 'right' as const, render: qf }]
            : []),
          {
            title: 'Qty dikembalikan',
            key: 'q',
            render: (_, r) => (
              <InputNumber
                min={0}
                max={r.available}
                disabled={!r.available}
                value={qty[r.purchaseLineId]}
                decimalSeparator=","
                onChange={(v) => setQty({ ...qty, [r.purchaseLineId]: Number(v) || 0 })}
              />
            ),
          },
          ...(resolution === 'nota_kredit'
            ? [{ title: 'Harga beli', dataIndex: 'priceUnit', align: 'right' as const, render: (v: any) => idr(v) }]
            : []),
        ]}
      />
      {resolution === 'nota_kredit' && (
        <div className="totals">
          <span>
            Nilai sebelum PPN <b>{rp(total)}</b>
          </span>
        </div>
      )}
      <Input.TextArea
        rows={2}
        placeholder="Keterangan / nomor klaim principal"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </Modal>
  );
}

export function PurchaseReturnList() {
  const [qs, set] = useQueryState({});
  const list = useFetch<any[]>('/purchase-returns', { q: qs.q, state: qs.state });
  const nav = useNavigate();
  return (
    <>
      <PageHead
        title="Retur ke Principal"
        sub="Barang rusak dari retur pelanggan dikembalikan ke principal. Buat dari halaman PO Principal dengan tombol Retur ke Principal."
      />
      <SearchBar
        resource="purchase-returns"
        value={qs.q}
        onChange={(q) => set({ q })}
        filter={qs}
        onApply={(f) => set(f)}
      >
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 140 }}
          value={qs.state}
          onChange={(v) => set({ state: v })}
          options={Object.entries(LABEL.ret).map(([value, label]) => ({ value, label }))}
        />
      </SearchBar>
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={list.loading}
          dataSource={list.data || []}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          locale={{ emptyText: emptyText(qs, 'Belum ada retur ke principal.') }}
          onRow={(r) => ({ onClick: () => nav(`/pengadaan/retur/${r.id}`), className: 'row-link' })}
          columns={[
            { title: 'Nomor', dataIndex: 'name', render: (v) => <b>{v}</b> },
            { title: 'Tanggal', dataIndex: 'date', render: tgl },
            { title: 'Principal', dataIndex: 'partner' },
            { title: 'PO', dataIndex: 'purchase' },
            { title: 'Penyelesaian', dataIndex: 'resolutionLabel' },
            {
              title: 'Nota kredit',
              dataIndex: 'amountTotal',
              align: 'right',
              render: (v: any) => (Number(v) ? idr(v) : '-'),
            },
            { title: 'Status', dataIndex: 'state', render: (v) => <Pill v={v} kind="ret" /> },
          ]}
        />
      </div>
    </>
  );
}

export function PurchaseReturnDetail() {
  const { id } = useParams();
  const can = useCan();
  const doc = useFetch<any>(`/purchase-returns/${id}`);
  const [rk, setRk] = useState(0);
  const r = doc.data;
  if (!r) return null;
  const reload = () => {
    doc.reload();
    setRk(rk + 1);
  };
  const act = async (p: string, msg: string) => {
    if ((await run(api.post(`/purchase-returns/${id}/${p}`, {}), msg)) !== undefined) reload();
  };
  const credit = r.resolution === 'nota_kredit';
  const canProcess = r.state === 'draft' && can(credit ? 'pengadaan' : 'gudang', 'write');
  const canCancel = r.state === 'draft' && (can('gudang', 'create') || can('pengadaan', 'create'));
  return (
    <>
      <PageHead
        crumb={{ label: 'Retur ke Principal', to: '/pengadaan/retur' }}
        title={r.name}
        sub={r.resolutionLabel}
      />
      <div className="toolbar">
        {canProcess && (
          <Button
            type="primary"
            onClick={() =>
              Modal.confirm({
                title: 'Proses retur ke principal?',
                content: credit
                  ? `Barang keluar dari Barang Rusak dan nota kredit ${rp(r.amountTotal)} mengurangi utang ke principal.`
                  : 'Barang keluar dari Barang Rusak dan penerimaan barang pengganti dibuat.',
                okText: 'Proses',
                cancelText: 'Batal',
                onOk: () => act('process', 'Retur ke principal diproses'),
              })
            }
          >
            Proses Retur
          </Button>
        )}
        {r.state === 'draft' && !canProcess && (
          <span className="muted">Menunggu diproses oleh {credit ? 'Finance' : 'Operasional'}.</span>
        )}
        <Button icon={<PrinterOutlined />} onClick={() => openFile(`/purchase-returns/${id}/pdf`)}>
          Cetak Bukti Retur
        </Button>
        {canCancel && (
          <Button danger onClick={() => act('cancel', 'Retur dibatalkan')}>
            Batalkan
          </Button>
        )}
        <span className="spacer" />
        <Pill v={r.state} kind="ret" />
      </div>
      <div className="card">
        <Descriptions column={{ xs: 1, md: 3 }} size="small">
          <Descriptions.Item label="Principal">{r.partner?.name}</Descriptions.Item>
          <Descriptions.Item label="Tanggal">{tgl(r.date)}</Descriptions.Item>
          <Descriptions.Item label="Gudang">{r.warehouse?.name}</Descriptions.Item>
          <Descriptions.Item label="PO Principal">
            <Link to={`/pengadaan/${r.purchase.id}`}>{r.purchase.name}</Link>
          </Descriptions.Item>
          <Descriptions.Item label={credit ? 'Nota kredit' : 'Penerimaan pengganti'}>
            {credit ? (
              r.refundEntry ? (
                <Link to={`/pengadaan/tagihan/${r.refundEntry.id}`}>{r.refundEntry.name}</Link>
              ) : (
                '-'
              )
            ) : r.receipt ? (
              <Link to={`/stok/dok/${r.receipt.id}`}>
                {r.receipt.name} ({LABEL.tr[r.receipt.state]})
              </Link>
            ) : (
              'dibuat saat retur diproses'
            )}
          </Descriptions.Item>
        </Descriptions>
        <Table<any>
          style={{ marginTop: 12 }}
          size="middle"
          rowKey="id"
          pagination={false}
          dataSource={r.lines}
          columns={[
            { title: 'Produk', dataIndex: 'product', render: (v, l) => `[${l.code}] ${v}` },
            { title: 'Qty', dataIndex: 'quantity', align: 'right', render: qf },
            { title: 'Satuan', dataIndex: 'uom' },
            ...(credit
              ? [
                  { title: 'Harga beli', dataIndex: 'priceUnit', align: 'right' as const, render: (v: any) => idr(v) },
                  { title: 'Subtotal', dataIndex: 'subtotal', align: 'right' as const, render: (v: any) => idr(v) },
                ]
              : []),
          ]}
        />
        {credit && (
          <div className="totals">
            <span className="muted">DPP {rp(r.amountUntaxed)}</span>
            <span className="muted">PPN {rp(r.amountTax)}</span>
            <span>
              Total nota kredit <span className="big">{rp(r.amountTotal)}</span>
            </span>
          </div>
        )}
        {r.note && <div className="note">{r.note}</div>}
      </div>
      <Chatter model="purchase_returns" id={+id!} name={r.name} reloadKey={rk} />
    </>
  );
}
