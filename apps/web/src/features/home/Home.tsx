import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Spin, Table, Upload, message } from 'antd';
import { WarningFilled } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { useFetch } from '../../shared/hooks';
import { api, errMsg, nf, rp, run, short, tgl } from '../../shared/lib';
import Chart from '../../shared/Chart';
import { PageHead, Pill } from '../../shared/ui';
import { linkOf } from '../../app/Shell';

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    api
      .get('/auth/config')
      .then((r) => setDemo(!!r.data.demo))
      .catch(() => setDemo(false));
  }, []);
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand" style={{ marginBottom: 6 }}>
          <img className="logo" src="/logo.png" alt="Logo MTPP" />
          <span>MTPP Distribusi</span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Sistem Distribusi PT Mentari Timur Prima Perkasa
        </p>
        {err && <Alert type="error" message={err} showIcon style={{ marginBottom: 16 }} />}
        <Form
          layout="vertical"
          onFinish={async (v) => {
            setBusy(true);
            setErr('');
            try {
              await login(v.login, v.password);
              nav('/');
            } catch (e) {
              setErr(errMsg(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item name="login" label="Email" rules={[{ required: true, message: 'Isi email' }]}>
            <Input size="large" autoFocus placeholder="nama@mtpp.co.id" />
          </Form.Item>
          <Form.Item name="password" label="Kata sandi" rules={[{ required: true, message: 'Isi kata sandi' }]}>
            <Input.Password size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={busy}>
            Masuk
          </Button>
        </Form>
        {demo && (
          <p className="note">
            Akun contoh: pimpinan@, admin@, sales@, operasional@, finance@mtpp.co.id · kata sandi mtpp12345
          </p>
        )}
      </div>
    </div>
  );
}

const cell = (v: any) => {
  if (v && typeof v === 'object') {
    if ('money' in v) return <span className="num">{rp(v.money)}</span>;
    if ('tag' in v)
      return (
        <Pill
          v={v.tag}
          kind={
            v.kind ??
            (['draft', 'sent', 'sale', 'done', 'cancel'].includes(v.tag)
              ? 'so'
              : ['waiting', 'assigned'].includes(v.tag)
                ? 'tr'
                : undefined)
          }
        />
      );
    if ('date' in v) return <span className={v.late ? 'loss' : ''}>{tgl(v.date)}</span>;
    if ('text' in v) return <Link to={v.link}>{v.text}</Link>;
  }
  return typeof v === 'number' ? nf(v) : (v ?? '-');
};

export function Dashboard() {
  const { data, loading } = useFetch<any>('/dashboard');
  const nav = useNavigate();
  if (loading && !data) return <Spin />;
  const d = data || {};
  const periode = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  return (
    <>
      <PageHead
        title={`Beranda ${d.groupName || ''}`}
        extra={
          <span className="pill gray" style={{ padding: '8px 16px', fontWeight: 500 }}>
            Periode: {periode}
          </span>
        }
      />
      {d.lowStock > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Link to="/stok?low=true">
            <span className="pill red">
              <WarningFilled /> Stok rendah: {d.lowStock} produk
            </span>
          </Link>
        </div>
      )}
      <div className="kpis">
        {(d.kpis || []).map((k: any) => (
          <div
            key={k.key}
            className={`kpi ${k.link ? 'link' : ''} ${k.tone || ''}`}
            onClick={() => k.link && nav(k.link)}
          >
            <div className="label">{k.label}</div>
            <div className="value">{k.money ? 'Rp ' + short(k.value) : nf(k.value)}</div>
            <div className="hint">{k.hint || ' '}</div>
          </div>
        ))}
      </div>
      {!!d.charts?.length && (
        <div
          className="grid"
          style={{
            gridTemplateColumns: d.charts.length > 1 ? 'minmax(0,1.6fr) minmax(0,1fr)' : '1fr',
            marginBottom: 16,
          }}
        >
          {d.charts.map((c: any) => (
            <div className="card" key={c.key}>
              <h3 className="card-title">{c.title}</h3>
              <Chart spec={c} money={c.key !== 'stock'} />
            </div>
          ))}
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}>
        {(d.lists || []).map((l: any) => (
          <div className="card" key={l.key} style={{ padding: '18px 20px' }}>
            <h3 className="card-title">{l.title}</h3>
            <Table<any>
              size="small"
              pagination={false}
              rowKey={(_: any, i?: number) => String(i)}
              dataSource={l.rows}
              locale={{ emptyText: 'Tidak ada data' }}
              columns={l.columns.map((c: string, i: number) => ({
                title: c,
                key: i,
                render: (_: any, r: any) => cell(r[i]),
              }))}
            />
          </div>
        ))}
        <div className="card" style={{ padding: '18px 20px' }}>
          <h3 className="card-title">Aktivitas saya</h3>
          {(d.activities || []).length ? (
            (d.activities || []).map((a: any) => (
              <div key={a.id} className="chatter-item">
                <Link to={linkOf(a.res_model, a.res_id)}>{a.summary}</Link>
                <div className={a.overdue ? 'loss' : 'muted'} style={{ fontSize: 13 }}>
                  {a.res_name} · {tgl(a.date_deadline)}
                  {a.overdue ? ' · terlambat' : ''}
                </div>
              </div>
            ))
          ) : (
            <div className="muted">Tidak ada aktivitas terbuka.</div>
          )}
        </div>
      </div>
    </>
  );
}

export function Profile() {
  const { me, reload } = useAuth();
  // gambar tanda tangan diambil dengan header Authorization, token tidak pernah masuk URL
  const [sigUrl, setSigUrl] = useState('');
  useEffect(() => {
    if (!me?.signatureId) {
      setSigUrl('');
      return;
    }
    let url = '';
    let live = true;
    api
      .get(`/attachments/${me.signatureId}/download`, { responseType: 'blob' })
      .then((r) => {
        if (!live) return;
        url = URL.createObjectURL(r.data);
        setSigUrl(url);
      })
      .catch(() => setSigUrl(''));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [me?.signatureId]);
  const [pf] = Form.useForm();
  const [pw] = Form.useForm();
  return (
    <>
      <PageHead title="Profil dan kata sandi" sub={`${me?.groupName} · ${me?.login}`} />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
        <div className="card">
          <h3 className="card-title">Data profil</h3>
          <Form
            form={pf}
            layout="vertical"
            initialValues={{ name: me?.name, email: me?.email, phone: me?.phone }}
            onFinish={async (v) => {
              if (await run(api.patch('/auth/profile', v), 'Profil disimpan')) reload();
            }}
          >
            <Form.Item name="name" label="Nama" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="email" label="Email">
              <Input />
            </Form.Item>
            <Form.Item name="phone" label="Telepon">
              <Input />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              Simpan
            </Button>
          </Form>
        </div>
        <div className="card">
          <h3 className="card-title">Ganti kata sandi</h3>
          <Form
            form={pw}
            layout="vertical"
            onFinish={async (v) => {
              if (await run(api.post('/auth/password', v), 'Kata sandi diganti')) pw.resetFields();
            }}
          >
            <Form.Item name="old" label="Kata sandi lama" rules={[{ required: true }]}>
              <Input.Password />
            </Form.Item>
            <Form.Item
              name="password"
              label="Kata sandi baru (minimal 8 karakter)"
              rules={[{ required: true, min: 8 }]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item name="confirm" label="Ulangi kata sandi baru" rules={[{ required: true }]}>
              <Input.Password />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              Ganti kata sandi
            </Button>
          </Form>
        </div>
        <div className="card">
          <h3 className="card-title">Tanda tangan</h3>
          <p className="muted">Gambar tanda tangan tercetak di atas nama penerbit pada dokumen.</p>
          {sigUrl && (
            <img
              alt="tanda tangan"
              src={sigUrl}
              style={{ maxHeight: 90, display: 'block', marginBottom: 12, border: '1px dashed #ECE8E4', padding: 8 }}
            />
          )}
          <Upload
            accept="image/png,image/jpeg"
            showUploadList={false}
            beforeUpload={async (f) => {
              const fd = new FormData();
              fd.append('file', f);
              if (await run(api.post('/auth/signature', fd), 'Tanda tangan disimpan')) reload();
              else message.error('Gagal');
              return false;
            }}
          >
            <Button>Unggah tanda tangan</Button>
          </Upload>
        </div>
      </div>
    </>
  );
}
