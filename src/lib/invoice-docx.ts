// Per-case boji invoice (kvitansiya) DOCX — auto-generated from the assigned
// receipt number. Shared by the /gen-invoice route and the one-click packet.
// Rendered as a real bordered receipt (label | value), not loose paragraphs.
import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, BorderStyle, WidthType, VerticalAlign,
} from 'docx';
import { getBojiAmount } from './konveyer-buxgalter';

export interface InvoiceData {
  clientName: string | null;
  kod: string | null;
  receiptNumber: string;
  assignedAt?: Date | null;   // when the kvitansiya was assigned; stable across re-downloads
  amount?: number;            // davlat-boji soʻm; defaults to the saved setting when omitted
  firm?: { shortName: string | null; legalName: string | null; stir: string | null; bankAccount: string | null; mfo: string | null } | null;
}

const FONT = 'Times New Roman';
const money = (n: number) => new Intl.NumberFormat('ru-RU').format(n);
// null/NaN-safe (same guard as core dmy) — never emit "NaN.NaN.NaN" on a legal doc.
const dmy = (d: Date | null | undefined) => {
  if (!d || Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const CELL = { top: border, bottom: border, left: border, right: border };

function row(label: string, value: string, opts: { strong?: boolean } = {}): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        borders: CELL, width: { size: 34, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.CENTER,
        shading: { fill: 'F5F5F5' },
        children: [new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ text: label, font: FONT, size: 22, color: '444444' })] })],
      }),
      new TableCell({
        borders: CELL, width: { size: 66, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ text: value, font: FONT, size: opts.strong ? 24 : 22, bold: !!opts.strong })] })],
      }),
    ],
  });
}

export async function buildInvoiceDocx(ac: InvoiceData): Promise<Buffer> {
  const firm = ac.firm;
  const amount = ac.amount ?? await getBojiAmount();
  const rows: TableRow[] = [
    row('To‘lovchi (firma)', firm?.legalName || firm?.shortName || '—', { strong: true }),
    ...(firm?.stir ? [row('STIR', firm.stir)] : []),
    ...(firm?.bankAccount ? [row('Hisob raqami (X/R)', firm.bankAccount)] : []),
    ...(firm?.mfo ? [row('MFO', firm.mfo)] : []),
    row('Qarzdor', ac.clientName || '—'),
    row('To‘lov summasi', `${money(amount)} so‘m`, { strong: true }),
    row('Sana', dmy(ac.assignedAt ?? new Date())),
    row('Maqsad', 'Sudga ariza (sud buyrug‘i) uchun davlat boji to‘lovi'),
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: 'DAVLAT BOJI TO‘LOV KVITANSIYASI', bold: true, size: 30, font: FONT })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: `Kvitansiya № ${ac.receiptNumber}`, bold: true, size: 26, font: FONT, color: '1F5FBF' })] }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
        new Paragraph({ spacing: { before: 220 }, children: [new TextRun({ text: 'Ushbu kvitansiya davlat boji to‘lovini tasdiqlaydi.', italics: true, size: 20, font: FONT, color: '777777' })] }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
