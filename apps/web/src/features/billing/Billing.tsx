import { useState } from 'react';
import dayjs from 'dayjs';
import {
  Alert,
  Button,
  DatePicker,
  Descriptions,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Table,
  Tabs,
  Tag,
  Segmented,
} from 'antd';
import { MailOutlined, PrinterOutlined } from '@ant-design/icons';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useCan } from '../../app/auth';
import { useFetch, useQueryState } from '../../shared/hooks';
import { api, idr, nf, openFile, qf, rp, run, tgl, today } from '../../shared/lib';
import { PaymentHistory } from '../sales/PaymentHistory';
import { EmailTag, LABEL, emptyText, PageHead, Pill, RelatedBar, SearchBar, StatusBar } from '../../shared/ui';
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

// tautan bukti transfer yang dilampirkan saat pembayaran dicatat
export function ProofLink({ p }: { p: any }) {
  if (!p?.proof) return <span className="muted">-</span>;
  return (
    <a title={p.proof.name} onClick={(e) => (e.stopPropagation(), openFile(`/attachments/${p.proof.id}/download`))}>
      Lihat bukti
    </a>
  );
}

// status penagihan menurut masa tenggang pelanggan
export function DueTag({ s, until }: { s?: string | null; until?: string | null }) {
  if (s === 'tenggang') return <Tag color="gold">Masa tenggang s.d. {tgl(until)}</Tag>;
  if (s === 'lewat_tenggang') return <Tag color="red">Lewat masa tenggang</Tag>;
  return null;
}

// Ajukan jadwal cicilan: bagi rata lalu sesuaikan tanggal dan nominal per termin
function InstallmentModal({ e, onClose }: { e: any; onClose: (ok?: boolean) => void }) {
  const residual = Number(e.amountResidual);
  const old = e.installments?.rows?.length ? e.installments.rows : null;
  const split = (n: number, first: string, every: number) => {
    const base = Math.floor((residual / n) * 100) / 100;
    return Array.from({ length: n }, (_, i) => ({
      dateDue: dayjs(first)
        .add(i * every, 'day')
        .format('YYYY-MM-DD'),
      amount: i === n - 1 ? Math.round((residual - base * (n - 1)) * 100) / 100 : base,
    }));
  };
  const [n, setN] = useState(old ? old.length : 3);
  const [first, setFirst] = useState(old ? old[0].dateDue : dayjs(e.invoiceDateDue || today()).format('YYYY-MM-DD'));
  const [every, setEvery] = useState(30);
  const [rows, setRows] = useState<any[]>(
    old ? old.map((x: any) => ({ dateDue: x.dateDue, amount: Number(x.amount) })) : split(3, first, 30),
  );
  const [note, setNote] = useState(e.installments?.note || '');
  const sum = Math.round(rows.reduce((a, x) => a + Number(x.amount || 0), 0) * 100) / 100;
  const diff = Math.round((residual - sum) * 100) / 100;
  return (
    <Modal
      open
      width={640}
      title={`Jadwal cicilan ${e.name}`}
      okText="Ajukan Jadwal"
      cancelText="Batal"
      okButtonProps={{ disabled: Math.abs(diff) > 0.009 }}
      onCancel={() => onClose()}
      onOk={async () => {
        if (
          (await run(
            api.post(`/invoices/${e.id}/installments`, { termins: rows, note }),
            'Jadwal cicilan diajukan',
          )) !== undefined
        )
          onClose(true);
      }}
    >
      <p className="muted">
        Sisa tagihan {rp(residual)} dibagi menjadi beberapa termin. Jadwal berlaku setelah disetujui pengguna yang
        berhak mengubah data penagihan.
      </p>
      <div className="toolbar">
        <span>
          Termin <InputNumber min={2} max={24} value={n} onChange={(v) => setN(Number(v) || 2)} style={{ width: 70 }} />
        </span>
        <span>
          Mulai{' '}
          <DatePicker
            allowClear={false}
            format="D MMM YYYY"
            value={dayjs(first)}
            onChange={(d) => d && setFirst(d.format('YYYY-MM-DD'))}
          />
        </span>
        <span>
          Setiap{' '}
          <InputNumber
            min={1}
            max={120}
            value={every}
            onChange={(v) => setEvery(Number(v) || 30)}
            style={{ width: 70 }}
          />{' '}
          hari
        </span>
        <Button onClick={() => setRows(split(n, first, every))}>Bagi Rata</Button>
      </div>
      <Table<any>
        size="small"
        rowKey={(_, i) => String(i)}
        pagination={false}
        dataSource={rows}
        columns={[
          { title: 'Termin', key: 'n', render: (_, __, i) => i + 1 },
          {
            title: 'Jatuh tempo',
            dataIndex: 'dateDue',
            render: (v, _, i) => (
              <DatePicker
                allowClear={false}
                format="D MMM YYYY"
                value={dayjs(v)}
                onChange={(d) =>
                  d && setRows(rows.map((x, j) => (j === i ? { ...x, dateDue: d.format('YYYY-MM-DD') } : x)))
                }
              />
            ),
          },
          {
            title: 'Nominal (Rp)',
            dataIndex: 'amount',
            align: 'right',
            render: (v, _, i) => (
              <InputNumber
                min={0}
                style={{ width: 170 }}
                value={v}
                decimalSeparator=","
                formatter={(x) => (x === undefined || x === null || x === '' ? '' : Number(x).toLocaleString('id-ID'))}
                parser={(x) => Number(String(x).replace(/\./g, '').replace(',', '.')) as any}
                onChange={(a) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: Number(a) || 0 } : x)))}
              />
            ),
          },
        ]}
      />
      <div className="totals">
        <span>
          Jumlah termin <b>{rp(sum)}</b>
        </span>
        {Math.abs(diff) > 0.009 && <span className="loss">selisih {rp(diff)} dari sisa tagihan</span>}
      </div>
      <Input.TextArea
        rows={2}
        placeholder="Catatan kesepakatan (opsional)"
        value={note}
        onChange={(x) => setNote(x.target.value)}
      />
    </Modal>
  );
}

function InstallmentsTab({ e, can, reload }: { e: any; can: any; reload: () => void }) {
  const inst = e.installments || {};
  const act = async (p: Promise<any>, msg: string) => {
    if ((await run(p, msg)) !== undefined) reload();
  };
  return (
    <>
      {inst.state && (
        <div className="toolbar">
          {inst.state === 'draft' ? (
            <Tag color="gold">Menunggu persetujuan</Tag>
          ) : (
            <Tag color="green">
              Disetujui {inst.approvedBy ? `oleh ${inst.approvedBy}` : ''} {tgl(inst.approveDate)}
            </Tag>
          )}
          {inst.state === 'draft' && can('penagihan', 'write') && (
            <Button
              type="primary"
              onClick={() => act(api.post(`/invoices/${e.id}/installments/approve`, {}), 'Jadwal cicilan disetujui')}
            >
              Setujui Jadwal
            </Button>
          )}
          {can('penagihan', 'write') && (
            <Button
              danger
              onClick={() =>
                Modal.confirm({
                  title: 'Batalkan jadwal cicilan?',
                  content: 'Jatuh tempo kembali ke tanggal jatuh tempo invoice.',
                  okText: 'Batalkan Jadwal',
                  cancelText: 'Tidak',
                  onOk: () => act(api.delete(`/invoices/${e.id}/installments`), 'Jadwal cicilan dibatalkan'),
                })
              }
            >
              Batalkan Jadwal
            </Button>
          )}
        </div>
      )}
      <Table<any>
        size="small"
        rowKey="sequence"
        pagination={false}
        dataSource={inst.rows || []}
        locale={{ emptyText: 'Belum ada jadwal cicilan. Jatuh tempo mengikuti tanggal jatuh tempo invoice.' }}
        columns={[
          { title: 'Termin', dataIndex: 'sequence' },
          {
            title: 'Jatuh tempo',
            dataIndex: 'dateDue',
            render: (v, r) => <span className={r.late ? 'loss' : ''}>{tgl(v)}</span>,
          },
          { title: 'Nominal', dataIndex: 'amount', align: 'right', render: (v: any) => idr(v) },
          { title: 'Terbayar', dataIndex: 'paid', align: 'right', render: (v: any) => idr(v) },
          { title: 'Sisa', dataIndex: 'open', align: 'right', render: (v: any) => idr(v) },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (v) =>
              v === 'lunas' ? (
                <Tag color="green">Lunas</Tag>
              ) : v === 'sebagian' ? (
                <Tag color="blue">Sebagian</Tag>
              ) : (
                <Tag>Belum</Tag>
              ),
          },
        ]}
      />
      {Number(inst.outside) > 0.5 && (
        <div className="note">
          Sisa {rp(inst.outside)} di luar jadwal (pembayaran lama dibatalkan) jatuh tempo pada tanggal invoice.
        </div>
      )}
      {inst.note && <div className="note">Catatan: {inst.note}</div>}
    </>
  );
}

export function InvoiceList({ type }: { type: 'invoice' | 'bill' }) {
  const [qs, set] = useQueryState({});
  const list = useFetch<any[]>('/invoices', {
    type,
    q: qs.q,
    paymentState: qs.paymentState,
    overdue: qs.overdue,
    dueState: qs.dueState,
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
        {type === 'invoice' && (
          <Select
            allowClear
            placeholder="Status penagihan"
            style={{ width: 190 }}
            value={qs.dueState}
            onChange={(v) => set({ dueState: v })}
            options={[
              { value: 'belum_jt', label: 'Belum jatuh tempo' },
              { value: 'tenggang', label: 'Masa tenggang' },
              { value: 'lewat_tenggang', label: 'Lewat masa tenggang' },
            ]}
          />
        )}
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
                render: (v: any, r: any) => (
                  <>
                    <b>{v}</b>
                    {r.moveType.endsWith('refund') && <span className="muted"> (nota kredit)</span>}
                  </>
                ),
              },
              { title: type === 'bill' ? 'Principal' : 'Pelanggan', dataIndex: 'partner' },
              { title: 'Asal', dataIndex: 'invoiceOrigin', render: (v: any) => v || '-' },
              { title: 'Tanggal', dataIndex: 'invoiceDate', render: tgl },
              {
                title: 'Jatuh tempo',
                dataIndex: 'dueDate',
                render: (v: any, r: any) => (
                  <>
                    <span className={r.overdue ? 'loss' : ''}>{tgl(v || r.invoiceDateDue)}</span>{' '}
                    <DueTag s={r.dueState} until={r.graceUntil} />
                  </>
                ),
              },
              { title: 'Total', dataIndex: 'amountTotal', align: 'right', render: (v: any) => idr(v) },
              {
                title: 'Sisa',
                dataIndex: 'amountResidual',
                align: 'right',
                render: (v: any, r: any) => (r.state === 'posted' ? idr(v) : '-'),
              },
              {
                title: 'Status',
                dataIndex: 'state',
                render: (v: any, r: any) =>
                  v !== 'posted' ? (
                    <Pill v={v} kind="je" />
                  ) : r.moveType.endsWith('refund') ? (
                    // nota kredit: lunas berarti sudah terpakai seluruhnya untuk mengurangi tagihan atau dikembalikan
                    <Pill v={r.paymentState === 'paid' ? 'paid' : 'partial'}>
                      {r.paymentState === 'paid' ? 'kredit terpakai' : 'sisa kredit'}
                    </Pill>
                  ) : (
                    <Pill v={r.paymentState} kind="pay" />
                  ),
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
            { title: 'Total SO', dataIndex: 'amountTotal', align: 'right', render: (v: any) => idr(v) },
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
  const loc = useLocation();
  const can = useCan();
  const doc = useFetch<any>(`/invoices/${id}`);
  const [rk, setRk] = useState(0);
  const [payOpen, setPayOpen] = useState(false);
  const [instOpen, setInstOpen] = useState(false);
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
        {e.canInstall && can('penagihan', 'create') && (
          <Button onClick={() => setInstOpen(true)}>{e.installments?.state ? 'Ubah Cicilan' : 'Atur Cicilan'}</Button>
        )}
        {cust && e.dueState && e.dueState !== 'lunas' && can('penagihan', 'write') && (
          <Button icon={<MailOutlined />} onClick={() => act('remind', 'Pengingat pembayaran dikirim')}>
            Kirim Pengingat
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
      <RelatedBar
        items={[
          {
            label: 'Sales Order',
            docs: e.sale ? [{ id: e.sale.id, name: e.sale.name, to: `/penjualan/${e.sale.id}` }] : [],
          },
          {
            label: 'PO Principal',
            docs: e.purchase ? [{ id: e.purchase.id, name: e.purchase.name, to: `/pengadaan/${e.purchase.id}` }] : [],
          },
          {
            label: 'Pembayaran',
            docs: [...(e.payments || []), ...(e.advances || [])].map((p: any) => ({
              id: p.id,
              name: p.name,
              to: `/penagihan/pembayaran?q=${encodeURIComponent(p.name)}`,
              note: rp(p.amount),
            })),
          },
          ...(e.installments?.rows?.length
            ? [
                {
                  label: e.installments.state === 'approved' ? 'termin cicilan' : 'termin menunggu persetujuan',
                  value: e.installments.rows.length,
                  tone: (e.installments.state === 'approved' ? 'ok' : 'warn') as 'ok' | 'warn',
                  to: `${loc.pathname}?tab=cicilan`,
                },
              ]
            : []),
        ]}
      />
      {e.dueState === 'lewat_tenggang' ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Lewat masa tenggang (${e.graceDays} hari setelah jatuh tempo ${tgl(e.dueDate)}); sisa ${rp(e.amountResidual)} belum dibayar.`}
          description="Surat jalan baru untuk pelanggan ini ditahan sampai tagihan dilunasi atau Pimpinan memberi izin kirim pada sales order."
        />
      ) : e.dueState === 'tenggang' ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Jatuh tempo ${tgl(e.dueDate)} terlewati; masa tenggang sampai ${tgl(e.graceUntil)}.`}
        />
      ) : (
        e.overdue && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={`Jatuh tempo ${tgl(e.dueDate || e.invoiceDateDue)}; sisa ${rp(e.amountResidual)} belum dibayar.`}
          />
        )
      )}
      <div className="card">
        <Descriptions column={{ xs: 1, md: 3 }} size="small">
          <Descriptions.Item label={cust ? 'Pelanggan' : 'Principal'}>{e.partner?.name}</Descriptions.Item>
          <Descriptions.Item label="Tanggal">{tgl(e.invoiceDate)}</Descriptions.Item>
          <Descriptions.Item label="Jatuh tempo">
            {tgl(e.invoiceDateDue)}
            {e.installments?.state === 'approved' && e.dueDate && e.dueDate !== e.invoiceDateDue && (
              <span className="muted" style={{ marginLeft: 6 }}>
                (cicilan berikut {tgl(e.dueDate)})
              </span>
            )}
          </Descriptions.Item>
          {cust && e.moveType === 'out_invoice' && (
            <Descriptions.Item label="Masa tenggang">
              {e.graceDays} hari <DueTag s={e.dueState} until={e.graceUntil} />
            </Descriptions.Item>
          )}
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
          key={loc.search}
          defaultActiveKey={new URLSearchParams(loc.search).get('tab') === 'cicilan' ? 'inst' : undefined}
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
                      { title: 'Harga (Rp)', dataIndex: 'priceUnit', align: 'right', render: (v: any) => idr(v) },
                      {
                        title: 'Subtotal (Rp)',
                        key: 's',
                        align: 'right',
                        render: (_, l) => idr(Number(l.debit) + Number(l.credit)),
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
                        <b>{idr(d.reduce((a, l: any) => a + Number(l.debit), 0))}</b>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        <b>{idr(d.reduce((a, l: any) => a + Number(l.credit), 0))}</b>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                  columns={[
                    { title: 'Akun', dataIndex: 'account' },
                    { title: 'Keterangan', dataIndex: 'name' },
                    { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => (Number(v) ? idr(v) : '') },
                    { title: 'Kredit', dataIndex: 'credit', align: 'right', render: (v) => (Number(v) ? idr(v) : '') },
                  ]}
                />
              ),
            },
            ...(e.moveType === 'out_invoice'
              ? [
                  {
                    key: 'inst',
                    label: `Cicilan${e.installments?.rows?.length ? ` (${e.installments.rows.length})` : ''}`,
                    children: <InstallmentsTab e={e} can={can} reload={reload} />,
                  },
                ]
              : []),
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
                    { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: (v: any) => idr(v) },
                    { title: 'Bukti', key: 'b', render: (_, p) => <ProofLink p={p} /> },
                    {
                      title: '',
                      key: 'r',
                      render: (_, p) => (
                        <>
                          {cust && p.paymentType !== 'outbound' && (
                            <a onClick={() => openFile(`/payments/${p.id}/receipt`)}>Kuitansi</a>
                          )}{' '}
                          {!p.adv && p.paymentType !== 'outbound' && can(menu, 'write') && (
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
      {instOpen && (
        <InstallmentModal
          e={e}
          onClose={(ok) => {
            setInstOpen(false);
            if (ok) reload();
          }}
        />
      )}
      {payOpen && (
        <PayModal
          title={`Pembayaran ${e.name}`}
          body={{ invoiceId: e.id }}
          proof={cust}
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

// Satu tempat untuk semua pembayaran: daftar per transaksi, atau riwayat per sales order (uang muka ke-n,
// pembayaran invoice, pelunasan, hangus) yang dulu ada di Penjualan > Riwayat Pembayaran.
export function PaymentsPage() {
  const [qs, set] = useQueryState({});
  const tab = qs.tab === 'so' ? 'so' : 'all';
  return (
    <>
      <PageHead
        title="Pembayaran"
        sub="Pembayaran dari pelanggan dan ke principal; tab Per sales order menunjukkan uang muka, pelunasan, dan sisa per pesanan."
      />
      <Segmented
        style={{ marginBottom: 14 }}
        value={tab}
        onChange={(v) => set({ tab: v === 'so' ? 'so' : undefined, partnerType: undefined, kind: undefined })}
        options={[
          { value: 'all', label: 'Semua pembayaran' },
          { value: 'so', label: 'Per sales order' },
        ]}
      />
      {tab === 'so' ? <PaymentHistory embedded /> : <PaymentsList embedded />}
    </>
  );
}

export function PaymentsList({ embedded = false }: { embedded?: boolean }) {
  const [qs, set] = useQueryState({ partnerType: 'customer' });
  const list = useFetch<any[]>('/payments', { partnerType: qs.partnerType, q: qs.q });
  const can = useCan();
  return (
    <>
      {!embedded && <PageHead title="Pembayaran" />}
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
            { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: (v: any) => idr(v) },
            { title: 'Bukti', key: 'b', render: (_, r) => <ProofLink p={r} /> },
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
