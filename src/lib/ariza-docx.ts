import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  BorderStyle, WidthType, AlignmentType, VerticalAlign,
} from 'docx';
import { dmy, formatSumDecimal, uzLongDateLatin, arizaHeaderDate } from '@/core/document';
import { CHAMBER } from '@/core/chamber';
import { CHAMBER_EMBLEM_DATA_URL } from '@/ui/chamber-emblem.data';
import type { CourtArizaDocumentProps } from '@/ui/CourtArizaDocument';

const FONT = 'Times New Roman';
const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

/** «14.04.2026-yildagi 22548-sonli, …» — the ariza lists contracts inline in Latin. */
function contractsText(contracts: CourtArizaDocumentProps['contracts']): string {
  return contracts.map((c) => `${dmy(c.date)}-yildagi ${c.number}-sonli`).join(', ');
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

function run(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun {
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
                    transformation: { width: 159, height: 56 }, // ~ 70.9mm x 25.1mm at 96dpi ratio
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

  const children: (Paragraph | Table)[] = [
    headerTable,

    // Date / number
    new Paragraph({ spacing: { before: 240 }, children: [run(arizaHeaderDate(props.issueDate), { size: 24 })] }),
    ...(props.number ? [new Paragraph({ children: [run(`№ ${props.number}`, { size: 24 })] })] : []),

    // Court addressee
    new Paragraph({
      spacing: { before: 280 },
      children: [run(props.courtName, { bold: true })],
    }),

    // Arizachi
    new Paragraph({ spacing: { before: 280 }, children: [run('Arizachi:')] }),
    new Paragraph({ children: [run(CHAMBER.applicantName, { bold: true })] }),
    ...CHAMBER.applicantAddress.map((line) => new Paragraph({ children: [run(line)] })),
    new Paragraph({ children: [run(`STIR ${CHAMBER.applicantStir}.`)] }),

    // Undiruvchi
    new Paragraph({ spacing: { before: 240 }, children: [run(CHAMBER.collectorLabel.join(' '))] }),
    new Paragraph({ children: [run(firmName, { bold: true, size: 24 })] }),
    ...(collectorRekvizit ? [new Paragraph({ children: [run(collectorRekvizit, { size: 24 })] })] : []),

    // Qarzdor
    new Paragraph({ spacing: { before: 240 }, children: [run('Qarzdor:')] }),
    new Paragraph({ children: [run(props.personFullName, { bold: true })] }),
    new Paragraph({ children: [run(props.personAddress)] }),
    new Paragraph({ children: [run(`JShShIR: ${props.personPinfl}`)] }),
    new Paragraph({ children: [run(`Tel:  ${props.personPhone}`, { size: 20 })] }),

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
    bodyPara([run(`Asosiy qarz qoldigʻi -  ${formatSumDecimal(props.debtPrincipal)} soʻm;`)]),
    bodyPara([run(`Muddatli foizlar qarzdorligi -  ${formatSumDecimal(props.debtTermInterest)} soʻm;`)]),
    bodyPara([run(`Muddati oʻtgan qarz qarzdorligi -  ${formatSumDecimal(props.debtOverduePrincipal)} soʻm;`)]),
    bodyPara([run(`Muddati oʻtgan foizlar qarzdorligi -  ${formatSumDecimal(props.debtOverdueInterest)} soʻm;`)]),
    bodyPara([
      run('Jami qarzdorligi  '),
      run(`${formatSumDecimal(props.debtTotal)} soʻm`, { bold: true }),
      run('ni tashkil etadi.'),
    ]),
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
