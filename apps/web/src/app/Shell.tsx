import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, ConfigProvider, Dropdown, Popover, List, Empty, notification } from 'antd';
import { BellOutlined, DownOutlined, LogoutOutlined, UserOutlined, WarningFilled } from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useCan } from './auth';
import { Module, activeItem, activeModule, moduleEntry, visibleModules } from './nav';
import { initials, tgl } from '../shared/lib';
import { useFetch } from '../shared/hooks';

export interface ShellContext {
  setNavHint(h: string | null): void;
}

export function useModules() {
  const { me } = useAuth();
  return visibleModules(me as any) as Module[];
}

export default function Shell() {
  const { me, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const mods = useModules();
  const cur = activeModule(loc.pathname, mods);
  // Petunjuk dari halaman terikat ke rute yang memasangnya, jadi hilang sendiri saat rute berganti.
  const [hint, setHint] = useState<{ path: string; h: string | null }>({ path: '', h: null });
  const setNavHint = useCallback((h: string | null) => setHint({ path: loc.pathname, h }), [loc.pathname]);
  const item = cur ? activeItem(loc.pathname, loc.search, cur, hint.path === loc.pathname ? hint.h : null) : null;
  const acts = useFetch<any[]>('/activities', undefined, [loc.pathname]);
  const due = (acts.data || []).filter((a) => a.overdue || a.dueToday);
  // stok rendah: stok bebas di bawah batas minimum, hanya untuk yang boleh melihat stok
  const can = useCan();
  const low = useFetch<any[]>(can('stok') ? '/stock' : null, { low: 'true' }, [loc.pathname]);
  const lowRows = low.data || [];
  const total = due.length + lowRows.length;
  // pemberitahuan sekali per sesi login, dan lagi bila jumlah produk stok rendah bertambah
  useEffect(() => {
    // pop-up hanya untuk yang dapat menindaklanjuti (gudang atau pengadaan); peran lain cukup lewat lonceng
    if (!lowRows.length || !me || !(can('pengadaan', 'create') || can('gudang', 'write'))) return;
    const key = `mtpp-low-stock-${me.id}`;
    const seen = Number(sessionStorage.getItem(key) || 0);
    if (lowRows.length <= seen) return;
    sessionStorage.setItem(key, String(lowRows.length));
    notification.warning({
      key: 'low-stock',
      message: `Stok rendah: ${lowRows.length} produk`,
      description: (
        <>
          {lowRows
            .slice(0, 3)
            .map((r) => `${r.product} (${r.warehouse})`)
            .join(', ')}
          {lowRows.length > 3 && `, dan ${lowRows.length - 3} lainnya`}. Stok bebas di bawah batas minimum.
        </>
      ),
      placement: 'bottomRight',
      duration: 8,
      btn: (
        <a
          onClick={() => {
            notification.destroy('low-stock');
            nav('/stok?low=true');
          }}
        >
          Lihat stok
        </a>
      ),
    });
  }, [lowRows.length, me]);
  const modMenu = { items: mods.map((m) => ({ key: m.key, label: m.label, onClick: () => nav(moduleEntry(m)) })) };

  const subRef = useRef<HTMLElement>(null);
  const fade = useCallback(() => {
    const el = subRef.current;
    if (!el) return;
    el.dataset.left = String(el.scrollLeft > 2);
    el.dataset.right = String(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);
  useEffect(() => {
    const el = subRef.current;
    if (!el) return;
    el.querySelector('a.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    fade();
    window.addEventListener('resize', fade);
    return () => window.removeEventListener('resize', fade);
  }, [loc.pathname, loc.search, item, cur, fade]);

  return (
    <>
      <div className="appbar">
        <header className="topbar">
          <Link className="brand" to="/">
            <img className="logo" src="/logo.png" alt="Logo MTPP" />
            <span>MTPP Distribusi</span>
          </Link>
          <nav className="nav" aria-label="Modul">
            {mods.map((m) => (
              <Link
                key={m.key}
                to={moduleEntry(m)}
                className={m.key === cur?.key ? 'active' : ''}
                aria-current={m.key === cur?.key ? 'page' : undefined}
              >
                {m.label}
              </Link>
            ))}
          </nav>
          {/* tanpa animasi: daftar modul langsung bisa diklik, tidak tersangkut di tengah gerak saat halaman sibuk */}
          <ConfigProvider theme={{ token: { motion: false } }}>
            <Dropdown menu={modMenu} trigger={['click']}>
              <button type="button" className="mod">
                {cur ? cur.label : 'Menu'}
                <DownOutlined style={{ fontSize: 10, opacity: 0.7 }} />
              </button>
            </Dropdown>
          </ConfigProvider>
          <span className="topspace" />
          <Popover
            placement="bottomRight"
            trigger="click"
            title="Pemberitahuan"
            content={
              <div style={{ width: 320 }}>
                {lowRows.length > 0 && (
                  <List
                    size="small"
                    header={<b>Stok rendah</b>}
                    dataSource={lowRows.slice(0, 5)}
                    footer={
                      <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        <Link to="/stok?low=true">
                          {lowRows.length > 5 ? `Lihat semua ${lowRows.length} produk` : 'Buka Stok per Gudang'}
                        </Link>
                        {can('pengadaan', 'create') && (
                          <Link to="/pengadaan/perlu-pesanan">Isi ulang stok ke principal</Link>
                        )}
                      </span>
                    }
                    renderItem={(r: any) => (
                      <List.Item style={{ cursor: 'pointer' }} onClick={() => nav('/stok?low=true')}>
                        <List.Item.Meta
                          avatar={<WarningFilled style={{ color: '#90241D' }} />}
                          title={r.product}
                          description={
                            <span className="loss">
                              {r.warehouse} · bebas {r.free}
                              {r.minQty != null ? `, minimum ${r.minQty}` : ' (terikat SO melebihi stok)'}
                            </span>
                          }
                        />
                      </List.Item>
                    )}
                  />
                )}
                {due.length ? (
                  <List
                    size="small"
                    header={lowRows.length > 0 ? <b>Aktivitas jatuh tempo</b> : undefined}
                    dataSource={due}
                    renderItem={(a: any) => (
                      <List.Item style={{ cursor: 'pointer' }} onClick={() => nav(linkOf(a.resModel, a.resId))}>
                        <List.Item.Meta
                          title={a.summary}
                          description={
                            <span className={a.overdue ? 'loss' : ''}>
                              {a.resName || ''} · {tgl(a.dateDeadline)}
                            </span>
                          }
                        />
                      </List.Item>
                    )}
                  />
                ) : (
                  !lowRows.length && (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Tidak ada pemberitahuan" />
                  )
                )}
              </div>
            }
          >
            <button type="button" className="bell" aria-label="Pemberitahuan">
              <Badge count={total} size="small">
                <BellOutlined style={{ fontSize: 18 }} />
              </Badge>
            </button>
          </Popover>
          <Dropdown
            menu={{
              items: [
                { key: 'p', icon: <UserOutlined />, label: 'Profil dan kata sandi', onClick: () => nav('/profil') },
                {
                  key: 'o',
                  icon: <LogoutOutlined />,
                  label: 'Keluar',
                  onClick: () => {
                    logout();
                    nav('/login');
                  },
                },
              ],
            }}
            trigger={['click']}
          >
            <button type="button" className="userbox" aria-label="Akun">
              <span className="who">
                {me?.name?.split(' ')[0]} · {me?.groupName}
              </span>
              <span className="avatar">{initials(me?.name || '')}</span>
            </button>
          </Dropdown>
        </header>
        {cur && cur.items.length > 0 && (
          <nav className="subnav" aria-label={`Menu ${cur.label}`} ref={subRef} onScroll={fade}>
            {cur.items.map((i) => (
              <Link
                key={i.to}
                to={i.to}
                className={i === item || (item && i.to === item.to && i.match === item.match) ? 'active' : ''}
                aria-current={item && i.to === item.to && i.match === item.match ? 'page' : undefined}
              >
                {i.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <main className="page">
        <Outlet context={{ setNavHint } satisfies ShellContext} />
      </main>
    </>
  );
}

export const linkOf = (model: string, id: number) =>
  (
    ({
      sales_orders: `/penjualan/${id}`,
      purchase_orders: `/pengadaan/${id}`,
      stock_transfers: `/stok/dok/${id}`,
      journal_entries: `/penagihan/${id}`,
      partners: `/master/pelanggan/${id}`,
      products: `/master/produk/${id}`,
    }) as any
  )[model] || '/';
