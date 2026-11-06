import { useRef, useState } from 'react';
import { message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api, run } from '../lib';

// Permintaan yang sedang berjalan, dikunci per alamat endpoint sehingga PO dan surat jalan untuk
// sales order yang sama tidak saling memblokir. Dipakai untuk menonaktifkan tombol dan menahan klik ganda.
const sedangDibuat = new Set<string>();
export const isBusy = (key: string) => sedangDibuat.has(key);

export type CreateFromSaleConfig = {
  endpoint: (soId: number) => string; // POST yang membuat dokumen dari sales order
  route: (docId: number) => string; // tujuan bila hanya satu dokumen terbentuk
  manyMessage: (n: number) => string; // pesan bila lebih dari satu dokumen terbentuk
  busyMessage: string; // peringatan bila permintaan yang sama sedang berjalan
  onDone: () => void; // dipanggil setelah dokumen lebih dari satu dibuat atau setelah gagal
};

export function useCreateFromSale(cfg: CreateFromSaleConfig): {
  create(soId: number): Promise<void>;
  isCreating(soId: number): boolean;
} {
  const nav = useNavigate();
  const [, render] = useState(0);
  const conf = useRef(cfg);
  conf.current = cfg;

  const create = async (id: number) => {
    const c = conf.current,
      key = c.endpoint(id);
    if (sedangDibuat.has(key)) return void message.warning(c.busyMessage);
    sedangDibuat.add(key);
    render((n) => n + 1);
    try {
      const r = await run(api.post(key));
      if (!r) return c.onDone();
      if (r.length === 1) return nav(c.route(r[0].id));
      message.success(c.manyMessage(r.length));
      c.onDone();
    } finally {
      sedangDibuat.delete(key);
      render((n) => n + 1);
    }
  };

  return { create, isCreating: (id) => sedangDibuat.has(cfg.endpoint(id)) };
}
