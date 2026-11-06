import * as path from 'path';
import * as fs from 'fs';
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter = require('pdfmake');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vfs = require('pdfmake/build/vfs_fonts.js');
import { SettingsService } from './settings.service';
import { FilesService } from './files.service';

const f = (n: string) => Buffer.from((vfs.pdfMake ? vfs.pdfMake.vfs : vfs)[n], 'base64');
const printer = new PdfPrinter({
  Roboto: {
    normal: f('Roboto-Regular.ttf'),
    bold: f('Roboto-Medium.ttf'),
    italics: f('Roboto-Italic.ttf'),
    bolditalics: f('Roboto-MediumItalic.ttf'),
  },
});

export interface DocSpec {
  title: string;
  titleEn: string;
  number: string;
  infoLeft: [string, string, string][];
  infoRight: [string, string, string][];
  columns: { h: string; en: string; w: any; align?: 'left' | 'right' | 'center' }[];
  rows: any[][];
  totals?: [string, string][];
  words?: string;
  wordsEn?: string;
  notesKey?: string; // kunci pada pengaturan doc_notes
  materai?: boolean;
  receipt?: { from: string; amount: string; purpose: string; method: string };
  terms?: [string, string][];
  note?: string;
  signer?: { name: string; role: string; signatureId?: number | null };
  copies?: string[];
  receiverBox?: boolean;
}

const BRAND = '#90241D';
const INK = '#2E2A27';
const SUB = '#625B55';
const LINE = '#D9D3CE';
const LINE2 = '#ECE8E4';
const M = 45; // margin halaman (16 mm), mengikuti tata letak MTPP Docs
const W = 595.28 - 2 * M;
// Logo MTPP dipakai pada kop dokumen selama belum ada logo yang diunggah di Pengaturan
const DEFAULT_LOGO = path.resolve(__dirname, '../../assets/logo.png');

const lines = (t?: any) =>
  String(t ?? '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
const filled = (v: any) => v !== undefined && v !== null && String(v).trim() !== '' && v !== '-';

@Injectable()
export class PdfService {
  constructor(
    private settings: SettingsService,
    private files: FilesService,
  ) {}

  private render(def: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = printer.createPdfKitDocument(def);
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }

  // ---------- kop dan judul ----------
  async letterhead(width = W) {
    const c = await this.settings.get('company');
    let logo: any = null;
    if (c.logoAttachmentId) {
      try {
        const f = await this.files.get(c.logoAttachmentId);
        logo = `data:${f.meta.mimetype};base64,` + f.buffer.toString('base64');
      } catch {}
    }
    if (!logo) {
      try {
        logo = 'data:image/png;base64,' + fs.readFileSync(DEFAULT_LOGO).toString('base64');
      } catch {}
    }
    const contact = [
      ...lines(c.street),
      c.phone && 'T ' + c.phone,
      c.fax && 'F ' + c.fax,
      c.email,
      c.website,
      c.npwp && 'NPWP ' + c.npwp,
    ].filter(Boolean);
    return [
      {
        columns: [
          ...(logo ? [{ image: logo, fit: [48, 48], width: 48 }] : []),
          {
            width: '*',
            margin: [logo ? 12 : 0, 8, 8, 0],
            stack: [
              { text: String(c.name || '').toUpperCase(), bold: true, fontSize: 13, characterSpacing: 0.5, color: INK },
              ...(c.tagline
                ? [
                    {
                      text: String(c.tagline).toUpperCase(),
                      fontSize: 6.8,
                      characterSpacing: 0.6,
                      color: SUB,
                      margin: [0, 3, 0, 0],
                    },
                  ]
                : []),
            ],
          },
          {
            width: 150,
            stack: contact.map((t: any) => ({
              text: t,
              fontSize: 7.2,
              color: SUB,
              alignment: 'right',
              lineHeight: 1.2,
            })),
          },
        ],
      },
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 1.4, lineColor: BRAND }],
        margin: [0, 10, 0, 18],
      },
    ];
  }

  title(title: string, en: string | undefined, meta: [string, string, any][], copy?: string) {
    const rows = meta.filter((r) => filled(r[2]));
    return {
      columns: [
        {
          width: '*',
          stack: [
            { text: title.toUpperCase(), bold: true, fontSize: 15, characterSpacing: 0.7, color: BRAND },
            ...(en
              ? [{ text: en.toUpperCase(), fontSize: 8, characterSpacing: 1.1, color: SUB, margin: [0, 3, 0, 0] }]
              : []),
            ...(copy ? [{ text: copy, fontSize: 8, bold: true, color: BRAND, margin: [0, 5, 0, 0] }] : []),
          ],
        },
        ...(rows.length
          ? [
              {
                width: 245,
                table: {
                  widths: [122, '*'],
                  body: rows.map(([a, b, v]) => [
                    { text: b ? `${a} / ${b}` : a, fontSize: 8, color: SUB },
                    { text: String(v), fontSize: 8.2, bold: true, alignment: 'right', noWrap: String(v).length <= 24 },
                  ]),
                },
                layout: this.plain(0, 1.5),
              },
            ]
          : []),
      ],
      columnGap: 16,
      margin: [0, 0, 0, 16],
    };
  }

  private plain(px = 0, py = 1) {
    return {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => px || 8,
      paddingTop: () => py,
      paddingBottom: () => py,
    };
  }

  // ---------- blok isi ----------
  // judul seksi dengan garis tipis selebar kolom
  section(id: string, en: string | undefined, width: number, margin: any = [0, 0, 0, 5]) {
    return {
      stack: [
        {
          text: [
            { text: id.toUpperCase(), bold: true, characterSpacing: 1 },
            ...(en ? [{ text: '  ' + en, fontSize: 6.8 }] : []),
          ],
          fontSize: 6.8,
          color: SUB,
        },
        { canvas: [{ type: 'line', x1: 0, y1: 3, x2: width, y2: 3, lineWidth: 0.5, lineColor: LINE }] },
      ],
      margin,
    };
  }

  kv(rows: [string, any][], labelWidth: any = 'auto') {
    const r = rows.filter((x) => filled(x[1]));
    if (!r.length) return null;
    return {
      table: {
        widths: [labelWidth, '*'],
        body: r.map(([a, v]) => [
          { text: a, fontSize: 8.4, color: SUB },
          { text: String(v), fontSize: 8.4, bold: true },
        ]),
      },
      layout: this.plain(10, 1.2),
    };
  }

  party(label: string, name: any, detail: any[], width = (W - 16) / 2) {
    return {
      width,
      stack: [
        this.section(label, undefined, width),
        { text: filled(name) ? String(name) : '—', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
        ...detail.filter(filled).map((t) => ({ text: String(t), fontSize: 8.4, color: SUB, lineHeight: 1.15 })),
      ],
    };
  }

  info(label: string, rows: [string, any][], width = (W - 16) / 2, labelWidth: any = 'auto') {
    const t = this.kv(rows, labelWidth);
    if (!t) return null;
    return { width, stack: [this.section(label, undefined, width), t] };
  }

  cols(...parts: any[]) {
    const p = parts.filter(Boolean);
    return p.length ? { columns: p, columnGap: 16, margin: [0, 0, 0, 13] } : null;
  }

  paragraphs(text?: any, margin: any = [0, 0, 0, 8]) {
    return String(text ?? '')
      .split(/\n\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => ({ text: x, fontSize: 9.2, lineHeight: 1.25, alignment: 'justify', margin }));
  }

  // deskripsi bertingkat: baris pertama tebal, baris berikutnya spesifikasi kecil
  desc(text: any) {
    const l = lines(text);
    if (l.length <= 1) return { text: l[0] ?? '', fontSize: 8.7, bold: true };
    return {
      stack: [
        { text: l[0], fontSize: 8.7, bold: true },
        ...l.slice(1).map((t) => ({ text: t, fontSize: 7.9, color: SUB, lineHeight: 1.1 })),
      ],
    };
  }

  table_(
    columns: { h: string; en?: string; w: any; align?: string; desc?: boolean }[],
    rows: any[][],
    opts: { fontSize?: number; bold?: (i: number) => boolean; margin?: any } = {},
  ) {
    const fs_ = opts.fontSize ?? 8.7;
    return {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: columns.map((c) => c.w),
        body: [
          columns.map((c) => ({
            stack: [
              {
                text: c.h.toUpperCase(),
                bold: true,
                fontSize: 6.8,
                characterSpacing: 0.8,
                color: INK,
                alignment: c.align || 'left',
              },
              ...(c.en && c.en.toLowerCase() !== c.h.toLowerCase()
                ? [{ text: c.en, fontSize: 6.6, color: SUB, alignment: c.align || 'left' }]
                : []),
            ],
          })),
          ...rows.map((r, ri) =>
            r.map((v, i) => {
              const c = columns[i];
              if (c.desc) return this.desc(v);
              return {
                text: v == null ? '' : String(v),
                fontSize: fs_,
                alignment: c.align || 'left',
                bold: opts.bold?.(ri) || false,
                color: c.h === 'No' ? SUB : INK,
              };
            }),
          ),
        ],
      },
      layout: {
        hLineWidth: (i: number, n: any) => (i === 0 ? 0.5 : i === 1 ? 1 : i === n.table.body.length ? 0.6 : 0.5),
        hLineColor: (i: number, n: any) => (i === 1 ? INK : i === 0 || i === n.table.body.length ? LINE : LINE2),
        vLineWidth: () => 0,
        paddingLeft: () => 6,
        paddingRight: () => 6,
        paddingTop: () => 5,
        paddingBottom: () => 5,
      },
      margin: opts.margin ?? [0, 0, 0, 10],
    };
  }

  // ---------- tanda tangan ----------
  private signCol(
    o: {
      role?: string;
      sub?: string;
      name?: string;
      title?: string;
      phone?: string;
      sig?: any;
      materai?: boolean;
      place?: string;
      salutation?: string;
      company?: string;
      pad?: number;
    },
    width: number,
  ) {
    return {
      width,
      unbreakable: true,
      stack: [
        ...(o.place ? [{ text: o.place, fontSize: 8.6, color: SUB, margin: [0, 0, 0, 7] }] : []),
        ...(o.salutation ? [{ text: o.salutation, fontSize: 8.8 }] : []),
        ...(o.company ? [{ text: o.company, bold: true, fontSize: 9 }] : []),
        ...(o.role ? [{ text: o.role.toUpperCase(), bold: true, fontSize: 6.8, characterSpacing: 1, color: SUB }] : []),
        ...(o.sub ? [{ text: o.sub, fontSize: 7.8, color: SUB }] : []),
        ...(o.materai
          ? [
              {
                table: {
                  widths: [94],
                  body: [
                    [
                      {
                        text: 'Meterai\nRp10.000',
                        fontSize: 7,
                        color: SUB,
                        alignment: 'center',
                        margin: [0, 13, 0, 13],
                      },
                    ],
                  ],
                },
                layout: {
                  hLineWidth: () => 0.5,
                  vLineWidth: () => 0.5,
                  hLineColor: () => SUB,
                  vLineColor: () => SUB,
                  hLineStyle: () => ({ dash: { length: 2 } }),
                  vLineStyle: () => ({ dash: { length: 2 } }),
                },
                margin: [0, 7, 0, 4],
              },
            ]
          : []),
        ...(o.sig
          ? [{ image: o.sig, fit: [120, 50], margin: [0, 4, 0, 2] }]
          : o.materai
            ? []
            : [{ text: ' ', fontSize: 8, margin: [0, 0, 0, 44 + (o.pad || 0)] }]),
        {
          canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.6, lineColor: INK }],
          margin: [0, 2, 0, 3],
        },
        { text: o.name || ' ', bold: true, fontSize: 9.6 },
        ...(o.title ? [{ text: o.title, fontSize: 7.8, color: SUB }] : []),
        ...(o.phone ? [{ text: 'Hp. ' + o.phone, fontSize: 7.8, color: SUB }] : []),
      ],
    };
  }

  signOne(o: Parameters<PdfService['signCol']>[0]) {
    return { columns: [{ text: '', width: '*' }, this.signCol(o, 205)], margin: [0, 16, 0, 0] };
  }

  signGrid(cols: Parameters<PdfService['signCol']>[0][]) {
    const w = (W - 16 * (cols.length - 1)) / cols.length;
    return { columns: cols.map((c) => this.signCol(c, w)), columnGap: 16, margin: [0, 16, 0, 0] };
  }

  private async footer() {
    const c = await this.settings.get('company');
    const addr = lines(c.street).join(', ');
    return (p: number, n: number, ps: any) => {
      const width = ps.width - 2 * M;
      return {
        margin: [M, 8, M, 0],
        stack: [
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.5, lineColor: LINE }] },
          {
            margin: [0, 4, 0, 0],
            columns: [
              {
                width: '*',
                fontSize: 6.8,
                color: SUB,
                text: [c.name, addr, c.phone ? 'T ' + c.phone : ''].filter(Boolean).join('   ·   '),
              },
              { width: 70, fontSize: 6.8, color: SUB, alignment: 'right', text: `Halaman ${p} dari ${n}` },
            ],
          },
        ],
      };
    };
  }

  // merender konten bebas dengan kop dan kaki dokumen standar
  async page(content: any[]): Promise<Buffer> {
    return this.render({
      pageSize: 'A4',
      pageMargins: [M, 40, M, 42],
      defaultStyle: { font: 'Roboto', color: INK },
      content: [...(await this.letterhead()), ...content.filter(Boolean)],
      footer: await this.footer(),
    });
  }

  // ---------- dokumen transaksi ----------
  private body(spec: DocSpec, company: any, sig: any, noteList: string[], copy?: string) {
    const out: any[] = [];
    const date = spec.infoRight.find((r) => r[1] === 'Date')?.[2];
    out.push(this.title(spec.title, spec.titleEn, [['No.', 'No.', spec.number], ...spec.infoRight], copy));

    if (spec.receipt) {
      const row = (a: string, en: string, cell: any) => [
        {
          stack: [
            { text: a, fontSize: 8.6, color: SUB },
            { text: en, fontSize: 7, color: SUB },
          ],
        },
        cell,
      ];
      out.push({
        table: {
          widths: [130, '*'],
          body: [
            row('Sudah terima dari', 'Received from', { text: spec.receipt.from, bold: true, fontSize: 11 }),
            row('Uang sejumlah', 'The sum of', {
              stack: [
                { text: spec.receipt.amount, bold: true, fontSize: 14, margin: [0, 0, 0, 4] },
                { text: spec.words, italics: true, bold: true, fontSize: 9 },
                { text: spec.wordsEn, italics: true, fontSize: 7.6, color: SUB },
              ],
            }),
            row('Untuk pembayaran', 'For payment of', { text: spec.receipt.purpose, fontSize: 9.2 }),
            row('Cara pembayaran', 'Payment method', { text: spec.receipt.method, fontSize: 9.2 }),
          ],
        },
        layout: {
          hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
          hLineColor: () => LINE2,
          vLineWidth: () => 0,
          paddingLeft: () => 0,
          paddingRight: () => 8,
          paddingTop: () => 8,
          paddingBottom: () => 8,
        },
        margin: [0, 0, 0, 12],
      });
    } else {
      const [first, ...rest] = spec.infoLeft;
      const addr = rest.filter((r) => r[1] === 'Address');
      const more = rest.filter((r) => r[1] !== 'Address');
      out.push(
        this.cols(
          this.party(
            `${first[0]} / ${first[1]}`,
            first[2],
            addr.map((r) => r[2]),
          ),
          this.info(
            'Detail / Details',
            more.map((r) => [`${r[0]} / ${r[1]}`, r[2]] as [string, any]),
          ),
        ),
      );
      out.push(
        this.table_(
          spec.columns.map((c) => ({ ...c, desc: c.w === '*' })),
          spec.rows,
          { margin: [0, 0, 0, 8] },
        ),
      );
    }

    const hasTotals = !spec.receipt && spec.totals?.length;
    if (hasTotals || (spec.words && !spec.receipt)) {
      const n = spec.totals?.length || 0;
      out.push({
        unbreakable: true,
        margin: [0, 0, 0, 12],
        columnGap: 16,
        columns: [
          {
            width: '*',
            stack: spec.words
              ? [
                  this.section('Jumlah / Amount in words', undefined, 240),
                  { text: spec.words, italics: true, bold: true, fontSize: 9 },
                  ...(spec.wordsEn ? [{ text: spec.wordsEn, italics: true, fontSize: 7.6, color: SUB }] : []),
                ]
              : [{ text: '' }],
          },
          ...(n
            ? [
                {
                  width: 230,
                  table: {
                    widths: ['*', 'auto'],
                    body: spec.totals!.map(([a, b], i) => {
                      const [id, en] = a.split(' / ');
                      const grand = i === n - 1;
                      return [
                        {
                          stack: [
                            { text: id, fontSize: grand ? 8.6 : 8.8, bold: grand, color: grand ? INK : SUB },
                            ...(en ? [{ text: en, fontSize: 6.6, color: SUB }] : []),
                          ],
                        },
                        { text: b, bold: true, fontSize: grand ? 10.4 : 8.8, alignment: 'right', noWrap: true },
                      ];
                    }),
                  },
                  layout: {
                    hLineWidth: (i: number) => (i === n - 1 ? 0.8 : i === n ? 2 : 0),
                    hLineColor: () => INK,
                    vLineWidth: () => 0,
                    paddingLeft: () => 0,
                    paddingRight: () => 0,
                    paddingTop: () => 3.5,
                    paddingBottom: () => 3.5,
                  },
                },
              ]
            : []),
        ],
      });
    }

    const terms = (spec.terms || []).filter((t) => filled(t[1]));
    if (terms.length)
      out.push({
        unbreakable: true,
        margin: [0, 0, 0, 12],
        stack: [
          this.section('Ketentuan', 'Terms', W),
          {
            table: {
              widths: [130, '*'],
              body: terms.map(([a, b]) => [
                { text: a, fontSize: 8.5, color: SUB },
                { text: b, fontSize: 8.5, bold: true },
              ]),
            },
            layout: {
              hLineWidth: (i: number, n: any) => (i === 0 || i === n.table.body.length ? 0 : 0.5),
              hLineColor: () => LINE2,
              vLineWidth: () => 0,
              paddingLeft: () => 0,
              paddingRight: () => 8,
              paddingTop: () => 3,
              paddingBottom: () => 3,
            },
          },
        ],
      });
    if (noteList.length)
      out.push({
        unbreakable: true,
        margin: [0, 0, 0, 10],
        stack: [
          this.section('Syarat & Ketentuan', 'Terms & Conditions', W),
          { ol: noteList, fontSize: 8.4, color: SUB },
        ],
      });
    if (spec.note) out.push({ text: spec.note, fontSize: 8.5, margin: [0, 0, 0, 8] });

    const city = company.city ? `${company.city}, ${date || ''}` : date;
    const me = {
      place: city,
      salutation: 'Hormat kami,',
      company: company.name,
      name: spec.signer?.name,
      title: spec.signer?.role,
      sig,
      materai: spec.materai,
    };
    if (spec.receiverBox)
      out.push(
        this.signGrid([
          { role: 'Diterima oleh', sub: 'Received by', title: 'Nama, tanggal, tanda tangan', pad: sig ? 0 : 21 },
          me,
        ]),
      );
    else if (spec.signer) out.push(this.signOne(me));
    if (spec.materai)
      out.push({
        text: 'Dokumen yang menyatakan penerimaan uang di atas Rp5.000.000 wajib dibubuhi meterai Rp10.000 (UU No. 10 Tahun 2020 tentang Bea Meterai).',
        fontSize: 7,
        color: SUB,
        margin: [0, 12, 0, 0],
      });
    return out;
  }

  async document(spec: DocSpec): Promise<Buffer> {
    const company = await this.settings.get('company');
    let sig: any = null;
    if (spec.signer?.signatureId) {
      try {
        const f = await this.files.get(spec.signer.signatureId);
        sig = `data:${f.meta.mimetype};base64,` + f.buffer.toString('base64');
      } catch {}
    }
    const noteList = spec.notesKey ? lines((await this.settings.get('doc_notes'))[spec.notesKey]) : [];
    const copies = spec.copies?.length ? spec.copies : [undefined];
    const content: any[] = [];
    for (const [i, c] of copies.entries()) {
      const b: any[] = [...(await this.letterhead()), ...this.body(spec, company, sig, noteList, c)].filter(Boolean);
      if (i > 0) b[0] = { ...b[0], pageBreak: 'before' };
      content.push(...b);
    }
    return this.render({
      pageSize: 'A4',
      pageMargins: [M, 40, M, 42],
      content,
      defaultStyle: { font: 'Roboto', color: INK },
      footer: await this.footer(),
    });
  }

  // ---------- laporan ----------
  async table(
    title: string,
    subtitle: string[],
    columns: { h: string; align?: string }[],
    rows: any[][],
    landscape = false,
  ): Promise<Buffer> {
    const width = (landscape ? 841.89 : 595.28) - 2 * M;
    const totalAt = rows.length && rows[rows.length - 1][0] === 'Total' ? rows.length - 1 : -1;
    return this.render({
      pageSize: 'A4',
      pageOrientation: landscape ? 'landscape' : 'portrait',
      pageMargins: [M, 40, M, 42],
      defaultStyle: { font: 'Roboto', color: INK },
      content: [
        ...(await this.letterhead(width)),
        { text: title.toUpperCase(), bold: true, fontSize: 15, characterSpacing: 0.7, color: BRAND },
        ...subtitle.map((t) => ({ text: t, fontSize: 8.2, color: SUB })),
        { text: ' ', fontSize: 8 },
        this.table_(
          columns.map((c) => ({ h: c.h, w: '*', align: c.align })),
          rows,
          { fontSize: 8, bold: (i) => i === totalAt },
        ),
      ],
      footer: await this.footer(),
    });
  }
}
