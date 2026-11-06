import { PdfService } from '../../common/pdf.service';
import { tglIndo } from '../../common/util';

// Empat jenis dokumen di luar alur transaksi. Isi dan urutannya mengikuti MTPP Docs.
export const DOC_TYPES: Record<string, { code: string; label: string; labelEn: string }> = {
  surat: { code: 'SP', label: 'Surat Resmi', labelEn: 'Official Letter' },
  bast: { code: 'BA', label: 'Berita Acara Serah Terima', labelEn: 'Handover Certificate' },
  bacomm: { code: 'BC', label: 'Berita Acara Commissioning', labelEn: 'Commissioning & Testing Report' },
  maintenance: { code: 'LM', label: 'Laporan Pemeliharaan', labelEn: 'Maintenance Service Report' },
};

const tgl = (d?: string) => (d ? tglIndo(d) : '');
const W = 595.28 - 90;
const nonEmpty = (t: any) => String(t ?? '').trim() !== '';

const to = (pdf: PdfService, d: any, label: string) => {
  const t = d.to || {};
  return pdf.party(label, t.company || t.person, [
    t.address, t.company && t.person ? `Up. / Attn: ${t.person}` : '', t.attn ? `Cc: ${t.attn}` : '',
    t.npwp ? `NPWP: ${t.npwp}` : '', t.phone ? `Telp / Phone: ${t.phone}` : '', t.email,
  ]);
};

const itemRows = (d: any) => (d.items || []).filter((i: any) => nonEmpty(i.desc) || nonEmpty(i.qty));
const items = (pdf: PdfService, d: any, emptyRow = false) => {
  const r = itemRows(d);
  if (!r.length && !emptyRow) return null;
  return pdf.table_(
    [{ h: 'No', w: 20, align: 'center' }, { h: 'Deskripsi Barang', en: 'Description', w: '*', desc: true }, { h: 'Qty', w: 40, align: 'right' }, { h: 'Satuan', en: 'Unit', w: 50 }],
    r.map((x: any, i: number) => [i + 1, x.desc, x.qty, x.unit]),
  );
};

const checks = (pdf: PdfService, d: any, first: string, en: string) => {
  const r = (d.checks || []).filter((x: any) => nonEmpty(x.item) || nonEmpty(x.result) || nonEmpty(x.note));
  return pdf.table_(
    [{ h: 'No', w: 20, align: 'center' }, { h: first, en, w: 235 }, { h: 'Hasil', en: 'Result', w: 70, align: 'center' }, { h: 'Keterangan', en: 'Notes', w: '*' }],
    r.map((x: any, i: number) => [i + 1, x.item, x.result, x.note]),
  );
};

const block = (pdf: PdfService, id: string, en: string, text: any) => (nonEmpty(text) ? [pdf.section(id, en, W), ...pdf.paragraphs(text)] : []);

// null bila seluruh data peralatan masih kosong, sehingga bloknya tidak dicetak
const equipment = (pdf: PdfService, d: any, extra: [string, any][] = []) => {
  const b = pdf.info('Data Peralatan / Equipment', [
    ['Merk / Brand', d.eqBrand], ['Tipe / Type', d.eqType], ['Kapasitas / Rating', d.eqRating], ['No. Seri / Serial', d.eqSerial], ...extra,
  ], W, 120);
  return b && { ...b, margin: [0, 0, 0, 12] };
};

export function renderDocument(pdf: PdfService, type: string, number: string, d: any, c: any): any[] {
  const signer = { name: d.signerName || c.signerName, title: d.signerTitle || c.signerTitle };
  switch (type) {
    case 'surat': {
      const ship = pdf.info('Alamat Tujuan / Delivery Address', [
        ['Alamat / Address', d.shipTo], ['Up. / Attn', d.shipContact], ['Diharapkan tiba / ETA', tgl(d.shipDate)],
      ], W, 120);
      return [
        pdf.title(d.subject || 'Surat', '', [['No.', 'No.', number], ['Tanggal', 'Date', tgl(d.date)], ['Lampiran', 'Attach.', d.attachment], ['Referensi', 'Ref.', d.refNumber]]),
        pdf.cols(to(pdf, d, 'Kepada / To')),
        ...pdf.paragraphs(d.body),
        items(pdf, d),
        ship && { ...ship, margin: [0, 0, 0, 10] },
        pdf.signOne({ place: `${c.city || ''}${d.date ? ', ' + tgl(d.date) : ''}`, salutation: 'Hormat kami,', company: c.name, ...signer, phone: d.signerPhone || c.signerPhone }),
        nonEmpty(d.cc) ? { text: `Tembusan / Cc: ${d.cc}`, fontSize: 8, color: '#625B55', margin: [0, 14, 0, 0] } : null,
      ];
    }
    case 'bast': {
      const p1 = { name: d.party1Name || c.signerName, title: d.party1Title || c.signerTitle, company: d.party1Company || c.name };
      return [
        pdf.title('Berita Acara Serah Terima', 'Handover Certificate', [['No.', 'No.', number], ['Tanggal', 'Date', tgl(d.date)], ['Lokasi', 'Location', d.location], ['Proyek', 'Project', d.project], ['PO Pelanggan', 'Customer PO', d.poNumber], ['Tanggal PO', 'PO Date', tgl(d.poDate)]]),
        ...pdf.paragraphs(`Pada hari ini, ${tgl(d.date) || '—'}, bertempat di ${d.location || '—'}, yang bertanda tangan di bawah ini:`),
        pdf.cols(
          pdf.info('Pihak Pertama / First Party', [['Nama / Name', p1.name], ['Jabatan / Title', p1.title], ['Perusahaan / Company', p1.company]]),
          pdf.info('Pihak Kedua / Second Party', [['Nama / Name', d.party2Name], ['Jabatan / Title', d.party2Title], ['Perusahaan / Company', d.party2Company]]),
        ),
        ...pdf.paragraphs(d.statement),
        items(pdf, d, true),
        ...block(pdf, 'Catatan Kondisi', 'Condition Notes', d.notes),
        ...pdf.paragraphs(d.closing),
        pdf.signGrid([
          { role: 'Pihak Kedua', sub: d.party2Company || 'Penerima', name: d.party2Name, title: d.party2Title },
          { role: 'Pihak Pertama', sub: p1.company, name: p1.name, title: p1.title },
        ]),
      ];
    }
    case 'bacomm':
      return [
        pdf.title('Berita Acara Commissioning & Testing', 'Commissioning & Testing Report', [['No.', 'No.', number], ['Tanggal', 'Date', tgl(d.date)], ['Pelaksanaan', 'Test Date', tgl(d.serviceDate)]]),
        pdf.cols(to(pdf, d, 'Pelanggan / Customer'), pdf.info('Pelaksanaan / Execution', [['Lokasi / Site', d.location], ['Proyek / Project', d.project], ['Teknisi / Engineer', d.technicians], ['Saksi / Witness', d.witness]])),
        equipment(pdf, d),
        ...pdf.paragraphs(d.statement),
        checks(pdf, d, 'Item Pengujian', 'Test Item'),
        ...block(pdf, 'Kesimpulan', 'Conclusion', d.result),
        ...pdf.paragraphs(d.notes),
        pdf.signGrid([
          { role: 'Pelanggan', sub: d.to?.company, name: d.to?.person, title: 'Nama & tanda tangan' },
          { role: 'Saksi', name: d.witness },
          { role: 'Pelaksana', sub: c.name, ...signer },
        ]),
      ];
    case 'maintenance': {
      const meas: [string, any, string][] = ([['Tegangan R–N', d.mR, 'V'], ['Tegangan S–N', d.mS, 'V'], ['Tegangan T–N', d.mT, 'V'], ['Arus R', d.mIR, 'A'], ['Arus S', d.mIS, 'A'], ['Arus T', d.mIT, 'A'], ['Tahanan isolasi', d.mIso, 'MΩ'], ['Tahanan pentanahan', d.mGnd, 'Ω'], ['Suhu', d.mTemp, '°C'], ['Beban', d.mLoad, '%']] as [string, any, string][]).filter((m) => nonEmpty(m[1]));
      const rows: any[][] = [];
      for (let i = 0; i < meas.length; i += 5) rows.push(meas.slice(i, i + 5));
      const notes = String(d.terms || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      const mat = items(pdf, d);
      return [
        pdf.title('Laporan Pemeliharaan', 'Maintenance Service Report', [['No.', 'No.', number], ['Tanggal', 'Date', tgl(d.date)], ['Pelaksanaan', 'Service Date', tgl(d.serviceDate)], ['Jenis', 'Type', d.serviceType]]),
        pdf.cols(to(pdf, d, 'Pelanggan / Customer'), pdf.info('Pelaksanaan / Execution', [['Lokasi / Site', d.location], ['Jam / Time', d.serviceTime], ['Teknisi / Technician', d.technicians], ['Status', d.status]])),
        equipment(pdf, d, [['Tahun / Year', d.eqYear], ['Jumlah / Qty', d.eqQty]]),
        pdf.section('Hasil Pemeriksaan', 'Inspection Result', W),
        checks(pdf, d, 'Pemeriksaan', 'Inspection Item'),
        ...(meas.length ? [pdf.section('Data Pengukuran', 'Measurements', W), {
          unbreakable: true, margin: [0, 0, 0, 10], stack: rows.map((r) => ({ columns: [0, 1, 2, 3, 4].map((i) => (r[i] ? { width: '*', margin: [0, 2, 0, 4], stack: [
            { text: r[i][0].toUpperCase(), fontSize: 6.6, color: '#625B55' },
            { text: [{ text: String(r[i][1]), bold: true, fontSize: 10 }, { text: ' ' + r[i][2], fontSize: 7, color: '#625B55' }] },
          ] } : { width: '*', text: '' })) })),
        }] : []),
        ...(mat ? [pdf.section('Material Terpakai', 'Materials Used', W), mat] : []),
        ...block(pdf, 'Temuan', 'Findings', d.findings),
        ...block(pdf, 'Tindakan', 'Action Taken', d.actions),
        ...block(pdf, 'Rekomendasi', 'Recommendation', d.recommendation),
        nonEmpty(d.nextService) ? { text: [{ text: 'Jadwal pemeliharaan berikutnya / Next service: ', bold: true }, tgl(d.nextService)], fontSize: 9.2, margin: [0, 0, 0, 8] } : null,
        ...(notes.length ? [pdf.section('Catatan', 'Notes', W), { ol: notes, fontSize: 8.4, color: '#625B55', margin: [0, 0, 0, 8] }] : []),
        pdf.signGrid([
          { role: 'Diperiksa & disetujui', sub: d.to?.company || 'Pelanggan / Customer', name: d.to?.person, title: 'Nama & tanda tangan' },
          { role: 'Teknisi Pelaksana', sub: c.name, name: d.technicians, title: 'Teknisi' },
          { role: 'Hormat kami', sub: c.name, ...signer },
        ]),
      ];
    }
  }
  return [];
}
