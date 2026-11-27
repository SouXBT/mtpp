import { nowDate } from '../../shared/clock';
import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { AuthUser, dataRule } from '../../shared/auth';
import { NumberingService } from '../../shared/numbering.service';
import { ChatterService } from '../../shared/chatter.service';
import { PdfService } from '../../shared/pdf.service';
import { graduateCustomer, refreshPurchase, refreshSale, salePayments } from '../../shared/status';
import { fail, must, idr, num, round2, tglIndo, today } from '../../shared/util';
import { collectionSettings, pastGrace } from '../../shared/collection';
import { lockRow } from '../../shared/lock';
import { StockService } from './stock.service';
import { Prisma } from '@prisma/client';

const sql = Prisma.sql;

export const TR_STATE: Record<string, string> = {
  draft: 'Draf',
  waiting: 'Menunggu',
  assigned: 'Siap Kirim',
  done: 'Selesai',
  cancel: 'Batal',
};
const MODEL = 'stock_transfers';

// Penerimaan barang (E.b, E.e), surat jalan dan pengiriman bertahap (E.d), dropship (E.f), jadwal pengiriman (E.h)
@Injectable()
export class TransfersService {
  constructor(
    @Inject(DB) private db: Db,
    private stock: StockService,
    private numbering: NumberingService,
    private chatter: ChatterService,
    private pdf: PdfService,
  ) {}

  async list(q: any, u?: AuthUser) {
    const w: any[] = [];
    const rule = u && dataRule(u, 'stock_transfers');
    if (rule) w.push(rule);
    if (q.from) w.push({ scheduledDate: { gte: q.from } });
    if (q.to) w.push({ scheduledDate: { lte: q.to } });
    if (q.partnerId) w.push({ partnerId: +q.partnerId });
    if (q.kind) w.push({ pickingType: { code: q.kind === 'outgoing' ? 'outgoing' : 'incoming' } });
    if (q.state) w.push({ state: { in: String(q.state).split(',') } });
    if (q.saleId) w.push({ saleId: +q.saleId });
    if (q.purchaseId) w.push({ purchaseId: +q.purchaseId });
    if (q.late === 'true')
      w.push({ AND: [{ scheduledDate: { lt: today() } }, { state: { notIn: ['done', 'cancel'] } }] });
    if (q.q)
      w.push({
        OR: [
          { name: { contains: `${q.q}`, mode: 'insensitive' } },
          { origin: { contains: `${q.q}`, mode: 'insensitive' } },
          { partner: { name: { contains: `${q.q}`, mode: 'insensitive' } } },
        ],
      });
    const rows: any[] = (
      await this.db.stockTransfers.findMany({
        where: w.length ? { AND: w } : undefined,
        include: {
          pickingType: { select: { code: true, warehouse: { select: { name: true } } } },
          partner: { select: { name: true } },
        },
        orderBy: q.sort === 'date' ? { scheduledDate: 'asc' } : { id: 'desc' },
        take: 500,
      })
    ).map(({ pickingType, partner, ...t }) => ({
      t,
      code: pickingType.code,
      partner: partner?.name ?? null,
      wh: pickingType.warehouse?.name ?? null,
    }));
    const t = today();
    const locs = await this.db.locations.findMany({});
    return rows.map((r) => ({
      ...r.t,
      kind: r.code,
      partner: r.partner,
      warehouse: r.wh,
      stateLabel: TR_STATE[r.t.state],
      dropship: locs.find((l) => l.id === r.t.locationId)?.usage === 'supplier' && r.code === 'outgoing',
      late: !!r.t.scheduledDate && r.t.scheduledDate < t && !['done', 'cancel'].includes(r.t.state),
    }));
  }

  async get(id: number) {
    const t = must(
      await this.db.stockTransfers.findFirst({
        where: { id: id },
        include: {
          pickingType: true,
          partner: true,
          sale: { include: { partner: true } },
          purchase: true,
          location: true,
          locationDest: true,
        },
      }),
      'Dokumen',
    );
    const moves: any[] = (
      await this.db.stockMoves.findMany({
        where: { pickingId: id },
        include: { product: { include: { template: { include: { uom: { select: { name: true } } } } } } },
        orderBy: { id: 'asc' },
      })
    ).map(({ product, ...m }) => ({
      m,
      code: product.defaultCode,
      name: product.template.name,
      uom: product.template.uom.name,
    }));
    const whId = t.pickingType.warehouseId;
    const ms = [];
    for (const r of moves)
      ms.push({
        ...r.m,
        code: r.code,
        product: r.name,
        uom: r.uom,
        available: whId && t.location.usage === 'internal' ? await this.stock.physical(r.m.productId, whId) : null,
      });
    const dropship = t.location.usage === 'supplier' && t.pickingType.code === 'outgoing';
    let payBlock = null;
    if (t.pickingType.code === 'outgoing' && t.sale) payBlock = await this.paymentBlock(t.saleId, dropship);
    const backorders = await this.db.stockTransfers.findMany({
      select: { id: true, name: true, state: true },
      where: { backorderId: id },
    });
    const parent = t.backorderId
      ? await this.db.stockTransfers.findFirst({ where: { id: t.backorderId }, select: { name: true } })
      : null;
    return {
      ...t,
      kind: t.pickingType.code,
      dropship,
      stateLabel: TR_STATE[t.state],
      moves: ms,
      paymentBlock: payBlock,
      backorders,
      backorderName: parent?.name ?? null,
      late: !!t.scheduledDate && t.scheduledDate < today() && !['done', 'cancel'].includes(t.state),
    };
  }

  // Surat jalan ditolak untuk pelanggan baru yang belum lunas, dan untuk pelanggan dengan tagihan lewat masa tenggang
  // kecuali Pimpinan memberi izin kirim pada SO ini. Dropship yang sudah dikirim principal hanya terkena aturan pelanggan baru.
  async paymentBlock(saleId: number, dropship = false) {
    const o = await this.db.salesOrders.findFirst({ where: { id: saleId }, include: { partner: true } });
    if (!o) return null;
    if (o.partner.mtppIsNewCustomer) {
      // semua uang yang diterima: uang muka dan pembayaran atas invoice SO ini (sama dengan detail SO)
      const paid = (await salePayments(this.db, saleId)).amount;
      if (paid < Number(o.amountTotal) - 0.5)
        return `Pelanggan baru: sales order baru dibayar Rp ${idr(paid)} dari Rp ${idr(Number(o.amountTotal))}. Surat jalan hanya dapat diterbitkan setelah lunas.`;
    }
    if (dropship || o.mtppReleaseDate) return null;
    const cfg = await collectionSettings(this.db);
    if (!cfg.blockDelivery) return null;
    const late = await pastGrace(this.db, o.partnerId, today());
    if (!late.length) return null;
    return `Pelanggan memiliki tagihan lewat masa tenggang (${late.map((x) => x.name).join(', ')}). Surat jalan ditahan sampai tagihan dilunasi atau Pimpinan memberi izin kirim pada ${o.name}.`;
  }

  private async pendingInOpen(saleLineIds: number[]) {
    if (!saleLineIds.length) return [];
    return this.db.$queryRaw(
      sql`select m.sale_line_id as id, sum(m.product_uom_qty)::float as q from stock_moves m join stock_transfers t on t.id = m.picking_id where m.sale_line_id in (${Prisma.join(saleLineIds)}) and t.state in ('draft', 'waiting', 'assigned') group by m.sale_line_id`,
    ) as Promise<any[]>;
  }

  // surat jalan hanya boleh memakai stok bebas: stok fisik dikurangi stok yang terikat untuk SO lain
  private async assertFreeStock(t: any, tx: any = this.db) {
    if (t.kind !== 'outgoing' || t.dropship || !t.saleId) return;
    const wid = t.pickingType.warehouseId;
    for (const m of t.moves) {
      const q = Number(m.quantity);
      if (q <= 0) continue;
      const phys = await this.stock.physical(m.productId, wid, tx);
      const other = await this.stock.reservedAhead(m.productId, wid, t.saleId, tx);
      const free = round2(Math.max(0, phys - other));
      if (q > free)
        fail(`Stok bebas ${m.product} tidak cukup (bebas ${num(free)}, terikat untuk SO lain ${num(other)})`);
    }
  }

  async createDeliveries(u: AuthUser, saleId: number) {
    const o = must(await this.db.salesOrders.findFirst({ where: { id: saleId } }), 'Sales order');
    // satu pembuatan surat jalan per SO pada satu waktu: permintaan berikutnya menunggu lalu menghitung ulang sisa
    return this.db.$transaction(async (lt) => {
      await lockRow(lt, 'sales_orders', saleId);
      return this.createDeliveriesLocked(u, saleId, o);
    });
  }

  private async createDeliveriesLocked(u: AuthUser, saleId: number, o: any) {
    if (o.state !== 'sale') fail('Surat jalan hanya dibuat dari sales order yang sudah dikonfirmasi');
    const block = await this.paymentBlock(saleId);
    if (block) fail(block);
    const lines = (await this.db.salesOrderLines.findMany({ where: { orderId: saleId } })).filter(
      (l) => !l.mtppIsDropship,
    );
    const open = await this.pendingInOpen(lines.map((l) => l.id));
    const todo = lines
      .map((l) => ({
        l,
        q: round2(Number(l.productUomQty) - Number(l.qtyDelivered) - Number(open.find((x) => x.id === l.id)?.q || 0)),
      }))
      .filter((x) => x.q > 0);
    if (!todo.length) fail('Tidak ada sisa barang yang perlu dikirim');
    const byWh = new Map<number, typeof todo>();
    for (const x of todo) {
      const wh = x.l.mtppWarehouseId;
      if (!wh) return fail(`Gudang asal untuk ${x.l.name} belum ditentukan`);
      byWh.set(wh, [...(byWh.get(wh) || []), x]);
    }
    const created: any[] = [];
    await this.db.$transaction(async (tx) => {
      const cust = await this.stock.virtualLocation('customer', tx);
      for (const [wid, items] of byWh) {
        const [type] = await tx.transferTypes.findMany({
          where: { AND: [{ warehouseId: wid }, { code: 'outgoing' }] },
        });
        const loc = await this.stock.internalLocation(wid, tx);
        const name = await this.numbering.next(tx, 'DO', today());
        const t = await tx.stockTransfers.create({
          data: {
            name,
            pickingTypeId: type.id,
            partnerId: o.partnerShippingId || o.partnerId,
            saleId,
            locationId: loc.id,
            locationDestId: cust.id,
            origin: o.name,
            scheduledDate: o.commitmentDate || today(),
            state: 'draft',
            createUid: u.id,
          },
        });
        for (const x of items) {
          const phys = await this.stock.physical(x.l.productId, wid, tx);
          const other = await this.stock.reservedAhead(x.l.productId, wid, saleId, tx);
          await tx.stockMoves.create({
            data: {
              pickingId: t.id,
              productId: x.l.productId,
              locationId: loc.id,
              locationDestId: cust.id,
              saleLineId: x.l.id,
              productUomQty: x.q,
              quantity: Math.max(0, Math.min(x.q, phys - other)),
            },
          });
        }
        await this.chatter.log(MODEL, t.id, u.id, `Surat jalan dibuat dari ${o.name}`, [], tx);
        created.push(t);
      }
    });
    return created;
  }

  // dipanggil saat PO dikonfirmasi: penerimaan barang otomatis ke gudang principal
  async createReceipt(tx: any, po: any, lines: any[], uid: number, suffix = 1, backorderOf?: number) {
    const [type] = await tx.transferTypes.findMany({
      where: { AND: [{ warehouseId: po.warehouseId }, { code: 'incoming' }] },
    });
    const loc = await this.stock.internalLocation(po.warehouseId, tx);
    const sup = await this.stock.virtualLocation('supplier', tx);
    let name = `${po.name}-T${suffix}`;
    while (await tx.stockTransfers.findFirst({ where: { name: name } })) name = `${po.name}-T${++suffix}`;
    const t = await tx.stockTransfers.create({
      data: {
        name,
        pickingTypeId: type.id,
        partnerId: po.partnerId,
        purchaseId: po.id,
        locationId: sup.id,
        locationDestId: loc.id,
        origin: po.name,
        scheduledDate: po.datePlanned || today(),
        state: 'waiting',
        backorderId: backorderOf,
        createUid: uid,
      },
    });
    for (const l of lines)
      await tx.stockMoves.create({
        data: {
          pickingId: t.id,
          productId: l.productId,
          locationId: sup.id,
          locationDestId: loc.id,
          purchaseLineId: l.purchaseLineId ?? l.id,
          productUomQty: l.qty,
          quantity: l.qty,
        },
      });
    return t;
  }

  // dropship: satu surat jalan yang sekaligus mencatat penerimaan dari principal
  async createDropship(tx: any, po: any, lines: any[], uid: number, backorderOf?: number) {
    const [type] = await tx.transferTypes.findMany({
      where: { AND: [{ warehouseId: po.warehouseId }, { code: 'outgoing' }] },
    });
    const sup = await this.stock.virtualLocation('supplier', tx);
    const cust = await this.stock.virtualLocation('customer', tx);
    const so = po.saleId ? await tx.salesOrders.findFirst({ where: { id: po.saleId } }) : null;
    const name = await this.numbering.next(tx, 'DO', today());
    const t = await tx.stockTransfers.create({
      data: {
        name,
        pickingTypeId: type.id,
        partnerId: po.destAddressId || so?.partnerShippingId || so?.partnerId,
        saleId: po.saleId,
        purchaseId: po.id,
        locationId: sup.id,
        locationDestId: cust.id,
        origin: `${so?.name || ''} / ${po.name}`,
        scheduledDate: po.datePlanned || today(),
        state: 'waiting',
        backorderId: backorderOf,
        note: 'Dropship: dikirim langsung dari principal',
        createUid: uid,
      },
    });
    for (const l of lines)
      await tx.stockMoves.create({
        data: {
          pickingId: t.id,
          productId: l.productId,
          locationId: sup.id,
          locationDestId: cust.id,
          purchaseLineId: l.purchaseLineId ?? l.id,
          saleLineId: l.saleLineId ?? l.mtppSaleLineId,
          productUomQty: l.qty,
          quantity: l.qty,
        },
      });
    return t;
  }

  async update(u: AuthUser, id: number, b: any) {
    const t = must(await this.db.stockTransfers.findFirst({ where: { id: id } }), 'Dokumen');
    if (['done', 'cancel'].includes(t.state)) fail('Dokumen yang sudah selesai atau batal tidak dapat diubah');
    await this.db.$transaction(async (tx) => {
      const head: any = {};
      for (const k of ['scheduledDate', 'note', 'partnerId']) if (b[k] !== undefined) head[k] = b[k] || null;
      if (Object.keys(head).length) {
        const ch = this.chatter.diff(t, head, [{ key: 'scheduledDate', label: 'Tanggal rencana' }]);
        await tx.stockTransfers.updateMany({
          where: { id: id },
          data: { ...head, writeUid: u.id, writeDate: nowDate() },
        });
        if (ch.length) await this.chatter.log(MODEL, id, u.id, 'Data diubah', ch, tx);
      }
      for (const m of b.moves || []) {
        if (!Number.isFinite(Number(m.quantity))) fail('Kuantitas harus berupa angka');
        if (Number(m.quantity) < 0) fail('Kuantitas tidak boleh minus');
        await tx.stockMoves.updateMany({
          where: { AND: [{ id: m.id }, { pickingId: id }] },
          data: { quantity: Number(m.quantity) },
        });
      }
      if (b.warehouseId) {
        // surat jalan tetap di gudang tempat stoknya terikat
        const linked = await tx.stockMoves.findMany({
          where: { pickingId: id },
          include: { saleLine: { select: { mtppWarehouseId: true } } },
        });
        if (linked.some((m) => m.saleLine && m.saleLine.mtppWarehouseId !== +b.warehouseId))
          fail('Gudang surat jalan harus sama dengan gudang stok yang terikat');
        const [type] = await tx.transferTypes.findMany({
          where: { AND: [{ warehouseId: +b.warehouseId }, { code: 'outgoing' }] },
        });
        const loc = await this.stock.internalLocation(+b.warehouseId, tx);
        await tx.stockTransfers.updateMany({ where: { id: id }, data: { pickingTypeId: type.id, locationId: loc.id } });
        await tx.stockMoves.updateMany({ where: { pickingId: id }, data: { locationId: loc.id } });
      }
    });
    return this.get(id);
  }

  async ready(u: AuthUser, id: number) {
    const t: any = await this.get(id);
    if (t.kind !== 'outgoing' || t.state !== 'draft')
      fail('Hanya surat jalan berstatus Draf yang dapat dijadikan Siap Kirim');
    if (t.paymentBlock) fail(t.paymentBlock);
    await this.assertFreeStock(t);
    await this.db.stockTransfers.updateMany({ where: { id: id }, data: { state: 'assigned' } });
    await this.chatter.log(MODEL, id, u.id, 'Surat jalan siap kirim', [
      { field: 'Status', old: 'Draf', new: 'Siap Kirim' },
    ]);
    return this.get(id);
  }

  async validate(u: AuthUser, id: number, b: any = {}) {
    const head = must(await this.db.stockTransfers.findFirst({ where: { id: id } }), 'Dokumen');
    // kuantitas isian diperiksa dulu dan baru disimpan bersama validasi, sehingga validasi yang gagal
    // tidak meninggalkan kuantitas yang sudah berubah
    const edits = new Map<number, number>();
    for (const m of b.moves || []) {
      const q = Number(m.quantity);
      if (!Number.isFinite(q)) fail('Kuantitas harus berupa angka');
      if (q < 0) fail('Kuantitas tidak boleh minus');
      edits.set(Number(m.id), q);
    }
    await this.db.$transaction(async (tx) => {
      // dikunci berurutan (SO lalu dokumen): validasi bersamaan, atau validasi bersamaan dengan pembatalan SO,
      // menunggu dan membaca keadaan terbaru sehingga stok tidak terpotong dua kali
      if (head.saleId) await lockRow(tx, 'sales_orders', head.saleId);
      await lockRow(tx, 'stock_transfers', id);
      const t: any = await this.get(id);
      if (['done', 'cancel'].includes(t.state)) fail('Dokumen sudah selesai atau batal');
      if (t.saleId) {
        const so = await tx.salesOrders.findFirst({ where: { id: t.saleId } });
        if (so?.state === 'cancel') fail('Sales order sudah dibatalkan');
      }
      for (const [mid] of edits)
        if (!t.moves.some((m: any) => m.id === mid)) fail('Baris barang tidak ditemukan pada dokumen ini');
      t.moves = t.moves.map((m: any) => (edits.has(m.id) ? { ...m, quantity: edits.get(m.id) } : m));
      if (t.kind === 'outgoing' && t.paymentBlock) fail(t.paymentBlock);
      if (!t.moves.some((m: any) => Number(m.quantity) > 0)) fail('Isi kuantitas yang diterima atau dikirim');
      for (const m of t.moves)
        if (Number(m.quantity) > Number(m.productUomQty))
          fail(`Kuantitas ${m.product} melebihi pesanan (${num(m.productUomQty)})`);
      for (const [mid, q] of edits)
        await tx.stockMoves.updateMany({ where: { AND: [{ id: mid }, { pickingId: id }] }, data: { quantity: q } });
      await this.assertFreeStock(t, tx);
      const rest: any[] = [];
      for (const m of t.moves) {
        const q = Number(m.quantity);
        const from = await tx.locations.findFirst({ where: { id: m.locationId } });
        const to = await tx.locations.findFirst({ where: { id: m.locationDestId } });
        await this.stock.applyMove(tx, m.productId, from, to, q);
        await tx.stockMoves.updateMany({ where: { id: m.id }, data: { state: 'done', date: nowDate() } });
        if (m.purchaseLineId)
          await tx.purchaseOrderLines.updateMany({
            where: { id: m.purchaseLineId },
            data: { qtyReceived: { increment: q } },
          });
        if (m.saleLineId)
          await tx.salesOrderLines.updateMany({
            where: { id: m.saleLineId },
            data: { qtyDelivered: { increment: q } },
          });
        if (q < Number(m.productUomQty))
          rest.push({
            productId: m.productId,
            qty: round2(Number(m.productUomQty) - q),
            purchaseLineId: m.purchaseLineId,
            saleLineId: m.saleLineId,
            locationId: m.locationId,
            locationDestId: m.locationDestId,
          });
      }
      await tx.stockTransfers.updateMany({
        where: { id: id },
        data: { state: 'done', dateDone: nowDate(), writeUid: u.id },
      });
      let msg =
        t.kind === 'incoming'
          ? 'Penerimaan barang divalidasi, stok bertambah'
          : t.dropship
            ? 'Dropship diterima pelanggan'
            : 'Surat jalan divalidasi, stok berkurang';
      if (rest.length) {
        // kuantitas yang kurang menjadi penerimaan susulan / surat jalan susulan
        if (t.kind === 'incoming') {
          const po = await tx.purchaseOrders.findFirst({ where: { id: t.purchaseId } });
          const bo = await this.createReceipt(tx, po, rest, u.id, 2, id);
          msg += `; sisa dibuat sebagai penerimaan susulan ${bo.name}`;
        } else {
          const name = await this.numbering.next(tx, 'DO', today());
          const bo = await tx.stockTransfers.create({
            data: {
              name,
              pickingTypeId: t.pickingTypeId,
              partnerId: t.partnerId,
              saleId: t.saleId,
              purchaseId: t.purchaseId,
              locationId: t.locationId,
              locationDestId: t.locationDestId,
              origin: t.origin,
              scheduledDate: t.scheduledDate,
              state: t.dropship ? 'waiting' : 'draft',
              backorderId: id,
              note: t.note,
              createUid: u.id,
            },
          });
          for (const r of rest)
            await tx.stockMoves.create({
              data: {
                pickingId: bo.id,
                productId: r.productId,
                locationId: r.locationId,
                locationDestId: r.locationDestId,
                saleLineId: r.saleLineId,
                purchaseLineId: r.purchaseLineId,
                productUomQty: r.qty,
                quantity: t.dropship ? r.qty : 0,
              },
            });
          msg += `; sisa dibuat sebagai surat jalan susulan ${bo.name}`;
        }
      }
      await this.chatter.log(MODEL, id, u.id, msg, [{ field: 'Status', old: TR_STATE[t.state], new: 'Selesai' }], tx);
      if (t.purchaseId) await refreshPurchase(tx, t.purchaseId);
      if (t.saleId) {
        await refreshSale(tx, t.saleId);
        await graduateCustomer(tx, t.saleId, this.chatter, u.id);
      }
    });
    return this.get(id);
  }

  async cancel(u: AuthUser, id: number) {
    await this.db.$transaction(async (tx) => {
      await lockRow(tx, 'stock_transfers', id);
      const t = must(await tx.stockTransfers.findFirst({ where: { id: id } }), 'Dokumen');
      if (t.state === 'done') fail('Dokumen yang sudah divalidasi tidak dapat dibatalkan');
      if (t.state === 'cancel') fail('Dokumen sudah dibatalkan');
      // penerimaan atau dropship dari PO: sisa yang tidak dikirim principal ditutup lewat PO (Tutup sisa PO),
      // supaya qty dipesan dan kekurangan stok tetap benar
      if (t.purchaseId) fail('Dokumen ini berasal dari PO Principal; gunakan Tutup sisa PO atau batalkan PO-nya');
      await tx.stockTransfers.updateMany({ where: { id: id }, data: { state: 'cancel' } });
      await tx.stockMoves.updateMany({ where: { pickingId: id }, data: { state: 'cancel' } });
      await this.chatter.log(MODEL, id, u.id, 'Dokumen dibatalkan', [], tx);
      if (t.saleId) await refreshSale(tx, t.saleId);
    });
    return this.get(id);
  }

  async pdfBuffer(u: AuthUser, id: number) {
    const t: any = await this.get(id);
    const ship = t.partner;
    const so = t.sale;
    const signer = (
      await this.db.users.findMany({ where: { id: u.id }, include: { partner: { select: { name: true } } } })
    ).map((x) => ({ name: x.partner.name, sig: x.signatureId }));
    const wh = await this.db.warehouses.findFirst({ where: { id: t.pickingType.warehouseId } });
    const rows = t.moves.map((m: any, i: number) => [
      i + 1,
      `[${m.code}] ${m.product}`,
      m.uom,
      num(m.productUomQty),
      num(t.state === 'done' ? m.quantity : m.quantity),
    ]);
    const isOut = t.kind === 'outgoing';
    const spec: any = {
      title: isOut ? 'SURAT JALAN' : 'BUKTI PENERIMAAN BARANG',
      titleEn: isOut ? 'Delivery Order' : 'Goods Receipt',
      number: t.name,
      notesKey: isOut ? 'surat_jalan' : undefined,
      infoLeft: isOut
        ? [
            ['Kepada', 'Deliver to', so?.partner?.name || ship?.name],
            ['Alamat kirim', 'Address', [ship?.street, ship?.city].filter(Boolean).join(', ')],
            ['Telepon', 'Phone', ship?.phone || so?.partner?.phone || '-'],
          ]
        : [
            ['Dari principal', 'From supplier', ship?.name],
            ['Gudang', 'Warehouse', wh?.name || '-'],
          ],
      infoRight: [
        ['Tanggal', 'Date', tglIndo(t.dateDone ? new Date(t.dateDone).toISOString().slice(0, 10) : t.scheduledDate)],
        ['Dokumen asal', 'Source', t.origin || '-'],
        ['Gudang asal', 'From warehouse', isOut ? (t.dropship ? 'Dropship dari principal' : wh?.name || '-') : '-'],
        ...(t.backorderName ? [['Susulan dari', 'Backorder of', t.backorderName]] : []),
      ],
      columns: [
        { h: 'No', en: 'No', w: 18 },
        { h: 'Produk', en: 'Product', w: '*' },
        { h: 'Satuan', en: 'Unit', w: 50 },
        { h: 'Dipesan', en: 'Ordered', w: 55, align: 'right' },
        { h: isOut ? 'Dikirim' : 'Diterima', en: isOut ? 'Delivered' : 'Received', w: 55, align: 'right' },
      ],
      rows,
      note: t.note || undefined,
      receiverBox: true,
      signer: {
        name: signer[0]?.name || u.name,
        role: isOut ? 'Operasional' : 'Penerima gudang',
        signatureId: signer[0]?.sig,
      },
      copies: isOut
        ? [
            'Lembar 1 – Pelanggan / Copy 1 – Customer',
            'Lembar 2 – Gudang / Copy 2 – Warehouse',
            'Lembar 3 – Finance / Copy 3 – Finance',
          ]
        : undefined,
    };
    return { buffer: await this.pdf.document(spec), name: `${t.name.replace(/\//g, '-')}.pdf` };
  }
}
