import { useEffect, useState } from 'react';
import { Alert, Button, DatePicker, Descriptions, Input, InputNumber, Modal, Radio, Select, Table, Tag } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCan } from '../../app/auth';
import { useFetch, useQueryState } from '../../shared/hooks';
import { api, idr, openFile, qf, rp, run, tgl, today } from '../../shared/lib';
import { LABEL, emptyText, PageHead, Pill, SearchBar } from '../../shared/ui';
import Chatter from '../../shared/Chatter';

const opts = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));
const RES_HELP: Record<string, string> = {
  ganti:
    'Barang dikembalikan ke lokasi Barang Rusak, lalu barang pengganti dikirim dengan surat jalan baru. Invoice tidak berubah.',
  nota_kredit:
    'Barang dikembalikan ke lokasi Barang Rusak dan nota kredit mengurangi piutang. Hanya untuk barang yang sudah ditagih.',
  potongan: 'Barang tetap di pelanggan. Nota kredit sebesar potongan yang disepakati mengurangi piutang.',
};

// Laporan barang bermasalah dari satu surat jalan yang sudah selesai; disimpan sebagai retur Draf
export function ReturnModal({
  pickingId,
  existing,
  onClose,
}: {
  pickingId: number;
  existing?: any;
  onClose: (r?: any) => void;
}) {
  const src = useFetch<any>(`/transfers/${pickingId}/returnable`);
  const [reason, setReason] = useState(existing?.reason || 'rusak');
  const [resolution, setResolution] = useState(existing?.resolution || 'ganti');
  const [date, setDate] = useState(existing?.date || today());
  const [note, setNote] = useState(existing?.note || '');
  const [qty, setQty] = useState<Record<number, number>>({});
  const [cut, setCut] = useState<Record<number, number>>({});
  useEffect(() => {
    if (!existing) return;
    setQty(Object.fromEntries(existing.lines.map((l: any) => [l.moveId, Number(l.quantity)])));
    setCut(Object.fromEntries(existing.lines.map((l: any) => [l.moveId, Number(l.priceUnit)])));
  }, [existing]);
  const d = src.data;
  const lines = (d?.lines || []).map((l: any) => {
    // saat mengubah retur Draf, kuantitasnya sendiri masih boleh dipakai
    const own = existing?.lines?.find((x: any) => x.moveId === l.moveId);
    return { ...l, available: l.available + (own ? Number(own.quantity) : 0) };
  });
  const credit = resolution !== 'ganti';
  const total = lines.reduce(
    (a: number, l: any) =>
      a +
      Number(qty[l.moveId] || 0) *
        (resolution === 'potongan' ? Number(cut[l.moveId] || 0) : resolution === 'nota_kredit' ? l.netPrice : 0),
    0,
  );
  const late = d?.claimUntil && date > d.claimUntil;
  const save = async () => {
    const body = {
      pickingId,
      date,
      reason,
      resolution,
      note,
      lines: lines
        .filter((l: any) => Number(qty[l.moveId]) > 0)
        .map((l: any) => ({ moveId: l.moveId, quantity: qty[l.moveId], priceUnit: cut[l.moveId] })),
    };
    const r = await run(
      existing ? api.patch(`/returns/${existing.id}`, body) : api.post('/returns', body),
      existing ? 'Retur diubah' : 'Retur dibuat',
    );
    if (r) onClose(r);
  };
  return (
    <Modal
      open
      width={780}
      title={existing ? `Ubah ${existing.name}` : `Barang bermasalah dari ${d?.picking?.name || ''}`}
      okText={existing ? 'Simpan' : 'Buat Retur'}
      cancelText="Batal"
      onCancel={() => onClose()}
      onOk={save}
    >
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <span>
          Tanggal{' '}
          <DatePicker
            allowClear={false}
            format="D MMM YYYY"
            value={dayjs(date)}
            onChange={(x) => x && setDate(x.format('YYYY-MM-DD'))}
          />
        </span>
        <span>
          Alasan <Select style={{ width: 210 }} value={reason} onChange={setReason} options={opts(LABEL.retReason)} />
        </span>
      </div>
      <Radio.Group
        style={{ marginBottom: 8 }}
        optionType="button"
        value={resolution}
        onChange={(e) => setResolution(e.target.value)}
        options={opts(LABEL.retRes).map((o) => ({ ...o, disabled: o.value === 'ganti' && d?.dropship }))}
      />
      <div className="muted" style={{ marginBottom: 8 }}>
        {RES_HELP[resolution]}
        {d?.dropship && ' Barang dropship dikembalikan langsung kepada principal.'}
      </div>
      {late && (
        <Alert
          style={{ marginBottom: 8 }}
          type="warning"
          showIcon
          message={`Klaim melewati batas ${tgl(d.claimUntil)}. Retur tetap dapat dibuat dan dicatat sebagai klaim terlambat.`}
        />
      )}
      <Table<any>
        size="small"
        rowKey="moveId"
        loading={src.loading}
        pagination={false}
        dataSource={lines}
        columns={[
          { title: 'Produk', dataIndex: 'product', render: (v, r) => `[${r.code}] ${v}` },
          { title: 'Dikirim', dataIndex: 'delivered', align: 'right', render: qf },
          { title: 'Bisa diretur', dataIndex: 'available', align: 'right', render: qf },
          ...(credit ? [{ title: 'Tertagih', dataIndex: 'qtyInvoiced', align: 'right' as const, render: qf }] : []),
          {
            title: 'Qty bermasalah',
            key: 'q',
            render: (_, r) => (
              <InputNumber
                min={0}
                max={r.available}
                value={qty[r.moveId]}
                decimalSeparator=","
                onChange={(v) => setQty({ ...qty, [r.moveId]: Number(v) || 0 })}
              />
            ),
          },
          ...(resolution === 'potongan'
            ? [
                {
                  title: 'Potongan/unit (Rp)',
                  key: 'c',
                  render: (_: any, r: any) => (
                    <InputNumber
                      min={0}
                      max={r.netPrice}
                      style={{ width: 150 }}
                      value={cut[r.moveId]}
                      formatter={(x) =>
                        x === undefined || x === null || x === '' ? '' : Number(x).toLocaleString('id-ID')
                      }
                      parser={(x) => Number(String(x).replace(/\./g, '').replace(',', '.')) as any}
                      onChange={(v) => setCut({ ...cut, [r.moveId]: Number(v) || 0 })}
                    />
                  ),
                },
              ]
            : resolution === 'nota_kredit'
              ? [{ title: 'Harga neto', dataIndex: 'netPrice', align: 'right' as const, render: (v: any) => idr(v) }]
              : []),
        ]}
      />
      {credit && (
        <div className="totals">
          <span>
            Nilai sebelum PPN <b>{rp(total)}</b>
          </span>
          <span className="muted">PPN dihitung saat retur diproses</span>
        </div>
      )}
      <Input.TextArea
        rows={2}
        placeholder="Keterangan kondisi barang dan kesepakatan dengan pelanggan"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </Modal>
  );
}

export function ReturnList() {
  const [qs, set] = useQueryState({});
  const list = useFetch<any[]>('/returns', { q: qs.q, state: qs.state });
  const nav = useNavigate();
  return (
    <>
      <PageHead
        title="Retur Pelanggan"
        sub="Barang bermasalah dilaporkan dari surat jalan yang sudah selesai (tombol Laporkan Barang Bermasalah)."
      />
      <SearchBar resource="returns" value={qs.q} onChange={(q) => set({ q })} filter={qs} onApply={(f) => set(f)}>
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 140 }}
          value={qs.state}
          onChange={(v) => set({ state: v })}
          options={opts(LABEL.ret)}
        />
      </SearchBar>
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={list.loading}
          dataSource={list.data || []}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          locale={{ emptyText: emptyText(qs, 'Belum ada retur pelanggan.') }}
          onRow={(r) => ({ onClick: () => nav(`/stok/retur/${r.id}`), className: 'row-link' })}
          columns={[
            { title: 'Nomor', dataIndex: 'name', render: (v) => <b>{v}</b> },
            { title: 'Tanggal', dataIndex: 'date', render: tgl },
            { title: 'Pelanggan', dataIndex: 'partner' },
            { title: 'Sales order', dataIndex: 'sale' },
            { title: 'Surat jalan', dataIndex: 'picking' },
            { title: 'Alasan', dataIndex: 'reasonLabel' },
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

function RefundModal({ r, onClose }: { r: any; onClose: (ok?: boolean) => void }) {
  const [amount, setAmount] = useState<number>(Number(r.creditLeft));
  const [method, setMethod] = useState('BNK');
  return (
    <Modal
      open
      title={`Kembalikan dana ${r.name}`}
      okText="Catat Pengembalian"
      cancelText="Batal"
      onCancel={() => onClose()}
      onOk={async () => {
        if (
          (await run(api.post(`/returns/${r.id}/refund`, { amount, method }), 'Pengembalian dana dicatat')) !==
          undefined
        )
          onClose(true);
      }}
    >
      <p>Sisa kredit pelanggan: {rp(r.creditLeft)}</p>
      <div className="toolbar">
        <InputNumber
          min={0}
          max={Number(r.creditLeft)}
          style={{ width: 200 }}
          value={amount}
          formatter={(x) => (x === undefined || x === null ? '' : Number(x).toLocaleString('id-ID'))}
          parser={(x) => Number(String(x).replace(/\./g, '').replace(',', '.')) as any}
          onChange={(v) => setAmount(Number(v) || 0)}
        />
        <Radio.Group
          optionType="button"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          options={[
            { value: 'BNK', label: 'Bank' },
            { value: 'KAS', label: 'Kas' },
          ]}
        />
      </div>
    </Modal>
  );
}

export function ReturnDetail() {
  const { id } = useParams();
  const can = useCan();
  const doc = useFetch<any>(`/returns/${id}`);
  const [rk, setRk] = useState(0);
  const [edit, setEdit] = useState(false);
  const [refund, setRefund] = useState(false);
  const r = doc.data;
  if (!r) return null;
  const reload = () => {
    doc.reload();
    setRk(rk + 1);
  };
  const act = async (p: string, msg: string) => {
    if ((await run(api.post(`/returns/${id}/${p}`, {}), msg)) !== undefined) reload();
  };
  const credit = r.resolution !== 'ganti';
  const canProcess = r.state === 'draft' && can(credit ? 'penagihan' : 'gudang', 'write');
  const canEdit = r.state === 'draft' && (can('gudang', 'create') || can('penjualan', 'write'));
  return (
    <>
      <PageHead crumb={{ label: 'Retur Pelanggan', to: '/stok/retur' }} title={r.name} sub={r.resolutionLabel} />
      <div className="toolbar">
        {canProcess && (
          <Button
            type="primary"
            onClick={() =>
              Modal.confirm({
                title: 'Proses retur?',
                content:
                  r.resolution === 'ganti'
                    ? 'Barang masuk ke lokasi Barang Rusak dan sales order kembali menunggu surat jalan pengganti.'
                    : r.resolution === 'nota_kredit'
                      ? `Barang masuk ke lokasi Barang Rusak dan nota kredit ${rp(r.amountTotal)} mengurangi piutang.`
                      : `Nota kredit potongan ${rp(r.amountTotal)} mengurangi piutang.`,
                okText: 'Proses',
                cancelText: 'Batal',
                onOk: () => act('process', 'Retur diproses'),
              })
            }
          >
            Proses Retur
          </Button>
        )}
        {r.state === 'draft' && !canProcess && (
          <span className="muted">Menunggu diproses oleh {credit ? 'Finance' : 'Operasional'}.</span>
        )}
        {canEdit && <Button onClick={() => setEdit(true)}>Ubah</Button>}
        <Button icon={<PrinterOutlined />} onClick={() => openFile(`/returns/${id}/pdf`)}>
          Cetak Berita Acara
        </Button>
        {r.state === 'done' && r.resolution === 'ganti' && (
          <Link to={`/penjualan/${r.saleId}`}>
            <Button>Buka sales order untuk surat jalan pengganti</Button>
          </Link>
        )}
        {r.state === 'done' && Number(r.creditLeft) > 0.5 && can('penagihan', 'write') && (
          <Button onClick={() => setRefund(true)}>Kembalikan Dana</Button>
        )}
        {canEdit && (
          <Button
            danger
            onClick={() =>
              Modal.confirm({
                title: 'Batalkan retur?',
                okText: 'Batalkan',
                cancelText: 'Tidak',
                onOk: () => act('cancel', 'Retur dibatalkan'),
              })
            }
          >
            Batalkan
          </Button>
        )}
        <span className="spacer" />
        <Pill v={r.state} kind="ret" />
      </div>
      {r.lateClaim && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={`Klaim diajukan setelah batas ${tgl(r.claimUntil)}.`}
        />
      )}
      {r.state === 'done' && Number(r.creditLeft) > 0.5 && (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message={`Invoice sudah lunas; sisa kredit ${rp(r.creditLeft)} dapat dikembalikan kepada pelanggan.`}
        />
      )}
      <div className="card">
        <Descriptions column={{ xs: 1, md: 3 }} size="small">
          <Descriptions.Item label="Pelanggan">{r.partner?.name}</Descriptions.Item>
          <Descriptions.Item label="Tanggal">{tgl(r.date)}</Descriptions.Item>
          <Descriptions.Item label="Alasan">{r.reasonLabel}</Descriptions.Item>
          <Descriptions.Item label="Sales order">
            <Link to={`/penjualan/${r.sale.id}`}>{r.sale.name}</Link>
          </Descriptions.Item>
          <Descriptions.Item label="Surat jalan">
            <Link to={`/stok/dok/${r.picking.id}`}>{r.picking.name}</Link>
            {r.dropship && (
              <Tag color="purple" style={{ marginLeft: 6 }}>
                dropship
              </Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Nota kredit">
            {r.refundEntry ? <Link to={`/penagihan/${r.refundEntry.id}`}>{r.refundEntry.name}</Link> : '-'}
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
                  {
                    title: r.resolution === 'potongan' ? 'Potongan/unit' : 'Harga neto',
                    dataIndex: 'priceUnit',
                    align: 'right' as const,
                    render: (v: any) => idr(v),
                  },
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
        {!!r.refunds?.length && (
          <div className="note">
            Pengembalian dana:{' '}
            {r.refunds.map((p: any) => (
              <span key={p.id} style={{ marginRight: 10 }}>
                {p.name} {rp(p.amount)} ({tgl(p.date)})
              </span>
            ))}
          </div>
        )}
      </div>
      <Chatter model="sales_returns" id={+id!} name={r.name} reloadKey={rk} />
      {edit && (
        <ReturnModal
          pickingId={r.pickingId}
          existing={r}
          onClose={(x) => {
            setEdit(false);
            if (x) reload();
          }}
        />
      )}
      {refund && (
        <RefundModal
          r={r}
          onClose={(ok) => {
            setRefund(false);
            if (ok) reload();
          }}
        />
      )}
    </>
  );
}
