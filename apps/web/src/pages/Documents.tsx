import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Col, ConfigProvider, Dropdown, Input, Modal, Popconfirm, Row, Select, Spin, Table } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  FilePdfOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useCan } from '../auth';
import { useFetch, useQueryState } from '../hooks';
import { PageHead } from '../components/ui';
import { api, errMsg, openFile, run, tgl, today } from '../lib';
import { CATALOG, MAINTENANCE_NOTES, UNITS } from './docCatalog';

// ---------- definisi jenis dokumen (isi mengikuti MTPP Docs) ----------
type Field = {
  k: string;
  l: string;
  t?: 'text' | 'textarea' | 'date' | 'select';
  w?: 1 | 2;
  rows?: number;
  opts?: string[];
};
type Section = { g: string; fields?: Field[]; items?: boolean; checks?: [string, string]; pickers?: boolean };
interface DocType {
  label: string;
  defaults: () => any;
  form: Section[];
}

const TO = (g = 'Kepada / Penerima'): Section => ({
  g,
  pickers: true,
  fields: [
    { k: 'to.company', l: 'Nama perusahaan / instansi', w: 2 },
    { k: 'to.person', l: 'Nama kontak (Up.)' },
    { k: 'to.phone', l: 'Telepon' },
    { k: 'to.address', l: 'Alamat', t: 'textarea', w: 2, rows: 2 },
    { k: 'to.npwp', l: 'NPWP' },
    { k: 'to.email', l: 'Email' },
    { k: 'to.attn', l: 'Cc (opsional)' },
  ],
});
const SIGNER: Section = {
  g: 'Penanda tangan (kosongkan untuk memakai data perusahaan)',
  fields: [
    { k: 'signerName', l: 'Nama' },
    { k: 'signerTitle', l: 'Jabatan' },
    { k: 'signerPhone', l: 'Hp (opsional)' },
  ],
};
const EQUIP: Field[] = [
  { k: 'eqBrand', l: 'Merk' },
  { k: 'eqType', l: 'Tipe' },
  { k: 'eqRating', l: 'Kapasitas / rating' },
  { k: 'eqSerial', l: 'No. seri' },
];
const check = (item: string, result = '') => ({ item, result, note: '' });

export const DOC_TYPES: Record<string, DocType> = {
  surat: {
    label: 'Surat Resmi',
    defaults: () => ({
      subject: 'Pemberitahuan Alamat Kirim',
      body: 'Dengan hormat,\n\nBersamaan dengan surat ini kami mohon bantuan Bapak/Ibu untuk pengiriman barang berikut:\n\nDemikian surat pemberitahuan kami. Atas perhatian dan kerja samanya kami ucapkan terima kasih.',
      items: [],
    }),
    form: [
      TO(),
      {
        g: 'Isi surat',
        fields: [
          { k: 'refNumber', l: 'Referensi' },
          { k: 'attachment', l: 'Lampiran' },
          { k: 'subject', l: 'Hal / subject', w: 2 },
          { k: 'body', l: 'Isi surat (pisahkan paragraf dengan baris kosong)', t: 'textarea', w: 2, rows: 9 },
        ],
      },
      { g: 'Daftar barang (opsional)', items: true },
      {
        g: 'Alamat tujuan kirim (opsional)',
        fields: [
          { k: 'shipTo', l: 'Alamat', t: 'textarea', w: 2, rows: 3 },
          { k: 'shipContact', l: 'Kontak / Up.' },
          { k: 'shipDate', l: 'Diharapkan tiba', t: 'date' },
        ],
      },
      { g: 'Tembusan', fields: [{ k: 'cc', l: 'Tembusan / Cc', w: 2 }] },
      SIGNER,
    ],
  },
  bast: {
    label: 'Berita Acara Serah Terima',
    defaults: () => ({
      statement:
        'Pada hari ini telah dilaksanakan serah terima barang/pekerjaan sebagaimana tercantum di bawah ini, dalam keadaan baik, lengkap dan sesuai dengan spesifikasi yang disepakati.',
      closing:
        'Berita acara ini dibuat dengan sebenarnya dan ditandatangani oleh kedua belah pihak untuk dipergunakan sebagaimana mestinya.',
      items: [],
    }),
    form: [
      {
        g: 'Pihak kedua (penerima)',
        pickers: true,
        fields: [
          { k: 'party2Company', l: 'Perusahaan', w: 2 },
          { k: 'party2Name', l: 'Nama' },
          { k: 'party2Title', l: 'Jabatan' },
          { k: 'location', l: 'Lokasi serah terima', w: 2 },
        ],
      },
      {
        g: 'Referensi proyek',
        fields: [
          { k: 'project', l: 'Nama proyek', w: 2 },
          { k: 'poNumber', l: 'PO Pelanggan' },
          { k: 'poDate', l: 'Tanggal PO', t: 'date' },
        ],
      },
      {
        g: 'Pihak pertama (penyerah), kosongkan untuk memakai data perusahaan',
        fields: [
          { k: 'party1Name', l: 'Nama' },
          { k: 'party1Title', l: 'Jabatan' },
          { k: 'party1Company', l: 'Perusahaan', w: 2 },
        ],
      },
      { g: 'Uraian', fields: [{ k: 'statement', l: 'Pernyataan', t: 'textarea', w: 2, rows: 3 }] },
      { g: 'Barang / pekerjaan', items: true },
      {
        g: 'Catatan dan penutup',
        fields: [
          { k: 'notes', l: 'Catatan kondisi', t: 'textarea', w: 2, rows: 2 },
          { k: 'closing', l: 'Penutup', t: 'textarea', w: 2, rows: 2 },
        ],
      },
    ],
  },
  bacomm: {
    label: 'Berita Acara Commissioning',
    defaults: () => ({
      statement:
        'Telah dilaksanakan pekerjaan commissioning dan pengujian terhadap peralatan sebagaimana tercantum di bawah ini, dengan hasil sebagai berikut:',
      result: 'Peralatan dinyatakan LAIK OPERASI dan siap diserahkan untuk dioperasikan.',
      checks: [
        check('Pemeriksaan visual & mekanik', 'OK'),
        check('Uji tahanan isolasi (Insulation Resistance)'),
        check('Uji rasio belitan (Turn Ratio)'),
        check('Uji polaritas & vector group', 'OK'),
        check('Uji fungsi proteksi (OCR / DGR)'),
        check('Uji interlock & fungsi mekanis cubicle', 'OK'),
        check('Uji pentanahan (Grounding)'),
        check('Energize / test on load', 'OK'),
      ],
    }),
    form: [
      TO('Pelanggan'),
      {
        g: 'Pelaksanaan',
        fields: [
          { k: 'location', l: 'Lokasi / site', w: 2 },
          { k: 'serviceDate', l: 'Tanggal pelaksanaan', t: 'date' },
          { k: 'project', l: 'Proyek' },
          { k: 'technicians', l: 'Teknisi / engineer' },
          { k: 'witness', l: 'Disaksikan oleh' },
        ],
      },
      { g: 'Data peralatan', fields: EQUIP },
      { g: 'Uraian', fields: [{ k: 'statement', l: 'Pernyataan', t: 'textarea', w: 2, rows: 2 }] },
      { g: 'Hasil pengujian', checks: ['Item pengujian', 'Hasil'] },
      {
        g: 'Kesimpulan',
        fields: [
          { k: 'result', l: 'Kesimpulan', t: 'textarea', w: 2, rows: 2 },
          { k: 'notes', l: 'Catatan', t: 'textarea', w: 2, rows: 2 },
        ],
      },
      SIGNER,
    ],
  },
  maintenance: {
    label: 'Laporan Pemeliharaan',
    defaults: () => ({
      serviceType: 'Preventive Maintenance',
      terms: MAINTENANCE_NOTES,
      items: [],
      checks: [
        check('Kebersihan body & isolator', 'Baik'),
        check('Kondisi bushing & terminal', 'Baik'),
        check('Level & kondisi oli', 'Baik'),
        check('Kekencangan baut terminal', 'Baik'),
        check('Tahanan isolasi (Megger)'),
        check('Tahanan pentanahan (grounding)'),
        check('Pengukuran tegangan & arus beban'),
        check('Fungsi proteksi / relay', 'Baik'),
        check('Silica gel / breather'),
        check('Indikator suhu & tekanan'),
      ],
    }),
    form: [
      TO('Pelanggan'),
      {
        g: 'Pelaksanaan',
        fields: [
          { k: 'location', l: 'Lokasi / site', w: 2 },
          { k: 'serviceDate', l: 'Tanggal pelaksanaan', t: 'date' },
          { k: 'serviceTime', l: 'Jam' },
          {
            k: 'serviceType',
            l: 'Jenis pekerjaan',
            t: 'select',
            opts: ['Preventive Maintenance', 'Corrective Maintenance', 'Commissioning', 'Inspeksi'],
          },
          { k: 'technicians', l: 'Teknisi pelaksana' },
        ],
      },
      { g: 'Data peralatan', fields: [...EQUIP, { k: 'eqYear', l: 'Tahun' }, { k: 'eqQty', l: 'Jumlah unit' }] },
      { g: 'Hasil pemeriksaan', checks: ['Pemeriksaan', 'Hasil'] },
      {
        g: 'Pengukuran (opsional)',
        fields: [
          { k: 'mR', l: 'Tegangan R–N (V)' },
          { k: 'mS', l: 'Tegangan S–N (V)' },
          { k: 'mT', l: 'Tegangan T–N (V)' },
          { k: 'mIR', l: 'Arus R (A)' },
          { k: 'mIS', l: 'Arus S (A)' },
          { k: 'mIT', l: 'Arus T (A)' },
          { k: 'mIso', l: 'Tahanan isolasi (MΩ)' },
          { k: 'mGnd', l: 'Tahanan pentanahan (Ω)' },
          { k: 'mTemp', l: 'Suhu (°C)' },
          { k: 'mLoad', l: 'Beban (%)' },
        ],
      },
      {
        g: 'Kesimpulan',
        fields: [
          { k: 'findings', l: 'Temuan', t: 'textarea', w: 2, rows: 3 },
          { k: 'actions', l: 'Tindakan yang dilakukan', t: 'textarea', w: 2, rows: 3 },
          { k: 'recommendation', l: 'Rekomendasi', t: 'textarea', w: 2, rows: 3 },
          { k: 'nextService', l: 'Jadwal berikutnya', t: 'date' },
          {
            k: 'status',
            l: 'Status akhir',
            t: 'select',
            opts: ['Selesai — Laik Operasi', 'Selesai dengan catatan', 'Perlu tindak lanjut'],
          },
        ],
      },
      { g: 'Material terpakai (opsional)', items: true },
      { g: 'Catatan (1 baris = 1 poin)', fields: [{ k: 'terms', l: '', t: 'textarea', w: 2, rows: 3 }] },
      SIGNER,
    ],
  },
};

const deepGet = (o: any, p: string) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function deepSet(o: any, p: string, v: any) {
  const n = { ...o };
  const ks = p.split('.');
  let c = n;
  ks.slice(0, -1).forEach((k) => {
    c[k] = { ...(c[k] || {}) };
    c = c[k];
  });
  c[ks[ks.length - 1]] = v;
  return n;
}

// ---------- daftar ----------
export function DocumentList() {
  const can = useCan();
  const nav = useNavigate();
  const [q, setQ] = useQueryState({ type: 'all' });
  const params = useMemo(() => ({ type: q.type === 'all' ? undefined : q.type, q: q.q }), [q.type, q.q]);
  const list = useFetch<any[]>('/documents', params);
  const title = DOC_TYPES[q.type]?.label || 'Semua Dokumen';
  const newMenu = {
    items: Object.entries(DOC_TYPES).map(([k, t]) => ({
      key: k,
      label: t.label,
      onClick: () => nav(`/dokumen/baru?type=${k}`),
    })),
  };
  return (
    <>
      <PageHead
        title={title}
        sub="Surat resmi, berita acara, dan laporan pemeliharaan. Penawaran, invoice, surat jalan, dan kuitansi tetap dibuat dari transaksinya."
        extra={
          can('dokumen', 'create') &&
          (DOC_TYPES[q.type] ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav(`/dokumen/baru?type=${q.type}`)}>
              Buat {title}
            </Button>
          ) : (
            <Dropdown menu={newMenu} trigger={['click']}>
              <Button type="primary" icon={<PlusOutlined />}>
                Buat dokumen <DownOutlined />
              </Button>
            </Dropdown>
          ))
        }
      />
      <div className="toolbar" style={{ maxWidth: 420 }}>
        <Input.Search
          allowClear
          placeholder="Cari nomor, pelanggan, atau perihal"
          defaultValue={q.q}
          onSearch={(v) => setQ({ q: v })}
        />
      </div>
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={list.loading}
          dataSource={list.data || []}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          rowClassName={() => 'row-link'}
          onRow={(r) => ({ onClick: () => nav(`/dokumen/${r.id}`) })}
          locale={{ emptyText: 'Belum ada dokumen' }}
          columns={[
            { title: 'Nomor', dataIndex: 'number', render: (v) => <b>{v}</b> },
            { title: 'Jenis', dataIndex: 'typeLabel' },
            { title: 'Tanggal', dataIndex: 'date', render: tgl },
            { title: 'Pelanggan', dataIndex: 'partner', render: (v) => v || '-' },
            { title: 'Perihal / proyek', dataIndex: 'title', render: (v) => v || '-' },
          ]}
        />
      </div>
    </>
  );
}

// ---------- formulir + pratinjau ----------
function FieldInput({ f, value, onChange }: { f: Field; value: any; onChange: (v: any) => void }) {
  const v = value ?? '';
  if (f.t === 'textarea')
    return <Input.TextArea rows={f.rows || 2} value={v} onChange={(e) => onChange(e.target.value)} />;
  if (f.t === 'date') return <Input type="date" value={v} onChange={(e) => onChange(e.target.value)} />;
  if (f.t === 'select')
    return (
      <Select
        style={{ width: '100%' }}
        allowClear
        value={v || undefined}
        onChange={(x) => onChange(x ?? '')}
        options={f.opts!.map((o) => ({ value: o, label: o }))}
      />
    );
  return <Input value={v} onChange={(e) => onChange(e.target.value)} />;
}

function ItemsEditor({
  items,
  onChange,
  onCatalog,
}: {
  items: any[];
  onChange: (x: any[]) => void;
  onCatalog: () => void;
}) {
  const set = (i: number, k: string, v: any) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <>
      {items.map((it, i) => (
        <div key={i} className="doc-item">
          <Input.TextArea
            rows={2}
            placeholder={'Baris pertama: nama barang (tebal)\nBaris berikutnya: spesifikasi'}
            value={it.desc}
            onChange={(e) => set(i, 'desc', e.target.value)}
          />
          <Input placeholder="Qty" value={it.qty} onChange={(e) => set(i, 'qty', e.target.value)} />
          <Select
            placeholder="Satuan"
            showSearch
            allowClear
            value={it.unit || undefined}
            onChange={(v) => set(i, 'unit', v ?? '')}
            options={UNITS.map((u) => ({ value: u, label: u }))}
          />
          <Button
            type="text"
            aria-label="Hapus baris"
            icon={<DeleteOutlined />}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button icon={<PlusOutlined />} onClick={() => onChange([...items, { desc: '', qty: '', unit: '' }])}>
          Tambah baris
        </Button>
        <Button onClick={onCatalog}>Dari katalog</Button>
      </div>
    </>
  );
}

function ChecksEditor({
  rows,
  heads,
  onChange,
}: {
  rows: any[];
  heads: [string, string];
  onChange: (x: any[]) => void;
}) {
  const set = (i: number, k: string, v: any) => onChange(rows.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <>
      <div className="doc-check muted" style={{ fontSize: 12 }}>
        <span>{heads[0]}</span>
        <span>{heads[1]}</span>
        <span>Keterangan</span>
        <span />
      </div>
      {rows.map((r, i) => (
        <div key={i} className="doc-check">
          <Input value={r.item} onChange={(e) => set(i, 'item', e.target.value)} />
          <Input value={r.result} onChange={(e) => set(i, 'result', e.target.value)} />
          <Input value={r.note} onChange={(e) => set(i, 'note', e.target.value)} />
          <Button
            type="text"
            aria-label="Hapus baris"
            icon={<DeleteOutlined />}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button icon={<PlusOutlined />} onClick={() => onChange([...rows, { item: '', result: '', note: '' }])}>
        Tambah baris
      </Button>
    </>
  );
}

function CatalogModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (x: any[]) => void }) {
  const products = useFetch<any[]>(open ? '/products' : null);
  const [sel, setSel] = useState<any[]>([]);
  useEffect(() => {
    if (open) setSel([]);
  }, [open]);
  const groups = useMemo(
    () => [
      ...(products.data?.length
        ? [
            {
              group: 'Master produk',
              items: products.data.map((p: any) => ({ desc: p.name, unit: p.uom || p.uomName || '' })),
            },
          ]
        : []),
      ...CATALOG,
    ],
    [products.data],
  );
  const toggle = (it: any) => setSel((s) => (s.includes(it) ? s.filter((x) => x !== it) : [...s, it]));
  return (
    <Modal
      title="Pilih dari katalog"
      open={open}
      onCancel={onClose}
      okText={`Tambahkan${sel.length ? ` (${sel.length})` : ''}`}
      cancelText="Batal"
      okButtonProps={{ disabled: !sel.length }}
      onOk={() => {
        onPick(sel.map((x) => ({ desc: x.desc, qty: '1', unit: x.unit })));
        onClose();
      }}
      width={620}
    >
      <div style={{ maxHeight: 460, overflow: 'auto' }}>
        {groups.map((g) => (
          <div key={g.group} style={{ marginBottom: 14 }}>
            <div className="card-title" style={{ marginBottom: 6, fontSize: 14 }}>
              {g.group}
            </div>
            {g.items.map((it: any, i: number) => (
              <label key={i} className={`doc-cat ${sel.includes(it) ? 'on' : ''}`}>
                <input type="checkbox" checked={sel.includes(it)} onChange={() => toggle(it)} />
                <span>
                  <b>{it.desc.split('\n')[0]}</b>
                  {it.desc.includes('\n') && (
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      {it.desc.split('\n').slice(1).join(' · ')}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function DocumentEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'baru';
  const nav = useNavigate();
  const loc = useLocation();
  const can = useCan();
  const type0 = new URLSearchParams(loc.search).get('type') || 'surat';
  const loaded = useFetch<any>(isNew ? null : `/documents/${id}`);
  const [type, setType] = useState(type0);
  const [head, setHead] = useState<any>({ number: '', date: today(), partnerId: null, saleOrderId: null });
  const [data, setData] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [preview, setPreview] = useState<{ url?: string; err?: string; busy?: boolean }>({ busy: true });
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<string>();
  const seq = useRef(0);

  const canSo = can('penjualan', 'read');
  const customers = useFetch<any[]>('/partners', { kind: 'customer' });
  const orders = useFetch<any[]>(canSo ? '/sales-orders' : null, { state: 'sale' });
  const next = useFetch<any>(isNew ? '/documents/next-number' : null, { type, date: head.date });

  // dokumen baru: isi bawaan + data yang dibawa dari dokumen sebelumnya
  useEffect(() => {
    if (!isNew) return;
    const t = DOC_TYPES[type0] ? type0 : 'surat';
    const carry: any = (loc.state as any)?.carry || {};
    setType(t);
    setHead({ number: '', date: today(), partnerId: carry.partnerId ?? null, saleOrderId: carry.saleOrderId ?? null });
    setData({ ...DOC_TYPES[t].defaults(), ...(carry.data || {}) });
    setDirty(!!carry.data);
  }, [isNew, type0, loc.key]);
  useEffect(() => {
    if (loaded.data) {
      const d = loaded.data;
      setType(d.type);
      setHead({ number: d.number, date: d.date, partnerId: d.partnerId, saleOrderId: d.saleOrderId });
      setData(d.data);
      setDirty(false);
    }
  }, [loaded.data]);

  // pratinjau: selalu hasil PDF dari server, jadi sama persis dengan hasil cetak
  useEffect(() => {
    if (!data) return;
    const n = ++seq.current;
    const h = setTimeout(async () => {
      setPreview((p) => ({ ...p, busy: true }));
      try {
        const r = await api.post(
          '/documents/preview',
          { type, date: head.date || today(), number: head.number || undefined, data },
          { responseType: 'blob' },
        );
        if (n !== seq.current) return;
        const url = URL.createObjectURL(r.data);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setPreview({ url });
      } catch (e: any) {
        if (n !== seq.current) return;
        let msg = errMsg(e);
        if (e?.response?.data instanceof Blob) {
          try {
            msg = JSON.parse(await e.response.data.text()).message || msg;
          } catch {}
        }
        setPreview((p) => ({ url: p.url, err: msg }));
      }
    }, 600);
    return () => clearTimeout(h);
  }, [data, type, head.date, head.number]);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const editable = isNew ? can('dokumen', 'create') : can('dokumen', 'write');
  const change = (k: string, v: any) => {
    setData((d: any) => deepSet(d, k, v));
    setDirty(true);
  };
  const changeHead = (p: any) => {
    setHead((h: any) => ({ ...h, ...p }));
    setDirty(true);
  };

  const pickCustomer = (pid?: number) => {
    changeHead({ partnerId: pid ?? null });
    const c = customers.data?.find((x) => x.id === pid);
    if (!c) return;
    setData((d: any) => ({
      ...d,
      party2Company: c.name,
      to: {
        ...(d.to || {}),
        company: c.name,
        address: [c.street, c.city].filter(Boolean).join(', '),
        phone: c.phone || '',
        email: c.email || '',
        npwp: c.vat || '',
      },
    }));
  };
  // nama dan jumlah barang ikut dari sales order; harga pokok dan margin tidak dibawa
  const pickOrder = async (oid?: number) => {
    changeHead({ saleOrderId: oid ?? null });
    if (!oid) return;
    const o = await run(api.get(`/sales-orders/${oid}`));
    if (!o) return;
    const addr = [o.partner?.street, o.partner?.city].filter(Boolean).join(', ');
    changeHead({ partnerId: o.partnerId, saleOrderId: oid });
    setData((d: any) => ({
      ...d,
      party2Company: o.partner?.name,
      poNumber: o.clientOrderRef || d.poNumber,
      refNumber: o.name,
      to: {
        ...(d.to || {}),
        company: o.partner?.name,
        address: addr,
        phone: o.partner?.phone || '',
        email: o.partner?.email || '',
        npwp: o.partner?.vat || '',
      },
      items: (o.lines || []).map((l: any) => ({
        desc: l.name,
        qty: String(Number(l.productUomQty)),
        unit: l.uom || '',
      })),
    }));
  };

  const save = async () => {
    setBusy(true);
    const body = { type, ...head, number: head.number || undefined, data };
    const r = await run(isNew ? api.post('/documents', body) : api.patch(`/documents/${id}`, body), 'Dokumen disimpan');
    setBusy(false);
    if (r) {
      setDirty(false);
      if (isNew) nav(`/dokumen/${r.id}`, { replace: true });
      else loaded.reload();
    }
  };
  // jenis lain: pelanggan, proyek, PO, dan daftar barang ikut terbawa
  const carryTo = (t: string) => {
    const k = [
      'to',
      'project',
      'poNumber',
      'poDate',
      'location',
      'party2Company',
      'party2Name',
      'party2Title',
      'items',
      'eqBrand',
      'eqType',
      'eqRating',
      'eqSerial',
      'technicians',
    ];
    const picked: any = { refNumber: head.number };
    k.forEach((x) => {
      if (data[x] !== undefined && data[x] !== '') picked[x] = data[x];
    });
    nav(`/dokumen/baru?type=${t}`, {
      state: { carry: { partnerId: head.partnerId, saleOrderId: head.saleOrderId, data: picked } },
    });
  };

  if (!isNew && !loaded.data && loaded.loading) return <Spin />;
  if (!data || !DOC_TYPES[type]) return <Spin />;
  const def = DOC_TYPES[type];
  const items = data.items || [];
  return (
    <>
      <PageHead
        crumb={{ label: def.label, to: `/dokumen?type=${type}` }}
        title={isNew ? 'Baru' : head.number}
        extra={
          <>
            {!isNew && (
              <Button
                icon={<FilePdfOutlined />}
                disabled={dirty}
                title={dirty ? 'Simpan perubahan dahulu' : undefined}
                onClick={() => openFile(`/documents/${id}/pdf`)}
              >
                Cetak / PDF
              </Button>
            )}
            {!isNew && can('dokumen', 'create') && (
              <Dropdown
                trigger={['click']}
                disabled={dirty}
                menu={{
                  items: [
                    {
                      key: 'copy',
                      icon: <CopyOutlined />,
                      label: 'Duplikat dokumen ini',
                      onClick: async () => {
                        const r = await run(api.post(`/documents/${id}/copy`), 'Dokumen diduplikat');
                        if (r) nav(`/dokumen/${r.id}`);
                      },
                    },
                    { type: 'divider' as const },
                    ...Object.entries(DOC_TYPES).map(([k, t]) => ({
                      key: k,
                      label: `Buat ${t.label}`,
                      onClick: () => carryTo(k),
                    })),
                  ],
                }}
              >
                <Button>
                  Buat dari ini <DownOutlined />
                </Button>
              </Dropdown>
            )}
            {!isNew && can('dokumen', 'delete') && (
              <Popconfirm
                title="Hapus dokumen ini?"
                okText="Hapus"
                cancelText="Batal"
                onConfirm={async () => {
                  if (await run(api.delete(`/documents/${id}`), 'Dokumen dihapus')) {
                    setDirty(false);
                    nav(`/dokumen?type=${type}`);
                  }
                }}
              >
                <Button danger icon={<DeleteOutlined />}>
                  Hapus
                </Button>
              </Popconfirm>
            )}
            {editable && (
              <Button type="primary" icon={<SaveOutlined />} loading={busy} disabled={!dirty && !isNew} onClick={save}>
                Simpan
              </Button>
            )}
          </>
        }
      />
      <div className="doc-editor">
        <div className="doc-form">
          <ConfigProvider componentDisabled={!editable}>
            <div className="card">
              <h3 className="card-title">Nomor dan tanggal</h3>
              <Row gutter={12}>
                <Col span={15}>
                  <div className="doc-label">No. dokumen</div>
                  <Input
                    value={head.number}
                    placeholder={isNew ? `Otomatis: ${next.data?.number || ''}` : ''}
                    onChange={(e) => changeHead({ number: e.target.value })}
                  />
                </Col>
                <Col span={9}>
                  <div className="doc-label">Tanggal</div>
                  <Input type="date" value={head.date} onChange={(e) => changeHead({ date: e.target.value })} />
                </Col>
              </Row>
            </div>
            {def.form.map((sec) => (
              <div className="card" key={sec.g}>
                <h3 className="card-title">{sec.g}</h3>
                {sec.pickers && (
                  <Row gutter={12} style={{ marginBottom: 12 }}>
                    <Col span={canSo ? 12 : 24}>
                      <div className="doc-label">Pilih pelanggan</div>
                      <Select
                        style={{ width: '100%' }}
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        placeholder="Pelanggan"
                        value={head.partnerId ?? undefined}
                        onChange={pickCustomer}
                        options={(customers.data || []).map((c) => ({ value: c.id, label: c.name }))}
                      />
                    </Col>
                    {canSo && (
                      <Col span={12}>
                        <div className="doc-label">Ambil dari sales order</div>
                        <Select
                          style={{ width: '100%' }}
                          allowClear
                          showSearch
                          optionFilterProp="label"
                          placeholder="Sales order"
                          value={head.saleOrderId ?? undefined}
                          onChange={pickOrder}
                          options={(orders.data || []).map((o: any) => ({
                            value: o.id,
                            label: `${o.name} · ${typeof o.partner === 'string' ? o.partner : o.partner?.name || ''}`,
                          }))}
                        />
                      </Col>
                    )}
                  </Row>
                )}
                {sec.fields && (
                  <Row gutter={12}>
                    {sec.fields.map((f) => (
                      <Col span={f.w === 2 ? 24 : 12} key={f.k} style={{ marginBottom: 10 }}>
                        {f.l && <div className="doc-label">{f.l}</div>}
                        <FieldInput f={f} value={deepGet(data, f.k)} onChange={(v) => change(f.k, v)} />
                      </Col>
                    ))}
                  </Row>
                )}
                {sec.items && (
                  <ItemsEditor items={items} onChange={(x) => change('items', x)} onCatalog={() => setCatalog(true)} />
                )}
                {sec.checks && (
                  <ChecksEditor rows={data.checks || []} heads={sec.checks} onChange={(x) => change('checks', x)} />
                )}
              </div>
            ))}
          </ConfigProvider>
        </div>
        <div className="doc-preview">
          {preview.err && (
            <Alert type="error" showIcon message={`Pratinjau gagal: ${preview.err}`} style={{ marginBottom: 8 }} />
          )}
          {preview.url ? (
            <iframe title="Pratinjau dokumen" src={`${preview.url}#toolbar=0&view=FitH`} />
          ) : (
            <div className="doc-preview-empty">
              <Spin />
            </div>
          )}
        </div>
      </div>
      <CatalogModal
        open={catalog}
        onClose={() => setCatalog(false)}
        onPick={(x) => change('items', [...items.filter((i: any) => String(i.desc || '').trim()), ...x])}
      />
    </>
  );
}
