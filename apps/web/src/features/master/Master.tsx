import { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth, useCan } from '../../app/auth';
import { useFetch, useQueryState } from '../../shared/hooks';
import { api, idr, nf, run, tgl } from '../../shared/lib';
import { PageHead } from '../../shared/ui';
import Crud from '../../shared/Crud';
import Chatter from '../../shared/Chatter';

const baseOf = (path: string, kind: string) =>
  path.startsWith('/penjualan')
    ? '/penjualan/pelanggan'
    : path.startsWith('/pengadaan')
      ? '/pengadaan/principal'
      : kind === 'supplier'
        ? '/master/principal'
        : '/master/pelanggan';

export function PartnerList({ kind }: { kind: 'customer' | 'supplier' }) {
  const [qs, set] = useQueryState({});
  const list = useFetch<any[]>('/partners', { kind, q: qs.q, active: qs.archived ? 'all' : 'true' });
  const nav = useNavigate();
  const loc = useLocation();
  const can = useCan();
  const menu = kind === 'supplier' ? 'principal' : 'pelanggan';
  const base = baseOf(loc.pathname, kind);
  return (
    <>
      <PageHead
        title={kind === 'supplier' ? 'Principal dan Gudang' : 'Pelanggan'}
        extra={
          can(menu, 'create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav(`${base}/baru`)}>
              Tambah
            </Button>
          )
        }
      />
      <div className="toolbar">
        <Input.Search
          allowClear
          placeholder="cari nama, email, atau kota"
          style={{ width: 340 }}
          defaultValue={qs.q}
          onSearch={(q) => set({ q })}
        />
        <Checkbox checked={!!qs.archived} onChange={(e) => set({ archived: e.target.checked ? '1' : undefined })}>
          Tampilkan yang diarsipkan
        </Checkbox>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={list.loading}
          dataSource={list.data || []}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          onRow={(r) => ({ onClick: () => nav(`${base}/${r.id}`), className: 'row-link' })}
          columns={[
            {
              title: 'Nama',
              dataIndex: 'name',
              render: (v, r) => (
                <>
                  <b>{v}</b> {r.mtppIsNewCustomer && <Tag color="gold">pelanggan baru</Tag>}{' '}
                  {!r.active && <Tag>arsip</Tag>}
                </>
              ),
            },
            { title: 'Kota', dataIndex: 'city', render: (v) => v || '-' },
            { title: 'Telepon', dataIndex: 'phone', render: (v) => v || '-' },
            { title: 'Email', dataIndex: 'email', render: (v) => v || '-' },
            ...(kind === 'customer'
              ? [
                  { title: 'Kategori', dataIndex: 'category', render: (v: any) => v || '-' },
                  { title: 'Term of payment', key: 't', render: (_: any, r: any) => r.paymentTerm?.name || '-' },
                  { title: 'Pricelist', key: 'p', render: (_: any, r: any) => r.pricelist?.name || '-' },
                ]
              : [
                  {
                    title: 'Gudang',
                    key: 'w',
                    render: (_: any, r: any) =>
                      r.warehouses?.map((w: any) => `${w.code} · ${w.name}`).join(', ') || '-',
                  },
                  { title: 'Syarat pembayaran', dataIndex: 'supplierNote', render: (v: any) => v || '-' },
                ]),
          ]}
        />
      </div>
    </>
  );
}

export function PartnerDetail({ kind }: { kind: 'customer' | 'supplier' }) {
  const { id } = useParams();
  const isNew = id === 'baru';
  const nav = useNavigate();
  const loc = useLocation();
  const can = useCan();
  const { me, settings } = useAuth();
  const menu = kind === 'supplier' ? 'principal' : 'pelanggan';
  const base = baseOf(loc.pathname, kind);
  const doc = useFetch<any>(isNew ? null : `/partners/${id}`);
  const terms = useFetch<any[]>('/payment-terms');
  const pls = useFetch<any[]>(kind === 'customer' && can('pricelist_jual') ? '/pricelists' : null);
  const prices = useFetch<any[]>(
    kind === 'supplier' && !isNew && can('pricelist_principal') ? '/supplier-prices/view' : null,
    { partnerId: id },
  );
  const [form] = Form.useForm();
  const [rk, setRk] = useState(0);
  const [addr, setAddr] = useState<any>(null);
  useEffect(() => {
    if (doc.data) form.setFieldsValue({ ...doc.data, warehouseName: doc.data.warehouses?.[0]?.name });
    else if (isNew && kind === 'customer') form.setFieldsValue({ mtppIsNewCustomer: true });
  }, [doc.data]);
  const writable = can(menu, isNew ? 'create' : 'write');
  const pim = me?.group === 'PIMPINAN';
  const admin = me?.group === 'ADMIN';
  const save = async () => {
    const v = await form.validateFields();
    if (isNew) {
      const r = await run(api.post('/partners', { ...v, kind }), 'Data disimpan');
      if (r) nav(`${base}/${r.id}`, { replace: true });
    } else if (await run(api.patch(`/partners/${id}`, v), 'Perubahan disimpan')) {
      doc.reload();
      setRk(rk + 1);
    }
  };
  const p = doc.data || {};
  const c = p.counts || {};
  return (
    <>
      <PageHead
        crumb={{ label: kind === 'supplier' ? 'Principal' : 'Pelanggan', to: base }}
        title={isNew ? 'Baru' : p.name}
      />
      <div className="toolbar">
        {(writable || pim) && (
          <Button type="primary" onClick={save}>
            Simpan
          </Button>
        )}
        <Button onClick={() => nav(base)}>Buang</Button>
        {!isNew && can(menu, 'write') && (
          <Button
            onClick={async () => {
              if (
                await run(api.patch(`/partners/${id}`, { active: !p.active }), p.active ? 'Diarsipkan' : 'Diaktifkan')
              )
                doc.reload();
            }}
          >
            {p.active ? 'Arsipkan' : 'Aktifkan kembali'}
          </Button>
        )}
        {!isNew && can(menu, 'delete') && (
          <Popconfirm
            title="Hapus data ini?"
            okText="Hapus"
            cancelText="Batal"
            onConfirm={async () => {
              if (await run(api.delete(`/partners/${id}`), 'Data dihapus')) nav(base);
            }}
          >
            <Button danger>Hapus</Button>
          </Popconfirm>
        )}
        <span className="spacer" />
        {!isNew && kind === 'customer' && (
          <Space size={10}>
            <Link to={`/penjualan?tab=quote&partnerId=${id}`}>
              <span className="pill blue">{c.quotations} penawaran</span>
            </Link>
            <Link to={`/penjualan?tab=order&partnerId=${id}`}>
              <span className="pill green">{c.orders} sales order</span>
            </Link>
            {can('penagihan') && (
              <Link to={`/penagihan?q=${encodeURIComponent(p.name || '')}`}>
                <span className="pill amber">{c.invoices} invoice</span>
              </Link>
            )}
          </Space>
        )}
        {!isNew && kind === 'supplier' && can('pengadaan') && (
          <Link to={`/pengadaan?tab=all&partnerId=${id}`}>
            <span className="pill blue">{c.purchases} pesanan</span>
          </Link>
        )}
      </div>
      <div className="card">
        <Form form={form} layout="vertical" disabled={!writable && !pim}>
          <Row gutter={24}>
            <Col xs={24} md={12}>
              <Form.Item name="name" label="Nama" rules={[{ required: true, message: 'Nama wajib diisi' }]}>
                <Input disabled={!writable} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="vat" label="NPWP">
                <Input disabled={!writable} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item
                name={kind === 'customer' ? 'category' : 'supplierNote'}
                label={kind === 'customer' ? 'Kategori' : 'Syarat pembayaran'}
              >
                <Input disabled={!writable} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="street" label="Alamat">
                <Input disabled={!writable} />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item name="city" label="Kota">
                <Input disabled={!writable} />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item name="phone" label="Telepon">
                <Input disabled={!writable} />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item name="email" label="Email">
                <Input disabled={!writable} />
              </Form.Item>
            </Col>
            {kind === 'supplier' && (
              <Col xs={24} md={12}>
                <Form.Item name="warehouseName" label="Nama gudang (satu gudang per principal)">
                  <Input disabled={!writable} placeholder="Gudang <nama principal>" />
                </Form.Item>
              </Col>
            )}
            {kind === 'customer' && (
              <>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="paymentTermId"
                    label="Term of payment"
                    tooltip="Ditetapkan Pimpinan berdasarkan credit check"
                  >
                    <Select
                      disabled={!pim}
                      allowClear
                      options={(terms.data || []).map((t) => ({ value: t.id, label: t.name }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="salesPricelistId" label="Pricelist penjualan" tooltip="Ditetapkan Pimpinan">
                    <Select
                      disabled={!pim}
                      allowClear
                      options={(pls.data || []).map((t) => ({ value: t.id, label: t.name }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="mtppIsNewCustomer"
                    label="Pelanggan baru (wajib lunas sebelum kirim)"
                    valuePropName="checked"
                    tooltip="Ditetapkan Admin atau Pimpinan; berakhir otomatis saat sales order pertama terkirim seluruhnya dan lunas"
                  >
                    <Switch disabled={!pim && !admin} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="mtppGraceDays"
                    label="Masa tenggang pembayaran (hari)"
                    tooltip="Ditetapkan Pimpinan. Setelah jatuh tempo + masa tenggang, surat jalan baru ditahan. Kosong = bawaan di Pengaturan."
                  >
                    <InputNumber
                      disabled={!pim}
                      min={0}
                      max={90}
                      style={{ width: '100%' }}
                      placeholder={`bawaan ${settings?.collection?.graceDays ?? 7} hari`}
                    />
                  </Form.Item>
                </Col>
              </>
            )}
          </Row>
        </Form>
        {!isNew && kind === 'supplier' && p.warehouses?.[0] && (
          <div className="note">
            Kode gudang <b>{p.warehouses[0].code}</b> dengan lokasi stok {p.warehouses[0].code}/Stok.
          </div>
        )}
      </div>

      {!isNew && kind === 'customer' && (
        <div className="card">
          <h3 className="card-title">Alamat kirim</h3>
          <Table<any>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={p.addresses || []}
            locale={{ emptyText: 'Belum ada alamat kirim; alamat utama dipakai.' }}
            columns={[
              { title: 'Nama lokasi', dataIndex: 'name' },
              { title: 'Alamat', dataIndex: 'street' },
              { title: 'Kota', dataIndex: 'city' },
              { title: 'Telepon', dataIndex: 'phone', render: (v) => v || '-' },
              {
                title: '',
                key: 'a',
                align: 'right',
                render: (_, a) =>
                  can('pelanggan', 'write') && (
                    <Space>
                      <a onClick={() => setAddr(a)}>Ubah</a>
                      <Popconfirm
                        title="Hapus alamat?"
                        onConfirm={async () => {
                          await run(api.delete(`/partners/addresses/${a.id}`), 'Alamat dihapus');
                          doc.reload();
                        }}
                      >
                        <a style={{ color: '#90241D' }}>Hapus</a>
                      </Popconfirm>
                    </Space>
                  ),
              },
            ]}
          />
          {can('pelanggan', 'write') && (
            <Button type="dashed" icon={<PlusOutlined />} style={{ marginTop: 10 }} onClick={() => setAddr({})}>
              Tambah alamat kirim
            </Button>
          )}
        </div>
      )}
      {!isNew && kind === 'supplier' && prices.data && (
        <div className="card">
          <h3 className="card-title">
            Pricelist principal{' '}
            <small>
              <Link to="/pengadaan/pricelist">kelola</Link>
            </small>
          </h3>
          <Table<any>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={prices.data}
            columns={[
              { title: 'Produk', dataIndex: 'product' },
              { title: 'Harga', dataIndex: 'price', align: 'right', render: (v: any) => idr(v) },
              { title: 'Diskon', dataIndex: 'discount', align: 'right', render: (v) => `${nf(v, 1)}%` },
              { title: 'Min. qty', dataIndex: 'minQty', align: 'right', render: (v: any) => nf(v) },
              {
                title: 'Berlaku',
                key: 'b',
                render: (_, r) => `${tgl(r.dateStart)} – ${r.dateEnd ? tgl(r.dateEnd) : 'seterusnya'}`,
              },
            ]}
          />
        </div>
      )}
      {!isNew && <Chatter model="partners" id={+id!} name={p.name} reloadKey={rk} />}
      {addr && (
        <AddressModal
          a={addr}
          partnerId={+id!}
          onClose={(ok) => {
            setAddr(null);
            if (ok) doc.reload();
          }}
        />
      )}
    </>
  );
}

function AddressModal({ a, partnerId, onClose }: { a: any; partnerId: number; onClose: (ok?: boolean) => void }) {
  const [form] = Form.useForm();
  return (
    <Modal
      open
      title={a.id ? 'Ubah alamat kirim' : 'Alamat kirim baru'}
      okText="Simpan"
      cancelText="Batal"
      onCancel={() => onClose()}
      onOk={async () => {
        const v = await form.validateFields();
        const ok = a.id
          ? await run(api.patch(`/partners/addresses/${a.id}`, v), 'Alamat disimpan')
          : await run(api.post(`/partners/${partnerId}/addresses`, v), 'Alamat ditambahkan');
        if (ok) onClose(true);
      }}
    >
      <Form form={form} layout="vertical" initialValues={a}>
        <Form.Item name="name" label="Nama lokasi" rules={[{ required: true }]}>
          <Input placeholder="mis. Proyek Gedung A" />
        </Form.Item>
        <Form.Item name="street" label="Alamat" rules={[{ required: true }]}>
          <Input.TextArea autoSize />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="city" label="Kota">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="phone" label="Telepon">
              <Input />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}

export function ProductList() {
  const [qs, set] = useQueryState({});
  const list = useFetch<any[]>('/products', { q: qs.q, active: qs.archived ? 'all' : 'true' });
  const nav = useNavigate();
  const can = useCan();
  const { me } = useAuth();
  return (
    <>
      <PageHead
        title="Produk"
        extra={
          can('produk', 'create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/master/produk/baru')}>
              Tambah
            </Button>
          )
        }
      />
      <div className="toolbar">
        <Input.Search
          allowClear
          placeholder="cari kode atau nama produk"
          style={{ width: 340 }}
          defaultValue={qs.q}
          onSearch={(q) => set({ q })}
        />
        <Checkbox checked={!!qs.archived} onChange={(e) => set({ archived: e.target.checked ? '1' : undefined })}>
          Tampilkan yang diarsipkan
        </Checkbox>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={list.loading}
          dataSource={list.data || []}
          pagination={{ pageSize: 30, hideOnSinglePage: true }}
          onRow={(r) => ({ onClick: () => nav(`/master/produk/${r.id}`), className: 'row-link' })}
          columns={[
            { title: 'Kode', dataIndex: 'code', render: (v) => <b>{v}</b> },
            {
              title: 'Nama',
              dataIndex: 'name',
              render: (v, r) => (
                <>
                  {v} {r.mtppRoute === 'dropship' && <Tag color="purple">dropship</Tag>} {!r.active && <Tag>arsip</Tag>}
                </>
              ),
            },
            { title: 'Kategori', dataIndex: 'category', render: (v) => v || '-' },
            { title: 'Satuan', dataIndex: 'uom' },
            { title: 'Principal', dataIndex: 'supplier', render: (v) => v || '-' },
            { title: 'Harga jual', dataIndex: 'listPrice', align: 'right', render: (v: any) => idr(v) },
            ...(me?.canSeeCost
              ? [
                  {
                    title: 'Harga pokok',
                    dataIndex: 'purchasePrice',
                    align: 'right' as const,
                    render: (v: any) => <span className="cost">{idr(v)}</span>,
                  },
                ]
              : []),
          ]}
        />
      </div>
    </>
  );
}

export function ProductDetail() {
  const { id } = useParams();
  const isNew = id === 'baru';
  const nav = useNavigate();
  const can = useCan();
  const list = useFetch<any[]>(isNew ? null : '/products', { active: 'all' });
  const units = useFetch<any[]>('/units', { active: 'true' });
  const cats = useFetch<any[]>('/categories', { active: 'true' });
  const sup = useFetch<any[]>('/partners', { kind: 'supplier' });
  const p = (list.data || []).find((x) => x.id === Number(id));
  const prices = useFetch<any[]>(
    !isNew && p && can('pricelist_principal') ? '/supplier-prices/view' : null,
    undefined,
    [p?.tmplId],
  );
  const [form] = Form.useForm();
  const [rk, setRk] = useState(0);
  useEffect(() => {
    if (p) form.setFieldsValue(p);
    else if (isNew) form.setFieldsValue({ mtppRoute: 'stock', listPrice: 0, type: 'product' });
  }, [p, isNew]);
  const writable = can('produk', isNew ? 'create' : 'write');
  const save = async () => {
    const v = await form.validateFields();
    if (isNew) {
      const r = await run(api.post('/products', v), 'Produk disimpan');
      if (r) nav(`/master/produk/${r.id}`, { replace: true });
    } else if (await run(api.patch(`/products/${id}`, v), 'Perubahan disimpan')) {
      list.reload();
      setRk(rk + 1);
    }
  };
  if (!isNew && !p) return null;
  return (
    <>
      <PageHead crumb={{ label: 'Produk', to: '/master/produk' }} title={isNew ? 'Baru' : `[${p.code}] ${p.name}`} />
      <div className="toolbar">
        {writable && (
          <Button type="primary" onClick={save}>
            Simpan
          </Button>
        )}
        <Button onClick={() => nav('/master/produk')}>Buang</Button>
        {!isNew && can('produk', 'write') && (
          <Button
            onClick={async () => {
              if (
                await run(api.patch(`/products/${id}`, { active: !p.active }), p.active ? 'Diarsipkan' : 'Diaktifkan')
              )
                list.reload();
            }}
          >
            {p.active ? 'Arsipkan' : 'Aktifkan kembali'}
          </Button>
        )}
        {!isNew && can('produk', 'delete') && (
          <Popconfirm
            title="Hapus produk?"
            okText="Hapus"
            cancelText="Batal"
            onConfirm={async () => {
              if (await run(api.delete(`/products/${id}`), 'Produk dihapus')) nav('/master/produk');
            }}
          >
            <Button danger>Hapus</Button>
          </Popconfirm>
        )}
      </div>
      <div className="card">
        <Form form={form} layout="vertical" disabled={!writable}>
          <Row gutter={24}>
            <Col xs={24} md={6}>
              <Form.Item name="code" label="Kode" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={18}>
              <Form.Item name="name" label="Nama" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="uomId" label="Satuan" rules={[{ required: true }]}>
                <Select options={(units.data || []).map((u) => ({ value: u.id, label: u.name }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="categoryId" label="Kategori">
                <Select allowClear options={(cats.data || []).map((u) => ({ value: u.id, label: u.name }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="mainSupplierId" label="Principal pemasok">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={(sup.data || []).map((u) => ({ value: u.id, label: u.name }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="mtppRoute" label="Rute">
                <Select
                  options={[
                    { value: 'stock', label: 'Dari gudang principal' },
                    { value: 'dropship', label: 'Dropship dari principal' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="listPrice" label="Harga jual (Rp)">
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  formatter={(x) => Number(x || 0).toLocaleString('id-ID')}
                  parser={(x) => Number(String(x).replace(/\./g, '')) as any}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={18}>
              <Form.Item name="descriptionSale" label="Spesifikasi">
                <Input.TextArea autoSize={{ minRows: 2 }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </div>
      {!isNew && prices.data && (
        <div className="card">
          <h3 className="card-title">
            Harga principal <small>harga yang berlaku menjadi harga pokok</small>
          </h3>
          <Table<any>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={prices.data.filter((r) => r.productTmplId === p.tmplId)}
            columns={[
              { title: 'Principal', dataIndex: 'partner' },
              { title: 'Harga', dataIndex: 'price', align: 'right', render: (v: any) => idr(v) },
              { title: 'Diskon', dataIndex: 'discount', align: 'right', render: (v) => `${nf(v, 1)}%` },
              { title: 'Min. qty', dataIndex: 'minQty', align: 'right', render: (v: any) => nf(v) },
              {
                title: 'Berlaku',
                key: 'b',
                render: (_, r) => `${tgl(r.dateStart)} – ${r.dateEnd ? tgl(r.dateEnd) : 'seterusnya'}`,
              },
            ]}
          />
        </div>
      )}
      {!isNew && <Chatter model="products" id={+id!} name={p.code} reloadKey={rk} />}
    </>
  );
}

export function CategoriesUnits() {
  return (
    <>
      <PageHead
        title="Kategori Produk dan Satuan"
        sub="Kategori dan satuan yang sudah dipakai hanya dapat diarsipkan."
      />
      <h3 className="card-title">Kategori</h3>
      <Crud
        path="/categories"
        menu="produk"
        title="kategori"
        fields={[{ key: 'name', label: 'Nama kategori', required: true }]}
      />
      <h3 className="card-title" style={{ marginTop: 24 }}>
        Satuan
      </h3>
      <Crud
        path="/units"
        menu="produk"
        title="satuan"
        fields={[
          { key: 'name', label: 'Nama satuan', required: true },
          { key: 'relativeFactor', label: 'Faktor', type: 'number' },
        ]}
      />
    </>
  );
}

export function PaymentTerms() {
  return (
    <>
      <PageHead title="Term of Payment" sub="Lama term of payment dipakai untuk menghitung jatuh tempo invoice." />
      <Crud
        path="/payment-terms"
        menu="top"
        title="term of payment"
        fields={[
          { key: 'name', label: 'Nama', required: true },
          { key: 'days', label: 'Lama (hari)', type: 'number', required: true },
          { key: 'note', label: 'Keterangan' },
        ]}
      />
    </>
  );
}

export function SalesPricelists() {
  const [sel, setSel] = useState<any>(null);
  return (
    <>
      <PageHead
        title="Pricelist Penjualan"
        sub="Harga jual atau diskon per pelanggan; terisi otomatis ketika produk dipilih pada penawaran."
      />
      <Crud
        path="/pricelists"
        menu="pricelist_jual"
        title="pricelist"
        fields={[{ key: 'name', label: 'Nama pricelist', required: true }]}
        extraActions={(r) => <a onClick={() => setSel(r)}>Isi harga</a>}
      />
      {sel ? (
        <>
          <h3 className="card-title" style={{ marginTop: 24 }}>
            Harga pada pricelist {sel.name}
          </h3>
          <Crud
            key={sel.id}
            path="/pricelist-items"
            params={{ pricelistId: sel.id }}
            defaults={{ pricelistId: sel.id }}
            menu="pricelist_jual"
            archive={false}
            title="harga"
            fields={[
              {
                key: 'productId',
                label: 'Produk',
                type: 'select',
                required: true,
                source: { path: '/products', label: (r) => `[${r.code}] ${r.name}` },
              },
              { key: 'fixedPrice', label: 'Harga tetap (Rp)', type: 'money' },
              { key: 'discount', label: 'atau diskon', type: 'pct' },
              { key: 'minQty', label: 'Qty minimum', type: 'number' },
              { key: 'dateStart', label: 'Mulai', type: 'date' },
              { key: 'dateEnd', label: 'Sampai', type: 'date' },
            ]}
          />
        </>
      ) : (
        <div className="card muted" style={{ marginTop: 24 }}>
          Pilih "Isi harga" pada salah satu pricelist.
        </div>
      )}
    </>
  );
}
