import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { AuthUser, CurrentUser } from '../../shared/auth';
import { REPORTS_BY_GROUP } from '../../shared/menus';
import { PdfService } from '../../shared/pdf.service';
import { SettingsService } from '../../shared/settings.service';
import { idr, num, tglIndo, today } from '../../shared/util';
import { Col, REPORT_TITLES } from './reports.helpers';
import { ReportsService } from './reports.service';

const fmt = (v: any, c: Col) => {
  if (v == null || v === '') return '';
  if (c.type === 'money') return idr(v);
  if (c.type === 'qty') return num(v, Number(v) % 1 ? 2 : 0);
  if (c.type === 'pct') return num(v, 2) + '%';
  if (c.type === 'date') return tglIndo(String(v));
  return String(v);
};

@Controller('reports')
export class ReportsController {
  constructor(
    private r: ReportsService,
    private pdf: PdfService,
    private settings: SettingsService,
  ) {}

  @Get() list(@CurrentUser() u: AuthUser) {
    return (REPORTS_BY_GROUP[u.group] || []).map((k) => ({ key: k, title: REPORT_TITLES[k] }));
  }
  @Get(':key') get(@CurrentUser() u: AuthUser, @Param('key') key: string, @Query() q: any) {
    return this.r.build(u, key, q);
  }

  // Ekspor laporan ke spreadsheet atau PDF: judul, periode, filter, tanggal cetak, seluruh baris
  @Get(':key/export')
  async export(@CurrentUser() u: AuthUser, @Param('key') key: string, @Query() q: any, @Res() res: Response) {
    const rep = await this.r.build(u, key, q);
    const company = await this.settings.get('company');
    const printed = `Dicetak ${tglIndo(today())} oleh ${u.name}`;
    const fname = `${rep.title.replace(/\W+/g, '_')}_${today()}`;
    const totalRow = rep.totals
      ? rep.columns.map((c, i) => (i === 0 ? 'Total' : rep.totals![c.key] !== undefined ? rep.totals![c.key] : null))
      : null;
    if (q.format === 'pdf') {
      const rows = rep.rows.map((r) => rep.columns.map((c) => fmt(r[c.key], c)));
      if (totalRow) rows.push(totalRow.map((v, i) => (i === 0 ? 'Total' : v == null ? '' : fmt(v, rep.columns[i]))));
      const buf = await this.pdf.table(
        rep.title,
        ['Periode: ' + rep.period, ...rep.filters, printed],
        rep.columns.map((c) => ({
          h: c.title,
          align: ['money', 'qty', 'pct'].includes(c.type as string) ? 'right' : 'left',
        })),
        rows,
        rep.columns.length > 6,
      );
      res
        .set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname}.pdf"` })
        .send(buf);
      return;
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistem Distribusi MTPP';
    const ws = wb.addWorksheet(rep.title.slice(0, 30));
    ws.addRow([rep.title]).font = { bold: true, size: 14 };
    ws.addRow([company.name]);
    ws.addRow(['Periode: ' + rep.period]);
    for (const f of rep.filters) ws.addRow([f]);
    ws.addRow([printed]);
    ws.addRow([]);
    const h = ws.addRow(rep.columns.map((c) => c.title));
    h.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A4A' } };
    });
    for (const r of rep.rows)
      ws.addRow(
        rep.columns.map((c) =>
          ['money', 'qty', 'pct'].includes(c.type as string)
            ? Number(r[c.key] ?? 0)
            : c.type === 'date' && r[c.key]
              ? String(r[c.key]).slice(0, 10)
              : (r[c.key] ?? ''),
        ),
      );
    if (totalRow) ws.addRow(totalRow).font = { bold: true };
    rep.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.type === 'money' ? 18 : c.type ? 12 : 28;
      if (c.type === 'money') col.numFmt = '#,##0';
    });
    const buf = await wb.xlsx.writeBuffer();
    res
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fname}.xlsx"`,
      })
      .send(Buffer.from(buf as ArrayBuffer));
  }
}
