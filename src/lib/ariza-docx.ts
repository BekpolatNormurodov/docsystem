import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  BorderStyle, WidthType, AlignmentType, VerticalAlign,
} from 'docx';
import { dmy, formatSumDecimal, uzLongDateLatin, arizaHeaderDate } from '@/core/document';
import { CHAMBER } from '@/core/chamber';
import { CHAMBER_EMBLEM_DATA_URL } from '@/ui/chamber-emblem.data';
import type { CourtArizaDocumentProps } from '@/ui/CourtArizaDocument';

const FONT = 'Times New Roman';
// Every edge NONE — including the inside borders between cells — so no gridlines print anywhere.
const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

/** «14.04.2026-yildagi 22548-sonli, …» — the ariza lists contracts inline in Latin. When a contract
 * has no date, the «-yildagi» prefix is dropped so it never prints a dangling «-yildagi 185-sonli». */
function contractsText(contracts: CourtArizaDocumentProps['contracts']): string {
  return contracts
    .map((c) => {
      const d = dmy(c.date);
      return d ? `${d}-yildagi ${c.number}-sonli` : `${c.number}-sonli`;
    })
    .join(', ');
}

/** A justified body paragraph, first-line indented 709 twips (1.25cm), matching CourtArizaDocument. */
function bodyPara(runs: TextRun[]): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 709 },
    spacing: { after: 120 },
    children: runs,
  });
}

function run(text: string, opts: { bold?: boolean; size?: number; italics?: boolean } = {}): TextRun {
  return new TextRun({ text, font: FONT, size: 28, ...opts });
}

/**
 * Builds the chamber ariza («Sud buyrugʻi berish haqida») as a real .docx, mirroring
 * `CourtArizaDocument` (the React source of truth) verbatim in wording. No QR.
 */
export async function buildArizaDocx(props: CourtArizaDocumentProps): Promise<Buffer> {
  const { firm } = props;
  const firmName = firm.arizaName || firm.letterheadName || firm.name;
  const firmAddress = firm.arizaAddress || firm.address;

  const collectorRekvizit = [
    firmAddress && `${firmAddress}.`,
    firm.bankAccount && `X/R: ${firm.bankAccount},`,
    firm.mfo && `MFO: ${firm.mfo},`,
    firm.stir && `STIR: ${firm.stir}`,
  ].filter(Boolean).join(' ');

  // Decode the emblem's base64 payload (after the comma) into image bytes.
  const emblemBase64 = CHAMBER_EMBLEM_DATA_URL.split(',')[1] ?? '';
  const emblemBuffer = Buffer.from(emblemBase64, 'base64');

  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDER,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            borders: NO_BORDER,
            verticalAlign: VerticalAlign.TOP,
            children: [
              new Paragraph({
                children: [
                  new ImageRun({
                    type: 'png',
                    data: emblemBuffer,
                    transformation: { width: 196, height: 69 }, // larger, keeps the ~2.84:1 ratio
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 60, type: WidthType.PERCENTAGE },
            borders: NO_BORDER,
            verticalAlign: VerticalAlign.TOP,
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [run(CHAMBER.branchName, { bold: true, size: 26 })],
              }),
              ...CHAMBER.contact.map((line) => new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [run(line, { size: 20 })],
              })),
            ],
          }),
        ],
      }),
    ],
  });

  // Parties block — a borderless 3-column table (label 40% right-aligned | 5% spacer | value 55%),
  // 1:1 with the ideal HTML (CourtArizaDocument's parties table). A table (not tab-stops) is required
  // so a LONG label like «Palata aʼzosi manfaatida undiruvchi:» WRAPS inside its own column instead of
  // overflowing a fixed tab stop and colliding with the value — that overflow was the garbled («rasvo»)
  // look. Borders are all NONE; the faint on-screen gridline Word may show is non-printing.
  type LineOpt = { bold?: boolean; size?: number; italics?: boolean };
  const valuePara = (text: string, opts?: LineOpt) =>
    new Paragraph({ spacing: { after: 20, line: 264, lineRule: 'auto' }, children: [run(text, opts)] });
  const partyRow = (label: string, lines: { text: string; opts?: LineOpt }[]): TableRow =>
    new TableRow({
      children: [
        new TableCell({
          width: { size: 40, type: WidthType.PERCENTAGE }, borders: NO_BORDER, verticalAlign: VerticalAlign.TOP,
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { line: 264, lineRule: 'auto' }, children: label ? [run(label, { size: 22 })] : [] })],
        }),
        new TableCell({ width: { size: 5, type: WidthType.PERCENTAGE }, borders: NO_BORDER, children: [new Paragraph({ children: [] })] }),
        new TableCell({
          width: { size: 55, type: WidthType.PERCENTAGE }, borders: NO_BORDER, verticalAlign: VerticalAlign.TOP,
          children: lines.map((l) => valuePara(l.text, l.opts)),
        }),
      ],
    });

  const partyTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDER,
    rows: [
      partyRow('', [{ text: props.courtName, opts: { bold: true, italics: true } }]),
      partyRow('Arizachi:', [
        { text: CHAMBER.applicantName, opts: { bold: true, italics: true } },
        ...CHAMBER.applicantAddress.map((l) => ({ text: l, opts: { italics: true, size: 24 } })),
        { text: `STIR ${CHAMBER.applicantStir}.`, opts: { italics: true, size: 24 } },
      ]),
      partyRow(CHAMBER.collectorLabel.join(' '), [
        { text: firmName, opts: { bold: true, italics: true, size: 26 } },
        ...(collectorRekvizit ? [{ text: collectorRekvizit, opts: { italics: true, size: 24 } }] : []),
      ]),
      partyRow('Qarzdor:', [
        { text: props.personFullName, opts: { bold: true, italics: true } },
        { text: props.personAddress, opts: { italics: true, size: 24 } },
        { text: `JShShIR: ${props.personPinfl}`, opts: { italics: true, size: 24 } },
        { text: `Tel:  ${props.personPhone}`, opts: { italics: true, size: 24 } },
      ]),
    ],
  });

  const children: (Paragraph | Table)[] = [
    headerTable,

    // Spacing under the letterhead (the horizontal rule was removed per request).
    new Paragraph({ spacing: { before: 40, after: 80 }, children: [] }),

    // Date / number — the register number is a manual fill-in blank, as on the printed blank.
    new Paragraph({ spacing: { before: 120 }, children: [run(arizaHeaderDate(props.issueDate), { size: 24 })] }),
    new Paragraph({ children: [run(props.number ? `№ ${props.number}` : '№_____________', { size: 24 })] }),
    // One blank line between the header block and the parties form.
    new Paragraph({ children: [] }),

    // Parties block — borderless label|spacer|value table (1:1 with the ideal HTML).
    partyTable,
    // One blank line after the parties form.
    new Paragraph({ spacing: { after: 60 }, children: [] }),

    // Title
    new Paragraph({
      spacing: { before: 320 },
      alignment: AlignmentType.CENTER,
      children: [run('A R I Z A', { bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [run('(Sud buyrugʻi berish haqida)', { size: 24 })],
    }),

    // Body
    bodyPara([run(
      'Oʻzbekiston Respublikasi «Savdo-sanoat palatasi toʻgʻrisida»gi Qonunning 21-moddasi hamda '
      + 'Oʻzbekiston Respublikasi “Davlat boji toʻgʻrisida”gi Qonuni 8-9-moddasida Oʻzbekiston '
      + 'Savdo-sanoat palatasi va uning hududiy boshqarmalari-palata aʼzolarining manfaatlarini koʻzlab '
      + 'qilingan daʼvolar yuzasidan davlat boji toʻlashdan ozod etilgan.',
    )]),
    bodyPara([run('Ish hujjatlari oʻrganilganda quyidagilar maʼlum boʻldi:')]),
    bodyPara([
      run(firmName, { bold: true }),
      run(` va fuqaro oʻrtasida ${contractsText(props.contracts)} “${props.contractType}” shartnomalariga asosan, yillik ${props.interestRate}% ustama haq toʻlash sharti bilan jami ${formatSumDecimal(props.loanAmount)} soʻm miqdorida kredit mablagʻi ajratilgan.`),
    ]),
    bodyPara([run(
      'Qarzdor tomonidan shartnomaga muvofiq qarzning asosiy qismini va foiz toʻlovlarini grafik asosida '
      + 'amalga oshirish majburiyatini oʻz zimmasiga olgan.',
    )]),
    bodyPara([run(
      'Mikro moliya tashkiloti tomonidan qarzdorga muddati oʻtgan qarzdorligi toʻgʻrisida rasmiy '
      + 'ogohlantirish xati yuborilgan boʻlishiga qaramasdan hozirgi kunga qadar toʻlovni ixtiyoriy '
      + 'ravishda amalga oshirmagan.',
    )]),
    bodyPara([run(
      `Shunga koʻra, qarzdor oʻz majburiyatlarini bajarmasligi natijasida ${props.asOfText || uzLongDateLatin(props.asOfDate)} holatiga koʻra mikro `
      + 'moliya tashkiloti oldidagi qarzdorligi quyidagicha:',
    )]),
    // Itemized breakdown — the four components (Asosiy qarz + the two foiz states +
    // muddati oʻtgan qarz) the «quyidagicha:» sentence promises, then the total.
    ...(([
      ['Asosiy qarz qoldigʻi', props.debtPrincipal],
      ['Muddatli foizlar qarzdorligi', props.debtTermInterest],
      ['Muddati oʻtgan qarz qarzdorligi', props.debtOverduePrincipal],
      ['Muddati oʻtgan foizlar qarzdorligi', props.debtOverdueInterest],
    ] as [string, string][]).map(([label, val], i, arr) => new Paragraph({
      indent: { left: 709 },
      spacing: { after: 40 },
      children: [run(`— ${label}: `), run(`${formatSumDecimal(val)} soʻm`, { bold: true }), run(i === arr.length - 1 ? '.' : ';')],
    }))),
    // Total on its own line, set apart with spacing above/below.
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      indent: { firstLine: 709 },
      spacing: { before: 160, after: 200 },
      children: [
        run('Jami qarzdorligi  '),
        run(`${formatSumDecimal(props.debtTotal)} soʻm`, { bold: true }),
        run('ni tashkil etadi.'),
      ],
    }),
    bodyPara([run(
      'Shuningdek, qarzdor tomonidan yuqorida koʻrsatib oʻtilgan kredit qarzi toʻlovlarini oʻz vaqtida '
      + 'amalga oshirilmaganligi sababli, bankning moliyaviy xolatiga jiddiy taʼsir qilmoqda.',
    )]),
    bodyPara([run(
      'Yuqorida keltirilganlariga hamda Oʻzbekiston Respublikasi FKning tegishli moddalari talablariga '
      + 'asosan, Sizdan quyidagilarni',
    )]),

    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 160 },
      children: [run('S Oʻ R A Y M I Z:')],
    }),

    bodyPara([run('1. Mazkur arizani davlat bojisiz ish yurituvingizga qabul qilishingizni;')]),
    bodyPara([
      run('2. Qarzdor '),
      run(props.personFullName, { bold: true }),
      run('dan '),
      run(firmName, { bold: true }),
      run(' foydasiga jami boʻlib '),
      run(`${formatSumDecimal(props.debtTotal)} soʻm`, { bold: true }),
      run(' qarzdorlik va pochta xarajatlari toʻlovini undirish boʻyicha sud buyrugʻini chiqarishingizni;'),
    ]),

    // Attachments
    new Paragraph({
      spacing: { before: 120 },
      indent: { firstLine: 567 },
      children: [run('Ilova qilingan hujjatlar roʻyxati:')],
    }),
    ...CHAMBER.attachments.map((a, i) => new Paragraph({
      indent: { firstLine: 567 },
      children: [run(`${i + 1}. ${a}`)],
    })),

    // Signature row
    new Paragraph({
      spacing: { before: 480 },
      tabStops: [{ type: 'right', position: 9026 }],
      children: [
        run(props.chamberSignerPosition, { bold: true }),
        run('\t'),
        run(props.chamberSignerName, { bold: true }),
      ],
    }),

    // Ijrochi footer
    new Paragraph({
      spacing: { before: 280 },
      children: [run(`Ijrochi: ${props.chamberExecutorName}`, { size: 20 })],
    }),
    new Paragraph({
      children: [run(`Telefon: ${props.chamberExecutorPhone}`, { size: 20 })],
    }),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 28 },
        },
      },
    },
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
