// Per-case boji invoice (kvitansiya) DOCX — auto-generated from the assigned
// receipt number. Shared by the /gen-invoice route and the one-click packet.
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import { BOJI_AMOUNT } from './konveyer-buxgalter';

export interface InvoiceData {
  clientName: string | null;
  kod: string | null;
  receiptNumber: string;
  assignedAt?: Date | null;   // when the kvitansiya was assigned; stable across re-downloads
  firm?: { shortName: string | null; legalName: string | null; stir: string | null; bankAccount: string | null; mfo: string | null } | null;
}

const money = (n: number) => new Intl.NumberFormat('ru-RU').format(n);
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

export async function buildInvoiceDocx(ac: InvoiceData): Promise<Buffer> {
  const firm = ac.firm;
  const p = (label: string, value: string) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun({ text: value })] });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: 'DAVLAT BOJI — HISOB-KVITANSIYA', bold: true, size: 28 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: `№ ${ac.receiptNumber}`, bold: true, size: 24 })] }),
        p('To‘lovchi (firma)', firm?.legalName || firm?.shortName || '—'),
        ...(firm?.stir ? [p('STIR', firm.stir)] : []),
        ...(firm?.bankAccount ? [p('Hisob raqami', firm.bankAccount)] : []),
        ...(firm?.mfo ? [p('MFO', firm.mfo)] : []),
        p('Qarzdor', ac.clientName || '—'),
        p('Summasi', `${money(BOJI_AMOUNT)} so‘m`),
        p('Sana', dmy(ac.assignedAt ?? new Date())),
        new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: 'Maqsad: sudga ariza uchun davlat boji to‘lovi.', italics: true })] }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
