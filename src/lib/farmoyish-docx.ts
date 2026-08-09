// Buxgalteriya farmoyishi (postal-fee directive) DOCX for an invoice batch —
// mirrors the real form: header + intro + table (№ | FIO | Kod | 20 600 | kvitansiya).
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, BorderStyle, WidthType, AlignmentType } from 'docx';
import { prisma } from './db';
import { POSTAL_FEE } from './konveyer-buxgalter';

const FONT = 'Times New Roman';
const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const CELL_BORDERS = { top: border, bottom: border, left: border, right: border };

function cell(text: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; width?: number } = {}) {
  return new TableCell({
    borders: CELL_BORDERS,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ alignment: opts.align ?? AlignmentType.LEFT, children: [new TextRun({ text, bold: opts.bold, font: FONT, size: 22 })] })],
  });
}

export async function buildFarmoyishDocx(batchId: number): Promise<{ buffer: Buffer; fileName: string }> {
  const batch = await prisma.invoiceBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { firm: true, cases: { orderBy: { id: 'asc' }, select: { clientName: true, kod: true, receiptNumber: true } } },
  });
  const rows = batch.cases.filter((c) => c.receiptNumber);

  const p = (text: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
    new Paragraph({ alignment: opts.align ?? AlignmentType.LEFT, spacing: { after: 120 }, children: [new TextRun({ text, bold: opts.bold, font: FONT, size: 24 })] });

  const header = [
    new TableRow({
      tableHeader: true,
      children: [
        cell('№', { bold: true, align: AlignmentType.CENTER, width: 6 }),
        cell('Қарздор ФИО', { bold: true, align: AlignmentType.CENTER, width: 44 }),
        cell('Код', { bold: true, align: AlignmentType.CENTER, width: 15 }),
        cell('Почта харажати', { bold: true, align: AlignmentType.CENTER, width: 15 }),
        cell('Квитанция рақами', { bold: true, align: AlignmentType.CENTER, width: 20 }),
      ],
    }),
    ...rows.map((c, i) =>
      new TableRow({
        children: [
          cell(String(i + 1), { align: AlignmentType.CENTER }),
          cell(c.clientName ?? '—'),
          cell(c.kod ?? '—', { align: AlignmentType.CENTER }),
          cell(POSTAL_FEE.toLocaleString('ru-RU'), { align: AlignmentType.CENTER }),
          cell(c.receiptNumber ?? '', { align: AlignmentType.CENTER }),
        ],
      }),
    ),
  ];

  const doc = new Document({
    sections: [{
      children: [
        p('Бухгалтерия фармойиши', { bold: true, align: AlignmentType.CENTER }),
        p(`${batch.firm.shortName}`, { bold: true, align: AlignmentType.CENTER }),
        p(`Кредит қарздорликларни ундириш жараёнида фуқаролик ишлари бўйича судга суд буйруғи бериш учун ариза киритилаётганлиги сабабли, почта харажатлари учун рўйхатдаги хос рақамларга ҳар бирига ${POSTAL_FEE.toLocaleString('ru-RU')} сўмдан тўлансин. Жами: ${rows.length} та.`),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: header }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const safe = batch.firm.shortName.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  return { buffer, fileName: `Farmoyish_${safe}_${batchId}.docx` };
}
