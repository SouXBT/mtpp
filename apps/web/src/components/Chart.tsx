import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { nf, short } from '../lib';

const PALETTE = ['#90241D', '#F2C500', '#C9756F', '#625B55', '#5E1510', '#F9E88A', '#E3B0AB', '#B8AFA8'];
const AGING = ['#F7D531', '#E3B0AB', '#C9756F', '#A83F36', '#731C16'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const tickX = (v: any) => { const m = String(v).match(/^(\d{4})-(\d{2})$/); return m ? `${MONTHS[+m[2] - 1]} ${m[1].slice(2)}` : String(v).length > 18 ? String(v).slice(0, 16) + '…' : v; };

export interface ChartSpec { type: 'line' | 'bar' | 'stacked' | 'pie'; x: string; series: { key: string; title: string }[]; data: any[]; title?: string }

export default function Chart({ spec: raw, height = 300, money = true, kind }: { spec: ChartSpec; height?: number; money?: boolean; kind?: 'auto' | 'bar' | 'line' | 'pie' | 'stacked' }) {
  // jenis grafik dapat diganti pengguna (subbab 3.4); 'auto' memakai jenis bawaan laporan
  const spec: ChartSpec = raw && kind && kind !== 'auto' ? { ...raw, type: kind } : raw;
  if (!spec?.data?.length) return <div className="muted" style={{ height, display: 'grid', placeItems: 'center' }}>Belum ada data pada periode ini</div>;
  const fmt = (v: any) => (money ? short(v) : nf(v));
  const tip = <Tooltip formatter={(v: any) => (money ? 'Rp ' + nf(v) : nf(v))} labelFormatter={tickX} />;
  const isAging = spec.x === 'bucket';
  if (spec.type === 'pie') {
    const k = spec.series[0].key;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={spec.data} dataKey={k} nameKey={spec.x} innerRadius="45%" outerRadius="75%" paddingAngle={2} label={(e: any) => `${e[spec.x]}: ${fmt(e[k])}`}>
            {spec.data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>{tip}
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (spec.type === 'line' && (spec.data.length > 14 || (kind && kind !== 'auto'))) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={spec.data} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#ECE8E4" /><XAxis dataKey={spec.x} tickFormatter={tickX} tickLine={false} axisLine={false} /><YAxis tickFormatter={fmt} tickLine={false} axisLine={false} width={64} />
          {tip}{spec.series.map((s, i) => <Line key={s.key} dataKey={s.key} name={s.title} stroke={PALETTE[i]} strokeWidth={2.5} dot={spec.data.length < 15} />)}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  const stacked = spec.type === 'stacked';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={spec.data} margin={{ top: 24, right: 16, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="#ECE8E4" />
        <XAxis dataKey={spec.x} tickFormatter={tickX} tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 12, fill: '#625B55' }} />
        <YAxis tickFormatter={fmt} tickLine={false} axisLine={false} width={64} tick={{ fontSize: 12, fill: '#625B55' }} />
        {tip}
        {spec.series.length > 1 && <Legend />}
        {spec.series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.title} stackId={stacked ? 'a' : undefined} fill={PALETTE[i]} radius={stacked ? undefined : [4, 4, 0, 0]} maxBarSize={72}>
            {isAging && spec.data.map((_, j) => <Cell key={j} fill={AGING[j % AGING.length]} />)}
            {!stacked && spec.series.length === 1 && <LabelList dataKey={s.key} position="top" formatter={fmt} style={{ fontSize: 12, fontWeight: 600, fill: '#2E2A27' }} />}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
