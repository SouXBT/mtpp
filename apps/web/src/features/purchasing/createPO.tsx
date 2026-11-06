import { Modal } from 'antd';
import { isBusy, useCreateFromSale } from '../sales/useCreateFromSale';

const endpoint = (id: number) => `/purchase-orders/from-sale/${id}`;
export const isCreatingPO = (id: number) => isBusy(endpoint(id));

export type POSource = { id: number; isNewCustomer: boolean; paidAmount: number };

// Membuat PO Principal dari sales order. Pelanggan baru yang belum membayar diberi peringatan dulu.
// onDone dipanggil setelah PO lebih dari satu dibuat atau setelah gagal, supaya daftar diperbarui.
export function useCreatePO(onDone: () => void): (so: POSource) => void {
  const h = useCreateFromSale({
    endpoint,
    route: (id) => `/pengadaan/${id}`,
    manyMessage: (n) => `${n} PO Principal dibuat`,
    busyMessage: 'PO Principal untuk sales order ini sedang dibuat',
    onDone,
  });

  return (so) => {
    if (h.isCreating(so.id)) return;
    if (so.isNewCustomer && !Number(so.paidAmount)) {
      Modal.confirm({
        title: 'Pelanggan baru belum membayar',
        content: 'Sales order ini belum menerima pembayaran. Tetap buat PO Principal?',
        okText: 'Tetap buat',
        cancelText: 'Batal',
        onOk: () => h.create(so.id),
      });
    } else void h.create(so.id);
  };
}
