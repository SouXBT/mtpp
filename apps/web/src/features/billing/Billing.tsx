import { useState } from 'react';
import { Alert, Button, Descriptions, Modal, Radio, Select, Table, Tabs } from 'antd';
import { MailOutlined, PrinterOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCan } from '../../app/auth';
import { useFetch, useQueryState } from '../../shared/hooks';
import { api, nf, openFile, qf, rp, run, tgl } from '../../shared/lib';
import { EmailTag, LABEL, emptyText, PageHead, Pill, SearchBar, StatusBar } from '../../shared/ui';
import { GroupSelect, groupCols, groupRows } from '../../shared/ui';
import Chatter from '../../shared/Chatter';
import { PayModal } from '../purchasing/Purchasing';

// pembatalan pembayaran: jurnal dibalik dan jumlahnya kembali ke sisa tagihan
const cancelPayment = (p: any, after: () => void) =>
  Modal.confirm({
    title: `Batalkan pembayaran ${p.name}?`,
    content: `${rp(p.amount)} dikembalikan ke sisa tagihan dan jurnal pembalik dibuat.`,
    okText: 'Batalkan Pembayaran',
    cancelText: 'Tidak',
    onOk: async () => {
      if ((await run(api.post(`/payments/${p.id}/cancel`, {}), 'Pembayaran dibatalkan')) !== undefined) after();
    },
  });

export function InvoiceList({ type }: { type: 'invoice' | 'bill' }) {
  const [qs, set] = useQueryState({});
  const list = useFetch<any[]>('/invoices', {
    type,
    q: qs.q,
    paymentState: qs.paymentState,
    overdue: qs.overdue,
    state: qs.state,
  });
  const nav = useNavigate();
  const base = type === 'bill' ? '/pengadaan/tagihan' : '/penagihan';
  return (
    <>
      <PageHead
        title={type === 'bill' ? 'Tagihan Principal' : 'Invoice Pelanggan'}
        sub={
          type === 'invoice'
            ? 'Invoice dibuat dari sales order untuk barang yang sudah dikirim. Jatuh tempo = tanggal invoice + term of payment.'
            : 'Tagihan dari principal dicatat pada pesanan yang bersangkutan.'
        }
      />
      <SearchBar
        resource={`invoices-${type}`}
        value={qs.q}
        onChange={(q) => set({ q })}
        filter={qs}
        onApply={(f) => set(f)}
      >
        <Select
          allowClear
          placeholder="Status bayar"
          style={{ width: 170 }}
          value={qs.paymentState}
          onChange={(v) => set({ paymentState: v })}
          options={Object.entries(LABEL.pay).map(([value, label]) => ({ value, label }))}
        />
        <Select
          allowClear
          placeholder="Status dokumen"
          style={{ width: 160 }}
          value={qs.state}
          onChange={(v) => set({ state: v })}
          options={[
            { value: 'draft', label: 'Draf' },
            { value: 'posted', label: 'Diposting' },
          ]}
        />
        <Button
          type={qs.overdue ? 'primary' : 'default'}
          danger={!!qs.overdue}
          onClick={() => set({ overdue: qs.overdue ? undefined : 'true' })}
        >
          Jatuh tempo
        </Button>
        <GroupSelect
          value={qs.group}
          onChange={(v) => set({ group: v })}
          options={[
            { value: 'partner', label: type === 'bill' ? 'Per principal' : 'Per pelanggan' },
            { value: 'paymentState', label: 'Per status bayar' },
            { value: 'month', label: 'Per bulan' },
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
            qs.group === 'month'
              ? (r) => String(r.invoiceDate || r.date).slice(0, 7)
              : qs.group === 'paymentState'
                ? (r) => LABEL.pay[r.paymentState]
                : undefined,
          )}
          expandable={{ defaultExpandAllRows: true }}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          locale={
            type === 'invoice'
              ? { emptyText: emptyText(qs, 'Belum ada invoice. Invoice dibuat dari menu Siap Ditagih.') }
              : undefined
          }
          onRow={(r) => ({ onClick: () => !r.__group && nav(`${base}/${r.id}`), className: 'row-link' })}
          columns={groupCols(
            [
              {
                title: 'Nomor',
                dataIndex: 'name',
                render: (v, r) => (
                  <>
                    <b>{v}</b>
                    {r.moveType.endsWith('refund') && <span className="muted"> (nota kredit)</span>}
                  </>
                ),
              },
              { title: type === 'bill' ? 'Principal' : 'Pelanggan', dataIndex: 'partner' },
              { title: 'Asal', dataIndex: 'invoiceOrigin', render: (v) => v || '-' },
              { title: 'Tanggal', dataIndex: 'invoiceDate', render: tgl },
              {
                title: 'Jatuh tempo',
                dataIndex: 'invoiceDateDue',
                render: (v, r) => <span className={r.overdue ? 'loss' : ''}>{tgl(v)}</span>,
              },
              { title: 'Total', dataIndex: 'amountTotal', align: 'right', render: (v: any) => nf(v) },
              {
                title: 'Sisa',
                dataIndex: 'amountResidual',
                align: 'right',
                render: (v, r) => (r.state === 'posted' ? nf(v) : '-'),
              },
              {
                title: 'Status',
                dataIndex: 'state',
                render: (v, r) => (v === 'posted' ? <Pill v={r.paymentState} kind="pay" /> : <Pill v={v} kind="je" />),
              },
            ],
            ['amountTotal', 'amountResidual'],
          )}
        />
      </div>
    </>
  );
}

export function ReadyToInvoice() {
  const list = useFetch<any[]>('/sales-orders', { state: 'sale,done' });
  const nav = useNavigate();
  const can = useCan();
  const rows = (list.data || []).filter((r) => ['to_invoice'].includes(r.invoiceStatus));
  return (
    <>
      <PageHead
        title="Sales Order Siap Ditagih"
        sub="Sales order yang memiliki barang terkirim tetapi belum dibuatkan invoice."
      />
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={list.loading}
          dataSource={rows}
          pagination={false}
          locale={{
            emptyText:
              'Tidak ada sales order yang menunggu invoice. Invoice bisa dibuat setelah surat jalan divalidasi.',
          }}
          columns={[
            { title: 'Sales order', dataIndex: 'name', render: (v, r) => <Link to={`/penjualan/${r.id}`}>{v}</Link> },
            { title: 'Pelanggan', dataIndex: 'partner' },
            { title: 'PO Pelanggan', dataIndex: 'clientOrderRef', render: (v) => v || '-' },
            { title: 'Tanggal konfirmasi', dataIndex: 'dateConfirm', render: tgl },
            { title: 'Total SO', dataIndex: 'amountTotal', align: 'right', render: (v: any) => nf(v) },
            {
              title: '',
              key: 'a',
              align: 'right',
              render: (_, r) =>
                can('penagihan', 'create') && (
                  <Button
                    type="primary"
                    size="small"
                    onClick={async () => {
                      const x = await run(api.post(`/invoices/from-sale/${r.id}`, {}), 'Invoice draf dibuat');
                      if (x) nav(`/penagihan/${x.id}`);
                    }}
                  >
                    Buat Invoice
                  </Button>
                ),
            },
          ]}
        />
      </div>
    </>
  );
}

export function InvoiceDetail({ type }: { type: 'invoice' | 'bill' }) {
  const { id } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const doc = useFetch<any>(`/invoices/${id}`);
  const [rk, setRk] = useState(0);
  const [payOpen, setPayOpen] = useState(false);
  const e = doc.data;
  if (!e) return null;
  const menu = type === 'bill' ? 'pengadaan' : 'penagihan';
  const reload = () => {
    doc.reload();
    setRk(rk + 1);
  };
  const act = async (p: string, msg: string) => {
    if ((await run(api.post(`/invoices/${id}/${p}`, {}), msg)) !== undefined) reload();
  };
  const cust = e.moveType.startsWith('out_');
  const base = type === 'bill' ? '/pengadaan/tagihan' : '/penagihan';
  const product = (e.lines || []).filter((l: any) => l.displayType === 'product');
  return (
    <>
      <PageHead
        crumb={{ label: type === 'bill' ? 'Tagihan Principal' : 'Invoice', to: base }}
        title={e.name}
        sub={e.moveType.endsWith('refund') ? 'Nota kredit' : undefined}
      />
      <div className="toolbar">
        {e.state === 'draft' && can(menu, 'write') && (
          <Button
            type="primary"
            onClick={() => act('post', cust ? 'Invoice diposting, jurnal dibuat' : 'Tagihan diposting, jurnal dibuat')}
          >
            Posting
          </Button>
        )}
        {e.state === 'posted' &&
          Number(e.amountResidual) > 0 &&
          e.moveType.endsWith('invoice') &&
          can(menu, 'create') && (
            <Button type="primary" onClick={() => setPayOpen(true)}>
              Catat Pembayaran
            </Button>
          )}
        {cust && e.state === 'posted' && can('penagihan', 'write') && (
          <Button icon={<MailOutlined />} onClick={() => act('send', 'Invoice dikirim lewat email')}>
            Kirim Email
          </Button>
        )}
        {cust && (
          <Button icon={<PrinterOutlined />} onClick={() => openFile(`/invoices/${id}/pdf`)}>
            Cetak
          </Button>
        )}
        {e.canReverse && !e.reversedEntryId && can(menu, 'write') && (
          <Button
            onClick={() =>
              Modal.confirm({
                title: 'Buat jurnal pembalik?',
                content: 'Dokumen yang sudah diposting hanya dapat dibatalkan melalui jurnal pembalik (nota kredit).',
                okText: 'Batalkan (jurnal pembalik)',
                cancelText: 'Tidak',
                onOk: () => act('reverse', 'Jurnal pembalik dibuat'),
              })
            }
          >
            Batalkan (jurnal pembalik)
          </Button>
        )}
        {e.state === 'draft' && can(menu, 'delete') && (
          <Button
            danger
            onClick={async () => {
              if ((await run(api.delete(`/invoices/${id}`), 'Draf dihapus')) !== undefined) nav(base);
            }}
          >
            Hapus draf
          </Button>
        )}
        <EmailTag s={e.emailStatus} />
        <span className="spacer" />
        <StatusBar
          value={
            e.state === 'draft'
              ? 'draft'
              : e.paymentState === 'reversed'
                ? 'reversed'
                : e.paymentState === 'paid'
                  ? 'paid'
                  : e.paymentState === 'partial'
                    ? 'partial'
                    : 'posted'
          }
          steps={
            e.paymentState === 'reversed'
              ? [
                  { key: 'draft', label: 'Draf' },
                  { key: 'posted', label: 'Diposting' },
                  { key: 'reversed', label: 'Dibalik' },
                ]
              : [
                  { key: 'draft', label: 'Draf' },
                  { key: 'posted', label: 'Belum dibayar' },
                  { key: 'partial', label: 'Sebagian' },
                  { key: 'paid', label: 'Lunas' },
                ]
          }
        />
      </div>
      {e.overdue && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Jatuh tempo ${tgl(e.invoiceDateDue)}; sisa ${rp(e.amountResidual)} belum dibayar.`}
        />
      )}
      <div className="card">
        <Descriptions column={{ xs: 1, md: 3 }} size="small">
          <Descriptions.Item label={cust ? 'Pelanggan' : 'Principal'}>{e.partner?.name}</Descriptions.Item>
          <Descriptions.Item label="Tanggal">{tgl(e.invoiceDate)}</Descriptions.Item>
          <Descriptions.Item label="Jatuh tempo">{tgl(e.invoiceDateDue)}</Descriptions.Item>
          {cust && (
            <Descriptions.Item label="Term of payment">
              {e.sale?.paymentTermName ||
                (e.invoiceDate && e.invoiceDateDue
                  ? `${Math.round((new Date(e.invoiceDateDue).getTime() - new Date(e.invoiceDate).getTime()) / 86400000)} hari`
                  : '-')}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Dokumen asal">
            {e.sale ? (
              <Link to={`/penjualan/${e.sale.id}`}>{e.sale.name}</Link>
            ) : e.purchase ? (
              <Link to={`/pengadaan/${e.purchase.id}`}>{e.purchase.name}</Link>
            ) : (
              e.invoiceOrigin || '-'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Referensi">{e.ref || '-'}</Descriptions.Item>
          <Descriptions.Item label="Jurnal">{e.journal?.name}</Descriptions.Item>
        </Descriptions>
        <Tabs
          style={{ marginTop: 8 }}
          items={[
            {
              key: 'p',
              label: 'Baris',
              children: (
                <>
                  <Table<any>
                    size="middle"
                    rowKey="id"
                    pagination={false}
                    dataSource={product}
                    columns={[
                      { title: 'Produk', dataIndex: 'name' },
                      { title: 'Qty', dataIndex: 'quantity', align: 'right', render: qf },
                      { title: 'Harga (Rp)', dataIndex: 'priceUnit', align: 'right', render: (v: any) => nf(v) },
                      {
                        title: 'Subtotal (Rp)',
                        key: 's',
                        align: 'right',
                        render: (_, l) => nf(Number(l.debit) + Number(l.credit)),
                      },
                    ]}
                  />
                  <div className="totals">
                    <span className="muted">DPP {rp(e.amountUntaxed)}</span>
                    <span className="muted">PPN {rp(e.amountTax)}</span>
                    <span>
                      Total <span className="big">{rp(e.amountTotal)}</span>
                    </span>
                    {e.state === 'posted' && (
                      <span>
                        Sisa <b>{rp(e.amountResidual)}</b>
                      </span>
                    )}
                  </div>
                  {cust && (
                    <div className="note">
                      <b>Terbilang:</b> <i>{e.words}</i>
                    </div>
                  )}
                </>
              ),
            },
            {
              key: 'j',
              label: 'Jurnal',
              children: (
                <Table<any>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={e.lines}
                  summary={(d) => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={2}>
                        <b>Total</b>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <b>{nf(d.reduce((a, l: any) => a + Number(l.debit), 0))}</b>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        <b>{nf(d.reduce((a, l: any) => a + Number(l.credit), 0))}</b>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                  columns={[
                    { title: 'Akun', dataIndex: 'account' },
                    { title: 'Keterangan', dataIndex: 'name' },
                    { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => (Number(v) ? nf(v) : '') },
                    { title: 'Kredit', dataIndex: 'credit', align: 'right', render: (v) => (Number(v) ? nf(v) : '') },
                  ]}
                />
              ),
            },
            {
              key: 'pay',
              label: `Pembayaran (${(e.payments || []).length + (e.advances || []).length})`,
              children: (
                <Table<any>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={[...(e.advances || []).map((p: any) => ({ ...p, adv: true })), ...(e.payments || [])]}
                  locale={{ emptyText: 'Belum ada pembayaran' }}
                  columns={[
                    { title: 'Nomor', dataIndex: 'name' },
                    { title: 'Tanggal', dataIndex: 'date', render: tgl },
                    { title: 'Jenis', key: 'k', render: (_, p) => (p.adv ? 'uang muka SO' : 'pembayaran invoice') },
                    { title: 'Keterangan', dataIndex: 'memo', render: (v) => v || '-' },
                    { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: (v: any) => nf(v) },
                    {
                      title: '',
                      key: 'r',
                      render: (_, p) => (
                        <>
                          {cust && <a onClick={() => openFile(`/payments/${p.id}/receipt`)}>Kuitansi</a>}{' '}
                          {!p.adv && can(menu, 'write') && (
                            <a className="loss" style={{ marginLeft: 10 }} onClick={() => cancelPayment(p, reload)}>
                              Batalkan Pembayaran
                            </a>
                          )}
                        </>
                      ),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </div>
      <Chatter model="journal_entries" id={+id!} name={e.name} reloadKey={rk} />
      {payOpen && (
        <PayModal
          title={`Pembayaran ${e.name}`}
          body={{ invoiceId: e.id }}
          max={Number(e.amountResidual)}
          onClose={(ok) => {
            setPayOpen(false);
            if (ok) reload();
          }}
        />
      )}
    </>
  );
}

export function PaymentsList() {
  const [qs, set] = useQueryState({ partnerType: 'customer' });
  const list = useFetch<any[]>('/payments', { partnerType: qs.partnerType, q: qs.q });
  const can = useCan();
  return (
    <>
      <PageHead title="Pembayaran" />
      <SearchBar resource="payments" value={qs.q} onChange={(q) => set({ q })} filter={qs} onApply={(f) => set(f)}>
        <Radio.Group
          optionType="button"
          value={qs.partnerType}
          onChange={(e) => set({ partnerType: e.target.value })}
          options={[
            { value: 'customer', label: 'Dari pelanggan' },
            { value: 'supplier', label: 'Ke principal' },
          ]}
        />
      </SearchBar>
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={list.loading}
          dataSource={list.data || []}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          columns={[
            { title: 'Nomor', dataIndex: 'name', render: (v) => <b>{v}</b> },
            { title: 'Tanggal', dataIndex: 'date', render: tgl },
            { title: 'Partner', dataIndex: 'partner' },
            {
              title: 'Untuk',
              key: 'u',
              render: (_, r) =>
                r.invoice ? (
                  <Link to={`${r.partnerType === 'supplier' ? '/pengadaan/tagihan' : '/penagihan'}/${r.invoiceId}`}>
                    {r.invoice}
                  </Link>
                ) : r.sale ? (
                  <>
                    {r.paymentType === 'outbound' ? 'pengembalian uang muka' : 'uang muka'}{' '}
                    <Link to={`/penjualan/${r.mtppSaleOrderId}`}>{r.sale}</Link>
                  </>
                ) : (
                  '-'
                ),
            },
            { title: 'Metode', dataIndex: 'journal' },
            { title: 'Keterangan', dataIndex: 'memo', render: (v) => v || '-' },
            { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: (v: any) => nf(v) },
            {
              title: '',
              key: 'k',
              render: (_, r) =>
                r.state === 'cancel' ? (
                  <span className="loss">batal</span>
                ) : (
                  <>
                    {r.partnerType === 'customer' && r.paymentType !== 'outbound' && (
                      <a onClick={() => openFile(`/payments/${r.id}/receipt`)}>Kuitansi</a>
                    )}{' '}
                    {can(r.partnerType === 'supplier' ? 'pengadaan' : 'penagihan', 'write') &&
                      Number(r.amountApplied) === 0 &&
                      !(r.partnerType === 'customer' && r.paymentType === 'outbound') && (
                        <a className="loss" style={{ marginLeft: 10 }} onClick={() => cancelPayment(r, list.reload)}>
                          Batalkan Pembayaran
                        </a>
                      )}
                  </>
                ),
            },
          ]}
        />
      </div>
    </>
  );
}
