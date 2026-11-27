import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  DatePicker,
  Descriptions,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Upload,
} from 'antd';
import {
  DeleteOutlined,
  MailOutlined,
  MoreOutlined,
  PlusOutlined,
  PrinterOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import type { ShellContext } from '../../app/Shell';
import { useAuth, useCan } from '../../app/auth';
import { useFetch, useQueryState } from '../../shared/hooks';
import { api, idr, nf, openFile, paymentForm, pct, qf, rp, run, tgl, today } from '../../shared/lib';
import { EmailTag, LABEL, emptyText, PageHead, Pill, SearchBar, StatusBar } from '../../shared/ui';
import { GroupSelect, groupCols, groupRows } from '../../shared/ui';
import Chatter from '../../shared/Chatter';
import { isCreatingPO, useCreatePO } from '../purchasing/createPO';
import { useCreateDelivery } from '../stock/createDelivery';
import { nextSteps } from './nextSteps';

const TABS = [
  { key: 'quote', label: 'Penawaran', state: 'draft,sent' },
  { key: 'order', label: 'Sales Order', state: 'sale,done' },
  { key: 'cancel', label: 'Batal', state: 'cancel' },
  { key: 'all', label: 'Semua', state: '' },
];
const FILTER_TABS = TABS.filter((t) => t.key === 'cancel' || t.key === 'all');

export function SalesList() {
  const [qs, set] = useQueryState({ tab: 'quote' });
  const tab = TABS.find((t) => t.key === qs.tab) || TABS[0];
  const params = {
    state: tab.state || undefined,
    q: qs.q,
    from: qs.from,
    to: qs.to,
    partnerId: qs.partnerId,
    expired: qs.expired,
  };
  const list = useFetch<any[]>('/sales-orders', params);
  const can = useCan();
  const nav = useNavigate();
  const customers = useFetch<any[]>('/partners', { kind: 'customer' });
  return (
    <>
      <PageHead
        title={tab.key === 'order' ? 'Sales Order' : tab.key === 'quote' ? 'Penawaran' : 'Penawaran dan Sales Order'}
        sub={
          tab.key === 'quote'
            ? 'PO dari pelanggan dicatat di sini: buka atau buat penawaran, isi PO Pelanggan, lalu konfirmasi.'
            : undefined
        }
        extra={
          can('penjualan', 'create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/penjualan/baru')}>
              Penawaran baru
            </Button>
          )
        }
      />
      <SearchBar
        resource="sales-orders"
        value={qs.q}
        onChange={(q) => set({ q })}
        filter={qs}
        onApply={(f) => set({ ...f })}
      >
        <Radio.Group
          value={FILTER_TABS.some((t) => t.key === tab.key) ? tab.key : null}
          onChange={(e) => set({ tab: e.target.value, expired: undefined })}
          optionType="button"
          options={FILTER_TABS.map((t) => ({ value: t.key, label: t.label }))}
        />
        <Select
          allowClear
          placeholder="Pelanggan"
          style={{ width: 220 }}
          value={qs.partnerId ? +qs.partnerId : undefined}
          onChange={(v) => set({ partnerId: v ? String(v) : undefined })}
          showSearch
          optionFilterProp="label"
          options={(customers.data || []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <DatePicker.RangePicker
          format="D MMM YYYY"
          value={qs.from ? [dayjs(qs.from), dayjs(qs.to)] : null}
          onChange={(r) => set({ from: r?.[0]?.format('YYYY-MM-DD'), to: r?.[1]?.format('YYYY-MM-DD') })}
        />
        {tab.key === 'quote' && (
          <Button
            type={qs.expired ? 'primary' : 'default'}
            onClick={() => set({ expired: qs.expired ? undefined : 'true' })}
          >
            Kedaluwarsa
          </Button>
        )}
        <GroupSelect
          value={qs.group}
          onChange={(v) => set({ group: v })}
          options={[
            { value: 'partner', label: 'Per pelanggan' },
            { value: 'state', label: 'Per status' },
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
              ? (r) => String(r.dateOrder).slice(0, 7)
              : qs.group === 'state'
                ? (r) => LABEL.so[r.state]
                : undefined,
          )}
          expandable={{ defaultExpandAllRows: true }}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          locale={{
            emptyText: emptyText(
              qs,
              tab.key === 'order'
                ? 'Belum ada sales order. Sales order muncul setelah penawaran dikonfirmasi.'
                : tab.key === 'cancel'
                  ? 'Belum ada dokumen yang dibatalkan.'
                  : tab.key === 'all'
                    ? 'Belum ada penawaran atau sales order. Klik "Penawaran baru" untuk memulai.'
                    : 'Belum ada penawaran. Klik "Penawaran baru" untuk memulai.',
            ),
          }}
          onRow={(r) => ({ onClick: () => !r.__group && nav(`/penjualan/${r.id}`), className: 'row-link' })}
          columns={groupCols(
            [
              { title: 'Nomor', dataIndex: 'name', render: (v: any) => <b>{v}</b> },
              { title: 'Tanggal', dataIndex: 'dateOrder', render: tgl },
              {
                title: 'Pelanggan',
                dataIndex: 'partner',
                render: (v: any, r: any) => (
                  <>
                    {v} {r.isNewCustomer && <Tag color="gold">baru</Tag>}
                  </>
                ),
              },
              { title: 'PO Pelanggan', dataIndex: 'clientOrderRef', render: (v: any) => v || '-' },
              {
                title: 'Berlaku sampai',
                dataIndex: 'validityDate',
                render: (v: any, r: any) => (
                  <span className={r.expired ? 'loss' : ''}>
                    {tgl(v)}
                    {r.expired ? ' · kedaluwarsa' : ''}
                  </span>
                ),
              },
              { title: 'Total', dataIndex: 'amountTotal', align: 'right', render: (v: any) => idr(v) },
              { title: 'Status', dataIndex: 'state', render: (v: any) => <Pill v={v} kind="so" /> },
              {
                title: 'Penagihan',
                dataIndex: 'invoiceStatus',
                render: (v: any, r: any) =>
                  ['sale', 'done'].includes(r.state) ? (
                    <Pill v={v === 'invoiced' ? 'paid' : v === 'to_invoice' ? 'not_paid' : 'draft'}>
                      {LABEL.inv[v]}
                    </Pill>
                  ) : (
                    '-'
                  ),
              },
            ],
            ['amountTotal'],
          )}
        />
      </div>
    </>
  );
}

const STEPS = [
  { key: 'draft', label: 'Penawaran' },
  { key: 'sent', label: 'Terkirim' },
  { key: 'sale', label: 'Sales Order' },
  { key: 'done', label: 'Selesai' },
];

export function SalesDetail() {
  const { id } = useParams();
  const isNew = id === 'baru';
  const nav = useNavigate();
  const can = useCan();
  const { me, settings } = useAuth();
  const { setNavHint } = useOutletContext<ShellContext>();
  const doc = useFetch<any>(isNew ? null : `/sales-orders/${id}`);
  const customers = useFetch<any[]>('/partners', { kind: 'customer' });
  const products = useFetch<any[]>('/products');
  const terms = useFetch<any[]>('/payment-terms');
  const [o, setO] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [rk, setRk] = useState(0);
  const priceSeq = useRef(0);
  const priceTimer = useRef<any>(null);
  const [pfOpen, setPfOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  useEffect(() => {
    if (isNew)
      setO({
        dateOrder: today(),
        lines: [],
        state: 'draft',
        mtppTermPayment: settings?.terms?.payment,
        mtppTermDelivery: settings?.terms?.delivery,
        mtppTermValidity: `${settings?.terms?.validityDays || 30} hari sejak tanggal penawaran`,
        mtppTermWarranty: settings?.terms?.warranty,
        mtppTermHandover: settings?.terms?.handover,
        mtppTermStandard: settings?.terms?.standard,
      });
    else if (doc.data) {
      setO(JSON.parse(JSON.stringify(doc.data)));
      setDirty(false);
    }
  }, [doc.data, isNew, settings]);
  // Submenu Penawaran atau Sales Order menyala sesuai status; dibatalkan tidak menyala. Ikut berubah setelah konfirmasi.
  // Status hanya dipakai bila dokumen di state adalah dokumen rute ini; dokumen sebelumnya tidak boleh meninggalkan penanda basi.
  const st = o && String(o.id) === id ? o.state : undefined;
  useEffect(() => {
    if (!st) {
      setNavHint(null);
      return;
    }
    setNavHint(st === 'cancel' ? null : ['sale', 'done'].includes(st) ? 'tab=order' : 'tab=quote');
  }, [st, setNavHint]);
  const partner = useFetch<any>(o?.partnerId ? `/partners/${o.partnerId}` : null);
  const createPO = useCreatePO(() => {
    doc.reload();
    setRk((n) => n + 1);
  });
  const delivery = useCreateDelivery(() => {
    doc.reload();
    setRk((n) => n + 1);
  });
  if (!o) return null;

  const editable = isNew || ['draft', 'sent'].includes(o.state);
  const canEdit = editable && can('penjualan', isNew ? 'create' : 'write');
  const upd = (p: any) => {
    setO({ ...o, ...p });
    setDirty(true);
  };
  const cost = me?.canSeeCost;
  const lines: any[] = o.lines || [];
  const calc = (l: any) => {
    const sub = Number(l.productUomQty || 0) * Number(l.priceUnit || 0) * (1 - Number(l.discount || 0) / 100);
    const m = sub - Number(l.productUomQty || 0) * Number(l.purchasePrice || 0);
    return { sub, m, mp: sub ? (m / sub) * 100 : 0 };
  };
  const untaxed = lines.reduce((a, l) => a + calc(l).sub, 0);
  const tax = Math.round(
    (untaxed *
      (Number(settings?.tax?.dppNum || 11) / Number(settings?.tax?.dppDen || 12)) *
      Number(settings?.tax?.rate || 12)) /
      100,
  );
  const hasLines = lines.some((l) => l.productId);
  const sendable = hasLines && untaxed > 0;
  const margin = lines.reduce((a, l) => a + calc(l).m, 0);

  const setLine = (i: number, p: any) => {
    const ls = [...lines];
    ls[i] = { ...ls[i], ...p };
    upd({ lines: ls });
  };
  const pickProduct = async (i: number, pid: number) => {
    const r = await run(
      api.get(`/products/${pid}/price`, { params: { partnerId: o.partnerId, qty: lines[i]?.productUomQty || 1 } }),
    );
    const pr = (products.data || []).find((p) => p.id === pid);
    if (r)
      setLine(i, {
        productId: pid,
        name: r.name,
        code: pr?.code,
        uom: pr?.uom,
        priceUnit: r.priceUnit,
        discount: r.discount,
        purchasePrice: r.purchasePrice,
        mtppWarehouseId: r.warehouseId,
        mtppIsDropship: r.dropship,
        priceManual: false,
        listHint: null,
      });
  };
  // Harga daftar dihitung ulang saat kuantitas atau pelanggan berubah. Harga ketikan pengguna dan baris yang
  // sudah tersimpan tidak ditimpa; harga daftarnya ditampilkan sebagai petunjuk.
  const refreshPrices = async (ls: any[], partnerId: number) => {
    const seq = ++priceSeq.current;
    const res = await Promise.all(
      ls.map((l) =>
        l.productId
          ? api
              .get(`/products/${l.productId}/price`, { params: { partnerId, qty: l.productUomQty || 1 } })
              .then((r) => r.data)
              .catch(() => null)
          : null,
      ),
    );
    if (seq !== priceSeq.current) return;
    setO((cur: any) => ({
      ...cur,
      lines: (cur.lines || []).map((l: any, i: number) => {
        const r = res[i],
          src = ls[i];
        if (!r || !src || l.productId !== src.productId || Number(l.productUomQty) !== Number(src.productUomQty))
          return l;
        if (l.priceManual === false)
          return { ...l, priceUnit: r.priceUnit, discount: r.discount, purchasePrice: r.purchasePrice, listHint: null };
        const same = Number(l.priceUnit) === Number(r.priceUnit) && Number(l.discount || 0) === Number(r.discount || 0);
        return { ...l, purchasePrice: r.purchasePrice, listHint: same ? null : r };
      }),
    }));
  };
  const setQty = (i: number, x: any) => {
    const ls = [...lines];
    ls[i] = { ...ls[i], productUomQty: x };
    upd({ lines: ls });
    clearTimeout(priceTimer.current);
    priceTimer.current = setTimeout(() => refreshPrices(ls, o.partnerId), 400);
  };

  const payload = () => ({
    partnerId: o.partnerId,
    partnerShippingId: o.partnerShippingId || null,
    dateOrder: o.dateOrder,
    validityDate: o.validityDate,
    commitmentDate: o.commitmentDate,
    clientOrderRef: o.clientOrderRef,
    mtppTermPayment: o.mtppTermPayment,
    mtppTermDelivery: o.mtppTermDelivery,
    mtppTermValidity: o.mtppTermValidity,
    mtppTermWarranty: o.mtppTermWarranty,
    mtppTermHandover: o.mtppTermHandover,
    mtppTermStandard: o.mtppTermStandard,
    ...(o.nameEdit ? { name: o.nameEdit } : {}),
    lines: lines
      .filter((l) => l.productId)
      .map((l) => ({
        productId: l.productId,
        name: l.name,
        productUomQty: l.productUomQty,
        priceUnit: l.priceUnit,
        discount: l.discount,
        mtppWarehouseId: l.mtppWarehouseId,
        mtppIsDropship: l.mtppIsDropship,
      })),
  });
  const save = async (): Promise<boolean> => {
    if (!o.partnerId) {
      Modal.warning({ title: 'Pilih pelanggan terlebih dahulu' });
      return false;
    }
    if (isNew) {
      const r = await run(api.post('/sales-orders', payload()), 'Penawaran dibuat');
      if (r) nav(`/penjualan/${r.id}`, { replace: true });
      return !!r;
    }
    const body: any = editable
      ? payload()
      : { commitmentDate: o.commitmentDate, clientOrderRef: o.clientOrderRef, partnerShippingId: o.partnerShippingId };
    if (await run(api.patch(`/sales-orders/${id}`, body), 'Perubahan disimpan')) {
      doc.reload();
      setRk(rk + 1);
      return true;
    }
    return false;
  };
  const act = async (path: string, msg: string, body?: any) => {
    if (dirty && !(await save())) return;
    const r = await run(api.post(`/sales-orders/${id}/${path}`, body || {}), msg);
    if (r !== undefined) {
      doc.reload();
      setRk(rk + 1);
    }
    return r;
  };
  const reload = () => {
    doc.reload();
    setRk(rk + 1);
  };

  const addresses = (partner.data?.addresses || []) as any[];
  const step = o.state === 'cancel' ? 'draft' : o.state;
  const pay = o.payment || {};
  const hold = o.creditHold || {};
  const steps = nextSteps(o);
  const release = () => {
    let note = '';
    Modal.confirm({
      title: 'Izinkan pengiriman?',
      content: (
        <>
          <div>Surat jalan sales order ini dapat diterbitkan walau pelanggan memiliki tagihan lewat masa tenggang.</div>
          <Input.TextArea
            style={{ marginTop: 12 }}
            rows={2}
            placeholder="Alasan (wajib), mis. janji bayar tanggal ..."
            onChange={(e) => {
              note = e.target.value;
            }}
          />
        </>
      ),
      okText: 'Izinkan Kirim',
      cancelText: 'Batal',
      onOk: () => act('release', 'Pengiriman diizinkan', { note }),
    });
  };
  const fromQuote = o.quotationNumber && o.name !== o.quotationNumber;
  // draf bekas SO dan penawaran lama yang nomornya tidak diganti tetap memakai nomor yang ada
  const getsSoNumber = !fromQuote && (o.quotationNumber || (o.nameEdit && o.nameEdit !== o.name));
  // Nilai PO Pelanggan disimpan di variabel lokal; dialog statis tidak punya state komponen.
  const confirmSO = () => {
    let po = String(o.clientOrderRef ?? '');
    Modal.confirm({
      title: 'Konfirmasi menjadi sales order?',
      content: (
        <>
          <div>{`${o.expired ? 'Penawaran sudah kedaluwarsa. ' : ''}Baris produk akan terkunci setelah dikonfirmasi.${getsSoNumber ? ' Dokumen ini akan mendapat nomor sales order.' : ''}`}</div>
          {hold.invoices?.length > 0 && (
            <Alert
              style={{ marginTop: 12 }}
              type="warning"
              showIcon
              message={`Pelanggan memiliki tagihan lewat masa tenggang: ${hold.invoices.map((x: any) => x.name).join(', ')}.`}
              description="Sales order tetap dapat dikonfirmasi, tetapi surat jalan ditahan sampai tagihan dilunasi atau Pimpinan memberi izin kirim."
            />
          )}
          <div style={{ marginTop: 12 }}>
            <label htmlFor="po-konfirmasi">PO Pelanggan</label>
            <Input
              id="po-konfirmasi"
              maxLength={80}
              style={{ marginTop: 4 }}
              defaultValue={po}
              onChange={(e) => {
                po = e.target.value;
              }}
            />
          </div>
        </>
      ),
      okText: 'Konfirmasi',
      cancelText: 'Batal',
      onOk: () => act('confirm', 'Sales order dikonfirmasi', { clientOrderRef: po.trim() }),
    });
  };
  const moreItems = [
    can('penjualan', 'create') &&
      !isNew && {
        key: 'copy',
        label: 'Salin penawaran',
        onClick: async () => {
          const r = await run(api.post(`/sales-orders/${id}/copy`), 'Salinan dibuat');
          if (r) nav(`/penjualan/${r.id}`);
        },
      },
    !isNew &&
      ['sale', 'done'].includes(o.state) && {
        key: 'pso',
        label: 'Cetak sales order',
        onClick: () => openFile(`/sales-orders/${id}/pdf?kind=order`),
      },
    can('penjualan', 'delete') &&
      !isNew &&
      o.state !== 'cancel' &&
      o.state !== 'done' && {
        key: 'cancel',
        danger: true,
        label: 'Batalkan',
        onClick: () =>
          Modal.confirm({
            title: 'Batalkan dokumen ini?',
            content:
              Number(pay.advanceAvailable) > 0
                ? `Uang muka ${rp(pay.advanceAvailable)} yang belum terpakai tidak dikembalikan: uang muka hangus dan dicatat sebagai pendapatan lain-lain. Dokumen tetap tersimpan sebagai riwayat dengan status Batal.`
                : 'Dokumen tetap tersimpan sebagai riwayat dengan status Batal.',
            okText: 'Batalkan',
            cancelText: 'Tidak',
            onOk: () => act('cancel', 'Dokumen dibatalkan'),
          }),
      },
  ].filter(Boolean) as any[];

  return (
    <>
      <PageHead
        crumb={{
          label: ['sale', 'done'].includes(o.state) ? 'Sales Order' : 'Penawaran',
          to: ['sale', 'done'].includes(o.state) ? '/penjualan?tab=order' : '/penjualan?tab=quote',
        }}
        title={isNew ? 'Baru' : o.name}
        sub={
          fromQuote || o.expired ? (
            <>
              {fromQuote && <>Dari penawaran {o.quotationNumber}</>}
              {fromQuote && o.expired && ' · '}
              {o.expired && <span className="loss">Penawaran kedaluwarsa sejak {tgl(o.validityDate)}</span>}
            </>
          ) : undefined
        }
      />
      <div className="toolbar">
        {canEdit && (dirty || isNew) && (
          <Button type="primary" onClick={save}>
            Simpan
          </Button>
        )}
        {!isNew && editable && can('penjualan', 'write') && (
          <Button
            type={dirty ? 'default' : 'primary'}
            icon={<MailOutlined />}
            disabled={!sendable}
            title={sendable ? undefined : 'Tambahkan produk dengan harga dulu'}
            onClick={() => act('send', 'Penawaran dikirim lewat email')}
          >
            Kirim Email
          </Button>
        )}
        {!isNew && (
          <Button
            icon={<PrinterOutlined />}
            onClick={() =>
              openFile(`/sales-orders/${id}/pdf?kind=${['sale', 'done'].includes(o.state) ? 'order' : 'quotation'}`)
            }
          >
            Cetak
          </Button>
        )}
        {!isNew && editable && can('penjualan', 'write') && (
          <Button
            disabled={!hasLines}
            title={hasLines ? undefined : 'Tambahkan produk dengan harga dulu'}
            onClick={confirmSO}
          >
            Konfirmasi
          </Button>
        )}
        {o.state === 'sale' && can('pengadaan', 'create') && (o.shortage || []).some((x: any) => x.shortage > 0) && (
          <Button
            disabled={isCreatingPO(+id!)}
            onClick={() =>
              createPO({ id: +id!, isNewCustomer: !!o.partner?.mtppIsNewCustomer, paidAmount: Number(pay.amount || 0) })
            }
          >
            Buat PO Principal
          </Button>
        )}
        {o.state === 'sale' && can('gudang', 'create') && o.deliverable && (
          <Button
            disabled={!o.canDeliver || delivery.isCreating(+id!)}
            title={
              !o.canDeliver
                ? hold.blocking
                  ? 'Pelanggan memiliki tagihan lewat masa tenggang'
                  : 'Pelanggan baru harus melunasi sales order'
                : ''
            }
            onClick={() => delivery.create(+id!)}
          >
            Buat Surat Jalan
          </Button>
        )}
        {['sale', 'done'].includes(o.state) &&
          can('penagihan', 'create') &&
          o.invoiceStatus === 'to_invoice' &&
          !(o.invoices || []).some((i: any) => i.moveType === 'out_invoice' && i.state === 'draft') && (
            <Button
              onClick={async () => {
                const r = await run(api.post(`/invoices/from-sale/${id}`, {}), 'Invoice draf dibuat');
                if (r) nav(`/penagihan/${r.id}`);
              }}
            >
              Buat Invoice
            </Button>
          )}
        {o.state === 'sale' && can('penagihan', 'create') && o.partner?.mtppIsNewCustomer && (
          <Button onClick={() => setPfOpen(true)}>Proforma Invoice</Button>
        )}
        {o.state === 'sale' && can('penagihan', 'create') && o.partner?.mtppIsNewCustomer && !pay.paidFull && (
          <Button onClick={() => setPayOpen(true)}>Catat Pembayaran (DP / Lunas)</Button>
        )}
        {o.state === 'cancel' && can('penjualan', 'write') && (
          <Button onClick={() => act('draft', 'Dikembalikan ke draf')}>Kembalikan ke Draf</Button>
        )}
        {moreItems.length > 0 && (
          <Dropdown menu={{ items: moreItems }}>
            <Button icon={<MoreOutlined />} />
          </Dropdown>
        )}
        <EmailTag s={o.emailStatus} />
        {o.state === 'cancel' && <Pill v="cancel" kind="so" />}
        <span className="spacer" />
        <StatusBar steps={STEPS} value={step} />
      </div>

      {o.partner?.mtppIsNewCustomer && ['sale'].includes(o.state) && (
        <Alert
          style={{ marginBottom: 16 }}
          type={pay.paidFull ? 'success' : 'warning'}
          showIcon
          message={
            pay.paidFull
              ? 'Pelanggan baru: sales order sudah lunas, surat jalan dapat diterbitkan.'
              : `Pelanggan baru: dibayar ${rp(pay.amount)} dari ${rp(o.amountTotal)}. Surat jalan diterbitkan setelah lunas.${
                  o.mtppSettleDate
                    ? ` Sisa ${rp(Number(o.amountTotal) - Number(pay.amount || 0))} dilunasi paling lambat ${tgl(o.mtppSettleDate)}${o.mtppSettleDate < today() ? ' (terlambat)' : ''}.`
                    : ''
                }`
          }
          description={
            o.mtppProformaNumber
              ? `Proforma ${o.mtppProformaNumber} · ${tgl(o.mtppProformaDate)} · diminta ${rp(o.mtppDpAmount)} (${nf(o.mtppDpPercent, 0)}%)${o.mtppProformaDueDate ? ` · bayar paling lambat ${tgl(o.mtppProformaDueDate)}` : ''}`
              : undefined
          }
          action={
            o.mtppProformaNumber && (
              <Button size="small" onClick={() => openFile(`/sales-orders/${id}/pdf?kind=proforma`)}>
                Cetak proforma
              </Button>
            )
          }
        />
      )}

      {!isNew && hold.invoices?.length > 0 && o.state !== 'cancel' && (
        <Alert
          style={{ marginBottom: 16 }}
          type={hold.blocking ? 'error' : 'warning'}
          showIcon
          message={
            <>
              Tagihan lewat masa tenggang:{' '}
              {hold.invoices.map((x: any, i: number) => (
                <span key={x.id}>
                  {i > 0 && ', '}
                  <Link to={`/penagihan/${x.id}`}>{x.name}</Link>
                </span>
              ))}
            </>
          }
          description={
            hold.released
              ? `Pengiriman diizinkan ${hold.releasedBy ? 'oleh ' + hold.releasedBy : ''} (${hold.releaseNote}).`
              : ['sale'].includes(o.state)
                ? 'Surat jalan ditahan sampai tagihan dilunasi atau Pimpinan memberi izin kirim.'
                : 'Setelah dikonfirmasi, surat jalan ditahan sampai tagihan dilunasi atau Pimpinan memberi izin kirim.'
          }
          action={
            me?.group === 'PIMPINAN' &&
            ['sale', 'done'].includes(o.state) &&
            (hold.released ? (
              <Button size="small" onClick={() => act('release/revoke', 'Izin kirim dicabut')}>
                Cabut Izin
              </Button>
            ) : (
              <Button size="small" type="primary" onClick={release}>
                Izinkan Kirim
              </Button>
            ))
          }
        />
      )}

      {!isNew && steps.length > 0 && (
        <div
          role="note"
          aria-label="Langkah berikutnya"
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            background: '#fff',
            border: '1px solid var(--sun-line)',
            borderLeft: '3px solid var(--sun-line)',
            color: 'var(--text)',
          }}
        >
          {steps.map((t) => (
            <div key={t}>{t}</div>
          ))}
        </div>
      )}

      <div className="card">
        <Row gutter={28}>
          <Col xs={24} md={12}>
            <Form.Item label="Pelanggan" layout="vertical">
              <Select
                disabled={!canEdit}
                showSearch
                optionFilterProp="label"
                value={o.partnerId}
                placeholder="Pilih pelanggan"
                onChange={(v) => {
                  const c = (customers.data || []).find((x) => x.id === v);
                  upd({ partnerId: v, partnerShippingId: null, paymentTermId: c?.paymentTermId, partner: c });
                  if (lines.length) refreshPrices(lines, v);
                }}
                options={(customers.data || []).map((c) => ({
                  value: c.id,
                  label: c.name + (c.mtppIsNewCustomer ? ' (pelanggan baru)' : ''),
                }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item label="Tanggal penawaran" layout="vertical">
              <DatePicker
                disabled={!canEdit}
                style={{ width: '100%' }}
                format="D MMMM YYYY"
                allowClear={false}
                value={dayjs(o.dateOrder)}
                onChange={(d) => {
                  const date = d.format('YYYY-MM-DD');
                  // berlaku sampai harus setelah tanggal penawaran; geser bila tidak lagi sah
                  upd(
                    o.validityDate && o.validityDate <= date
                      ? {
                          dateOrder: date,
                          validityDate: d.add(settings?.terms?.validityDays || 30, 'day').format('YYYY-MM-DD'),
                        }
                      : { dateOrder: date },
                  );
                }}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item label="Berlaku sampai" layout="vertical">
              <DatePicker
                disabled={!canEdit}
                style={{ width: '100%' }}
                format="D MMMM YYYY"
                value={o.validityDate ? dayjs(o.validityDate) : null}
                placeholder="otomatis"
                disabledDate={(d) => !!o.dateOrder && !d.isAfter(dayjs(o.dateOrder), 'day')}
                onChange={(d) => upd({ validityDate: d?.format('YYYY-MM-DD') })}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item
              label="Term of payment"
              layout="vertical"
              tooltip="Ditetapkan Pimpinan pada data pelanggan"
              extra="Mengikuti data pelanggan"
            >
              <Select
                disabled
                value={o.paymentTermId ?? (customers.data || []).find((c) => c.id === o.partnerId)?.paymentTermId}
                options={(terms.data || []).map((t) => ({ value: t.id, label: t.name }))}
                placeholder="-"
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item label="PO Pelanggan" layout="vertical">
              <Input
                disabled={!can('penjualan', 'write') || o.state === 'cancel'}
                value={o.clientOrderRef}
                onChange={(e) => upd({ clientOrderRef: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item label="Alamat kirim" layout="vertical">
              <Select
                allowClear
                disabled={!can('penjualan', 'write') || ['done', 'cancel'].includes(o.state)}
                value={o.partnerShippingId}
                placeholder="Alamat utama pelanggan"
                onChange={(v) => upd({ partnerShippingId: v })}
                options={addresses.map((a) => ({ value: a.id, label: `${a.name} – ${a.street || ''}` }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item label="Rencana kirim" layout="vertical">
              <DatePicker
                disabled={!can('penjualan', 'write') || ['done', 'cancel'].includes(o.state)}
                style={{ width: '100%' }}
                format="D MMMM YYYY"
                value={o.commitmentDate ? dayjs(o.commitmentDate) : null}
                onChange={(d) => upd({ commitmentDate: d?.format('YYYY-MM-DD') || null })}
              />
            </Form.Item>
          </Col>
          {!isNew && editable && (
            <Col xs={24} md={6}>
              <Form.Item
                label="Nomor dokumen"
                layout="vertical"
                tooltip={
                  fromQuote
                    ? 'Nomor sales order tidak dapat diubah'
                    : `Dapat diubah sebelum dikonfirmasi; nomor ganda ditolak.${o.quotationNumber ? ' Sales order mendapat nomor baru saat dikonfirmasi.' : ''}`
                }
              >
                <Input
                  disabled={!canEdit || !!fromQuote}
                  value={o.nameEdit ?? o.name}
                  onChange={(e) => upd({ nameEdit: e.target.value })}
                />
              </Form.Item>
            </Col>
          )}
        </Row>

        <Tabs
          items={[
            {
              key: 'lines',
              label: 'Baris Produk',
              children: (
                <>
                  <Table<any>
                    size="middle"
                    rowKey={(_: any, i?: number) => String(i)}
                    pagination={false}
                    dataSource={lines}
                    scroll={{ x: 900 }}
                    columns={[
                      {
                        title: 'Produk',
                        dataIndex: 'name',
                        width: 300,
                        render: (v, l, i) =>
                          canEdit ? (
                            <Select
                              showSearch
                              optionFilterProp="label"
                              style={{ width: '100%' }}
                              value={l.productId}
                              placeholder="Pilih produk"
                              onChange={(pid) => pickProduct(i, pid)}
                              options={(products.data || []).map((p) => ({
                                value: p.id,
                                label: `[${p.code}] ${p.name}`,
                              }))}
                            />
                          ) : (
                            <>
                              {v} {l.mtppIsDropship && <Tag color="purple">dropship</Tag>}
                            </>
                          ),
                      },
                      {
                        title: 'Qty',
                        dataIndex: 'productUomQty',
                        width: 110,
                        align: 'right',
                        render: (v, l, i) =>
                          canEdit ? (
                            <InputNumber min={0} value={v} onChange={(x) => setQty(i, x)} style={{ width: 90 }} />
                          ) : (
                            `${qf(v)} ${l.uom || ''}`
                          ),
                      },
                      {
                        title: 'Harga (Rp)',
                        dataIndex: 'priceUnit',
                        width: 150,
                        align: 'right',
                        render: (v, l, i) =>
                          canEdit ? (
                            <>
                              <InputNumber
                                min={0}
                                value={v}
                                style={{ width: 140 }}
                                formatter={(x) => Number(x || 0).toLocaleString('id-ID')}
                                parser={(x) => Number(String(x).replace(/\./g, '')) as any}
                                onChange={(x) => setLine(i, { priceUnit: x, priceManual: true })}
                              />
                              {l.listHint && (
                                <div className="muted" style={{ fontSize: 12 }}>
                                  harga daftar: {idr(l.listHint.priceUnit)}
                                  {Number(l.listHint.discount)
                                    ? ` (diskon ${nf(l.listHint.discount, Number(l.listHint.discount) % 1 ? 1 : 0)}%)`
                                    : ''}
                                </div>
                              )}
                            </>
                          ) : (
                            idr(v)
                          ),
                      },
                      {
                        title: 'Diskon',
                        dataIndex: 'discount',
                        width: 90,
                        align: 'right',
                        render: (v, _, i) =>
                          canEdit ? (
                            <InputNumber
                              min={0}
                              max={100}
                              value={v}
                              style={{ width: 70 }}
                              onChange={(x) => setLine(i, { discount: x, priceManual: true })}
                            />
                          ) : (
                            `${nf(v, Number(v) % 1 ? 1 : 0)}%`
                          ),
                      },
                      ...(cost
                        ? [
                            {
                              title: 'Harga pokok (Rp)',
                              dataIndex: 'purchasePrice',
                              align: 'right' as const,
                              render: (v: any, l: any) =>
                                l.productId && !Number(v) ? (
                                  <span className="loss">harga pokok belum ada</span>
                                ) : (
                                  <span className="cost">{idr(v)}</span>
                                ),
                            },
                            {
                              title: 'Margin',
                              key: 'm',
                              align: 'right' as const,
                              render: (_: any, l: any) => {
                                if (l.productId && !Number(l.purchasePrice)) return '-';
                                const c = calc(l);
                                return <span className={c.m >= 0 ? 'gain' : 'loss'}>{pct(c.mp)}</span>;
                              },
                            },
                          ]
                        : []),
                      ...(!editable
                        ? [
                            {
                              title: 'Terkirim',
                              dataIndex: 'qtyDelivered',
                              align: 'right' as const,
                              render: qf,
                            },
                            { title: 'Tertagih', dataIndex: 'qtyInvoiced', align: 'right' as const, render: qf },
                          ]
                        : []),
                      { title: 'Subtotal (Rp)', key: 'sub', align: 'right', render: (_, l) => idr(calc(l).sub) },
                      ...(canEdit
                        ? [
                            {
                              title: '',
                              key: 'x',
                              width: 40,
                              render: (_: any, __: any, i: number) => (
                                <a onClick={() => upd({ lines: lines.filter((_, j) => j !== i) })}>
                                  <DeleteOutlined />
                                </a>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                  {canEdit && (
                    <Button
                      type="dashed"
                      icon={<PlusOutlined />}
                      style={{ marginTop: 10 }}
                      disabled={!o.partnerId}
                      onClick={() => upd({ lines: [...lines, { productUomQty: 1, discount: 0 }] })}
                    >
                      {o.partnerId ? 'Tambah baris' : 'Pilih pelanggan dulu'}
                    </Button>
                  )}
                  <div className="totals">
                    {cost && (
                      <span className="muted">
                        Margin rata-rata{' '}
                        <b className={margin >= 0 ? 'gain' : 'loss'}>{pct(untaxed ? (margin / untaxed) * 100 : 0)}</b> (
                        {rp(margin)})
                      </span>
                    )}
                    <span className="muted">DPP {rp(untaxed)}</span>
                    <span className="muted">PPN {rp(editable ? tax : o.amountTax)}</span>
                    <span>
                      Total <span className="big">{rp(editable ? untaxed + tax : o.amountTotal)}</span>
                    </span>
                  </div>
                </>
              ),
            },
            {
              key: 'terms',
              label: 'Syarat Penawaran',
              children: (
                <Row gutter={24}>
                  {[
                    ['mtppTermPayment', 'Pembayaran'],
                    ['mtppTermHandover', 'Penyerahan'],
                    ['mtppTermStandard', 'Standar'],
                    ['mtppTermDelivery', 'Waktu kirim'],
                    ['mtppTermValidity', 'Masa berlaku'],
                    ['mtppTermWarranty', 'Garansi'],
                  ].map(([k, l]) => (
                    <Col xs={24} md={12} key={k}>
                      <Form.Item label={l} layout="vertical">
                        <Input.TextArea
                          disabled={!canEdit}
                          autoSize={{ minRows: 2 }}
                          value={o[k]}
                          onChange={(e) => upd({ [k]: e.target.value })}
                        />
                      </Form.Item>
                    </Col>
                  ))}
                </Row>
              ),
            },
            ...(!isNew ? [{ key: 'flow', label: 'Pengiriman dan Tagihan', children: <Related o={o} /> }] : []),
          ]}
        />
      </div>
      {!isNew && <Chatter model="sales_orders" id={+id!} name={o.name} reloadKey={rk} />}
      {pfOpen && (
        <ProformaModal
          o={o}
          onClose={(ok) => {
            setPfOpen(false);
            if (ok) reload();
          }}
        />
      )}
      {payOpen && (
        <AdvanceModal
          o={o}
          onClose={(ok) => {
            setPayOpen(false);
            if (ok) reload();
          }}
        />
      )}
    </>
  );
}

function Related({ o }: { o: any }) {
  const sh = (o.shortage || []).filter((x: any) => x.remaining > 0);
  return (
    <Row gutter={24}>
      <Col xs={24} lg={12}>
        <h4>Kebutuhan stok</h4>
        <Table<any>
          size="small"
          pagination={false}
          rowKey="lineId"
          dataSource={sh}
          locale={{ emptyText: o.state === 'sale' ? 'Semua barang sudah terkirim' : 'Tersedia setelah dikonfirmasi' }}
          columns={[
            { title: 'Produk', dataIndex: 'name' },
            { title: 'Sisa kirim', dataIndex: 'remaining', align: 'right', render: qf },
            {
              title: 'Stok bebas',
              dataIndex: 'available',
              align: 'right',
              render: (v, r) => (r.dropship ? 'dropship' : qf(v)),
            },
            { title: 'Dipesan', dataIndex: 'onOrder', align: 'right', render: qf },
            {
              title: 'Kurang',
              dataIndex: 'shortage',
              align: 'right',
              render: (v) => <span className={v > 0 ? 'loss' : ''}>{qf(v)}</span>,
            },
          ]}
        />
      </Col>
      <Col xs={24} lg={12}>
        <h4>Dokumen terkait</h4>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="PO Principal">
            {(o.purchaseOrders || []).map((p: any) => (
              <div key={p.id}>
                <Link to={`/pengadaan/${p.id}`}>{p.name}</Link> <Pill v={p.state} kind="po" />
              </div>
            ))}
            {!o.purchaseOrders?.length && '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Surat jalan">
            {(o.transfers || []).map((t: any) => (
              <div key={t.id}>
                <Link to={`/stok/dok/${t.id}`}>{t.name}</Link> <Pill v={t.state} kind="tr" />{' '}
                <span className="muted">{tgl(t.scheduledDate)}</span>
              </div>
            ))}
            {!o.transfers?.length && '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Invoice">
            {(o.invoices || []).map((t: any) => (
              <div key={t.id}>
                <Link to={`/penagihan/${t.id}`}>{t.name}</Link> <Pill v={t.state} kind="je" />{' '}
                {t.state === 'posted' && <Pill v={t.paymentState} kind="pay" />}{' '}
                <span className="muted">{rp(t.amountTotal)}</span>
              </div>
            ))}
            {!o.invoices?.length && '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Pembayaran diterima">
            {rp(o.payment?.amount)} dari {rp(o.amountTotal)}{' '}
            <Link to={`/penjualan/pembayaran?q=${encodeURIComponent(o.name)}`}>riwayat</Link>
            {Number(o.payment?.forfeited) > 0 && <div className="loss">Uang muka hangus {rp(o.payment.forfeited)}</div>}
          </Descriptions.Item>
        </Descriptions>
      </Col>
    </Row>
  );
}

// Algoritma 3.2: persen dan nominal saling dihitung, nomor PI tetap jika diterbitkan ulang
function ProformaModal({ o, onClose }: { o: any; onClose: (ok?: boolean) => void }) {
  const { settings } = useAuth();
  const total = Number(o.amountTotal);
  // masa tenggang proforma: bawaan 7 hari dari Pengaturan, paling sedikit 7 hari, boleh diatur lebih lama
  // proforma yang diterbitkan ulang memakai masa tenggang sebelumnya; proforma baru memakai bawaan Pengaturan
  const prevGrace =
    o.mtppProformaDueDate && o.mtppProformaDate
      ? dayjs(o.mtppProformaDueDate).diff(dayjs(o.mtppProformaDate), 'day')
      : null;
  const [graceDays, setGraceDays] = useState<number>(
    prevGrace && prevGrace >= 7 && prevGrace <= 90 ? prevGrace : Number(settings?.collection?.proformaGraceDays ?? 7),
  );
  const [mode, setMode] = useState<'persen' | 'nominal' | 'lunas'>(o.mtppDpMode || 'persen');
  const [settleDate, setSettleDate] = useState<string>(o.mtppSettleDate || dayjs().add(14, 'day').format('YYYY-MM-DD'));
  const issued = !!o.mtppProformaNumber;
  const [percent, setPercent] = useState<number>(issued ? Number(o.mtppDpPercent ?? 30) : 30);
  const [amount, setAmount] = useState<number>(issued ? Number(o.mtppDpAmount ?? 0) : Math.round(total * 0.3));
  const [note, setNote] = useState(o.mtppProformaNote || '');
  const [date, setDate] = useState(o.mtppProformaDate || today());
  const issue = async (send: boolean) => {
    const r = await run(
      api.post(`/sales-orders/${o.id}/proforma`, {
        mode,
        percent,
        amount,
        note,
        date,
        graceDays,
        settleDate: mode === 'lunas' ? undefined : settleDate,
      }),
      'Proforma diterbitkan (tanpa jurnal)',
    );
    if (!r) return;
    if (send) await run(api.post(`/sales-orders/${o.id}/proforma/send`, {}), 'Proforma dikirim lewat email');
    else openFile(`/sales-orders/${o.id}/pdf?kind=proforma`);
    onClose(true);
  };
  return (
    <Modal
      open
      title="Proforma Invoice"
      onCancel={() => onClose()}
      width={560}
      footer={[
        <Button key="c" onClick={() => onClose()}>
          Batal
        </Button>,
        <Button key="p" onClick={() => issue(false)}>
          Terbitkan dan cetak
        </Button>,
        <Button key="s" type="primary" onClick={() => issue(true)}>
          Terbitkan dan kirim email
        </Button>,
      ]}
    >
      <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Nomor proforma">{o.mtppProformaNumber || 'PI baru (otomatis)'}</Descriptions.Item>
        <Descriptions.Item label="Sales order">{o.name}</Descriptions.Item>
        <Descriptions.Item label="Total pesanan">
          <b>{rp(total)}</b>
        </Descriptions.Item>
      </Descriptions>
      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        optionType="button"
        buttonStyle="solid"
        options={[
          { value: 'persen', label: 'Uang muka (persen)' },
          { value: 'nominal', label: 'Uang muka (nominal)' },
          { value: 'lunas', label: 'Langsung lunas' },
        ]}
        style={{ marginBottom: 16 }}
      />
      {mode === 'lunas' && (
        <p className="muted">
          Pelanggan diminta melunasi seluruh nilai sales order <b>{rp(total)}</b> sekaligus.
        </p>
      )}
      <Row gutter={12}>
        <Col span={10}>
          <div className="muted">Persen</div>
          <InputNumber
            disabled={mode !== 'persen'}
            min={0}
            max={100}
            addonAfter="%"
            style={{ width: '100%' }}
            value={percent}
            onChange={(v) => {
              setPercent(Number(v));
              setAmount(Math.round((total * Number(v)) / 100));
            }}
          />
        </Col>
        <Col span={14}>
          <div className="muted">Nominal (Rp)</div>
          <InputNumber
            disabled={mode !== 'nominal'}
            min={0}
            max={total}
            style={{ width: '100%' }}
            value={amount}
            formatter={(x) => Number(x || 0).toLocaleString('id-ID')}
            parser={(x) => Number(String(x).replace(/\./g, '')) as any}
            onChange={(v) => {
              setAmount(Number(v));
              setPercent(total ? Math.round((Number(v) / total) * 10000) / 100 : 0);
            }}
          />
        </Col>
      </Row>
      <div style={{ marginTop: 12 }} className="muted">
        Tanggal
      </div>
      <DatePicker
        value={dayjs(date)}
        format="D MMMM YYYY"
        allowClear={false}
        onChange={(d) => setDate(d.format('YYYY-MM-DD'))}
      />
      <div style={{ marginTop: 12 }} className="muted">
        Masa tenggang pembayaran (paling sedikit 7 hari)
      </div>
      <Space>
        <InputNumber
          min={7}
          max={90}
          precision={0}
          addonAfter="hari"
          value={graceDays}
          onChange={(v) => setGraceDays(Math.min(90, Math.max(7, Number(v) || 7)))}
        />
        <span className="muted">bayar paling lambat {tgl(dayjs(date).add(graceDays, 'day').format('YYYY-MM-DD'))}</span>
      </Space>
      {mode !== 'lunas' && (
        <>
          <div style={{ marginTop: 12 }} className="muted">
            Sisa dilunasi paling lambat
          </div>
          <DatePicker
            value={dayjs(settleDate)}
            format="D MMMM YYYY"
            allowClear={false}
            disabledDate={(d) => !d.isAfter(dayjs(date), 'day')}
            onChange={(d) => setSettleDate(d.format('YYYY-MM-DD'))}
          />
        </>
      )}
      <div style={{ marginTop: 12 }} className="muted">
        Catatan pembayaran
      </div>
      <Input.TextArea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        autoSize={{ minRows: 2 }}
        placeholder="mis. Uang muka 30%, sisa dilunasi sebelum barang dikirim"
      />
    </Modal>
  );
}

// Pembayaran pelanggan atas SO: pilih uang muka (dengan tanggal pelunasan sisa) atau langsung lunas; bukti wajib
export function AdvanceModal({ o, onClose }: { o: any; onClose: (ok?: boolean) => void }) {
  const left = Math.max(0, Math.round((Number(o.amountTotal) - Number(o.payment?.amount || 0)) * 100) / 100);
  const firstDp =
    Number(o.mtppDpAmount) && Number(o.mtppDpAmount) < left ? Number(o.mtppDpAmount) : Math.round(left * 0.3);
  const [kind, setKind] = useState<'dp' | 'lunas'>(o.mtppDpMode === 'lunas' ? 'lunas' : 'dp');
  const [v, setV] = useState<any>({
    amount: o.mtppDpMode === 'lunas' ? left : firstDp,
    method: 'BNK',
    date: today(),
    memo: '',
    settleDate: o.mtppSettleDate || dayjs().add(14, 'day').format('YYYY-MM-DD'),
  });
  const [file, setFile] = useState<File | null>(null);
  const amount = kind === 'lunas' ? left : Number(v.amount || 0);
  const invalid = !file || (kind === 'dp' && (!(amount > 0) || amount >= left || !v.settleDate));
  return (
    <Modal
      open
      title={`Pembayaran ${o.name}`}
      okText="Catat pembayaran"
      cancelText="Batal"
      okButtonProps={{ disabled: invalid }}
      onCancel={() => onClose()}
      onOk={async () => {
        const body = {
          saleId: o.id,
          kind,
          amount,
          method: v.method,
          date: v.date,
          memo: v.memo,
          settleDate: kind === 'dp' ? v.settleDate : undefined,
        };
        if (
          await run(
            api.post('/payments', paymentForm(body, file)),
            kind === 'lunas' ? 'Pelunasan dicatat' : 'Uang muka dicatat',
          )
        )
          onClose(true);
      }}
    >
      <p className="muted">
        Sisa nilai sales order: <b>{rp(left)}</b>. Pembayaran dicatat ke akun Uang Muka Pelanggan dan otomatis dipakai
        saat invoice diposting.
      </p>
      <Radio.Group
        style={{ marginBottom: 12 }}
        optionType="button"
        buttonStyle="solid"
        value={kind}
        onChange={(e) => {
          setKind(e.target.value);
          setV({ ...v, amount: e.target.value === 'lunas' ? left : firstDp });
        }}
        options={[
          { value: 'dp', label: 'Uang muka (DP)' },
          { value: 'lunas', label: 'Lunasi langsung' },
        ]}
      />
      <PaymentFields v={{ ...v, amount }} setV={setV} max={left} lockAmount={kind === 'lunas'} />
      {kind === 'dp' && (
        <div style={{ marginTop: 8 }}>
          <div className="muted">Sisa {rp(Math.max(left - amount, 0))} dilunasi paling lambat</div>
          <DatePicker
            value={v.settleDate ? dayjs(v.settleDate) : null}
            format="D MMMM YYYY"
            allowClear={false}
            disabledDate={(d) => d.isBefore(dayjs(v.date), 'day')}
            style={{ width: 200 }}
            onChange={(d) => setV({ ...v, settleDate: d.format('YYYY-MM-DD') })}
          />
        </div>
      )}
      <ProofInput file={file} setFile={setFile} />
    </Modal>
  );
}

// Bukti transfer wajib untuk pembayaran pelanggan (gambar atau PDF)
export function ProofInput({ file, setFile }: { file: File | null; setFile: (f: File | null) => void }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="muted">Bukti transfer / bukti pembayaran (wajib, gambar atau PDF)</div>
      <Upload
        accept="image/*,application/pdf"
        maxCount={1}
        fileList={file ? [{ uid: '1', name: file.name, status: 'done' } as any] : []}
        beforeUpload={(f) => {
          setFile(f);
          return false;
        }}
        onRemove={() => setFile(null)}
      >
        <Button icon={<UploadOutlined />}>{file ? 'Ganti berkas bukti' : 'Pilih berkas bukti'}</Button>
      </Upload>
      {!file && (
        <div className="loss" style={{ fontSize: 12, marginTop: 4 }}>
          Lampirkan bukti sebelum mencatat pembayaran.
        </div>
      )}
    </div>
  );
}

export function PaymentFields({
  v,
  setV,
  max,
  lockAmount,
}: {
  v: any;
  setV: (x: any) => void;
  max?: number;
  lockAmount?: boolean;
}) {
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <div>
        <div className="muted">Jumlah (Rp)</div>
        <InputNumber
          min={0}
          max={max}
          disabled={lockAmount}
          style={{ width: '100%' }}
          value={v.amount}
          formatter={(x) => Number(x || 0).toLocaleString('id-ID')}
          parser={(x) => Number(String(x).replace(/\./g, '')) as any}
          onChange={(x) => setV({ ...v, amount: x })}
        />
      </div>
      <div>
        <div className="muted">Metode</div>
        <Radio.Group
          value={v.method}
          onChange={(e) => setV({ ...v, method: e.target.value })}
          options={[
            { value: 'BNK', label: 'Transfer bank' },
            { value: 'KAS', label: 'Kas' },
          ]}
        />
      </div>
      <div>
        <div className="muted">Tanggal</div>
        <DatePicker
          value={dayjs(v.date)}
          format="D MMMM YYYY"
          allowClear={false}
          style={{ width: 200 }}
          onChange={(d) => setV({ ...v, date: d.format('YYYY-MM-DD') })}
        />
      </div>
      <div>
        <div className="muted">Keterangan</div>
        <Input
          value={v.memo}
          onChange={(e) => setV({ ...v, memo: e.target.value })}
          placeholder="mis. Transfer BCA 12/11"
        />
      </div>
    </Space>
  );
}

export function useCustomerOptions() {
  const c = useFetch<any[]>('/partners', { kind: 'customer' });
  return useMemo(() => (c.data || []).map((x) => ({ value: x.id, label: x.name })), [c.data]);
}
export { Popconfirm };
