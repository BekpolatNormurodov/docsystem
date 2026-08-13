// Buxgalteriya farmoyishi (postal-fee directive) DOCX for an invoice batch — mirrors the real form:
// title + date + intro (full legal name + the firm's inter-district court) + table + signature block.
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, BorderStyle, WidthType, AlignmentType, TabStopType } from 'docx';
import { prisma } from './db';
import { POSTAL_FEE } from './konveyer-buxgalter';

const FONT = 'Times New Roman';
const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const CELL_BORDERS = { top: border, bottom: border, left: border, right: border };
const pad = (n: number) => String(n).padStart(2, '0');

// Bank name by MFO — every firm banks at ANORBANK today (MFO 01183), printed in the letterhead
// rekvizit («… МФО 01183 АО "ANORBANK"»). Unknown MFO → bank name simply omitted.
const BANK_BY_MFO: Record<string, string> = { '01183': 'АО "ANORBANK"' };

// Farmoyish signatories — the FIRM's OWN executive director + executor (ижрочи) FIO, per firm code.
// These are firm officers (NOT the chamber signer in Settings) and aren't in the DB, so — like
// FIRMS_SEED — they're seeded here from the firms' real farmoyish letterheads. A firm with no entry
// prints blank fill-in lines rather than an invented name.
export const FARMOYISH_SIGNERS: Record<string, { director: string; executor: string }> = {
  '06292': { director: 'Ё.А.Хасанов', executor: 'Л.Сурманов' }, // URBAN FINANCE SOLUTIONS
};

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
  // Letterhead rekvizit (running header) — the header is omitted if none are present.
  address?: string | null;
  stir?: string | null; // ИНН
  bankAccount?: string | null; // Х/р
  mfo?: string | null; // МФО
  // Signatories — blank fill-in lines when absent (see FARMOYISH_SIGNERS).
  directorName?: string | null;
  executorName?: string | null;
}

/** Pure doc builder — no DB. Parameterised so it can be rendered and asserted in tests. */
export async function renderFarmoyishDocx(input: FarmoyishInput): Promise<Buffer> {
  const { legalName, district, phone, date, rows, directorName, executorName } = input;
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

  // ── Letterhead running header — assembled from the firm's rekvizit (legal name + address + ИНН +
  // Х/р + МФО + bank). Auto-fills per firm; omitted entirely if no rekvizit data is present.
  const hdr = (text: string, bold = false, size = 18) => new TextRun({ text, font: FONT, size, bold });
  const rekvizit: string[] = [];
  if (input.address) rekvizit.push(`${input.address}.`);
  if (input.stir) rekvizit.push(`ИНН ${input.stir.replace(/\s+/g, '')}.`);
  const bankBits: string[] = [];
  if (input.bankAccount) bankBits.push(`Х/р ${input.bankAccount}`);
  if (input.mfo) bankBits.push(`МФО ${input.mfo}`);
  const bankName = input.mfo ? BANK_BY_MFO[input.mfo] : undefined;
  if (bankName) bankBits.push(bankName);
  if (bankBits.length) rekvizit.push(bankBits.join(' '));
  const rekvizitLine = rekvizit.join(' ');
  const header = (legalName || rekvizitLine)
    ? new Header({
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [hdr(legalName, true, 22)] }),
          ...(rekvizitLine
            ? [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 40 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 1 } },
                children: [hdr(rekvizitLine)],
              })]
            : []),
        ],
      })
    : undefined;

  const doc = new Document({
    sections: [{
      ...(header ? { headers: { default: header } } : {}),
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [run('Бухгалтерия фармойиши', true)] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 160 }, children: [run(dateStr)] }),
        new Paragraph({
          alignment: AlignmentType.BOTH,
          spacing: { after: 160 },
          children: [run(
            `${legalName} кредит қарздорликларни ундириш жараёнида фуқаролик ишлари бўйича ${court} суд буйруғи бериш учун ариза киритилаётганлиги сабабли, почта харажатлари учун рўйхатдаги хос рақамларга тўлансин.`,
          )],
        }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }),

        // ── Signature block (mirrors the real form): director name to the right of «Ижрожи директори»,
        // then «Ижрочи: <name>», then the firm phone. Names come from FARMOYISH_SIGNERS; a firm with no
        // seeded officer prints a blank fill-in line rather than an invented name.
        new Paragraph({
          spacing: { before: 360, after: 40 },
          tabStops: [{ type: TabStopType.RIGHT, position: 9600 }],
          children: [run(`${legalName} Ижрожи директори`), run('\t' + (directorName || '______________________'))],
        }),
        new Paragraph({
          spacing: { after: 40 },
          children: [run('Ижрочи: ' + (executorName || '______________________'))],
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
  const signers = FARMOYISH_SIGNERS[firm.code];
  const buffer = await renderFarmoyishDocx({
    legalName: firm.legalName || firm.shortName,
    district: firm.district,
    phone: firm.phone,
    date: batch.createdAt,
    rows: batch.cases.filter((c) => c.receiptNumber),
    address: firm.address,
    stir: firm.stir,
    bankAccount: firm.bankAccount,
    mfo: firm.mfo,
    directorName: signers?.director,
    executorName: signers?.executor,
  });
  const safe = firm.shortName.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  return { buffer, fileName: `Farmoyish_${safe}_${batchId}.docx` };
}
