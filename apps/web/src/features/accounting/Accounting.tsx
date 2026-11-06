import { useState } from 'react';
import {
  Button,
  Col,
  Collapse,
  DatePicker,
  Descriptions,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Table,
  Upload,
} from 'antd';
import { DeleteOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCan } from '../../app/auth';
import { useFetch, useQueryState } from '../../shared/hooks';
import { api, nf, openFile, rp, run, tgl, today } from '../../shared/lib';
import { PageHead, Pill } from '../../shared/ui';
import Crud from '../../shared/Crud';
import Chatter from '../../shared/Chatter';

const TYPES = [
  { value: 'asset', label: 'Aset' },
  { value: 'liability', label: 'Kewajiban' },
  { value: 'equity', label: 'Ekuitas' },
  { value: 'income', label: 'Pendapatan' },
  { value: 'expense', label: 'Beban' },
];
const typeLabel = (v: string) => TYPES.find((t) => t.value === v)?.label || v;
const money = (x: any) => Number(x || 0).toLocaleString('id-ID');
const parse = (x: any) => Number(String(x).replace(/\./g, '').replace(',', '.')) as any;

function useAccounts() {
  return useFetch<any[]>('/accounts', { active: 'true' });
}
function PeriodPicker({ qs, set }: { qs: any; set: any }) {
  const from = qs.from || dayjs().startOf('month').format('YYYY-MM-DD'),
    to = qs.to || today();
  return (
    <DatePicker.RangePicker
      format="D MMM YYYY"
      allowClear={false}
      value={[dayjs(from), dayjs(to)]}
      onChange={(r) => set({ from: r?.[0]?.format('YYYY-MM-DD'), to: r?.[1]?.format('YYYY-MM-DD') })}
      presets={[
        { label: 'Bulan ini', value: [dayjs().startOf('month'), dayjs()] },
        {
          label: 'Bulan lalu',
          value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')],
        },
        {
          label: 'Kuartal ini',
          value: [
            dayjs()
              .startOf('month')
              .subtract(dayjs().month() % 3, 'month'),
            dayjs(),
          ],
        },
        { label: 'Tahun ini', value: [dayjs().startOf('year'), dayjs()] },
      ]}
    />
  );
}

export function CashPage() {
  const can = useCan();
  const bal = useFetch<any>('/cash/balance');
  const [qs, set] = useQueryState({ journal: 'KAS' });
  const list = useFetch<any[]>('/journal-entries', { journal: qs.journal, from: qs.from, to: qs.to });
  const accs = useAccounts();
  const [v, setV] = useState<any>({ type: 'out', amount: 0, date: today(), memo: '' });
  const submit = async () => {
    if (await run(api.post('/cash', v), 'Transaksi kas dicatat')) {
      setV({ ...v, amount: 0, memo: '' });
      list.reload();
      bal.reload();
    }
  };
  return (
    <>
      <PageHead title="Kas" sub="Penerimaan dan pengeluaran di luar pembayaran invoice dan tagihan principal." />
      <div className="kpis">
        <div className="kpi">
          <div className="label">Saldo kas</div>
          <div className="value">{rp(bal.data?.cash)}</div>
        </div>
        <div className="kpi">
          <div className="label">Saldo bank</div>
          <div className="value">{rp(bal.data?.bank)}</div>
        </div>
      </div>
      {can('akuntansi', 'create') && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="card-title">Catat transaksi kas</h3>
          <Row gutter={12} align="bottom">
            <Col>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                value={v.type}
                onChange={(e) => setV({ ...v, type: e.target.value })}
                options={[
                  { value: 'in', label: 'Penerimaan' },
                  { value: 'out', label: 'Pengeluaran' },
                ]}
              />
            </Col>
            <Col flex="220px">
              <div className="muted">Akun lawan</div>
              <Select
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
                value={v.accountId}
                onChange={(x) => setV({ ...v, accountId: x })}
                options={(accs.data || [])
                  .filter((a) => !['1-1100'].includes(a.code))
                  .map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))}
              />
            </Col>
            <Col flex="170px">
              <div className="muted">Jumlah (Rp)</div>
              <InputNumber
                min={0}
                style={{ width: '100%' }}
                value={v.amount}
                formatter={money}
                parser={parse}
                onChange={(x) => setV({ ...v, amount: x })}
              />
            </Col>
            <Col>
              <div className="muted">Tanggal</div>
              <DatePicker
                value={dayjs(v.date)}
                allowClear={false}
                format="D MMM YYYY"
                onChange={(d) => setV({ ...v, date: d.format('YYYY-MM-DD') })}
              />
            </Col>
            <Col flex="auto">
              <div className="muted">Keterangan</div>
              <Input value={v.memo} onChange={(e) => setV({ ...v, memo: e.target.value })} />
            </Col>
            <Col>
              <Button type="primary" onClick={submit} disabled={!v.accountId || !v.amount || !v.memo}>
                Simpan
              </Button>
            </Col>
          </Row>
        </div>
      )}
      <div className="toolbar">
        <Radio.Group
          optionType="button"
          value={qs.journal}
          onChange={(e) => set({ journal: e.target.value })}
          options={[
            { value: 'KAS', label: 'Jurnal kas' },
            { value: 'BNK', label: 'Jurnal bank' },
          ]}
        />
        <PeriodPicker qs={qs} set={set} />
      </div>
      <JournalTable rows={list.data} loading={list.loading} />
    </>
  );
}

function JournalTable({ rows, loading }: { rows?: any[]; loading?: boolean }) {
  const nav = useNavigate();
  return (
    <div className="card" style={{ padding: 0 }}>
      <Table<any>
        rowKey="id"
        loading={loading}
        dataSource={rows || []}
        pagination={{ pageSize: 30, hideOnSinglePage: true }}
        onRow={(r) => ({ onClick: () => nav(`/akuntansi/jurnal/${r.id}`), className: 'row-link' })}
        columns={[
          { title: 'Tanggal', dataIndex: 'date', render: tgl },
          { title: 'Nomor', dataIndex: 'name', render: (v) => <b>{v}</b> },
          { title: 'Jurnal', dataIndex: 'journal' },
          { title: 'Partner', dataIndex: 'partner', render: (v) => v || '-' },
          { title: 'Referensi', dataIndex: 'ref', render: (v) => v || '-' },
          { title: 'Jumlah', dataIndex: 'amountTotal', align: 'right', render: (v: any) => nf(v) },
          { title: 'Status', dataIndex: 'state', render: (v) => <Pill v={v} kind="je" /> },
        ]}
      />
    </div>
  );
}

export function JournalList() {
  const [qs, set] = useQueryState({});
  const list = useFetch<any[]>('/journal-entries', {
    journal: qs.journal,
    q: qs.q,
    from: qs.from,
    to: qs.to,
    state: qs.state,
  });
  const journals = useFetch<any[]>('/journals');
  const nav = useNavigate();
  const can = useCan();
  return (
    <>
      <PageHead
        title="Jurnal"
        sub="Jurnal dibuat otomatis dari invoice, pembayaran, tagihan principal, dan kas. Jurnal yang diposting hanya dapat dibatalkan dengan jurnal pembalik."
        extra={
          can('akuntansi', 'create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/akuntansi/jurnal/baru')}>
              Jurnal umum
            </Button>
          )
        }
      />
      <div className="toolbar">
        <Input.Search
          allowClear
          placeholder="cari nomor atau referensi"
          style={{ width: 300 }}
          onSearch={(q) => set({ q })}
        />
        <Select
          allowClear
          placeholder="Jurnal"
          style={{ width: 200 }}
          value={qs.journal}
          onChange={(v) => set({ journal: v })}
          options={(journals.data || []).map((j) => ({ value: j.code, label: `${j.code} – ${j.name}` }))}
        />
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 140 }}
          value={qs.state}
          onChange={(v) => set({ state: v })}
          options={[
            { value: 'draft', label: 'Draf' },
            { value: 'posted', label: 'Diposting' },
          ]}
        />
        <PeriodPicker qs={qs} set={set} />
      </div>
      <JournalTable rows={list.data} loading={list.loading} />
    </>
  );
}

export function JournalDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const isNew = id === 'baru';
  const doc = useFetch<any>(isNew ? null : `/journal-entries/${id}`);
  const accs = useAccounts();
  const [draft, setDraft] = useState<any>({
    date: today(),
    ref: '',
    lines: [
      { debit: 0, credit: 0 },
      { debit: 0, credit: 0 },
    ],
  });
  const [rk, setRk] = useState(0);
  if (isNew) {
    const dr = draft.lines.reduce((a: number, l: any) => a + Number(l.debit || 0), 0),
      cr = draft.lines.reduce((a: number, l: any) => a + Number(l.credit || 0), 0);
    const setL = (i: number, p: any) => {
      const ls = [...draft.lines];
      ls[i] = { ...ls[i], ...p };
      setDraft({ ...draft, lines: ls });
    };
    const save = async (post: boolean) => {
      const r = await run(
        api.post('/journal-entries', {
          ...draft,
          post,
          journal: 'MISC',
          lines: draft.lines.filter((l: any) => l.accountId),
        }),
        post ? 'Jurnal diposting' : 'Jurnal draf disimpan',
      );
      if (r) nav(`/akuntansi/jurnal/${r.id}`, { replace: true });
    };
    return (
      <>
        <PageHead crumb={{ label: 'Jurnal', to: '/akuntansi/jurnal' }} title="Jurnal umum baru" />
        <div className="toolbar">
          <Button type="primary" disabled={Math.abs(dr - cr) > 0.009 || !dr} onClick={() => save(true)}>
            Simpan dan posting
          </Button>
          <Button onClick={() => save(false)}>Simpan draf</Button>
          <span className={Math.abs(dr - cr) > 0.009 ? 'loss' : 'gain'}>
            Debit {rp(dr)} · Kredit {rp(cr)} {Math.abs(dr - cr) > 0.009 ? '· belum seimbang' : '· seimbang'}
          </span>
        </div>
        <div className="card">
          <Row gutter={16} style={{ marginBottom: 14 }}>
            <Col>
              <div className="muted">Tanggal</div>
              <DatePicker
                value={dayjs(draft.date)}
                allowClear={false}
                format="D MMM YYYY"
                onChange={(d) => setDraft({ ...draft, date: d.format('YYYY-MM-DD') })}
              />
            </Col>
            <Col flex="auto">
              <div className="muted">Referensi</div>
              <Input
                value={draft.ref}
                onChange={(e) => setDraft({ ...draft, ref: e.target.value })}
                placeholder="mis. Penyesuaian akhir bulan"
              />
            </Col>
          </Row>
          <Table<any>
            size="small"
            rowKey={(_: any, i?: number) => String(i)}
            pagination={false}
            dataSource={draft.lines}
            columns={[
              {
                title: 'Akun',
                key: 'a',
                render: (_, l, i) => (
                  <Select
                    showSearch
                    optionFilterProp="label"
                    style={{ width: 300 }}
                    value={l.accountId}
                    onChange={(v) => setL(i, { accountId: v })}
                    options={(accs.data || []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))}
                  />
                ),
              },
              {
                title: 'Keterangan',
                key: 'n',
                render: (_, l, i) => <Input value={l.name} onChange={(e) => setL(i, { name: e.target.value })} />,
              },
              {
                title: 'Debit',
                key: 'd',
                render: (_, l, i) => (
                  <InputNumber
                    min={0}
                    value={l.debit}
                    formatter={money}
                    parser={parse}
                    onChange={(v) => setL(i, { debit: v, credit: v ? 0 : l.credit })}
                    style={{ width: 150 }}
                  />
                ),
              },
              {
                title: 'Kredit',
                key: 'c',
                render: (_, l, i) => (
                  <InputNumber
                    min={0}
                    value={l.credit}
                    formatter={money}
                    parser={parse}
                    onChange={(v) => setL(i, { credit: v, debit: v ? 0 : l.debit })}
                    style={{ width: 150 }}
                  />
                ),
              },
              {
                title: '',
                key: 'x',
                render: (_, __, i) => (
                  <a onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_: any, j: number) => j !== i) })}>
                    <DeleteOutlined />
                  </a>
                ),
              },
            ]}
          />
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            style={{ marginTop: 10 }}
            onClick={() => setDraft({ ...draft, lines: [...draft.lines, { debit: 0, credit: 0 }] })}
          >
            Tambah baris
          </Button>
        </div>
      </>
    );
  }
  const e = doc.data;
  if (!e) return null;
  const reload = () => {
    doc.reload();
    setRk(rk + 1);
  };
  return (
    <>
      <PageHead crumb={{ label: 'Jurnal', to: '/akuntansi/jurnal' }} title={e.name} />
      <div className="toolbar">
        {e.state === 'draft' && e.moveType === 'entry' && can('akuntansi', 'write') && (
          <Button
            type="primary"
            onClick={async () => {
              if (await run(api.post(`/journal-entries/${id}/post`), 'Jurnal diposting')) reload();
            }}
          >
            Posting
          </Button>
        )}
        {e.state === 'draft' && e.moveType === 'entry' && can('akuntansi', 'delete') && (
          <Button
            danger
            onClick={async () => {
              if (await run(api.delete(`/journal-entries/${id}`), 'Draf dihapus')) nav('/akuntansi/jurnal');
            }}
          >
            Hapus draf
          </Button>
        )}
        {e.state === 'posted' &&
          !e.paymentEntry &&
          !e.reversal &&
          !e.reversedEntryId &&
          e.paymentState !== 'reversed' &&
          can('akuntansi', 'write') && (
            <Button
              onClick={() =>
                Modal.confirm({
                  title: 'Buat jurnal pembalik?',
                  okText: 'Batalkan (jurnal pembalik)',
                  cancelText: 'Tidak',
                  onOk: async () => {
                    const r = await run(api.post(`/journal-entries/${id}/reverse`), 'Jurnal pembalik dibuat');
                    if (r) nav(`/akuntansi/jurnal/${r.id}`);
                  },
                })
              }
            >
              Batalkan (jurnal pembalik)
            </Button>
          )}
        {e.moveType !== 'entry' && (
          <Link to={`${e.moveType.startsWith('in_') ? '/pengadaan/tagihan' : '/penagihan'}/${e.id}`}>
            Buka dokumen {e.moveType.startsWith('in_') ? 'tagihan' : 'invoice'}
          </Link>
        )}
        <Pill v={e.state} kind="je" />
      </div>
      <div className="card">
        <Descriptions size="small" column={{ xs: 1, md: 3 }}>
          <Descriptions.Item label="Tanggal">{tgl(e.date)}</Descriptions.Item>
          <Descriptions.Item label="Jurnal">{e.journal?.name}</Descriptions.Item>
          <Descriptions.Item label="Partner">{e.partner?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="Referensi">{e.ref || '-'}</Descriptions.Item>
          {e.reversal && (
            <Descriptions.Item label="Dibalik oleh">
              <Link to={`/akuntansi/jurnal/${e.reversal.id}`}>{e.reversal.name}</Link>
            </Descriptions.Item>
          )}
          {e.reversedEntryId && (
            <Descriptions.Item label="Membalik">
              <Link to={`/akuntansi/jurnal/${e.reversedEntryId}`}>jurnal asal</Link>
            </Descriptions.Item>
          )}
        </Descriptions>
        <Table<any>
          style={{ marginTop: 12 }}
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
            { title: 'Keterangan', dataIndex: 'name', render: (v) => v || '-' },
            { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => (Number(v) ? nf(v) : '') },
            { title: 'Kredit', dataIndex: 'credit', align: 'right', render: (v) => (Number(v) ? nf(v) : '') },
          ]}
        />
      </div>
      <Chatter model="journal_entries" id={+id!} name={e.name} reloadKey={rk} />
    </>
  );
}

export function AccountsPage() {
  return (
    <>
      <PageHead title="Bagan Akun" sub="Setiap akun memiliki kode, nama, dan jenis akun." />
      <Crud
        path="/accounts"
        menu="akuntansi"
        title="akun"
        fields={[
          { key: 'code', label: 'Kode', required: true, width: 120 },
          { key: 'name', label: 'Nama akun', required: true },
          { key: 'accountType', label: 'Jenis', type: 'select', required: true, options: TYPES, render: typeLabel },
        ]}
      />
    </>
  );
}

export function LedgerPage() {
  const [qs, set] = useQueryState({});
  const accs = useAccounts();
  const data = useFetch<any>('/ledger', { from: qs.from, to: qs.to, accountId: qs.accountId });
  return (
    <>
      <PageHead
        title="Buku Besar"
        sub="Saldo awal, mutasi, dan saldo akhir setiap akun."
        extra={
          <Button
            onClick={() =>
              openFile(`/reports/buku_besar/export?format=xlsx&from=${data.data?.from}&to=${data.data?.to}`)
            }
          >
            Ekspor
          </Button>
        }
      />
      <div className="toolbar">
        <PeriodPicker qs={qs} set={set} />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Semua akun"
          style={{ width: 300 }}
          value={qs.accountId ? +qs.accountId : undefined}
          onChange={(v) => set({ accountId: v ? String(v) : undefined })}
          options={(accs.data || []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))}
        />
      </div>
      <Collapse
        defaultActiveKey={qs.accountId ? [String(qs.accountId)] : []}
        items={(data.data?.accounts || []).map((a: any) => ({
          key: String(a.account.id),
          label: (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <b style={{ minWidth: 260 }}>
                {a.account.code} {a.account.name}
              </b>
              <span className="muted">Awal {nf(a.opening)}</span>
              <span className="muted">Debit {nf(a.debit)}</span>
              <span className="muted">Kredit {nf(a.credit)}</span>
              <b>Akhir {nf(a.closing)}</b>
            </div>
          ),
          children: (
            <Table<any>
              size="small"
              rowKey={(_: any, i?: number) => String(i)}
              pagination={false}
              dataSource={a.lines}
              columns={[
                { title: 'Tanggal', dataIndex: 'date', render: tgl },
                {
                  title: 'Nomor',
                  dataIndex: 'name',
                  render: (v, r) => <Link to={`/akuntansi/jurnal/${r.moveId}`}>{v}</Link>,
                },
                { title: 'Partner', dataIndex: 'partner', render: (v) => v || '-' },
                { title: 'Keterangan', key: 'k', render: (_, r) => r.label || r.ref || '-' },
                { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => (Number(v) ? nf(v) : '') },
                { title: 'Kredit', dataIndex: 'credit', align: 'right', render: (v) => (Number(v) ? nf(v) : '') },
                { title: 'Saldo', dataIndex: 'balance', align: 'right', render: (v: any) => nf(v) },
              ]}
            />
          ),
        }))}
      />
      {!data.loading && !data.data?.accounts?.length && (
        <div className="card muted">Tidak ada mutasi pada periode ini.</div>
      )}
    </>
  );
}

export function TrialBalancePage() {
  const [qs, set] = useQueryState({});
  const data = useFetch<any>('/trial-balance', { from: qs.from, to: qs.to });
  const d = data.data;
  return (
    <>
      <PageHead
        title="Neraca Saldo"
        extra={
          <>
            <Button onClick={() => openFile(`/reports/buku_besar/export?format=xlsx&from=${d?.from}&to=${d?.to}`)}>
              Ekspor spreadsheet
            </Button>
            <Button onClick={() => openFile(`/reports/buku_besar/export?format=pdf&from=${d?.from}&to=${d?.to}`)}>
              Ekspor PDF
            </Button>
          </>
        }
      />
      <div className="toolbar">
        <PeriodPicker qs={qs} set={set} />
        {d && (
          <span className={Math.abs(d.totalDebit - d.totalCredit) < 0.01 ? 'pill green' : 'pill red'}>
            {Math.abs(d.totalDebit - d.totalCredit) < 0.01 ? 'Seimbang' : 'Tidak seimbang'}
          </span>
        )}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <Table<any>
          rowKey="id"
          loading={data.loading}
          dataSource={(d?.rows || []).filter((r: any) => r.opening || r.debit || r.credit)}
          pagination={false}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>
                <b>Total</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">
                <b>{nf(d?.totalDebit)}</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right">
                <b>{nf(d?.totalCredit)}</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} />
            </Table.Summary.Row>
          )}
          columns={[
            { title: 'Kode', dataIndex: 'code' },
            {
              title: 'Akun',
              dataIndex: 'name',
              render: (v, r) => (
                <Link to={`/akuntansi/buku-besar?accountId=${r.id}&from=${d.from}&to=${d.to}`}>{v}</Link>
              ),
            },
            { title: 'Jenis', dataIndex: 'type', render: typeLabel },
            { title: 'Saldo awal', dataIndex: 'opening', align: 'right', render: (v: any) => nf(v) },
            { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v: any) => nf(v) },
            { title: 'Kredit', dataIndex: 'credit', align: 'right', render: (v: any) => nf(v) },
            { title: 'Saldo akhir', dataIndex: 'closing', align: 'right', render: (v) => <b>{nf(v)}</b> },
          ]}
        />
      </div>
    </>
  );
}

export function BankReconPage() {
  const [qs, set] = useQueryState({ reconciled: 'false' });
  const list = useFetch<any[]>('/bank-statements', { reconciled: qs.reconciled === 'all' ? undefined : qs.reconciled });
  const can = useCan();
  const [imp, setImp] = useState<any>(null);
  const [cand, setCand] = useState<any>(null);
  const openCand = async (l: any) => {
    const c = await run(api.get(`/bank-statements/${l.id}/candidates`));
    if (c) setCand({ line: l, list: c });
  };
  return (
    <>
      <PageHead
        title="Rekonsiliasi Bank"
        sub="Mutasi rekening dari bank dicocokkan dengan pembayaran yang tercatat. Baris yang belum cocok tetap terbuka."
        extra={
          can('akuntansi', 'create') && (
            <Button type="primary" icon={<UploadOutlined />} onClick={() => setImp({ dateFormat: 'DD/MM/YYYY' })}>
              Impor mutasi (CSV)
            </Button>
          )
        }
      />
      <div className="toolbar">
        <Radio.Group
          optionType="button"
          value={qs.reconciled}
          onChange={(e) => set({ reconciled: e.target.value })}
          options={[
            { value: 'false', label: 'Belum cocok' },
            { value: 'true', label: 'Sudah cocok' },
            { value: 'all', label: 'Semua' },
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
            { title: 'Tanggal', dataIndex: 'date', render: tgl },
            { title: 'Keterangan bank', dataIndex: 'paymentRef' },
            {
              title: 'Jumlah',
              dataIndex: 'amount',
              align: 'right',
              render: (v) => <span className={Number(v) < 0 ? 'loss' : 'gain'}>{nf(v)}</span>,
            },
            {
              title: 'Pembayaran',
              key: 'p',
              render: (_, r) =>
                r.isReconciled ? (
                  <>
                    {r.payment} <span className="muted">{r.partner}</span>
                  </>
                ) : (
                  <span className="pill amber">belum cocok</span>
                ),
            },
            {
              title: '',
              key: 'a',
              align: 'right',
              render: (_, r) =>
                can('akuntansi', 'write') &&
                (r.isReconciled ? (
                  <a
                    onClick={async () => {
                      await run(api.post(`/bank-statements/${r.id}/unmatch`), 'Pencocokan dibatalkan');
                      list.reload();
                    }}
                  >
                    Batalkan cocok
                  </a>
                ) : (
                  <a onClick={() => openCand(r)}>Cocokkan</a>
                )),
            },
          ]}
        />
      </div>
      {imp && (
        <Modal
          open
          title="Impor mutasi rekening"
          okText="Impor"
          cancelText="Batal"
          onCancel={() => setImp(null)}
          onOk={async () => {
            if (!imp.file) return;
            const fd = new FormData();
            fd.append('file', imp.file);
            for (const k of ['dateCol', 'refCol', 'amountCol', 'debitCol', 'creditCol', 'dateFormat'])
              if (imp[k]) fd.append(k, imp[k]);
            const r = await run(api.post('/bank-statements/import', fd));
            if (r) {
              Modal.info({
                title: 'Hasil impor',
                content: (
                  <>
                    {r.imported} baris diimpor, {r.matched} cocok otomatis.
                    {r.errors?.length ? (
                      <div className="loss">
                        {r.errors.length} baris gagal:{' '}
                        {r.errors.map((e: any) => `baris ${e.row} (${e.reason})`).join(', ')}
                      </div>
                    ) : null}
                  </>
                ),
              });
              setImp(null);
              list.reload();
            }
          }}
        >
          <p className="muted">
            Kolom ditebak dari judul (Tanggal, Keterangan, Jumlah atau Debit/Kredit). Isi nama kolom jika judul file
            berbeda.
          </p>
          <Upload
            beforeUpload={(f) => {
              setImp({ ...imp, file: f });
              return false;
            }}
            maxCount={1}
            accept=".csv"
          >
            <Button icon={<UploadOutlined />}>Pilih file CSV</Button>
          </Upload>
          <Row gutter={8} style={{ marginTop: 12 }}>
            {[
              ['dateCol', 'Kolom tanggal'],
              ['refCol', 'Kolom keterangan'],
              ['amountCol', 'Kolom jumlah'],
              ['debitCol', 'Kolom debit'],
              ['creditCol', 'Kolom kredit'],
            ].map(([k, l]) => (
              <Col span={12} key={k} style={{ marginBottom: 8 }}>
                <div className="muted">{l}</div>
                <Input
                  value={imp[k]}
                  onChange={(e) => setImp({ ...imp, [k]: e.target.value })}
                  placeholder="otomatis"
                />
              </Col>
            ))}
            <Col span={12}>
              <div className="muted">Format tanggal</div>
              <Select
                style={{ width: '100%' }}
                value={imp.dateFormat}
                onChange={(v) => setImp({ ...imp, dateFormat: v })}
                options={['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((v) => ({ value: v, label: v }))}
              />
            </Col>
          </Row>
        </Modal>
      )}
      {cand && (
        <Modal
          open
          title={`Cocokkan ${rp(cand.line.amount)} – ${cand.line.paymentRef}`}
          footer={null}
          onCancel={() => setCand(null)}
        >
          {cand.list.length ? (
            <Table<any>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={cand.list}
              columns={[
                { title: 'Pembayaran', dataIndex: 'name' },
                { title: 'Tanggal', dataIndex: 'date', render: tgl },
                { title: 'Partner', dataIndex: 'partner' },
                { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: (v: any) => nf(v) },
                {
                  title: '',
                  key: 'a',
                  render: (_, p) => (
                    <Button
                      size="small"
                      type="primary"
                      onClick={async () => {
                        await run(
                          api.post(`/bank-statements/${cand.line.id}/match`, { paymentId: p.id }),
                          'Mutasi dicocokkan',
                        );
                        setCand(null);
                        list.reload();
                      }}
                    >
                      Pilih
                    </Button>
                  ),
                },
              ]}
            />
          ) : (
            <p className="muted">
              Tidak ada pembayaran bank dengan nilai yang sama dalam rentang 3 hari. Periksa selisihnya atau catat
              transaksi kas/bank terlebih dahulu.
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
