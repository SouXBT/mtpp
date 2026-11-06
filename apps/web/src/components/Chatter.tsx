import { useState } from 'react';
import { Button, Checkbox, DatePicker, Empty, Input, List, Select, Space, Tabs, Upload } from 'antd';
import { DeleteOutlined, PaperClipOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, nf, openFile, run, tgl, tglJam } from '../lib';
import { useFetch } from '../hooks';

// Catatan internal, riwayat perubahan, lampiran, dan aktivitas pada setiap dokumen
export default function Chatter({
  model,
  id,
  name,
  reloadKey,
}: {
  model: string;
  id: number;
  name?: string;
  reloadKey?: any;
}) {
  const msgs = useFetch<any[]>(`/records/${model}/${id}/messages`, undefined, [reloadKey]);
  const atts = useFetch<any[]>(`/records/${model}/${id}/attachments`, undefined, [reloadKey]);
  const acts = useFetch<any[]>('/activities', { resModel: model, resId: id });
  const [note, setNote] = useState('');
  const [act, setAct] = useState<any>({
    activityType: 'telepon',
    summary: '',
    dateDeadline: dayjs().add(1, 'day').format('YYYY-MM-DD'),
  });

  const send = async () => {
    if (!note.trim()) return;
    if (await run(api.post(`/records/${model}/${id}/messages`, { body: note }))) {
      setNote('');
      msgs.reload();
    }
  };
  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    if (await run(api.post(`/records/${model}/${id}/attachments`, fd), 'Lampiran diunggah')) {
      atts.reload();
      msgs.reload();
    }
    return false;
  };
  const addAct = async () => {
    if (
      await run(api.post('/activities', { ...act, resModel: model, resId: id, resName: name }), 'Aktivitas dijadwalkan')
    ) {
      setAct({ ...act, summary: '' });
      acts.reload();
      msgs.reload();
    }
  };

  const fmtVal = (c: any, side: 'old' | 'new') => {
    const f = c[side === 'old' ? 'oldValueFloat' : 'newValueFloat'];
    const t = c[side === 'old' ? 'oldValueChar' : 'newValueChar'];
    return f !== null && f !== undefined ? nf(f, Number(f) % 1 ? 2 : 0) : (t ?? '-');
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <Tabs
        items={[
          {
            key: 'log',
            label: 'Catatan dan Riwayat',
            children: (
              <>
                <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
                  <Input.TextArea
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    placeholder="Tulis catatan internal (tidak dikirim ke pelanggan/principal)..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Button type="primary" onClick={send}>
                    Kirim catatan
                  </Button>
                </Space.Compact>
                <List
                  loading={msgs.loading}
                  dataSource={msgs.data || []}
                  locale={{ emptyText: 'Belum ada riwayat' }}
                  renderItem={(m: any) => (
                    <div className="chatter-item">
                      <div>
                        <b>{m.author}</b> <span className="muted">· {tglJam(m.date)}</span>{' '}
                        {m.messageType === 'note' && (
                          <span className="pill blue" style={{ marginLeft: 6, padding: '1px 8px' }}>
                            catatan
                          </span>
                        )}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                      {m.changes?.map((c: any) => (
                        <div key={c.id} className="muted" style={{ fontSize: 13 }}>
                          {c.field}: <s>{fmtVal(c, 'old')}</s> → <b style={{ color: '#2E2A27' }}>{fmtVal(c, 'new')}</b>
                        </div>
                      ))}
                    </div>
                  )}
                />
              </>
            ),
          },
          {
            key: 'att',
            label: `Lampiran (${atts.data?.length || 0})`,
            children: (
              <>
                <Upload beforeUpload={upload} showUploadList={false}>
                  <Button icon={<UploadOutlined />}>Unggah file</Button>
                </Upload>
                <List
                  style={{ marginTop: 12 }}
                  dataSource={atts.data || []}
                  locale={{ emptyText: 'Belum ada lampiran' }}
                  renderItem={(a: any) => (
                    <List.Item
                      actions={[
                        <a key="d" onClick={() => openFile(`/attachments/${a.id}/download`)}>
                          Unduh
                        </a>,
                        <a
                          key="x"
                          onClick={async () => {
                            await run(api.delete(`/attachments/${a.id}`), 'Lampiran dihapus');
                            atts.reload();
                          }}
                        >
                          <DeleteOutlined />
                        </a>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={<PaperClipOutlined />}
                        title={a.name}
                        description={`${nf(a.fileSize / 1024, 0)} KB · ${tglJam(a.createDate)}`}
                      />
                    </List.Item>
                  )}
                />
              </>
            ),
          },
          {
            key: 'act',
            label: `Aktivitas (${(acts.data || []).filter((a) => !a.done).length})`,
            children: (
              <>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Select
                    value={act.activityType}
                    style={{ width: 150 }}
                    onChange={(v) => setAct({ ...act, activityType: v })}
                    options={['telepon', 'email', 'rapat', 'tindak lanjut', 'penagihan'].map((v) => ({
                      value: v,
                      label: v,
                    }))}
                  />
                  <Input
                    placeholder="Ringkasan aktivitas"
                    style={{ width: 300 }}
                    value={act.summary}
                    onChange={(e) => setAct({ ...act, summary: e.target.value })}
                  />
                  <DatePicker
                    value={dayjs(act.dateDeadline)}
                    format="D MMM YYYY"
                    allowClear={false}
                    onChange={(d) => setAct({ ...act, dateDeadline: d.format('YYYY-MM-DD') })}
                  />
                  <Button type="primary" onClick={addAct} disabled={!act.summary}>
                    Jadwalkan
                  </Button>
                </Space>
                {(acts.data || []).length ? (
                  <List
                    dataSource={acts.data}
                    renderItem={(a: any) => (
                      <List.Item
                        actions={[
                          <a
                            key="x"
                            onClick={async () => {
                              await run(api.delete(`/activities/${a.id}`));
                              acts.reload();
                            }}
                          >
                            <DeleteOutlined />
                          </a>,
                        ]}
                      >
                        <Checkbox
                          checked={a.done}
                          onChange={async (e) => {
                            await run(api.patch(`/activities/${a.id}`, { done: e.target.checked }));
                            acts.reload();
                            msgs.reload();
                          }}
                          style={{ marginRight: 12 }}
                        />
                        <List.Item.Meta
                          title={
                            <span style={{ textDecoration: a.done ? 'line-through' : undefined }}>{a.summary}</span>
                          }
                          description={
                            <span className={a.overdue ? 'loss' : ''}>
                              {a.activityType} · {a.user} · jatuh tempo {tgl(a.dateDeadline)}
                              {a.overdue ? ' (terlambat)' : ''}
                            </span>
                          }
                        />
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Belum ada aktivitas" />
                )}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
