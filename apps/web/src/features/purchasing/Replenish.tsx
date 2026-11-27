import { useState } from 'react';
import { Button, Modal } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useCan } from '../../app/auth';
import { useFetch } from '../../shared/hooks';
import { api, qf, run } from '../../shared/lib';

// Isi ulang stok minimum (seperti reordering rule Odoo): produk yang stok bebasnya ditambah barang PO yang belum datang
// di bawah batas minimum dipesan sampai 2x minimum, satu PO per principal. Dipakai di Perlu PO Principal dan Stok.
export function ReplenishButton({ type = 'default' }: { type?: 'default' | 'primary' }) {
  const can = useCan();
  const nav = useNavigate();
  const allowed = can('pengadaan', 'create');
  const plan = useFetch<any[]>(allowed ? '/purchase-orders/replenish/plan' : null);
  const [busy, setBusy] = useState(false);
  if (!allowed) return null;
  const n = plan.data?.length || 0;
  const open = () =>
    Modal.confirm({
      title: 'Buat PO isi ulang stok minimum?',
      width: 560,
      content: (
        <>
          <p>Dipesan sampai 2× batas minimum, satu PO per principal:</p>
          <ul style={{ paddingLeft: 18, maxHeight: 260, overflow: 'auto' }}>
            {(plan.data || []).map((x) => (
              <li key={`${x.productId}-${x.warehouseId}`}>
                {x.product} ({x.warehouse}): {qf(x.qty)} · bebas {qf(x.free)}, dalam perjalanan {qf(x.incoming)},
                minimum {qf(x.minQty)}
              </li>
            ))}
          </ul>
        </>
      ),
      okText: 'Buat PO',
      cancelText: 'Batal',
      onOk: async () => {
        setBusy(true);
        const r = await run(api.post('/purchase-orders/replenish'), 'PO isi ulang stok dibuat');
        setBusy(false);
        plan.reload();
        if (r?.length === 1) nav(`/pengadaan/${r[0].id}`);
        else if (r?.length) nav('/pengadaan?state=draft');
      },
    });
  return (
    <Button
      type={type}
      loading={busy}
      disabled={!n}
      title={n ? undefined : 'Semua stok di atas batas minimum atau sudah dipesan'}
      onClick={open}
    >
      Isi Ulang Stok Minimum{n ? ` (${n} produk)` : ''}
    </Button>
  );
}
