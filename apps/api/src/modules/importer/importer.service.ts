import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { DB, Db } from '../../db/db.module';
import { AuthUser } from '../../shared/auth';
import { round2, today } from '../../shared/util';
import { StockService } from '../stock/stock.service';
import { JournalService } from '../accounting/journal.service';
import { createWarehouse } from '../../shared/warehouse';

interface Field {
  key: string;
  title: string;
  required?: boolean;
  type?: 'number' | 'date' | 'bool';
}

const KINDS: Record<string, { title: string; fields: Field[] }> = {
  customers: {
    title: 'Pelanggan',
    fields: [
      { key: 'name', title: 'Nama', required: true },
      { key: 'vat', title: 'NPWP' },
      { key: 'email', title: 'Email' },
      { key: 'phone', title: 'Telepon' },
      { key: 'street', title: 'Alamat' },
      { key: 'city', title: 'Kota' },
      { key: 'category', title: 'Kategori' },
      { key: 'termDays', title: 'Term of payment (hari)', type: 'number' },
      { key: 'isNew', title: 'Pelanggan baru (ya/tidak)', type: 'bool' },
    ],
  },
  addresses: {
    title: 'Alamat kirim pelanggan',
    fields: [
      { key: 'customer', title: 'Nama pelanggan', required: true },
      { key: 'name', title: 'Nama lokasi', required: true },
      { key: 'street', title: 'Alamat', required: true },
      { key: 'city', title: 'Kota' },
      { key: 'phone', title: 'Telepon' },
    ],
  },
  principals: {
    title: 'Principal dan gudang',
    fields: [
      { key: 'name', title: 'Nama', required: true },
      { key: 'vat', title: 'NPWP' },
      { key: 'email', title: 'Email' },
      { key: 'phone', title: 'Telepon' },
      { key: 'street', title: 'Alamat' },
      { key: 'city', title: 'Kota' },
      { key: 'warehouseName', title: 'Nama gudang' },
      { key: 'supplierNote', title: 'Syarat pembayaran' },
    ],
  },
  products: {
    title: 'Produk',
    fields: [
      { key: 'code', title: 'Kode', required: true },
      { key: 'name', title: 'Nama', required: true },
      { key: 'uom', title: 'Satuan', required: true },
      { key: 'category', title: 'Kategori' },
      { key: 'principal', title: 'Principal' },
      { key: 'listPrice', title: 'Harga jual', type: 'number' },
      { key: 'route', title: 'Rute (stock/dropship)' },
      { key: 'description', title: 'Spesifikasi' },
    ],
  },
  supplier_prices: {
    title: 'Pricelist principal',
    fields: [
      { key: 'principal', title: 'Principal', required: true },
      { key: 'code', title: 'Kode produk', required: true },
      { key: 'price', title: 'Harga', required: true, type: 'number' },
      { key: 'discount', title: 'Diskon %', type: 'number' },
      { key: 'minQty', title: 'Kuantitas minimum', type: 'number' },
      { key: 'dateStart', title: 'Berlaku mulai', type: 'date' },
      { key: 'dateEnd', title: 'Berlaku sampai', type: 'date' },
    ],
  },
  initial_stock: {
    title: 'Stok awal per gudang',
    fields: [
      { key: 'code', title: 'Kode produk', required: true },
      { key: 'warehouse', title: 'Kode atau nama gudang', required: true },
      { key: 'qty', title: 'Kuantitas', required: true, type: 'number' },
    ],
  },
  opening_balance: {
    title: 'Saldo awal akun',
    fields: [
      { key: 'account', title: 'Kode akun', required: true },
      { key: 'debit', title: 'Debit', type: 'number' },
      { key: 'credit', title: 'Kredit', type: 'number' },
      { key: 'date', title: 'Tanggal saldo', type: 'date' },
    ],
  },
  open_invoices: {
    title: 'Invoice pelanggan yang masih terbuka',
    fields: [
      { key: 'number', title: 'Nomor invoice', required: true },
      { key: 'partner', title: 'Pelanggan', required: true },
      { key: 'date', title: 'Tanggal', required: true, type: 'date' },
      { key: 'due', title: 'Jatuh tempo', type: 'date' },
      { key: 'total', title: 'Total', required: true, type: 'number' },
      { key: 'residual', title: 'Sisa', required: true, type: 'number' },
    ],
  },
  open_bills: {
    title: 'Tagihan principal yang masih terbuka',
    fields: [
      { key: 'number', title: 'Nomor tagihan', required: true },
      { key: 'partner', title: 'Principal', required: true },
      { key: 'date', title: 'Tanggal', required: true, type: 'date' },
      { key: 'due', title: 'Jatuh tempo', type: 'date' },
      { key: 'total', title: 'Total', required: true, type: 'number' },
      { key: 'residual', title: 'Sisa', required: true, type: 'number' },
    ],
  },
};

class RowError extends Error {}

const bad = (m: string): never => {
  throw new RowError(m);
};

const norm = (v: string) =>
  String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function cellValue(v: any): any {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object')
    return v.result ?? v.text ?? (v.richText ? v.richText.map((r: any) => r.text).join('') : String(v));
  return v;
}

function parseNum(v: any) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let t = String(v).replace(/[^\d,.-]/g, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return isNaN(n) ? NaN : n;
}

function parseDate(v: any) {
  if (v == null || v === '') return null;
  const t = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return 'invalid';
}

// Impor data awal dari spreadsheet lama (fitur C.k): kolom dipetakan, baris salah ditampilkan dan tidak disimpan
@Injectable()
export class ImporterService {
  constructor(
    @Inject(DB) private db: Db,
    private stock: StockService,
    private journal: JournalService,
  ) {}

  kinds() {
    return Object.entries(KINDS).map(([key, k]) => ({ key, title: k.title, fields: k.fields }));
  }

  async template(kind: string, res: Response) {
    const k = KINDS[kind] || bad('Jenis impor tidak dikenal');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(k.title.slice(0, 30));
    const h = ws.addRow(k.fields.map((f) => f.title + (f.required ? ' *' : '')));
    h.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A4A' } };
    });
    k.fields.forEach((_, i) => (ws.getColumn(i + 1).width = 24));
    const buf = await wb.xlsx.writeBuffer();
    res
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="template_${kind}.xlsx"`,
      })
      .send(Buffer.from(buf as ArrayBuffer));
  }

  private async read(file: Express.Multer.File) {
    if (!file) bad('File belum dipilih');
    const wb = new ExcelJS.Workbook();
    if (/\.csv$/i.test(file.originalname)) {
      const { Readable } = await import('stream');
      await wb.csv.read(Readable.from(file.buffer.toString('utf8')));
    } else await wb.xlsx.load(file.buffer as any);
    const ws = wb.worksheets[0];
    const rows: any[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => rows.push((r.values as any[]).slice(1).map(cellValue)));
    const headers = (rows.shift() || []).map((h) =>
      String(h ?? '')
        .replace(/\s*\*$/, '')
        .trim(),
    );
    return { headers, rows: rows.filter((r) => r.some((v) => v != null && v !== '')) };
  }

  // langkah 1: baca kolom file dan usulkan pemetaan otomatis
  async preview(kind: string, file: Express.Multer.File) {
    const k = KINDS[kind] || bad('Jenis impor tidak dikenal');
    const { headers, rows } = await this.read(file);
    const mapping: Record<string, number | null> = {};
    for (const f of k.fields) {
      const i = headers.findIndex(
        (h) => norm(h) === norm(f.title) || norm(h) === norm(f.key) || norm(h).startsWith(norm(f.title).slice(0, 6)),
      );
      mapping[f.key] = i >= 0 ? i : null;
    }
    return { headers, mapping, sample: rows.slice(0, 5), total: rows.length, fields: k.fields };
  }

  // langkah 2: validasi dan simpan baris yang benar
  async run(u: AuthUser, kind: string, file: Express.Multer.File, body: any) {
    const k = KINDS[kind] || bad('Jenis impor tidak dikenal');
    const { headers, rows } = await this.read(file);
    let mapping: Record<string, number | null> = body.mapping ? JSON.parse(body.mapping) : {};
    if (!body.mapping)
      for (const f of k.fields) {
        const i = headers.findIndex((h) => norm(h) === norm(f.title) || norm(h) === norm(f.key));
        mapping[f.key] = i >= 0 ? i : null;
      }
    const dryRun = body.dryRun === 'true' || body.dryRun === true;
    const errors: { row: number; message: string }[] = [];
    let ok = 0;
    const openingLines: { accountId: number; debit: number; credit: number; date: string }[] = [];

    await this.db.$transaction(async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        const v: any = {};
        try {
          for (const f of k.fields) {
            const idx = mapping[f.key];
            let x = idx == null ? null : raw[idx];
            if (typeof x === 'string') x = x.trim();
            if (f.type === 'number') {
              x = parseNum(x);
              if (Number.isNaN(x)) bad(`${f.title} bukan angka`);
            }
            if (f.type === 'date') {
              x = parseDate(x);
              if (x === 'invalid') bad(`${f.title} bukan tanggal yang valid`);
            }
            if (f.type === 'bool') x = x == null ? null : /^(ya|y|yes|true|1)$/i.test(String(x));
            if (f.required && (x == null || x === '')) bad(`${f.title} wajib diisi`);
            v[f.key] = x;
          }
          // setiap baris memakai savepoint sehingga baris salah tidak membatalkan baris lain
          await tx
            .$transaction(async (sp) => {
              const r = await this.row(sp, kind, v, u);
              if (r) openingLines.push(r);
              if (dryRun) throw new RowError('__dry');
            })
            .catch((e) => {
              if (e.message !== '__dry') throw e;
            });
          ok++;
        } catch (e: any) {
          errors.push({
            row: i + 2,
            message:
              e instanceof RowError
                ? e.message
                : e?.cause?.detail || e?.detail || e?.message || 'Kesalahan tidak diketahui',
          });
        }
      }
      // saldo awal akun: satu jurnal dengan selisih ke akun Ekuitas Saldo Awal
      if (kind === 'opening_balance' && openingLines.length && !dryRun) {
        const date = openingLines[0].date;
        const dr = round2(openingLines.reduce((a, l) => a + l.debit, 0)),
          cr = round2(openingLines.reduce((a, l) => a + l.credit, 0));
        const lines: any[] = openingLines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          name: 'Saldo awal',
        }));
        if (Math.abs(dr - cr) > 0.009)
          lines.push({
            key: 'opening',
            debit: dr < cr ? round2(cr - dr) : 0,
            credit: dr > cr ? round2(dr - cr) : 0,
            name: 'Selisih saldo awal',
          });
        await this.journal.create(tx, {
          journal: 'MISC',
          date,
          ref: 'Saldo awal dari spreadsheet lama',
          post: true,
          uid: u.id,
          lines,
        });
      }
    });
    return { total: rows.length, imported: dryRun ? 0 : ok, valid: ok, dryRun, errors };
  }

  private async partnerBy(tx: any, name: string, kind: 'customer' | 'supplier') {
    const [p] = await tx.partners.findMany({
      where: { AND: [{ name: { contains: name, mode: 'insensitive' } }, { type: 'company' }] },
    });
    if (!p) bad(`${kind === 'customer' ? 'Pelanggan' : 'Principal'} "${name}" tidak ditemukan`);
    if (kind === 'supplier' && !p.supplierRank) bad(`"${name}" bukan principal`);
    return p;
  }

  private async productBy(tx: any, code: string) {
    const [r] = (await tx.products.findMany({ where: { defaultCode: String(code) }, include: { template: true } })).map(
      ({ template, ...p }) => ({ p, t: template }),
    );
    if (!r) bad(`Produk dengan kode ${code} tidak ditemukan`);
    return r;
  }

  private async row(tx: any, kind: string, v: any, u: AuthUser): Promise<any> {
    switch (kind) {
      case 'customers': {
        const [dup] = await tx.partners.findMany({
          where: {
            AND: [{ name: { contains: v.name, mode: 'insensitive' } }, { type: 'company' }, { customerRank: 1 }],
          },
        });
        if (dup) bad('Pelanggan dengan nama yang sama sudah ada');
        let paymentTermId = null;
        if (v.termDays != null) {
          let [t] = await tx.paymentTerms.findMany({ where: { days: v.termDays } });
          if (!t)
            t = await tx.paymentTerms.create({
              data: { name: v.termDays ? `${v.termDays} hari` : 'Tunai', days: v.termDays },
            });
          paymentTermId = t.id;
        }
        await tx.partners.create({
          data: {
            name: v.name,
            vat: v.vat,
            email: v.email,
            phone: v.phone,
            street: v.street,
            city: v.city,
            category: v.category,
            customerRank: 1,
            paymentTermId,
            mtppIsNewCustomer: v.isNew ?? false,
            createUid: u.id,
          },
        });
        return;
      }
      case 'addresses': {
        const c = await this.partnerBy(tx, v.customer, 'customer');
        await tx.partners.create({
          data: {
            parentId: c.id,
            type: 'delivery',
            name: v.name,
            street: v.street,
            city: v.city,
            phone: v.phone,
            createUid: u.id,
          },
        });
        return;
      }
      case 'principals': {
        const [dup] = await tx.partners.findMany({
          where: { AND: [{ name: { contains: v.name, mode: 'insensitive' } }, { type: 'company' }] },
        });
        if (dup?.supplierRank) bad('Principal dengan nama yang sama sudah ada');
        const p = await tx.partners.create({
          data: {
            name: v.name,
            vat: v.vat,
            email: v.email,
            phone: v.phone,
            street: v.street,
            city: v.city,
            supplierNote: v.supplierNote,
            supplierRank: 1,
            createUid: u.id,
          },
        });
        await createWarehouse(tx, p.id, v.warehouseName || `Gudang ${v.name}`);
        return;
      }
      case 'products': {
        const [dup] = await tx.products.findMany({ where: { defaultCode: String(v.code) } });
        if (dup) bad(`Kode ${v.code} sudah dipakai`);
        let [uom] = await tx.units.findMany({ where: { name: { contains: v.uom, mode: 'insensitive' } } });
        if (!uom) uom = await tx.units.create({ data: { name: v.uom } });
        let categoryId = null;
        if (v.category) {
          let [c] = await tx.productCategories.findMany({
            where: { name: { contains: v.category, mode: 'insensitive' } },
          });
          if (!c) c = await tx.productCategories.create({ data: { name: v.category } });
          categoryId = c.id;
        }
        const sup = v.principal ? await this.partnerBy(tx, v.principal, 'supplier') : null;
        const route = String(v.route || 'stock')
          .toLowerCase()
          .startsWith('drop')
          ? 'dropship'
          : 'stock';
        const t = await tx.productTemplates.create({
          data: {
            name: v.name,
            uomId: uom.id,
            categoryId,
            mainSupplierId: sup?.id || null,
            listPrice: v.listPrice || 0,
            descriptionSale: v.description,
            mtppRoute: route,
            createUid: u.id,
          },
        });
        await tx.products.create({ data: { productTmplId: t.id, defaultCode: String(v.code) } });
        return;
      }
      case 'supplier_prices': {
        const sup = await this.partnerBy(tx, v.principal, 'supplier');
        const pr = await this.productBy(tx, v.code);
        if (v.price < 0) bad('Harga tidak boleh minus');
        if (v.discount != null && (v.discount < 0 || v.discount > 100)) bad('Diskon harus 0 sampai 100');
        await tx.supplierPrices.create({
          data: {
            partnerId: sup.id,
            productTmplId: pr.t.id,
            price: v.price,
            discount: v.discount || 0,
            minQty: v.minQty || 0,
            dateStart: v.dateStart,
            dateEnd: v.dateEnd,
            createUid: u.id,
          },
        });
        return;
      }
      case 'initial_stock': {
        const pr = await this.productBy(tx, v.code);
        const [w] = await tx.warehouses.findMany({
          where: {
            OR: [{ code: String(v.warehouse) }, { name: { contains: String(v.warehouse), mode: 'insensitive' } }],
          },
        });
        if (!w) bad(`Gudang ${v.warehouse} tidak ditemukan`);
        if (!(v.qty > 0)) bad('Kuantitas harus lebih dari 0');
        const to = await this.stock.internalLocation(w.id, tx);
        const from = await this.stock.virtualLocation('inventory', tx);
        await this.stock.applyMove(tx, pr.p.id, from, to, v.qty);
        await tx.stockMoves.create({
          data: {
            productId: pr.p.id,
            locationId: from.id,
            locationDestId: to.id,
            productUomQty: v.qty,
            quantity: v.qty,
            state: 'done',
          },
        });
        return;
      }
      case 'opening_balance': {
        const [a] = await tx.accounts.findMany({ where: { code: String(v.account) } });
        if (!a) bad(`Akun ${v.account} tidak ditemukan`);
        const d = round2(v.debit || 0),
          c = round2(v.credit || 0);
        if (d < 0 || c < 0) bad('Debit dan kredit tidak boleh minus');
        if (!d && !c) bad('Isi debit atau kredit');
        return { accountId: a.id, debit: d, credit: c, date: v.date || today() };
      }
      case 'open_invoices':
      case 'open_bills': {
        const cust = kind === 'open_invoices';
        const p = await this.partnerBy(tx, v.partner, cust ? 'customer' : 'supplier');
        const [dup] = await tx.journalEntries.findMany({ where: { name: String(v.number) } });
        if (dup) bad(`Nomor ${v.number} sudah ada`);
        if (!(v.total > 0) || v.residual < 0 || v.residual > v.total) bad('Total dan sisa tidak valid');
        const jr = await this.journal.journal(cust ? 'INV' : 'BILL', tx);
        const main = await this.journal.map(cust ? 'receivable' : 'payable', tx),
          opening = await this.journal.map('opening', tx);
        const amt = round2(v.residual);
        // nomor dokumen lama dimasukkan manual; hanya sisa yang dicatat sebagai saldo terhadap Ekuitas Saldo Awal
        const e = await tx.journalEntries.create({
          data: {
            name: String(v.number),
            journalId: jr.id,
            partnerId: p.id,
            moveType: cust ? 'out_invoice' : 'in_invoice',
            date: v.date,
            invoiceDate: v.date,
            invoiceDateDue: v.due || v.date,
            state: 'posted',
            paymentState: amt <= 0 ? 'paid' : amt < v.total ? 'partial' : 'not_paid',
            amountUntaxed: v.total,
            amountTax: 0,
            amountTotal: v.total,
            amountResidual: amt,
            ref: 'Saldo awal dari spreadsheet lama',
            createUid: u.id,
          },
        });
        if (amt > 0)
          await tx.journalEntryLines.createMany({
            data: [
              {
                moveId: e.id,
                accountId: cust ? main : opening,
                partnerId: p.id,
                name: v.number,
                debit: amt,
                credit: 0,
                balance: amt,
                date: v.date,
                dateMaturity: v.due,
              },
              {
                moveId: e.id,
                accountId: cust ? opening : main,
                partnerId: p.id,
                name: v.number,
                debit: 0,
                credit: amt,
                balance: -amt,
                date: v.date,
                dateMaturity: v.due,
              },
            ],
          });
        return;
      }
    }
  }
}
