import { ReactNode, useState } from 'react';
import {
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, run, nf, tgl } from '../lib';
import { useFetch } from '../hooks';
import { useCan } from '../auth';

export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'pct' | 'date' | 'select' | 'bool' | 'textarea';
  options?: { value: any; label: string }[];
  source?: { path: string; params?: any; label: (r: any) => string; value?: (r: any) => any };
  required?: boolean;
  table?: boolean;
  form?: boolean;
  render?: (v: any, r: any) => ReactNode;
  width?: number;
}

export function useOptions(src?: Field['source']) {
  const r = useFetch<any[]>(src ? src.path : null, src?.params);
  return (r.data || []).map((x) => ({ value: src!.value ? src!.value(x) : x.id, label: src!.label(x) }));
}

function FieldInput({ f }: { f: Field }) {
  const opts = useOptions(f.source);
  if (f.type === 'select') return <Select showSearch optionFilterProp="label" allowClear options={f.options || opts} />;
  if (f.type === 'number') return <InputNumber style={{ width: '100%' }} decimalSeparator="," />;
  if (f.type === 'money')
    return (
      <InputNumber
        style={{ width: '100%' }}
        formatter={(v) => (v === undefined || v === null || v === '' ? '' : Number(v).toLocaleString('id-ID'))}
        parser={(v) => Number(String(v).replace(/\./g, '').replace(',', '.')) as any}
      />
    );
  if (f.type === 'pct') return <InputNumber style={{ width: '100%' }} min={0} max={100} addonAfter="%" />;
  if (f.type === 'date') return <DatePicker style={{ width: '100%' }} format="D MMM YYYY" />;
  if (f.type === 'bool') return <Switch />;
  if (f.type === 'textarea') return <Input.TextArea autoSize={{ minRows: 2 }} />;
  return <Input />;
}

export function SelectLabel({ f, v }: { f: Field; v: any }) {
  const opts = useOptions(f.source);
  return <>{(f.options || opts).find((o) => o.value === v)?.label ?? v ?? '-'}</>;
}

// halaman master sederhana: tabel + jendela tambah/ubah + arsip/hapus (fitur C.g)
export default function Crud({
  path,
  listPath,
  menu,
  fields,
  params,
  title,
  rowKey = 'id',
  extraActions,
  defaults,
  archive = true,
  onChange,
}: {
  path: string;
  listPath?: string;
  menu: string;
  fields: Field[];
  params?: any;
  title?: string;
  rowKey?: string;
  extraActions?: (r: any) => ReactNode;
  defaults?: any;
  archive?: boolean;
  onChange?: () => void;
}) {
  const can = useCan();
  const [showArchived, setShowArchived] = useState(false);
  const list = useFetch<any[]>(listPath || path, {
    ...(params || {}),
    ...(archive ? { active: showArchived ? 'all' : 'true' } : {}),
  });
  const [edit, setEdit] = useState<any>(null);
  const [form] = Form.useForm();

  const open = (r: any) => {
    const v: any = { ...(r || defaults || {}) };
    for (const f of fields) if (f.type === 'date' && v[f.key]) v[f.key] = dayjs(v[f.key]);
    form.setFieldsValue(v);
    setEdit(r || {});
  };
  const save = async () => {
    const v = await form.validateFields();
    for (const f of fields) if (f.type === 'date') v[f.key] = v[f.key] ? dayjs(v[f.key]).format('YYYY-MM-DD') : null;
    const body = { ...(defaults || {}), ...v };
    const ok = edit?.[rowKey]
      ? await run(api.patch(`${path}/${edit[rowKey]}`, body), 'Perubahan disimpan')
      : await run(api.post(path, body), 'Data ditambahkan');
    if (ok) {
      setEdit(null);
      list.reload();
      onChange?.();
    }
  };

  const cols: any[] = fields
    .filter((f) => f.table !== false)
    .map((f) => ({
      title: f.label,
      dataIndex: f.key,
      width: f.width,
      align: ['number', 'money', 'pct'].includes(f.type || '') ? 'right' : undefined,
      render:
        f.render ||
        ((v: any) =>
          f.type === 'money' ? (
            nf(v)
          ) : f.type === 'pct' ? (
            `${nf(v, 1)}%`
          ) : f.type === 'date' ? (
            tgl(v)
          ) : f.type === 'bool' ? (
            v ? (
              'ya'
            ) : (
              '-'
            )
          ) : f.type === 'select' ? (
            <SelectLabel f={f} v={v} />
          ) : (
            (v ?? '-')
          )),
    }));
  cols.push({
    title: '',
    width: 220,
    align: 'right',
    render: (_: any, r: any) => (
      <Space size={14}>
        {extraActions?.(r)}
        {can(menu, 'write') && <a onClick={() => open(r)}>Ubah</a>}
        {archive && can(menu, 'write') && r.active !== undefined && (
          <a
            onClick={async () => {
              await run(
                api.patch(`${path}/${r[rowKey]}`, { active: !r.active }),
                r.active ? 'Diarsipkan' : 'Diaktifkan kembali',
              );
              list.reload();
            }}
          >
            {r.active ? 'Arsipkan' : 'Aktifkan'}
          </a>
        )}
        {can(menu, 'delete') && (
          <Popconfirm
            title="Hapus data ini?"
            okText="Hapus"
            cancelText="Batal"
            onConfirm={async () => {
              await run(api.delete(`${path}/${r[rowKey]}`), 'Data dihapus');
              list.reload();
              onChange?.();
            }}
          >
            <a style={{ color: '#90241D' }}>Hapus</a>
          </Popconfirm>
        )}
      </Space>
    ),
  });

  return (
    <>
      <div className="toolbar">
        {can(menu, 'create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>
            Tambah
          </Button>
        )}
        <span className="spacer" />
        {archive && (
          <Checkbox checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)}>
            Tampilkan yang diarsipkan
          </Checkbox>
        )}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey={rowKey}
          loading={list.loading}
          dataSource={list.data || []}
          columns={cols}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          size="middle"
          rowClassName={(r: any) => (r.active === false ? 'muted' : '')}
        />
      </div>
      <Modal
        open={!!edit}
        title={(edit?.[rowKey] ? 'Ubah ' : 'Tambah ') + (title || 'data')}
        onCancel={() => setEdit(null)}
        onOk={save}
        okText="Simpan"
        cancelText="Batal"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          {fields
            .filter((f) => f.form !== false)
            .map((f) => (
              <Form.Item
                key={f.key}
                name={f.key}
                label={f.label}
                valuePropName={f.type === 'bool' ? 'checked' : 'value'}
                rules={f.required ? [{ required: true, message: `${f.label} wajib diisi` }] : undefined}
              >
                <FieldInput f={f} />
              </Form.Item>
            ))}
        </Form>
      </Modal>
    </>
  );
}
