import { useEffect, useState } from 'react';
import { Alert, Button, DatePicker, Descriptions, Input, InputNumber, Modal, Radio, Select, Table, Tag } from 'antd';
import { PrinterOutlined, WarningFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCan } from '../../app/auth';
import { useFetch, useQueryState } from '../../shared/hooks';
import { api, openFile, qf, run, tgl, tglJam } from '../../shared/lib';
import { LABEL, emptyText, PageHead, Pill, SearchBar, StatusBar } from '../../shared/ui';
import { GroupSelect, groupCols, groupRows } from '../../shared/ui';
import Chatter from '../../shared/Chatter';
import Crud from '../../shared/Crud';
import { useCreateDelivery } from './createDelivery';
import { ReturnModal } from './Returns';

export function StockOverview() {
  const [qs, set] = useQueryState({});
  const list = useFetch<any[]>('/stock', {
    warehouseId: qs.warehouseId,
    categoryId: qs.categoryId,
    low: qs.low,
    q: qs.q,
  });
  const low = useFetch<any[]>('/stock', { low: 'true' });
  const wh = useFetch<any[]>('/warehouses');
  const cats = useFetch<any[]>('/categories');
  const [q, setQ] = useState(qs.q || '');
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Stok per Gudang</h1>
        <div className="toolbar" style={{ margin: 0 }}>
          <Input.Search
            allowClear
            placeholder="cari produk..."
            style={{ width: 360 }}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (!e.target.value) set({ q: undefined });
            }}
            onSearch={(v) => set({ q: v || undefined })}
          />
          <Select
            allowClear
            placeholder="Gudang"
            style={{ width: 230 }}
            value={qs.warehouseId ? +qs.warehouseId : undefined}
            onChange={(v) => set({ warehouseId: v ? String(v) : undefined })}
            options={(wh.data || []).map((w) => ({ value: w.id, label: w.name }))}
          />
          <Select
            allowClear
            placeholder="Kategori"
            style={{ width: 170 }}
            value={qs.categoryId ? +qs.categoryId : undefined}
            onChange={(v) => set({ categoryId: v ? String(v) : undefined })}
            options={(cats.data || []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <Button type={qs.low ? 'primary' : 'default'} onClick={() => set({ low: qs.low ? undefined : 'true' })}>
            Stok rendah
          </Button>
        </div>
      </div>
      <div className="toolbar">
        <Button
          onClick={() =>
            openFile(`/reports/stok_gudang/export?format=xlsx${qs.warehouseId ? '&warehouseId=' + qs.warehouseId : ''}`)
          }
        >
          Ekspor
        </Button>
        <span className="spacer" />
        {(low.data?.length || 0) > 0 && (
          <span className="pill red">
            <WarningFilled /> Stok rendah: {low.data!.length} produk
          </span>
        )}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="key"
          loading={list.loading}
          dataSource={list.data || []}
          pagination={{ pageSize: 30, hideOnSinglePage: true }}
          columns={[
            {
              title: 'Produk',
              dataIndex: 'product',
              render: (v, r) => (
                <>
                  <div>{v}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.code} · {r.category || '-'}
                  </div>
                </>
              ),
            },
            { title: 'Gudang principal', dataIndex: 'warehouse' },
            { title: 'Stok fisik', dataIndex: 'physical', align: 'center', render: qf },
            { title: 'Stok terikat', dataIndex: 'reserved', align: 'center', render: qf },
            {
              title: 'Stok bebas',
              dataIndex: 'free',
              align: 'center',
              render: (v) => <b className={v < 0 ? 'loss' : ''}>{qf(v)}</b>,
            },
            {
              title: 'Barang rusak',
              dataIndex: 'damaged',
              align: 'center',
              render: (v) => (Number(v) ? <span className="loss">{qf(v)}</span> : '-'),
            },
            { title: 'Stok minimum', dataIndex: 'minQty', align: 'center', render: (v) => (v == null ? '-' : qf(v)) },
            { title: 'Satuan', dataIndex: 'uom' },
            { title: 'Status', dataIndex: 'status', render: (v) => <Pill v={v} /> },
          ]}
        />
      </div>
      <div className="note">
        Stok bebas = stok fisik dikurangi stok terikat sales order yang belum dikirim. Barang rusak dari retur pelanggan
        disimpan terpisah dan tidak dihitung sebagai stok fisik. Persediaan memakai metode periodik sehingga mutasi stok
        tidak membuat jurnal.
      </div>
    </>
  );
}

export function TransferList({ kind }: { kind: 'incoming' | 'outgoing' }) {
  const [qs, set] = useQueryState({ tab: 'open' });
  const list = useFetch<any[]>('/transfers', {
    kind,
    q: qs.q,
    late: qs.late,
    from: qs.from,
    to: qs.to,
    state: qs.tab === 'open' ? 'draft,waiting,assigned' : qs.tab === 'done' ? 'done' : undefined,
    sort: 'date',
  });
  const nav = useNavigate();
  return (
    <>
      <PageHead
        title={kind === 'incoming' ? 'Penerimaan Barang' : 'Surat Jalan'}
        sub={
          kind === 'incoming'
            ? 'PO Principal yang barangnya belum diterima beserta perkiraan tanggal tiba.'
            : 'Jadwal pengiriman diurutkan menurut tanggal rencana kirim.'
        }
      />
      <SearchBar
        resource={`transfers-${kind}`}
        value={qs.q}
        onChange={(q) => set({ q })}
        filter={qs}
        onApply={(f) => set(f)}
      >
        <Radio.Group
          optionType="button"
          value={qs.tab}
          onChange={(e) => set({ tab: e.target.value })}
          options={[
            { value: 'open', label: 'Belum selesai' },
            { value: 'done', label: 'Selesai' },
            { value: 'all', label: 'Semua' },
          ]}
        />
        <DatePicker.RangePicker
          format="D MMM YYYY"
          placeholder={['Tanggal kirim dari', 'sampai']}
          value={qs.from ? [dayjs(qs.from), dayjs(qs.to)] : null}
          onChange={(r) => set({ from: r?.[0]?.format('YYYY-MM-DD'), to: r?.[1]?.format('YYYY-MM-DD') })}
        />
        <Button
          type={qs.late ? 'primary' : 'default'}
          danger={!!qs.late}
          onClick={() => set({ late: qs.late ? undefined : 'true' })}
        >
          Terlambat
        </Button>
        <GroupSelect
          value={qs.group}
          onChange={(v) => set({ group: v })}
          options={[
            { value: 'partner', label: kind === 'incoming' ? 'Per principal' : 'Per pelanggan' },
            { value: 'warehouse', label: 'Per gudang' },
            { value: 'date', label: 'Per tanggal' },
            { value: 'state', label: 'Per status' },
          ]}
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
            qs.group === 'state'
              ? (r) => LABEL.tr[r.state]
              : qs.group === 'date'
                ? (r) => String(r.scheduledDate || '-')
                : undefined,
          )}
          expandable={{ defaultExpandAllRows: true }}
          pagination={{ pageSize: 30, hideOnSinglePage: true }}
          locale={{
            emptyText: emptyText(
              qs,
              qs.tab === 'done'
                ? 'Tidak ada data di tab ini.'
                : kind === 'incoming'
                  ? (qs.tab === 'open' ? 'Tidak ada penerimaan yang belum selesai.' : 'Belum ada penerimaan.') +
                    ' Penerimaan muncul setelah PO dikonfirmasi.'
                  : (qs.tab === 'open' ? 'Tidak ada surat jalan yang belum selesai.' : 'Belum ada surat jalan.') +
                    ' Surat jalan dibuat dari sales order.',
            ),
          }}
          onRow={(r) => ({ onClick: () => !r.__group && nav(`/stok/dok/${r.id}`), className: 'row-link' })}
          columns={groupCols(
            [
              {
                title: 'Nomor',
                dataIndex: 'name',
                render: (v: any, r: any) => (
                  <>
                    <b>{v}</b> {r.dropship && <Tag color="purple">dropship</Tag>} {r.backorderId && <Tag>susulan</Tag>}
                  </>
                ),
              },
              { title: kind === 'incoming' ? 'Principal' : 'Pelanggan / alamat', dataIndex: 'partner' },
              { title: 'Dokumen asal', dataIndex: 'origin' },
              { title: 'Gudang', dataIndex: 'warehouse' },
              {
                title: kind === 'incoming' ? 'Perkiraan tiba' : 'Rencana kirim',
                dataIndex: 'scheduledDate',
                render: (v: any, r: any) => (
                  <span className={r.late ? 'loss' : ''}>
                    {tgl(v)}
                    {r.late ? ' · terlambat' : ''}
                  </span>
                ),
              },
              { title: 'Selesai', dataIndex: 'dateDone', render: tgl },
              { title: 'Status', dataIndex: 'state', render: (v: any) => <Pill v={v} kind="tr" /> },
            ],
            [],
          )}
        />
      </div>
    </>
  );
}

export function ReadyToShipList() {
  const list = useFetch<any[]>('/sales-orders/worklist/ready');
  const can = useCan();
  const delivery = useCreateDelivery(() => list.reload());
  return (
    <>
      <PageHead
        title="Siap Dikirim"
        sub="Sales order yang stok bebasnya tersedia dan belum dibuatkan surat jalan. Pelanggan baru tampil setelah lunas."
      />
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={list.loading}
          dataSource={list.data || []}
          pagination={false}
          locale={{ emptyText: 'Tidak ada sales order yang siap dikirim' }}
          columns={[
            { title: 'Sales order', dataIndex: 'name', render: (v, r) => <Link to={`/penjualan/${r.id}`}>{v}</Link> },
            {
              title: 'Pelanggan',
              dataIndex: 'partner',
              render: (v, r) => (
                <>
                  {v} {r.isNewCustomer && <Tag color="gold">baru</Tag>}
                </>
              ),
            },
            { title: 'Tanggal konfirmasi', dataIndex: 'dateConfirm', render: tgl },
            { title: 'Rencana kirim', dataIndex: 'commitmentDate', render: tgl },
            { title: 'Produk siap', dataIndex: 'items', align: 'right' },
            ...(can('gudang', 'create')
              ? [
                  {
                    title: '',
                    key: 'aksi',
                    align: 'right' as const,
                    render: (_: any, r: any) => (
                      <Button
                        size="small"
                        type="primary"
                        disabled={delivery.isCreating(r.id)}
                        onClick={() => delivery.create(r.id)}
                      >
                        Buat Surat Jalan
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
    </>
  );
}

export function TransferDetail() {
  const { id } = useParams();
  const can = useCan();
  const doc = useFetch<any>(`/transfers/${id}`);
  const wh = useFetch<any[]>('/warehouses');
  const [t, setT] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [rk, setRk] = useState(0);
  const [retOpen, setRetOpen] = useState(false);
  const nav = useNavigate();
  const rets = useFetch<any[]>('/returns', { pickingId: id }, [rk]);
  useEffect(() => {
    if (doc.data) {
      setT(JSON.parse(JSON.stringify(doc.data)));
      setDirty(false);
    }
  }, [doc.data]);
  if (!t) return null;
  const open = !['done', 'cancel'].includes(t.state);
  const w = can('gudang', 'write') && open;
  const reload = () => {
    doc.reload();
    setRk(rk + 1);
  };
  const body = () => ({
    scheduledDate: t.scheduledDate,
    note: t.note,
    moves: t.moves.map((m: any) => ({ id: m.id, quantity: m.quantity })),
  });
  const save = async () => {
    if (await run(api.patch(`/transfers/${id}`, body()), 'Perubahan disimpan')) reload();
  };
  const act = async (p: string, msg: string, b?: any) => {
    if (dirty && p !== 'validate') await run(api.patch(`/transfers/${id}`, body()));
    if ((await run(api.post(`/transfers/${id}/${p}`, b || {}), msg)) !== undefined) reload();
  };
  const incoming = t.kind === 'incoming';
  const partial = t.moves.some((m: any) => Number(m.quantity) < Number(m.productUomQty));
  const validate = () =>
    Modal.confirm({
      title: incoming
        ? 'Validasi penerimaan barang?'
        : t.dropship
          ? 'Konfirmasi barang dropship diterima pelanggan?'
          : 'Validasi surat jalan?',
      content: partial
        ? 'Kuantitas kurang dari pesanan; sisanya dibuat sebagai dokumen susulan.'
        : incoming
          ? 'Stok fisik gudang bertambah.'
          : t.dropship
            ? 'Stok gudang tidak berubah.'
            : 'Stok fisik gudang berkurang.',
      okText: 'Validasi',
      cancelText: 'Batal',
      onOk: () =>
        act('validate', 'Dokumen divalidasi', { moves: t.moves.map((m: any) => ({ id: m.id, quantity: m.quantity })) }),
    });
  const title = incoming ? 'Penerimaan Barang' : 'Surat Jalan';
  const canReturn =
    t.kind === 'outgoing' && t.state === 'done' && !!t.saleId && (can('gudang', 'create') || can('penjualan', 'write'));
  return (
    <>
      <PageHead
        crumb={{ label: title, to: incoming ? '/stok/penerimaan' : '/stok/surat-jalan' }}
        title={t.name}
        sub={
          <>
            {t.dropship && <Tag color="purple">dropship dari principal</Tag>}
            {t.backorderId && <Tag>Susulan dari {t.backorderName}</Tag>}
            {t.late && <Tag color="red">terlambat</Tag>}
          </>
        }
      />
      <div className="toolbar">
        {dirty && (
          <Button type="primary" onClick={save}>
            Simpan
          </Button>
        )}
        {w && t.kind === 'outgoing' && t.state === 'draft' && !t.dropship && (
          <Button onClick={() => act('ready', 'Surat jalan siap kirim')} disabled={!!t.paymentBlock}>
            Siap Kirim
          </Button>
        )}
        {w && (
          <Button type={dirty ? 'default' : 'primary'} onClick={validate} disabled={!!t.paymentBlock}>
            Validasi
          </Button>
        )}
        <Button icon={<PrinterOutlined />} onClick={() => openFile(`/transfers/${id}/pdf`)}>
          {incoming ? 'Cetak bukti penerimaan' : 'Cetak surat jalan (3 lembar)'}
        </Button>
        {canReturn && <Button onClick={() => setRetOpen(true)}>Laporkan Barang Bermasalah</Button>}
        {open && can('gudang', 'delete') && (
          <Button
            danger
            onClick={() =>
              Modal.confirm({
                title: 'Batalkan dokumen?',
                okText: 'Batalkan',
                cancelText: 'Tidak',
                onOk: () => act('cancel', 'Dokumen dibatalkan'),
              })
            }
          >
            Batalkan
          </Button>
        )}
        <span className="spacer" />
        <StatusBar
          value={t.state === 'cancel' ? 'draft' : t.state}
          steps={
            incoming || t.dropship
              ? [
                  { key: 'waiting', label: 'Menunggu' },
                  { key: 'done', label: 'Selesai' },
                ]
              : [
                  { key: 'draft', label: 'Draf' },
                  { key: 'assigned', label: 'Siap Kirim' },
                  { key: 'done', label: 'Selesai' },
                ]
          }
        />
      </div>
      {t.paymentBlock && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={t.paymentBlock} />}
      <div className="card">
        <Descriptions column={{ xs: 1, md: 3 }} size="small">
          <Descriptions.Item label={incoming ? 'Principal' : 'Dikirim kepada'}>
            {t.partner?.name}
            {t.partner?.street ? `, ${t.partner.street}` : ''}
          </Descriptions.Item>
          <Descriptions.Item label="Dokumen asal">
            {t.sale ? (
              <Link to={`/penjualan/${t.saleId}`}>{t.sale.name}</Link>
            ) : t.purchase ? (
              <Link to={`/pengadaan/${t.purchaseId}`}>{t.purchase.name}</Link>
            ) : (
              t.origin
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Dari → ke">
            {t.location?.completeName} → {t.locationDest?.completeName}
          </Descriptions.Item>
          <Descriptions.Item label={incoming ? 'Perkiraan tiba' : 'Rencana kirim'}>
            <DatePicker
              disabled={!w}
              size="small"
              format="D MMMM YYYY"
              value={t.scheduledDate ? dayjs(t.scheduledDate) : null}
              onChange={(d) => {
                setT({ ...t, scheduledDate: d?.format('YYYY-MM-DD') });
                setDirty(true);
              }}
            />
          </Descriptions.Item>
          <Descriptions.Item label="Selesai">{tglJam(t.dateDone)}</Descriptions.Item>
          {!incoming && !t.dropship && (
            <Descriptions.Item label="Gudang asal">
              {(wh.data || []).find((x) => x.id === t.pickingType?.warehouseId)?.name || '-'}
            </Descriptions.Item>
          )}
        </Descriptions>
        <Table<any>
          style={{ marginTop: 16 }}
          size="middle"
          rowKey="id"
          pagination={false}
          dataSource={t.moves}
          columns={[
            {
              title: 'Produk',
              dataIndex: 'product',
              render: (v, m) => (
                <>
                  [{m.code}] {v}
                </>
              ),
            },
            {
              title: incoming ? 'Dipesan' : 'Dipesan / sisa',
              dataIndex: 'productUomQty',
              align: 'right',
              render: (v, m) => `${qf(v)} ${m.uom}`,
            },
            ...(!incoming && !t.dropship
              ? [
                  {
                    title: 'Stok fisik gudang',
                    dataIndex: 'available',
                    align: 'right' as const,
                    render: (v: any, m: any) => (
                      <span className={Number(v) < Number(m.quantity) ? 'loss' : ''}>{qf(v)}</span>
                    ),
                  },
                ]
              : []),
            {
              title: incoming ? 'Diterima' : 'Dikirim',
              dataIndex: 'quantity',
              align: 'right',
              render: (v, m, i) =>
                w ? (
                  <InputNumber
                    min={0}
                    max={Number(m.productUomQty)}
                    value={v}
                    onChange={(x) => {
                      const ms = [...t.moves];
                      ms[i] = { ...m, quantity: x };
                      setT({ ...t, moves: ms });
                      setDirty(true);
                    }}
                  />
                ) : (
                  qf(v)
                ),
            },
          ]}
        />
        {t.backorders?.length > 0 && (
          <div className="note">
            Dokumen susulan:{' '}
            {t.backorders.map((b: any) => (
              <Link key={b.id} to={`/stok/dok/${b.id}`} style={{ marginRight: 10 }}>
                {b.name} ({b.state})
              </Link>
            ))}
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <div className="muted">Catatan</div>
          <Input.TextArea
            disabled={!w}
            autoSize={{ minRows: 1 }}
            value={t.note}
            onChange={(e) => {
              setT({ ...t, note: e.target.value });
              setDirty(true);
            }}
          />
        </div>
      </div>
      {!!rets.data?.length && (
        <div className="note">
          Retur dari surat jalan ini:{' '}
          {rets.data.map((r: any) => (
            <Link key={r.id} to={`/stok/retur/${r.id}`} style={{ marginRight: 10 }}>
              {r.name} ({r.stateLabel}, {r.resolutionLabel})
            </Link>
          ))}
        </div>
      )}
      <Chatter model="stock_transfers" id={+id!} name={t.name} reloadKey={rk} />
      {retOpen && (
        <ReturnModal
          pickingId={+id!}
          onClose={(r) => {
            setRetOpen(false);
            if (r) nav(`/stok/retur/${r.id}`);
          }}
        />
      )}
    </>
  );
}

export function StockRules() {
  return (
    <>
      <PageHead
        title="Stok Minimum"
        sub="Produk dengan stok bebas di bawah batas minimum ditandai stok rendah dan muncul sebagai pemberitahuan di beranda."
      />
      <Crud
        path="/stock-rules"
        menu="stok"
        archive={false}
        title="aturan stok minimum"
        fields={[
          {
            key: 'productId',
            label: 'Produk',
            type: 'select',
            required: true,
            source: { path: '/products', label: (r) => `[${r.code}] ${r.name}` },
          },
          {
            key: 'warehouseId',
            label: 'Gudang',
            type: 'select',
            required: true,
            source: { path: '/warehouses', label: (r) => r.name },
          },
          { key: 'minQty', label: 'Batas minimum', type: 'number', required: true },
        ]}
      />
    </>
  );
}

export function StockMoves() {
  const list = useFetch<any[]>('/stock/moves');
  return (
    <>
      <PageHead title="Mutasi Stok" sub="Setiap validasi penerimaan barang atau surat jalan tercatat sebagai mutasi." />
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={list.loading}
          dataSource={list.data || []}
          pagination={{ pageSize: 30 }}
          columns={[
            { title: 'Waktu', dataIndex: 'date', render: tglJam },
            { title: 'Dokumen', dataIndex: 'doc', render: (v) => v || 'Stok awal' },
            { title: 'Produk', dataIndex: 'product', render: (v, r) => `[${r.code}] ${v}` },
            { title: 'Dari', dataIndex: 'from' },
            { title: 'Ke', dataIndex: 'to' },
            { title: 'Kuantitas', dataIndex: 'qty', align: 'right', render: qf },
          ]}
        />
      </div>
    </>
  );
}
