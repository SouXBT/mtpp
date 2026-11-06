
// gudang principal: satu gudang, satu lokasi stok, jenis penerimaan dan surat jalan
export async function createWarehouse(tx: any, partnerId: number, name: string) {
  const code = 'G' + String(partnerId).padStart(3, '0');
  const w = await tx.warehouses.create({ data: { partnerId, name, code } });
  await tx.locations.create({ data: { warehouseId: w.id, name: 'Stok', completeName: `${code}/Stok`, usage: 'internal' } });
  await tx.transferTypes.createMany({ data: [
    { warehouseId: w.id, name: 'Penerimaan Barang', code: 'incoming', sequenceCode: 'RCV' },
    { warehouseId: w.id, name: 'Surat Jalan', code: 'outgoing', sequenceCode: 'DO' },
  ] });
  return w;
}

