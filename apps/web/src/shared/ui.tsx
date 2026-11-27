import { ReactNode, useState } from 'react';
import { Button, Dropdown, Input, Modal, Segmented, Select, Space, Tag, Tooltip, message } from 'antd';
import { FilterOutlined, SaveOutlined, SearchOutlined, StarOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { api, run, tglJam } from './lib';
import { useFetch } from './hooks';

export function PageHead({
  crumb,
  title,
  extra,
  sub,
}: {
  crumb?: { label: string; to: string };
  title: ReactNode;
  extra?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">
          {crumb && (
            <span className="crumb">
              <Link to={crumb.to}>{crumb.label}</Link> /{' '}
            </span>
          )}
          {title}
        </h1>
        {sub && (
          <div className="muted" style={{ marginTop: 4 }}>
            {sub}
          </div>
        )}
      </div>
      {extra && <Space wrap>{extra}</Space>}
    </div>
  );
}

const C: Record<string, string> = {
  // sales order
  draft: 'gray',
  sent: 'blue',
  sale: 'green',
  done: 'green',
  cancel: 'red',
  // pesanan
  purchase: 'blue',
  // transfer
  waiting: 'amber',
  assigned: 'blue',
  // jurnal & bayar
  posted: 'green',
  not_paid: 'amber',
  partial: 'blue',
  paid: 'green',
  reversed: 'gray',
  // email
  diproses: 'blue',
  terkirim: 'green',
  simulasi: 'gray',
  gagal: 'red',
  ditolak: 'red',
  // stok
  aman: 'green',
  'stok rendah': 'red',
  kurang: 'red',
  // status bayar PO
  'menunggu barang': 'gray',
  'menunggu tagihan': 'amber',
  'belum dikonfirmasi': 'amber',
  'belum dibayar': 'red',
  sebagian: 'blue',
  lunas: 'green',
  'tidak ada tagihan': 'gray',
};
export const LABEL: Record<string, Record<string, string>> = {
  so: { draft: 'Penawaran', sent: 'Terkirim', sale: 'Sales Order', done: 'Selesai', cancel: 'Batal' },
  po: { draft: 'Permintaan', sent: 'Terkirim', purchase: 'Pesanan', done: 'Selesai', cancel: 'Batal' },
  tr: { draft: 'Draf', waiting: 'Menunggu', assigned: 'Siap Kirim', done: 'Selesai', cancel: 'Batal' },
  je: { draft: 'Draf', posted: 'Diposting', cancel: 'Batal' },
  pay: { not_paid: 'belum dibayar', partial: 'sebagian', paid: 'lunas', reversed: 'dibalik' },
  inv: { no: 'belum ditagih', to_invoice: 'siap ditagih', partial: 'sebagian', invoiced: 'sudah ditagih' },
};
export function Pill({ v, kind, children }: { v: string; kind?: string; children?: ReactNode }) {
  const text = children ?? (kind ? LABEL[kind]?.[v] : v) ?? v;
  return <span className={`pill ${C[v] || 'gray'}`}>{text}</span>;
}
export function EmailTag({ s }: { s?: any }) {
  if (!s) return null;
  return (
    <Tooltip title={s.failureReason || tglJam(s.statusAt || s.sentAt)}>
      <span className={`pill ${C[s.state] || 'gray'}`}>Email: {s.state}</span>
    </Tooltip>
  );
}

export function StatusBar({ steps, value }: { steps: { key: string; label: string }[]; value: string }) {
  // dibungkus agar bisa digeser di layar sempit, bukan melebarkan halaman
  return (
    <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
      <Segmented
        className="statusbar"
        value={value}
        options={steps.map((s) => ({ value: s.key, label: s.label, disabled: s.key !== value }))}
      />
    </div>
  );
}

// pencarian + filter favorit (fitur A.e)
export function SearchBar({
  resource,
  value,
  onChange,
  filter,
  onApply,
  placeholder,
  children,
}: {
  resource: string;
  value?: string;
  onChange: (v: string) => void;
  filter: any;
  onApply: (f: any) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  const saved = useFetch<any[]>('/saved-filters', { resource });
  const [q, setQ] = useState(value || '');
  const save = () => {
    let name = '';
    Modal.confirm({
      title: 'Simpan filter favorit',
      content: <Input autoFocus placeholder="Nama filter" onChange={(e) => (name = e.target.value)} />,
      okText: 'Simpan',
      cancelText: 'Batal',
      onOk: async () => {
        if (!name) {
          message.warning('Isi nama filter');
          throw new Error();
        }
        await run(api.post('/saved-filters', { resource, name, filter }), 'Filter disimpan');
        saved.reload();
      },
    });
  };
  const items = [
    ...(saved.data || []).map((f) => ({
      key: String(f.id),
      label: (
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          {f.name}
          <a
            onClick={async (e) => {
              e.stopPropagation();
              await run(api.delete(`/saved-filters/${f.id}`));
              saved.reload();
            }}
          >
            hapus
          </a>
        </span>
      ),
      onClick: () => onApply(f.filter),
    })),
    ...(saved.data?.length ? [{ type: 'divider' as const }] : []),
    { key: 'save', icon: <SaveOutlined />, label: 'Simpan filter saat ini', onClick: save },
  ];
  return (
    <div className="toolbar">
      <Input
        allowClear
        prefix={<SearchOutlined className="muted" />}
        placeholder={placeholder || 'cari nomor, nama, atau produk...'}
        style={{ width: 340, borderRadius: 999 }}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value) onChange('');
        }}
        onPressEnter={() => onChange(q)}
      />
      {children}
      <Dropdown menu={{ items }} trigger={['click']}>
        <Button icon={<StarOutlined />}>Favorit</Button>
      </Dropdown>
    </div>
  );
}

// Kata pencarian, pelanggan/principal, tanggal, dan pilihan/tombol penyaring (kedaluwarsa, status bayar, jatuh tempo, terlambat, status)
// membuat daftar berfilter. Tab bukan filter: pemanggil yang tab-nya mempersempit data memilih teks per tab.
// Daftar berfilter selalu menampilkan 'Tidak ada data yang cocok', bukan petunjuk langkah berikutnya.
const FILTER_KEYS = ['q', 'partnerId', 'from', 'to', 'expired', 'paymentState', 'overdue', 'late', 'state'];
export const emptyText = (qs: Record<string, any>, next: string) =>
  FILTER_KEYS.some((k) => qs[k]) ? 'Tidak ada data yang cocok' : next;

export const FilterIcon = FilterOutlined;
export const yes = (v: any) => (v ? <Tag color="blue">ya</Tag> : <span className="muted">-</span>);

// Pengelompokan daftar (fitur pencarian dan filter): baris dikelompokkan menjadi pohon yang bisa dibuka-tutup
export function groupRows(rows: any[] | undefined, key?: string, label?: (r: any) => string) {
  if (!key || !rows) return rows || [];
  const map = new Map<string, any[]>();
  for (const r of rows) {
    const k = label ? label(r) : String(r[key] ?? '-');
    map.set(k, [...(map.get(k) || []), r]);
  }
  return [...map.entries()].map(([k, children]) => ({
    id: 'g:' + k,
    __group: true,
    __label: `${k} (${children.length})`,
    children,
  }));
}
export function groupCols(cols: any[], sumKeys: string[] = []) {
  return cols.map((c, i) => ({
    ...c,
    render: (v: any, r: any, idx: number) => {
      if (!r.__group) return c.render ? c.render(v, r, idx) : v;
      if (i === 0) return <b>{r.__label}</b>;
      if (sumKeys.includes(c.dataIndex))
        return (
          <b>
            {Number(r.children.reduce((a: number, x: any) => a + Number(x[c.dataIndex] || 0), 0)).toLocaleString(
              'id-ID',
            )}
          </b>
        );
      return null;
    },
  }));
}
export function GroupSelect({
  value,
  onChange,
  options,
}: {
  value?: string;
  onChange: (v?: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select
      allowClear
      placeholder="Kelompokkan"
      style={{ width: 180 }}
      value={value}
      onChange={onChange}
      options={options}
    />
  );
}
