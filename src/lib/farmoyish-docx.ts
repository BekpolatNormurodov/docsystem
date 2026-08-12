// Buxgalteriya farmoyishi (postal-fee directive) DOCX for an invoice batch — mirrors the real form:
// title + date + intro (full legal name + the firm's inter-district court) + table + signature block.
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, BorderStyle, WidthType, AlignmentType, TabStopType } from 'docx';
import { prisma } from './db';
import { POSTAL_FEE } from './konveyer-buxgalter';

const FONT = 'Times New Roman';
const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const CELL_BORDERS = { top: border, bottom: border, left: border, right: border };
const pad = (n: number) => String(n).padStart(2, '0');

// The firm's billing tuman (Cyrillic, e.g. "Учтепа тумани") → its inter-district court in the dative,
// "Учтепа туманлараро судига", matching the real farmoyish. Only for a genuine "…тумани" district;
// anything else (city/viloyat, or missing) falls back to the generic "судга" so we never invent a
// court that doesn't fit.
export function courtFromDistrict(district?: string | null): string | null {
  const m = /^(.*?)\s*тумани$/i.exec((district ?? '').trim());
  return m && m[1].trim() ? `${m[1].trim()} туманлараро судига` : null;
}

function cell(text: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; width?: number } = {}) {
  return new TableCell({
    borders: CELL_BORDERS,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ alignment: opts.align ?? AlignmentType.LEFT, children: [new TextRun({ text, bold: opts.bold, font: FONT, size: 22 })] })],
  });
}

export interface FarmoyishRow { clientName: string | null; kod: string | null; receiptNumber: string | null }
export interface FarmoyishInput {
  legalName: string; // full legal name (falls back to shortName upstream)
  district?: string | null; // billing tuman → court
  phone?: string | null;
  date: Date; // batch date, printed as "DD.MM.YYYY й"
  rows: FarmoyishRow[];
}

/** Pure doc builder — no DB. Parameterised so it can be rendered and asserted in tests. */
export async function renderFarmoyishDocx(input: FarmoyishInput): Promise<Buffer> {
  const { legalName, district, phone, date, rows } = input;
  const court = courtFromDistrict(district) ?? 'судга';
  const dateStr = `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()} й`;
  const run = (text: string, bold = false) => new TextRun({ text, bold, font: FONT, size: 24 });

  const tableRows = [
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
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [run('Бухгалтерия фармойиши', true)] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 160 }, children: [run(dateStr)] }),
        new Paragraph({
          alignment: AlignmentType.BOTH,
          spacing: { after: 160 },
          children: [run(
            `${legalName} кредит қарздорликларни ундириш жараёнида фуқаролик ишлари бўйича ${court} суд буйруғи бериш учун ариза киритилаётганлиги сабабли, почта харажатлари учун рўйхатдаги хос рақамларга тўлансин.`,
          )],
        }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }),

        // ── Signature block (mirrors the real form). Director/executor NAMES are not in the DB, so
        // they are left as fill-in lines rather than invented; only real firm data is printed.
        new Paragraph({
          spacing: { before: 360, after: 40 },
          tabStops: [{ type: TabStopType.RIGHT, position: 9600 }],
          children: [run(`${legalName} Ижрожи директори`), run('\t______________________')],
        }),
        new Paragraph({
          spacing: { after: 40 },
          tabStops: [{ type: TabStopType.RIGHT, position: 9600 }],
          children: [run('Ижрочи: ______________________'), run('\t______________________')],
        }),
        new Paragraph({ children: [run(`Tel: ${phone ?? '________________'}`)] }),
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

export async function buildFarmoyishDocx(batchId: number): Promise<{ buffer: Buffer; fileName: string }> {
  const batch = await prisma.invoiceBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { firm: true, cases: { orderBy: { id: 'asc' }, select: { clientName: true, kod: true, receiptNumber: true } } },
  });
  const firm = batch.firm;
  const buffer = await renderFarmoyishDocx({
    legalName: firm.legalName || firm.shortName,
    district: firm.district,
    phone: firm.phone,
    date: batch.createdAt,
    rows: batch.cases.filter((c) => c.receiptNumber),
  });
  const safe = firm.shortName.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  return { buffer, fileName: `Farmoyish_${safe}_${batchId}.docx` };
}
