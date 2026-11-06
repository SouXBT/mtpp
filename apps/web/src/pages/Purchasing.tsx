import { useEffect, useState } from 'react';
import { Button, Col, DatePicker, Descriptions, Input, InputNumber, Modal, Radio, Row, Select, Table, Tabs, Tag, Upload } from 'antd';
import { MailOutlined, PrinterOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCan } from '../auth';
import { useFetch, useQueryState } from '../hooks';
import { api, nf, openFile, qf, rp, run, tgl, today } from '../lib';
import { EmailTag, LABEL, emptyText, PageHead, Pill, SearchBar, StatusBar } from '../components/ui';
import { GroupSelect, groupCols, groupRows } from '../components/ui';
import Chatter from '../components/Chatter';
import Crud from '../components/Crud';
import { PaymentFields } from './Sales';
import { isCreatingPO, useCreatePO } from './createPO';

const PAY_STATES = ['menunggu barang', 'menunggu tagihan', 'belum dikonfirmasi', 'belum dibayar', 'sebagian', 'lunas'];

export function POList() {
  const [qs, set] = useQueryState({ tab: 'open' });
  const st = qs.tab === 'open' ? 'draft,sent,purchase' : qs.tab === 'done' ? 'done' : qs.tab === 'cancel' ? 'cancel' : undefined;
  const list = useFetch<any[]>('/purchase-orders', { state: st, q: qs.q, paymentState: qs.paymentState, partnerId: qs.partnerId });
  const sup = useFetch<any[]>('/partners', { kind: 'supplier' });
  const nav = useNavigate(); const can = useCan();
  const need = useFetch<any[]>('/sales-orders/worklist/need-po');
  const perlu = <Link to="/pengadaan/perlu-pesanan">Perlu PO Principal{need.data ? ` (${need.data.length})` : ''}</Link>;
  return (
    <>
      <PageHead title="PO Principal" sub={<>PO dibuat dari sales order yang stoknya kurang.{!can('pengadaan', 'create') && <> {perlu}</>}</>}
        extra={can('pengadaan', 'create') ? <Button type="primary" onClick={() => nav('/pengadaan/perlu-pesanan')}>Perlu PO Principal{need.data ? ` (${need.data.length})` : ''}</Button> : undefined} />
      <SearchBar resource="purchase-orders" value={qs.q} onChange={(q) => set({ q })} filter={qs} onApply={(f) => set(f)}>
        <Radio.Group optionType="button" value={qs.tab} onChange={(e) => set({ tab: e.target.value })} options={[{ value: 'open', label: 'Berjalan' }, { value: 'done', label: 'Selesai' }, { value: 'cancel', label: 'Batal' }, { value: 'all', label: 'Semua' }]} />
        <Select allowClear placeholder="Principal" style={{ width: 230 }} value={qs.partnerId ? +qs.partnerId : undefined} onChange={(v) => set({ partnerId: v ? String(v) : undefined })} options={(sup.data || []).map((s) => ({ value: s.id, label: s.name }))} />
        <Select allowClear placeholder="Status bayar" style={{ width: 190 }} value={qs.paymentState} onChange={(v) => set({ paymentState: v })} options={PAY_STATES.map((v) => ({ value: v, label: v }))} />
        <GroupSelect value={qs.group} onChange={(v) => set({ group: v })} options={[{ value: 'partner', label: 'Per principal' }, { value: 'mtppPaymentState', label: 'Per status bayar' }, { value: 'state', label: 'Per status' }, { value: 'month', label: 'Per bulan' }]} />
      </SearchBar>
      <div className="card" style={{ padding: 0 }}>
        <Table<any> key={`${qs.group || "none"}-${list.data?.length || 0}`} rowKey="id" loading={list.loading} dataSource={groupRows(list.data, qs.group, qs.group === 'month' ? (r) => String(r.dateOrder).slice(0, 7) : qs.group === 'state' ? (r) => LABEL.po[r.state] : undefined)} expandable={{ defaultExpandAllRows: true }} locale={{ emptyText: emptyText(qs, qs.tab === 'open' ? 'Tidak ada PO yang berjalan. PO dibuat dari menu Perlu PO Principal.' : qs.tab === 'all' ? 'Belum ada PO. PO dibuat dari menu Perlu PO Principal.' : 'Tidak ada data di tab ini.') }} onRow={(r) => ({ onClick: () => !r.__group && nav(`/pengadaan/${r.id}`), className: 'row-link' })} pagination={{ pageSize: 25, hideOnSinglePage: true }}
          columns={groupCols([
            { title: 'Nomor', dataIndex: 'name', render: (v, r) => <><b>{v}</b> {r.isDropship && <Tag color="purple">dropship</Tag>}</> },
            { title: 'Principal', dataIndex: 'partner' }, { title: 'Sales order', dataIndex: 'sale', render: (v) => v || '-' },
            { title: 'Tanggal', dataIndex: 'dateOrder', render: tgl },
            { title: 'Perkiraan tiba', dataIndex: 'datePlanned', render: (v, r) => <span className={r.state === 'purchase' && v && v < today() ? 'loss' : ''}>{tgl(v)}</span> },
            { title: 'Total', dataIndex: 'amountTotal', align: 'right', render: (v: any) => nf(v) },
            { title: 'Status', dataIndex: 'state', render: (v) => <Pill v={v} kind="po" /> },
            { title: 'Status bayar', dataIndex: 'mtppPaymentState', render: (v, r) => (['purchase', 'done'].includes(r.state) ? <Pill v={v} /> : '-') },
            { title: 'Sisa utang', dataIndex: 'mtppAmountDue', align: 'right', render: (v) => (v ? nf(v) : '-') },
          ], ['amountTotal', 'mtppAmountDue'])} />
      </div>
    </>
  );
}

export function NeedPurchaseList() {
  const list = useFetch<any[]>('/sales-orders/worklist/need-po');
  const can = useCan();
  const createPO = useCreatePO(list.reload);
  return (
    <>
      <PageHead title="Perlu PO Principal" sub="Sales order terkonfirmasi yang stoknya kurang dan belum dipesan kepada principal." />
      <div className="card" style={{ padding: 0 }}>
        <Table<any> rowKey="id" loading={list.loading} dataSource={list.data || []} pagination={false} locale={{ emptyText: 'Tidak ada sales order yang perlu dipesan.' }}
          columns={[
            { title: 'Sales order', dataIndex: 'name', render: (v, r) => <Link to={`/penjualan/${r.id}`}>{v}</Link> },
            { title: 'Pelanggan', dataIndex: 'partner', render: (v, r) => <>{v} {r.isNewCustomer && <Tag color="gold">baru</Tag>}</> },
            { title: 'Tanggal konfirmasi', dataIndex: 'dateConfirm', render: tgl }, { title: 'Rencana kirim', dataIndex: 'commitmentDate', render: tgl },
            { title: 'Produk kurang', dataIndex: 'items', align: 'right' }, { title: 'Jumlah kurang', dataIndex: 'shortage', align: 'right', render: qf },
            ...(can('pengadaan', 'create') ? [{ title: '', key: 'aksi', align: 'right' as const, render: (_: any, r: any) => <Button type="primary" size="small" disabled={isCreatingPO(r.id)} onClick={() => createPO({ id: r.id, isNewCustomer: r.isNewCustomer, paidAmount: r.paidAmount })}>Buat PO</Button> }] : []),
          ]} />
      </div>
    </>
  );
}

export function PODetail() {
  const { id } = useParams(); const nav = useNavigate(); const can = useCan();
  const doc = useFetch<any>(`/purchase-orders/${id}`);
  const [o, setO] = useState<any>(null); const [dirty, setDirty] = useState(false); const [rk, setRk] = useState(0);
  const [billOpen, setBillOpen] = useState(false); const [payOpen, setPayOpen] = useState(false); const [refundOpen, setRefundOpen] = useState(false);
  useEffect(() => { if (doc.data) { setO(JSON.parse(JSON.stringify(doc.data))); setDirty(false); } }, [doc.data]);
  if (!o) return null;
  const editable = ['draft', 'sent'].includes(o.state) && can('pengadaan', 'write');
  const upd = (p: any) => { setO({ ...o, ...p }); setDirty(true); };
  const reload = () => { doc.reload(); setRk(rk + 1); };
  const save = async () => {
    const body: any = editable ? { datePlanned: o.datePlanned, note: o.note, lines: o.lines.map((l: any) => ({ productId: l.productId, name: l.name, productQty: l.productQty, priceUnit: l.priceUnit, mtppSaleLineId: l.mtppSaleLineId })) } : { datePlanned: o.datePlanned, note: o.note };
    if (await run(api.patch(`/purchase-orders/${id}`, body), 'Perubahan disimpan')) reload();
  };
  const act = async (p: string, msg: string) => { if (dirty) await save(); if (await run(api.post(`/purchase-orders/${id}/${p}`, {}), msg) !== undefined) reload(); };
  const untaxed = o.lines.reduce((a: number, l: any) => a + Number(l.productQty) * Number(l.priceUnit), 0);
  const bills = (o.bills || []).filter((b: any) => b.moveType === 'in_invoice');
  const canBill = ['purchase', 'done'].includes(o.state) && o.lines.some((l: any) => Number(l.qtyReceived) > Number(l.qtyInvoiced));
  const due = Number(o.mtppAmountDue || 0);
  const payStep = PAY_STATES.includes(o.mtppPaymentState) ? o.mtppPaymentState : 'menunggu barang';

  return (
    <>
      <PageHead crumb={{ label: 'PO Principal', to: '/pengadaan' }} title={o.name} sub={o.sale && <>Dari sales order <Link to={`/penjualan/${o.sale.id}`}>{o.sale.name}</Link></>} />
      <div className="toolbar">
        {dirty && <Button type="primary" onClick={save}>Simpan</Button>}
        {['draft', 'sent'].includes(o.state) && can('pengadaan', 'write') && <Button type={dirty ? 'default' : 'primary'} icon={<MailOutlined />} onClick={() => act('send', 'Pesanan dikirim ke principal')}>Kirim Email</Button>}
        <Button icon={<PrinterOutlined />} onClick={() => openFile(`/purchase-orders/${id}/pdf`)}>Cetak</Button>
        {['draft', 'sent'].includes(o.state) && can('pengadaan', 'write') && <Button onClick={() => Modal.confirm({ title: 'Konfirmasi PO?', content: o.isDropship ? 'Surat jalan dropship dibuat otomatis.' : 'Penerimaan barang dibuat otomatis di gudang principal.', okText: 'Konfirmasi', cancelText: 'Batal', onOk: () => act('confirm', 'Pesanan dikonfirmasi') })}>Konfirmasi</Button>}
        {canBill && can('pengadaan', 'create') && <Button onClick={() => setBillOpen(true)} icon={<UploadOutlined />}>Catat Tagihan</Button>}
        {due > 0 && can('pengadaan', 'create') && <Button onClick={() => setPayOpen(true)}>Bayar Principal</Button>}
        {bills.some((b: any) => b.state === 'posted') && can('pengadaan', 'create') && <Button onClick={() => setRefundOpen(true)}>Nota Kredit</Button>}
        {o.state === 'purchase' && can('pengadaan', 'write') && o.lines.some((l: any) => Number(l.qtyReceived) > 0) && o.lines.some((l: any) => Number(l.qtyReceived) < Number(l.productQty)) && <Button onClick={() => Modal.confirm({ title: 'Tutup sisa PO?', content: 'Penerimaan yang belum datang dibatalkan dan kuantitas pesanan menjadi sebesar yang sudah diterima. Sisanya dapat dipesan ulang dari sales order.', okText: 'Tutup sisa PO', cancelText: 'Tidak', onOk: () => act('close-remaining', 'Sisa pesanan ditutup') })}>Tutup sisa PO</Button>}
        {!['done', 'cancel'].includes(o.state) && can('pengadaan', 'delete') && <Button danger onClick={() => Modal.confirm({ title: 'Batalkan PO?', okText: 'Batalkan', cancelText: 'Tidak', onOk: () => act('cancel', 'Pesanan dibatalkan') })}>Batalkan</Button>}
        <EmailTag s={o.emailStatus} />
        <span className="spacer" />
        <StatusBar value={o.state === 'cancel' ? 'draft' : o.state} steps={[{ key: 'draft', label: 'Permintaan' }, { key: 'sent', label: 'Terkirim' }, { key: 'purchase', label: 'Pesanan' }, { key: 'done', label: 'Selesai' }]} />
      </div>

      {['purchase', 'done'].includes(o.state) && (
        <div className="card" style={{ marginBottom: 16, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <b>Status pembayaran</b>
          <StatusBar value={payStep} steps={['menunggu barang', 'menunggu tagihan', 'belum dibayar', 'sebagian', 'lunas'].map((k) => ({ key: k, label: k }))} />
          {payStep === 'belum dikonfirmasi' && <Pill v="belum dikonfirmasi" />}
          <span className="spacer" style={{ flex: 1 }} /><span>Sisa utang <b>{rp(due)}</b></span>
        </div>
      )}

      <div className="card">
        <Descriptions column={{ xs: 1, md: 3 }} size="small">
          <Descriptions.Item label="Principal">{o.partner?.name}</Descriptions.Item>
          <Descriptions.Item label={o.isDropship ? 'Kirim langsung ke' : 'Gudang tujuan'}>{o.isDropship ? `${o.destAddress?.name || ''}, ${o.destAddress?.street || ''}` : o.warehouse?.name}</Descriptions.Item>
          <Descriptions.Item label="Tanggal PO">{tgl(o.dateOrder)}</Descriptions.Item>
        </Descriptions>
        <Row gutter={24} style={{ marginTop: 12 }}>
          <Col xs={24} md={8}><div className="muted">Perkiraan tiba</div><DatePicker disabled={!can('pengadaan', 'write') || ['done', 'cancel'].includes(o.state)} style={{ width: '100%' }} format="D MMMM YYYY" value={o.datePlanned ? dayjs(o.datePlanned) : null} onChange={(d) => upd({ datePlanned: d?.format('YYYY-MM-DD') })} /></Col>
          <Col xs={24} md={16}><div className="muted">Syarat pesanan</div><Input.TextArea disabled={!can('pengadaan', 'write') || ['done', 'cancel'].includes(o.state)} autoSize={{ minRows: 1 }} value={o.note} onChange={(e) => upd({ note: e.target.value })} /></Col>
        </Row>
        <Tabs style={{ marginTop: 10 }} items={[
          { key: 'l', label: 'Baris Produk', children: (
            <>
              <Table<any> size="middle" rowKey="id" pagination={false} dataSource={o.lines} columns={[
                { title: 'Produk', dataIndex: 'name' },
                { title: 'Qty', dataIndex: 'productQty', align: 'right', render: (v, l, i) => editable ? <InputNumber min={0} value={v} onChange={(x) => { const ls = [...o.lines]; ls[i] = { ...l, productQty: x }; upd({ lines: ls }); }} /> : `${qf(v)} ${l.uom}` },
                { title: 'Harga principal (Rp)', dataIndex: 'priceUnit', align: 'right', render: (v, l, i) => editable ? <InputNumber min={0} value={v} style={{ width: 150 }} formatter={(x) => Number(x || 0).toLocaleString('id-ID')} parser={(x) => Number(String(x).replace(/\./g, '')) as any} onChange={(x) => { const ls = [...o.lines]; ls[i] = { ...l, priceUnit: x }; upd({ lines: ls }); }} /> : nf(v) },
                { title: 'Diterima', dataIndex: 'qtyReceived', align: 'right', render: qf },
                { title: 'Ditagih', dataIndex: 'qtyInvoiced', align: 'right', render: qf },
                { title: 'Subtotal (Rp)', key: 's', align: 'right', render: (_, l) => nf(Number(l.productQty) * Number(l.priceUnit)) },
              ]} />
              <div className="totals"><span className="muted">DPP {rp(untaxed)}</span><span className="muted">PPN {rp(o.amountTax)}</span><span>Total <span className="big">{rp(dirty ? untaxed + Number(o.amountTax) : o.amountTotal)}</span></span></div>
            </>) },
          { key: 'r', label: `${o.isDropship ? 'Surat Jalan Dropship' : 'Penerimaan Barang'} (${o.transfers.length})`, children: (
            <Table<any> size="small" rowKey="id" pagination={false} dataSource={o.transfers} columns={[{ title: 'Nomor', dataIndex: 'name', render: (v, r) => <Link to={`/stok/dok/${r.id}`}>{v}</Link> }, { title: 'Jadwal', dataIndex: 'scheduledDate', render: tgl }, { title: 'Status', dataIndex: 'state', render: (v) => <Pill v={v} kind="tr" /> }]} />) },
          { key: 'b', label: `Tagihan Principal (${o.bills.length})`, children: (
            <Table<any> size="small" rowKey="id" pagination={false} dataSource={o.bills} columns={[
              { title: 'Nomor', dataIndex: 'name', render: (v, r) => <Link to={`/pengadaan/tagihan/${r.id}`}>{v}</Link> }, { title: 'No. tagihan principal', dataIndex: 'ref', render: (v) => v || '-' },
              { title: 'Jenis', dataIndex: 'moveType', render: (v) => (v === 'in_refund' ? 'nota kredit' : 'tagihan') }, { title: 'Tanggal', dataIndex: 'invoiceDate', render: tgl }, { title: 'Jatuh tempo', dataIndex: 'invoiceDateDue', render: tgl },
              { title: 'Total', dataIndex: 'amountTotal', align: 'right', render: (v: any) => nf(v) }, { title: 'Sisa', dataIndex: 'amountResidual', align: 'right', render: (v: any) => nf(v) },
              { title: 'Status', dataIndex: 'state', render: (v, r) => <>{<Pill v={v} kind="je" />} {v === 'posted' && <Pill v={r.paymentState} kind="pay" />}</> },
            ]} />) },
        ]} />
      </div>
      <Chatter model="purchase_orders" id={+id!} name={o.name} reloadKey={rk} />
      {billOpen && <BillModal o={o} onClose={(r) => { setBillOpen(false); if (r) nav(`/pengadaan/tagihan/${r.id}`); }} />}
      {payOpen && <PayModal title={`Bayar ${o.partner?.name}`} body={{ purchaseId: o.id }} max={due} onClose={(ok) => { setPayOpen(false); if (ok) reload(); }} />}
      {refundOpen && <RefundModal o={o} onClose={(ok) => { setRefundOpen(false); if (ok) reload(); }} />}
    </>
  );
}

// tagihan dari principal diunggah, lalu dikonfirmasi (posting)
function BillModal({ o, onClose }: { o: any; onClose: (r?: any) => void }) {
  const [v, setV] = useState<any>({ ref: '', date: today() }); const [file, setFile] = useState<File | null>(null);
  return (
    <Modal open title={`Tagihan principal untuk ${o.name}`} okText="Simpan tagihan" cancelText="Batal" onCancel={() => onClose()} onOk={async () => {
      const r = await run(api.post(`/invoices/from-purchase/${o.id}`, v), 'Tagihan draf dibuat');
      if (!r) return;
      if (file) { const fd = new FormData(); fd.append('file', file); await run(api.post(`/records/journal_entries/${r.id}/attachments`, fd)); }
      onClose(r);
    }}>
      <p className="muted">Tagihan dihitung dari kuantitas yang sudah diterima dan belum ditagih. Periksa lalu posting pada halaman tagihan.</p>
      <div className="muted">Nomor tagihan dari principal</div><Input value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} style={{ marginBottom: 10 }} />
      <div className="muted">Tanggal tagihan</div><DatePicker value={dayjs(v.date)} allowClear={false} format="D MMMM YYYY" onChange={(d) => setV({ ...v, date: d.format('YYYY-MM-DD') })} style={{ marginBottom: 10 }} />
      <div className="muted">Lama pembayaran (hari, kosong = sesuai syarat principal)</div><InputNumber min={0} value={v.dueDays} onChange={(x) => setV({ ...v, dueDays: x ?? undefined })} style={{ marginBottom: 10 }} />
      <div className="muted">File tagihan principal</div>
      <Upload beforeUpload={(f) => { setFile(f); return false; }} maxCount={1} onRemove={() => setFile(null)}><Button icon={<UploadOutlined />}>Pilih file</Button></Upload>
    </Modal>
  );
}

function RefundModal({ o, onClose }: { o: any; onClose: (ok?: boolean) => void }) {
  const [v, setV] = useState<any>({ amount: 0, ref: '', date: today() });
  return (
    <Modal open title="Nota kredit principal" okText="Simpan" cancelText="Batal" onCancel={() => onClose()} onOk={async () => { if (await run(api.post(`/invoices/refund-purchase/${o.id}`, v), 'Nota kredit dicatat')) onClose(true); }}>
      <div className="muted">Nilai sebelum PPN (Rp)</div><InputNumber min={0} style={{ width: '100%' }} value={v.amount} formatter={(x) => Number(x || 0).toLocaleString('id-ID')} parser={(x) => Number(String(x).replace(/\./g, '')) as any} onChange={(x) => setV({ ...v, amount: x })} />
      <div className="muted" style={{ marginTop: 10 }}>Nomor nota kredit</div><Input value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} />
    </Modal>
  );
}

export function PayModal({ title, body, max, onClose }: { title: string; body: any; max: number; onClose: (ok?: boolean) => void }) {
  const [v, setV] = useState<any>({ amount: max, method: 'BNK', date: today(), memo: '' });
  return (
    <Modal open title={title} okText="Catat pembayaran" cancelText="Batal" onCancel={() => onClose()} onOk={async () => { if (await run(api.post('/payments', { ...body, ...v }), 'Pembayaran dicatat')) onClose(true); }}>
      <p className="muted">Sisa yang harus dibayar: <b>{rp(max)}</b></p>
      <PaymentFields v={v} setV={setV} max={max} />
    </Modal>
  );
}

export function SupplierPricelist() {
  return (
    <>
      <PageHead title="Pricelist dan Diskon Principal" sub="Harga yang berlaku (tanggal mulai terbaru, kuantitas minimum terbesar) menjadi harga pokok pada penawaran. Harga yang sudah tidak berlaku tidak dipakai pada pesanan baru." />
      <Crud path="/supplier-prices" listPath="/supplier-prices/view" menu="pricelist_principal" archive={false} title="harga principal" fields={[
        { key: 'partnerId', label: 'Principal', type: 'select', required: true, table: false, source: { path: '/partners', params: { kind: 'supplier' }, label: (r) => r.name } },
        { key: 'partner', label: 'Principal', form: false },
        { key: 'productTmplId', label: 'Produk', type: 'select', required: true, table: false, source: { path: '/products', label: (r) => `[${r.code}] ${r.name}`, value: (r) => r.tmplId } },
        { key: 'product', label: 'Produk', form: false },
        { key: 'price', label: 'Harga (Rp)', type: 'money', required: true },
        { key: 'discount', label: 'Diskon', type: 'pct' },
        { key: 'minQty', label: 'Kuantitas minimum', type: 'number' },
        { key: 'dateStart', label: 'Berlaku mulai', type: 'date' },
        { key: 'dateEnd', label: 'Berlaku sampai', type: 'date', render: (v) => (v ? (v < today() ? <span className="muted">{tgl(v)} (tidak berlaku)</span> : tgl(v)) : 'tanpa batas') },
        { key: 'net', label: 'Harga bersih', form: false, render: (_, r) => nf(Number(r.price) * (1 - Number(r.discount) / 100)) },
      ]} />
    </>
  );
}
