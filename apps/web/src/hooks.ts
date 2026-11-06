import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, showErr } from './lib';

// ambil data dari API, muat ulang saat path atau parameter berubah
export function useFetch<T = any>(path: string | null, params?: any, deps: any[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(!!path);
  const key = JSON.stringify(params || {});
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const r = await api.get(path, { params });
      if (n === seq.current) setData(r.data);
    } catch (e) {
      if (n === seq.current) showErr(e);
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, ...deps]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, loading, reload, setData };
}

// filter daftar disimpan di URL sehingga bisa dibagikan dan dikembalikan
export function useQueryState(defaults: Record<string, string> = {}) {
  const [sp, setSp] = useSearchParams();
  const state: Record<string, string> = { ...defaults };
  sp.forEach((v, k) => (state[k] = v));
  const set = (patch: Record<string, string | undefined | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') n.delete(k);
      else n.set(k, v);
    }
    setSp(n, { replace: true });
  };
  return [state, set] as const;
}
