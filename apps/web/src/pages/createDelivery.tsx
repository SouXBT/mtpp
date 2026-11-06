import { useCreateFromSale } from './useCreateFromSale';

const endpoint = (id: number) => `/transfers/from-sale/${id}`;

// Membuat surat jalan dari sales order. Satu dokumen langsung dibuka; lebih dari satu (gudang berbeda) diberi pesan.
export function useCreateDelivery(onDone: () => void): { create(soId: number): void; isCreating(soId: number): boolean } {
  const h = useCreateFromSale({ endpoint, route: (id) => `/stok/dok/${id}`, manyMessage: (n) => `${n} surat jalan dibuat`, busyMessage: 'Surat jalan untuk sales order ini sedang dibuat', onDone });
  return { create: (id) => { if (!h.isCreating(id)) void h.create(id); }, isCreating: h.isCreating };
}
