import { nowDate } from '../../shared/clock';
import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { fail, must, round2 } from '../../shared/util';
import { Prisma } from '@prisma/client';

const sql = Prisma.sql;

// Stok fisik, stok terikat, dan stok bebas per gudang principal (E.c)
// - stok fisik  = stock_balances.quantity pada lokasi gudang
// - stok terikat = jumlah (qty pesan - qty terkirim) baris SO berstatus Sales Order pada gudang tersebut
// - stok bebas  = stok fisik - stok terikat
@Injectable()
export class StockService {
  constructor(@Inject(DB) private db: Db) {}

  async internalLocation(warehouseId: number, tx: any = this.db) {
    const [l] = await tx.locations.findMany({
      where: { AND: [{ warehouseId: warehouseId }, { usage: 'internal' }] },
      take: 1,
    });
    if (!l) fail('Lokasi gudang tidak ditemukan');
    return l;
  }
  // lokasi Barang Rusak per gudang untuk retur pelanggan; tidak dihitung sebagai stok fisik atau stok bebas
  async damagedLocation(warehouseId: number, tx: any = this.db) {
    const [l] = await tx.locations.findMany({ where: { AND: [{ warehouseId }, { usage: 'damaged' }] }, take: 1 });
    if (l) return l;
    const w = must(await tx.warehouses.findFirst({ where: { id: warehouseId } }), 'Gudang');
    return tx.locations.create({
      data: { warehouseId, name: 'Barang Rusak', completeName: `${w.code}/Barang Rusak`, usage: 'damaged' },
    });
  }
  async virtualLocation(usage: 'supplier' | 'customer' | 'inventory', tx: any = this.db) {
    const [l] = await tx.locations.findMany({ where: { AND: [{ usage: usage }] }, take: 1 });
    if (!l) fail('Lokasi bantu belum dibuat');
    return l;
  }

  async physical(productId: number, warehouseId: number, tx: any = this.db) {
    const loc = await this.internalLocation(warehouseId, tx);
    const [b] = await tx.stockBalances.findMany({ where: { AND: [{ productId: productId }, { locationId: loc.id }] } });
    return Number(b?.quantity || 0);
  }

  async reserved(productId: number, warehouseId: number, excludeOrderId?: number, tx: any = this.db) {
    const lines = await tx.salesOrderLines.findMany({
      where: {
        productId,
        mtppWarehouseId: warehouseId,
        mtppIsDropship: false,
        order: { state: 'sale', ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}) },
      },
      select: { productUomQty: true, qtyDelivered: true },
    });
    const r = {
      q: lines.reduce((a: number, l: any) => a + Math.max(Number(l.productUomQty) - Number(l.qtyDelivered), 0), 0),
    };
    return Number(r?.q || 0);
  }

  // stok terikat SO lain yang dikonfirmasi lebih dulu; SO yang lebih dulu dikonfirmasi berhak atas stok lebih dulu
  async reservedAhead(productId: number, warehouseId: number, orderId: number, tx: any = this.db) {
    const iso = (d: any) => (!d ? '' : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
    const me = await tx.salesOrders.findFirst({ where: { id: orderId }, select: { id: true, dateConfirm: true } });
    const lines = await tx.salesOrderLines.findMany({
      where: {
        productId,
        mtppWarehouseId: warehouseId,
        mtppIsDropship: false,
        order: { state: 'sale', id: { not: orderId } },
      },
      select: { productUomQty: true, qtyDelivered: true, order: { select: { id: true, dateConfirm: true } } },
    });
    const ahead = lines.filter(
      (l: any) =>
        iso(l.order.dateConfirm) < iso(me?.dateConfirm) ||
        (iso(l.order.dateConfirm) === iso(me?.dateConfirm) && l.order.id < orderId),
    );
    return ahead.reduce((a: number, l: any) => a + Math.max(Number(l.productUomQty) - Number(l.qtyDelivered), 0), 0);
  }

  // pindahkan stok antar lokasi; stok gudang tidak boleh minus
  async applyMove(tx: any, productId: number, fromLoc: any, toLoc: any, qty: number) {
    if (qty <= 0) return;
    for (const [loc, sign] of [
      [fromLoc, -1],
      [toLoc, 1],
    ] as const) {
      if (loc.usage !== 'internal' && loc.usage !== 'damaged') continue;
      await tx.$queryRaw(
        sql`select id from stock_balances where product_id = ${productId} and location_id = ${loc.id} for update`,
      );
      const b = await tx.stockBalances.findFirst({ where: { productId, locationId: loc.id } });
      const newQ = round2(Number(b?.quantity || 0) + sign * qty);
      if (newQ < 0) fail('Stok fisik tidak cukup di ' + loc.completeName);
      if (b) await tx.stockBalances.updateMany({ where: { id: b.id }, data: { quantity: newQ, inDate: nowDate() } });
      else await tx.stockBalances.create({ data: { productId, locationId: loc.id, quantity: newQ } });
    }
  }

  async overview(q: { warehouseId?: number; categoryId?: number; low?: boolean; q?: string }) {
    const whs = await this.db.warehouses.findMany({
      where: { active: true },
      include: { partner: true, locations: true },
    });
    const prods: any[] = (
      await this.db.products.findMany({
        where: { active: true },
        include: { template: { include: { category: { select: { name: true } }, uom: { select: { name: true } } } } },
      })
    ).map(({ template: t, ...p }) => ({
      id: p.id,
      code: p.defaultCode,
      name: t.name,
      categoryId: t.categoryId,
      category: t.category?.name ?? null,
      uom: t.uom.name,
      supplierId: t.mainSupplierId,
      type: t.type,
    }));
    const bal = await this.db.stockBalances.findMany({});
    const rules = await this.db.stockRules.findMany({});
    const res: any[] = await this.db.$queryRaw(
      sql`select l.product_id as "productId", l.mtpp_warehouse_id as w, sum(greatest(l.product_uom_qty - l.qty_delivered, 0))::float as q from sales_order_lines l join sales_orders o on o.id = l.order_id where o.state = 'sale' and l.mtpp_is_dropship = false group by l.product_id, l.mtpp_warehouse_id`,
    );
    const rows: any[] = [];
    for (const w of whs) {
      if (q.warehouseId && w.id !== +q.warehouseId) continue;
      const loc = w.locations.find((l) => l.usage === 'internal');
      const bad = w.locations.find((l) => l.usage === 'damaged');
      for (const p of prods) {
        if (p.type === 'service') continue;
        const physical = Number(bal.find((b) => b.productId === p.id && b.locationId === loc?.id)?.quantity || 0);
        const damaged = Number(bal.find((b) => b.productId === p.id && b.locationId === bad?.id)?.quantity || 0);
        const reserved = Number(res.find((r) => r.productId === p.id && r.w === w.id)?.q || 0);
        const rule = rules.find((r) => r.productId === p.id && r.warehouseId === w.id);
        if (!physical && !damaged && !reserved && !rule && p.supplierId !== w.partnerId) continue;
        const free = round2(physical - reserved);
        const min = rule ? Number(rule.minQty) : null;
        const low = min !== null && free < min;
        if (q.low && !low) continue;
        if (q.categoryId && p.categoryId !== +q.categoryId) continue;
        if (q.q && !`${p.code} ${p.name}`.toLowerCase().includes(String(q.q).toLowerCase())) continue;
        rows.push({
          key: `${w.id}-${p.id}`,
          productId: p.id,
          code: p.code,
          product: p.name,
          category: p.category,
          uom: p.uom,
          warehouseId: w.id,
          warehouse: w.name,
          principal: w.partner?.name,
          physical,
          reserved,
          free,
          damaged,
          minQty: min,
          ruleId: rule?.id || null,
          status: low ? 'stok rendah' : free < 0 ? 'kurang' : 'aman',
        });
      }
    }
    return rows;
  }

  async lowStockCount() {
    return (await this.overview({ low: true })).length;
  }
}
