import axios from 'axios';
import dayjs from 'dayjs';
import 'dayjs/locale/id';
import { message } from 'antd';

dayjs.locale('id');

export const TOKEN_KEY = 'mtpp_token';
export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};
export const setToken = (t: string) => {
  try {
    t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
  } catch {}
};

export const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((c) => {
  const t = getToken();
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});
api.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401 && !String(e.config?.url).includes('/auth/login')) {
      setToken('');
      if (location.pathname !== '/login') location.href = '/login';
    }
    return Promise.reject(e);
  },
);

export const errMsg = (e: any) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || e?.message || 'Terjadi kesalahan';
};
export const showErr = (e: any) => message.error(errMsg(e));

// panggilan dengan pesan sukses/gagal standar
export async function run(p: Promise<{ data: any }>, ok?: string): Promise<any> {
  try {
    const r = await p;
    if (ok) message.success(ok);
    return r.data;
  } catch (e) {
    showErr(e);
    return undefined;
  }
}

// file (PDF/xlsx) dibuka memakai token pada query string
export const fileUrl = (path: string) =>
  `/api${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken())}`;
export const openFile = (path: string) => window.open(fileUrl(path), '_blank');

export const rp = (n: any) => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
export const nf = (n: any, d = 0) =>
  Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
export const qf = (n: any) => nf(n, Number(n) % 1 ? 2 : 0);
export const pct = (n: any) => nf(n, 1) + '%';
export const short = (n: any) => {
  const v = Number(n || 0),
    a = Math.abs(v);
  if (a >= 1e12) return nf(v / 1e12, 2) + ' T';
  if (a >= 1e9) return nf(v / 1e9, 2) + ' M';
  if (a >= 1e6) return nf(v / 1e6, a >= 1e8 ? 0 : 1) + ' jt';
  if (a >= 1e3) return nf(v / 1e3, 0) + ' rb';
  return nf(v);
};
export const tgl = (d: any) => (d ? dayjs(d).format('D MMM YYYY') : '-');
export const tglJam = (d: any) => (d ? dayjs(d).format('D MMM YYYY HH:mm') : '-');
export const today = () => dayjs().format('YYYY-MM-DD');
export const initials = (n: string) =>
  (n || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
    .toUpperCase();
