import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tabs,
  Typography,
  Upload,
} from 'antd';
import { CopyOutlined, DownloadOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth, useCan } from '../../app/auth';
import { useFetch, useQueryState } from '../../shared/hooks';
import { api, fileUrl, openFile, run, tglJam } from '../../shared/lib';
import { PageHead, Pill } from '../../shared/ui';

export function UsersList() {
  const list = useFetch<any[]>('/users');
  const nav = useNavigate();
  const can = useCan();
  return (
    <>
      <PageHead
        title="Pengguna"
        extra={
          can('pengguna', 'create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/pengaturan/pengguna/baru')}>
              Tambah pengguna
            </Button>
          )
        }
      />
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={list.loading}
          dataSource={list.data || []}
          pagination={false}
          onRow={(r) => ({ onClick: () => nav(`/pengaturan/pengguna/${r.id}`), className: 'row-link' })}
          columns={[
            { title: 'Nama', dataIndex: 'name', render: (v) => <b>{v}</b> },
            { title: 'Email login', dataIndex: 'login' },
            { title: 'Grup', dataIndex: 'groupName' },
            { title: 'Login terakhir', dataIndex: 'loginDate', render: tglJam },
            {
              title: 'Status',
              dataIndex: 'active',
              render: (v) => <Pill v={v ? 'aman' : 'cancel'}>{v ? 'aktif' : 'nonaktif'}</Pill>,
            },
          ]}
        />
      </div>
    </>
  );
}

function Matrix({
  group,
  menus,
  editable,
  onSaved,
}: {
  group: any;
  menus: any[];
  editable: boolean;
  onSaved?: () => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    setRows(
      menus.map((m) => {
        const p = group?.permissions?.find((x: any) => x.menu === m.key) || {};
        return {
          menu: m.key,
          label: m.label,
          master: m.master,
          read: !!p.permRead,
          create: !!p.permCreate,
          write: !!p.permWrite,
          delete: !!p.permDelete,
        };
      }),
    );
  }, [group, menus]);
  const set = (i: number, k: string, v: boolean) => {
    const r = [...rows];
    r[i] = { ...r[i], [k]: v };
    if (k !== 'read' && v) r[i].read = true;
    if (k === 'read' && !v) Object.assign(r[i], { create: false, write: false, delete: false });
    setRows(r);
  };
  const cb = (k: string) => (_: any, r: any, i: number) => (
    <Checkbox disabled={!editable} checked={r[k]} onChange={(e) => set(i, k, e.target.checked)} />
  );
  return (
    <>
      <Table<any>
        className="matrix"
        size="middle"
        rowKey="menu"
        pagination={false}
        dataSource={rows}
        columns={[
          {
            title: 'Menu',
            dataIndex: 'label',
            align: 'left',
            render: (v, r) => (
              <span style={{ display: 'block', textAlign: 'left' }}>
                {v}{' '}
                {r.master && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    · master
                  </span>
                )}
              </span>
            ),
          },
          { title: 'Baca', key: 'r', width: 110, align: 'center', render: cb('read') },
          { title: 'Buat', key: 'c', width: 110, align: 'center', render: cb('create') },
          { title: 'Ubah', key: 'u', width: 110, align: 'center', render: cb('write') },
          { title: 'Hapus', key: 'd', width: 110, align: 'center', render: cb('delete') },
        ]}
      />
      {editable && (
        <Button
          type="primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (await run(api.put(`/groups/${group.id}/permissions`, rows), `Hak akses ${group.name} disimpan`))
              onSaved?.();
          }}
        >
          Simpan hak akses {group?.name}
        </Button>
      )}
    </>
  );
}

export function UserDetail() {
  const { id } = useParams();
  const isNew = id === 'baru';
  const nav = useNavigate();
  const can = useCan();
  const user = useFetch<any>(isNew ? null : `/users/${id}`);
  const groups = useFetch<any[]>('/groups');
  const menus = useFetch<any[]>('/menus');
  const [form] = Form.useForm();
  const [gid, setGid] = useState<number>();
  useEffect(() => {
    if (user.data) {
      form.setFieldsValue(user.data);
      setGid(user.data.groupId);
    } else if (isNew) form.setFieldsValue({ active: true });
  }, [user.data]);
  const g = (groups.data || []).find((x) => x.id === gid);
  const save = async () => {
    const v = await form.validateFields();
    if (isNew) {
      const r = await run(api.post('/users', { ...v, groupId: gid }), 'Pengguna dibuat');
      if (r) nav(`/pengaturan/pengguna/${r.id}`, { replace: true });
    } else if (await run(api.patch(`/users/${id}`, { ...v, groupId: gid }), 'Perubahan disimpan')) user.reload();
  };
  const reset = () => {
    let pw = '';
    Modal.confirm({
      title: 'Atur ulang kata sandi',
      content: (
        <Input.Password
          autoFocus
          placeholder="Kata sandi baru (minimal 8 karakter)"
          onChange={(e) => (pw = e.target.value)}
        />
      ),
      okText: 'Simpan',
      cancelText: 'Batal',
      onOk: () => run(api.post(`/users/${id}/reset-password`, { password: pw }), 'Kata sandi diatur ulang'),
    });
  };
  return (
    <>
      <PageHead crumb={{ label: 'Pengguna', to: '/pengaturan/pengguna' }} title={isNew ? 'Baru' : user.data?.name} />
      <div className="toolbar">
        <Button type="primary" onClick={save} disabled={!can('pengguna', isNew ? 'create' : 'write')}>
          Simpan
        </Button>
        <Button onClick={() => nav('/pengaturan/pengguna')}>Buang</Button>
        {!isNew && can('pengguna', 'write') && (
          <>
            <Button onClick={reset}>Atur Ulang Kata Sandi</Button>
            <Button
              onClick={async () => {
                if (
                  await run(
                    api.patch(`/users/${id}`, { active: !user.data?.active }),
                    user.data?.active ? 'Diarsipkan' : 'Diaktifkan',
                  )
                )
                  user.reload();
              }}
            >
              {user.data?.active ? 'Arsipkan' : 'Aktifkan'}
            </Button>
          </>
        )}
      </div>
      <div className="card">
        <Form form={form} layout="vertical">
          <Row gutter={24}>
            <Col xs={24} md={10}>
              <Form.Item name="name" label="Nama" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item name="login" label="Email login" rules={[{ required: true, type: 'email' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item name="active" label="Status" valuePropName="checked">
                <Checkbox>Aktif</Checkbox>
              </Form.Item>
            </Col>
            {isNew && (
              <Col xs={24} md={10}>
                <Form.Item
                  name="password"
                  label="Kata sandi awal"
                  rules={[{ required: true, min: 8, message: 'Minimal 8 karakter' }]}
                >
                  <Input.Password />
                </Form.Item>
              </Col>
            )}
          </Row>
          <Form.Item label="Grup pengguna" required>
            <Radio.Group
              value={gid}
              onChange={(e) => setGid(e.target.value)}
              options={(groups.data || []).map((x) => ({ value: x.id, label: x.name }))}
            />
          </Form.Item>
        </Form>
        {g && <Matrix group={g} menus={menus.data || []} editable={can('pengguna', 'write')} onSaved={groups.reload} />}
        <div className="note">
          Hak baca, buat, ubah, dan hapus berlaku untuk seluruh anggota grup {g?.name}. Perubahan disimpan pada
          group_permissions dan diperiksa di server.
        </div>
      </div>
      {!isNew && (
        <div className="card">
          <h3 className="card-title">Tanda tangan</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Tercetak di atas nama penerbit pada surat penawaran, pesanan, proforma, surat jalan, dan invoice.
          </p>
          {user.data?.signatureId && (
            <img
              alt="tanda tangan"
              src={fileUrl(`/attachments/${user.data.signatureId}/download`)}
              style={{ maxHeight: 90, display: 'block', marginBottom: 12, border: '1px dashed #ECE8E4', padding: 8 }}
            />
          )}
          {can('pengguna', 'write') && (
            <Upload
              accept="image/png,image/jpeg"
              showUploadList={false}
              beforeUpload={async (f) => {
                const fd = new FormData();
                fd.append('file', f);
                if (await run(api.post(`/users/${id}/signature`, fd), 'Tanda tangan disimpan')) user.reload();
                return false;
              }}
            >
              <Button icon={<UploadOutlined />}>Unggah tanda tangan</Button>
            </Upload>
          )}
        </div>
      )}
    </>
  );
}

export function GroupsPage() {
  const groups = useFetch<any[]>('/groups');
  const menus = useFetch<any[]>('/menus');
  const can = useCan();
  const [sel, setSel] = useState<number>();
  const g = (groups.data || []).find((x) => x.id === (sel ?? groups.data?.[0]?.id));
  return (
    <>
      <PageHead
        title="Grup dan Hak Akses"
        sub="Setiap akun masuk ke satu grup; grup menentukan menu, kolom, dan data yang dapat dibuka. Pemeriksaan dijalankan di server."
      />
      <div className="toolbar">
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          value={g?.id}
          onChange={(e) => setSel(e.target.value)}
          options={(groups.data || []).map((x) => ({ value: x.id, label: x.name }))}
        />
      </div>
      {g && (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            {g.comment}
          </p>
          <Matrix group={g} menus={menus.data || []} editable={can('pengguna', 'write')} onSaved={groups.reload} />
        </div>
      )}
    </>
  );
}

export function EmailOutbox() {
  const [qs, set] = useQueryState({});
  const list = useFetch<any[]>('/emails', { state: qs.state, q: qs.q });
  return (
    <>
      <PageHead
        title="Email Keluar"
        sub="Status terkirim, gagal, atau ditolak diterima dari layanan email melalui webhook."
      />
      <div className="toolbar">
        <Input.Search
          allowClear
          placeholder="cari dokumen, penerima, atau subjek"
          style={{ width: 340 }}
          onSearch={(q) => set({ q })}
        />
        <Radio.Group
          optionType="button"
          value={qs.state || ''}
          onChange={(e) => set({ state: e.target.value || undefined })}
          options={[
            { value: '', label: 'Semua' },
            { value: 'diproses', label: 'Diproses' },
            { value: 'terkirim', label: 'Terkirim' },
            { value: 'simulasi', label: 'Simulasi' },
            { value: 'gagal', label: 'Gagal' },
            { value: 'ditolak', label: 'Ditolak' },
          ]}
        />
      </div>
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={list.loading}
          dataSource={list.data || []}
          pagination={{ pageSize: 30, hideOnSinglePage: true }}
          columns={[
            { title: 'Waktu kirim', dataIndex: 'sentAt', render: tglJam },
            { title: 'Dokumen', dataIndex: 'documentName', render: (v) => <b>{v}</b> },
            { title: 'Penerima', dataIndex: 'emailTo' },
            { title: 'Subjek', dataIndex: 'subject' },
            {
              title: 'Status',
              dataIndex: 'state',
              render: (v, r) => (
                <>
                  <Pill v={v} />
                  {r.failureReason && (
                    <div className="loss" style={{ fontSize: 12 }}>
                      {r.failureReason}
                    </div>
                  )}
                </>
              ),
            },
            { title: 'Status diterima', dataIndex: 'statusAt', render: tglJam },
            {
              title: '',
              key: 'a',
              render: (_, r) =>
                ['gagal', 'ditolak'].includes(r.state) && (
                  <a
                    onClick={() => {
                      let to = r.emailTo;
                      Modal.confirm({
                        title: 'Kirim ulang email',
                        content: <Input defaultValue={to} onChange={(e) => (to = e.target.value)} />,
                        okText: 'Kirim ulang',
                        cancelText: 'Batal',
                        onOk: async () => {
                          await run(api.post(`/emails/${r.id}/resend`, { to }), 'Email dikirim ulang');
                          list.reload();
                        },
                      });
                    }}
                  >
                    Kirim ulang
                  </a>
                ),
            },
          ]}
        />
      </div>
    </>
  );
}

export function CompanyPage() {
  const { settings, reload } = useAuth();
  const can = useCan();
  const [form] = Form.useForm();
  const [v, setV] = useState(0);
  useEffect(() => {
    form.setFieldsValue(settings.company);
  }, [settings]);
  return (
    <>
      <PageHead
        title="Data Perusahaan"
        sub="Nama, alamat, NPWP, dan logo tercetak pada kop setiap dokumen. Tanda tangan diunggah setiap pengguna pada halaman profil."
      />
      <div className="card">
        <Form
          form={form}
          layout="vertical"
          disabled={!can('perusahaan', 'write')}
          onFinish={async (x) => {
            if (await run(api.put('/settings/company', { ...settings.company, ...x }), 'Data perusahaan disimpan'))
              reload();
          }}
        >
          <Row gutter={24}>
            <Col xs={24} md={12}>
              <Form.Item name="name" label="Nama perusahaan" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="npwp" label="NPWP">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="street" label="Alamat">
                <Input.TextArea autoSize />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="phone" label="Telepon">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="email" label="Email">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="tagline" label="Tagline pada kop">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="fax" label="Faks">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="website" label="Website">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="city" label="Kota (tempat tanda tangan)">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="signerName" label="Penanda tangan utama">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="signerTitle" label="Jabatan">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="signerPhone" label="Hp">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit">
            Simpan
          </Button>
        </Form>
      </div>
      <div className="card">
        <h3 className="card-title">Logo</h3>
        {settings.company?.logoAttachmentId && (
          <img
            key={v}
            alt="logo"
            src={`/api/settings/logo?v=${v}`}
            style={{ maxHeight: 80, marginBottom: 12, display: 'block' }}
          />
        )}
        <Upload
          accept="image/png,image/jpeg"
          showUploadList={false}
          disabled={!can('perusahaan', 'write')}
          beforeUpload={async (f) => {
            const fd = new FormData();
            fd.append('file', f);
            if (await run(api.post('/settings/logo', fd), 'Logo disimpan')) {
              reload();
              setV(v + 1);
            }
            return false;
          }}
        >
          <Button icon={<UploadOutlined />}>Unggah logo (PNG/JPG)</Button>
        </Upload>
      </div>
    </>
  );
}

export function DocumentSettings() {
  const { settings, reload } = useAuth();
  const can = useCan();
  const w = can('pengaturan', 'write');
  const seq = useFetch<any>('/settings/sequences/preview');
  const [tax, setTax] = useState<any>({});
  const [terms, setTerms] = useState<any>({});
  const [po, setPo] = useState<any>({});
  const [bank, setBank] = useState<any>({});
  const [notes, setNotes] = useState<any>({});
  const [col, setCol] = useState<any>({});
  const [lock, setLock] = useState<string>('');
  const wAcc = can('akuntansi', 'write');
  useEffect(() => {
    setLock(settings.lock_date?.date || '');
    setCol(settings.collection || {});
    setTax(settings.tax || {});
    setTerms(settings.terms || {});
    setPo(settings.po_terms || {});
    setBank(settings.bank || {});
    setNotes(settings.doc_notes || {});
  }, [settings]);
  const save = async (key: string, val: any) => {
    if (await run(api.put(`/settings/${key}`, val), 'Pengaturan disimpan')) reload();
  };
  const eff = (Number(tax.rate || 0) * Number(tax.dppNum || 0)) / Number(tax.dppDen || 1);
  return (
    <>
      <PageHead title="Format Cetak" />
      <Tabs
        items={[
          {
            key: 'collection',
            label: 'Penagihan',
            children: (
              <div className="card">
                <Row gutter={24}>
                  <Col>
                    <div className="muted">Masa tenggang bawaan (hari)</div>
                    <InputNumber
                      disabled={!w}
                      min={0}
                      max={90}
                      value={col.graceDays}
                      onChange={(v) => setCol({ ...col, graceDays: v })}
                    />
                  </Col>
                  <Col>
                    <div className="muted">Masa tenggang proforma (hari, paling sedikit 7)</div>
                    <InputNumber
                      disabled={!w}
                      min={7}
                      max={90}
                      precision={0}
                      value={col.proformaGraceDays ?? 7}
                      onChange={(v) => setCol({ ...col, proformaGraceDays: v })}
                    />
                  </Col>
                  <Col>
                    <div className="muted">PO pelanggan wajib mulai nilai pesanan (Rp, 0 = semua)</div>
                    <InputNumber
                      disabled={!w}
                      min={0}
                      precision={0}
                      style={{ width: 200 }}
                      value={col.poMinAmount ?? 0}
                      formatter={(v) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                      parser={(v) => Number(String(v ?? '').replace(/\D/g, '')) as any}
                      onChange={(v) => setCol({ ...col, poMinAmount: v ?? 0 })}
                    />
                  </Col>
                  <Col>
                    <div className="muted">Tahan surat jalan setelah masa tenggang</div>
                    <Switch
                      disabled={!w}
                      checked={!!col.blockDelivery}
                      onChange={(v) => setCol({ ...col, blockDelivery: v })}
                    />
                  </Col>
                  <Col>
                    <div className="muted">Cicilan paling banyak (termin)</div>
                    <InputNumber
                      disabled={!w}
                      min={2}
                      max={24}
                      value={col.maxInstallments}
                      onChange={(v) => setCol({ ...col, maxInstallments: v })}
                    />
                  </Col>
                  <Col>
                    <div className="muted">Termin terakhir paling lambat (bulan)</div>
                    <InputNumber
                      disabled={!w}
                      min={1}
                      max={36}
                      value={col.maxMonths}
                      onChange={(v) => setCol({ ...col, maxMonths: v })}
                    />
                  </Col>
                </Row>
                <p className="note">
                  Masa tenggang dapat diganti per pelanggan oleh Pimpinan di data pelanggan. Umur piutang tetap dihitung
                  dari tanggal jatuh tempo; masa tenggang hanya menentukan kapan pengiriman berikutnya ditahan.
                </p>
                {w && (
                  <Button type="primary" onClick={() => save('collection', col)}>
                    Simpan
                  </Button>
                )}
              </div>
            ),
          },
          {
            key: 'tax',
            label: 'PPN',
            children: (
              <div className="card">
                <Row gutter={16}>
                  <Col>
                    <div className="muted">Tarif PPN (%)</div>
                    <InputNumber disabled={!w} value={tax.rate} onChange={(v) => setTax({ ...tax, rate: v })} />
                  </Col>
                  <Col>
                    <div className="muted">DPP nilai lain</div>
                    <Space>
                      <InputNumber disabled={!w} value={tax.dppNum} onChange={(v) => setTax({ ...tax, dppNum: v })} />/
                      <InputNumber disabled={!w} value={tax.dppDen} onChange={(v) => setTax({ ...tax, dppDen: v })} />
                    </Space>
                  </Col>
                  <Col>
                    <div className="muted">Label</div>
                    <Input
                      disabled={!w}
                      value={tax.label}
                      onChange={(e) => setTax({ ...tax, label: e.target.value })}
                    />
                  </Col>
                </Row>
                <p className="note">
                  PPN = {tax.rate}% × DPP ({tax.dppNum}/{tax.dppDen} × nilai transaksi), efektif{' '}
                  {eff.toFixed(2).replace('.', ',')}% dan dibulatkan per dokumen.
                </p>
                {w && (
                  <Button type="primary" onClick={() => save('tax', tax)}>
                    Simpan
                  </Button>
                )}
              </div>
            ),
          },
          {
            key: 'lock',
            label: 'Kunci periode',
            children: (
              <div className="card">
                <div className="muted">Kunci jurnal sampai tanggal</div>
                {!wAcc && <p className="muted">Hanya dapat diubah oleh peran dengan hak tulis Akuntansi (Finance).</p>}
                <Space>
                  <Input
                    type="date"
                    disabled={!wAcc}
                    value={lock}
                    max={dayjs().format('YYYY-MM-DD')}
                    onChange={(e) => setLock(e.target.value)}
                    style={{ width: 180 }}
                  />
                  {wAcc && (
                    <Button type="primary" onClick={() => save('lock_date', { date: lock || null })}>
                      Simpan
                    </Button>
                  )}
                  {wAcc && settings.lock_date?.date && (
                    <Button onClick={() => save('lock_date', { date: null })}>Buka kunci</Button>
                  )}
                </Space>
                <p className="note">
                  Invoice, tagihan, pembayaran, dan jurnal bertanggal sampai tanggal ini tidak dapat dibuat, diposting,
                  dihapus, atau dibalik, sehingga laporan periode yang sudah ditutup tidak berubah. Koreksi dicatat di
                  periode berjalan. Tanggal kunci tidak boleh di masa depan dan periodenya tidak boleh masih memiliki
                  dokumen draf.
                </p>
              </div>
            ),
          },
          {
            key: 'terms',
            label: 'Syarat penawaran',
            children: (
              <div className="card">
                <Row gutter={16}>
                  {[
                    ['payment', 'Pembayaran'],
                    ['handover', 'Penyerahan'],
                    ['standard', 'Standar'],
                    ['delivery', 'Waktu kirim'],
                    ['warranty', 'Garansi'],
                  ].map(([k, l]) => (
                    <Col xs={24} md={12} key={k} style={{ marginBottom: 12 }}>
                      <div className="muted">{l}</div>
                      <Input.TextArea
                        disabled={!w}
                        autoSize
                        value={terms[k]}
                        onChange={(e) => setTerms({ ...terms, [k]: e.target.value })}
                      />
                    </Col>
                  ))}
                  <Col xs={24} md={12}>
                    <div className="muted">Masa berlaku penawaran (hari)</div>
                    <InputNumber
                      disabled={!w}
                      min={1}
                      value={terms.validityDays}
                      onChange={(v) => setTerms({ ...terms, validityDays: v })}
                    />
                  </Col>
                </Row>
                {w && (
                  <Button type="primary" onClick={() => save('terms', terms)}>
                    Simpan
                  </Button>
                )}
              </div>
            ),
          },
          {
            key: 'po',
            label: 'Syarat pesanan & pembayaran',
            children: (
              <div className="card">
                <div className="muted">Syarat pada PO Principal</div>
                <Input.TextArea
                  disabled={!w}
                  autoSize={{ minRows: 2 }}
                  value={po.note}
                  onChange={(e) => setPo({ ...po, note: e.target.value })}
                />
                <div className="muted" style={{ marginTop: 10 }}>
                  Uang muka ke principal sebelum PO dikonfirmasi (%, 0 = tidak wajib; Pimpinan dapat mengecualikan per
                  PO)
                </div>
                <InputNumber
                  disabled={!w}
                  min={0}
                  max={100}
                  value={po.dpPercent ?? 30}
                  onChange={(x) => setPo({ ...po, dpPercent: Number(x ?? 0) })}
                />
                {w && (
                  <Button type="primary" style={{ margin: '10px 0 20px' }} onClick={() => save('po_terms', po)}>
                    Simpan
                  </Button>
                )}
                <div className="muted">Instruksi pembayaran pada invoice dan proforma</div>
                <Input.TextArea
                  disabled={!w}
                  autoSize={{ minRows: 2 }}
                  value={bank.text}
                  onChange={(e) => setBank({ ...bank, text: e.target.value })}
                />
                {w && (
                  <Button type="primary" style={{ marginTop: 10 }} onClick={() => save('bank', bank)}>
                    Simpan
                  </Button>
                )}
              </div>
            ),
          },
          {
            key: 'notes',
            label: 'Syarat & ketentuan cetak',
            children: (
              <div className="card">
                <p className="muted" style={{ marginTop: 0 }}>
                  Satu baris menjadi satu poin bernomor pada dokumen. Kosongkan bila tidak ingin dicetak.
                </p>
                {[
                  ['invoice', 'Invoice'],
                  ['surat_jalan', 'Surat jalan'],
                  ['po', 'PO Principal'],
                ].map(([k, l]) => (
                  <div key={k} style={{ marginBottom: 12 }}>
                    <div className="muted">{l}</div>
                    <Input.TextArea
                      disabled={!w}
                      autoSize={{ minRows: 3 }}
                      value={notes[k]}
                      onChange={(e) => setNotes({ ...notes, [k]: e.target.value })}
                    />
                  </div>
                ))}
                {w && (
                  <Button type="primary" onClick={() => save('doc_notes', notes)}>
                    Simpan
                  </Button>
                )}
              </div>
            ),
          },
          {
            key: 'seq',
            label: 'Penomoran',
            children: (
              <div className="card">
                <p className="muted" style={{ marginTop: 0 }}>
                  Format &lt;kode&gt;/MTPP/&lt;tahun&gt;/&lt;bulan&gt;/&lt;urut&gt;, dimulai ulang setiap bulan. Nomor
                  ganda ditolak; nomor dokumen lama dapat dimasukkan manual. Penawaran mendapat nomor sales order baru
                  saat dikonfirmasi; penawaran lama bernomor SO tetap memakai nomornya.
                </p>
                <Table<any>
                  size="small"
                  pagination={false}
                  rowKey="k"
                  dataSource={Object.entries(seq.data || {}).map(([k, v]) => ({ k, v }))}
                  columns={[
                    { title: 'Kode', dataIndex: 'k' },
                    {
                      title: 'Nomor berikutnya',
                      dataIndex: 'v',
                      render: (v) => <Typography.Text code>{v}</Typography.Text>,
                    },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

export function ImportPage() {
  const kinds = useFetch<any[]>('/import');
  const [kind, setKind] = useState<string>('customers');
  const [file, setFile] = useState<File | null>(null);
  const [prev, setPrev] = useState<any>(null);
  const [map, setMap] = useState<any>({});
  const [res, setRes] = useState<any>(null);
  const [step, setStep] = useState(0);
  const k = (kinds.data || []).find((x) => x.key === kind);
  const preview = async (f: File) => {
    setFile(f);
    const fd = new FormData();
    fd.append('file', f);
    const r = await run(api.post(`/import/${kind}/preview`, fd));
    if (r) {
      setPrev(r);
      setMap(r.mapping);
      setStep(1);
      setRes(null);
    }
  };
  const go = async (dry: boolean) => {
    const fd = new FormData();
    fd.append('file', file!);
    fd.append('mapping', JSON.stringify(map));
    fd.append('dryRun', String(dry));
    const r = await run(api.post(`/import/${kind}`, fd), dry ? undefined : 'Impor selesai');
    if (r) {
      setRes(r);
      setStep(dry ? 1 : 2);
    }
  };
  return (
    <>
      <PageHead
        title="Impor Data Awal"
        sub="Data dari spreadsheet lama dipetakan ke kolom sistem. Baris yang salah ditampilkan beserta alasannya dan tidak ikut tersimpan."
      />
      <div className="card">
        <Steps
          current={step}
          size="small"
          style={{ marginBottom: 20 }}
          items={[{ title: 'Pilih jenis dan file' }, { title: 'Petakan kolom dan periksa' }, { title: 'Selesai' }]}
        />
        <Space wrap>
          <Select
            style={{ width: 300 }}
            value={kind}
            onChange={(v) => {
              setKind(v);
              setPrev(null);
              setRes(null);
              setStep(0);
            }}
            options={(kinds.data || []).map((x) => ({ value: x.key, label: x.title }))}
          />
          <Button icon={<DownloadOutlined />} onClick={() => openFile(`/import/template/${kind}`)}>
            Unduh template
          </Button>
          <Upload
            accept=".xlsx,.csv"
            showUploadList={false}
            beforeUpload={(f) => {
              preview(f);
              return false;
            }}
          >
            <Button type="primary" icon={<UploadOutlined />}>
              Pilih file (.xlsx / .csv)
            </Button>
          </Upload>
          {file && <span className="muted">{file.name}</span>}
        </Space>
        {prev && k && (
          <>
            <h3 className="card-title" style={{ marginTop: 22 }}>
              Pemetaan kolom ({prev.total} baris)
            </h3>
            <Row gutter={[16, 10]}>
              {k.fields.map((f: any) => (
                <Col xs={24} md={8} key={f.key}>
                  <div className="muted">
                    {f.title}
                    {f.required ? ' *' : ''}
                  </div>
                  <Select
                    allowClear
                    style={{ width: '100%' }}
                    value={map[f.key] ?? undefined}
                    placeholder="tidak dipakai"
                    onChange={(v) => setMap({ ...map, [f.key]: v ?? null })}
                    options={prev.headers.map((h: string, i: number) => ({ value: i, label: h || `Kolom ${i + 1}` }))}
                  />
                </Col>
              ))}
            </Row>
            <Space style={{ marginTop: 16 }}>
              <Button onClick={() => go(true)}>Periksa tanpa menyimpan</Button>
              <Button type="primary" onClick={() => go(false)}>
                Impor
              </Button>
            </Space>
          </>
        )}
        {res && (
          <div style={{ marginTop: 18 }}>
            <Alert
              type={res.errors.length ? 'warning' : 'success'}
              showIcon
              message={
                res.dryRun
                  ? `${res.valid} dari ${res.total} baris valid. Tidak ada yang disimpan.`
                  : `${res.imported} dari ${res.total} baris tersimpan.`
              }
            />
            {res.errors.length > 0 && (
              <Table<any>
                style={{ marginTop: 10 }}
                size="small"
                rowKey="row"
                pagination={false}
                dataSource={res.errors}
                columns={[
                  { title: 'Baris', dataIndex: 'row', width: 80 },
                  { title: 'Alasan', dataIndex: 'message' },
                ]}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}

export function ApiKeysPage() {
  const list = useFetch<any[]>('/api-keys');
  const can = useCan();
  const [name, setName] = useState('');
  return (
    <>
      <PageHead
        title="API Key"
        sub="REST API hanya-baca untuk aplikasi lain: GET /api/v1/sales-orders, /api/v1/invoices, /api/v1/stock dengan header X-API-Key."
      />
      {can('pengaturan', 'create') && (
        <div className="toolbar">
          <Input
            placeholder="Nama aplikasi"
            style={{ width: 280 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            type="primary"
            disabled={!name}
            onClick={async () => {
              const r = await run(api.post('/api-keys', { name }), 'API key dibuat');
              if (r) {
                setName('');
                list.reload();
                Modal.success({
                  title: 'Simpan API key ini',
                  width: 560,
                  content: (
                    <>
                      <p>Kunci hanya ditampilkan sekali.</p>
                      <Typography.Paragraph copyable={{ icon: <CopyOutlined /> }} code>
                        {r.key}
                      </Typography.Paragraph>
                    </>
                  ),
                });
              }
            }}
          >
            Buat API key
          </Button>
        </div>
      )}
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={list.loading}
          dataSource={list.data || []}
          pagination={false}
          columns={[
            { title: 'Nama', dataIndex: 'name', render: (v) => <b>{v}</b> },
            { title: 'Awalan', dataIndex: 'prefix', render: (v) => <Typography.Text code>{v}…</Typography.Text> },
            { title: 'Dibuat', dataIndex: 'createDate', render: tglJam },
            { title: 'Terakhir dipakai', dataIndex: 'lastUsed', render: tglJam },
            {
              title: 'Aktif',
              dataIndex: 'active',
              render: (v, r) => (
                <Switch
                  disabled={!can('pengaturan', 'write')}
                  checked={v}
                  onChange={async (x) => {
                    await run(api.patch(`/api-keys/${r.id}`, { active: x }));
                    list.reload();
                  }}
                />
              ),
            },
            {
              title: '',
              key: 'd',
              render: (_, r) =>
                can('pengaturan', 'delete') && (
                  <a
                    style={{ color: '#90241D' }}
                    onClick={async () => {
                      await run(api.delete(`/api-keys/${r.id}`), 'API key dihapus');
                      list.reload();
                    }}
                  >
                    Hapus
                  </a>
                ),
            },
          ]}
        />
      </div>
      <div className="card">
        <h3 className="card-title">Contoh pemanggilan</h3>
        <pre
          style={{
            background: '#FDF6F5',
            color: '#2E2A27',
            border: '1px solid #ECE8E4',
            padding: 16,
            borderRadius: 8,
            overflow: 'auto',
          }}
        >{`curl -H "X-API-Key: mtpp_xxx" ${location.origin}/api/v1/sales-orders?state=sale&limit=50\ncurl -H "X-API-Key: mtpp_xxx" ${location.origin}/api/v1/invoices?paymentState=not_paid\ncurl -H "X-API-Key: mtpp_xxx" ${location.origin}/api/v1/stock`}</pre>
      </div>
    </>
  );
}
