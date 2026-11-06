import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, getToken, setToken } from './lib';

export interface Me {
  id: number; partnerId: number; name: string; login: string; group: string; groupName: string; email?: string; phone?: string;
  perms: Record<string, { read: boolean; create: boolean; write: boolean; delete: boolean }>;
  canSeeCost: boolean; signatureId?: number | null; reports: string[];
}
interface Ctx { me: Me | null; loading: boolean; login: (l: string, p: string) => Promise<void>; logout: () => void; reload: () => Promise<void>; settings: any }
const AuthCtx = createContext<Ctx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [settings, setSettings] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!getToken()) { setMe(null); setLoading(false); return; }
    try {
      const [m, st] = await Promise.all([api.get('/auth/me'), api.get('/settings')]);
      setMe(m.data); setSettings(st.data);
    } catch { setMe(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const login = async (l: string, p: string) => {
    const r = await api.post('/auth/login', { login: l, password: p });
    setToken(r.data.token); setLoading(true); await reload();
  };
  const logout = () => { setToken(''); setMe(null); };
  return <AuthCtx.Provider value={{ me, loading, login, logout, reload, settings }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);

// hak akses menu di sisi tampilan (server tetap memeriksa ulang)
export function useCan() {
  const { me } = useAuth();
  return (menu: string, action: 'read' | 'create' | 'write' | 'delete' = 'read') => !!me?.perms?.[menu]?.[action];
}
