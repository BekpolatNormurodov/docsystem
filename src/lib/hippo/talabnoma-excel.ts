// Build the "tayyor Excel" for xat.hippo.uz from docsystem court-list loans,
// in the exact column shape of `talabnoma BRIGHT.xlsx`.
//
// One row per (client × firm) — same grouping as the court ariza. Row 1 is the
// machine header hippo reads; row 2 is the human label row (skipped on import);
// data starts at row 3. Names/addresses stay Cyrillic; region/area are hippo
// numeric IDs; amounts also emitted in Uzbek Cyrillic words.
import ExcelJS from 'exceljs';
import { numberToUzWords } from '@/core/uz-number-words';
import { resolveHippoRegionArea } from '@/core/hippo-regions';
import { latinToCyrillic } from '@/core/uz-latin-to-cyrillic';

// Machine header (row 1) — exact keys the hippo importer maps.
export const TALABNOMA_COLUMNS = [
  'date', 'contract_id', 'address', 'receiver', 'contract_date', 'contract_number',
  'loan_amount', 'loan_amount_words', 'total_debt', 'total_debt_words', 'region', 'area',
] as const;

// Human labels (row 2) — copied from the reference file.
const HUMAN_LABELS: Record<(typeof TALABNOMA_COLUMNS)[number], string> = {
  date: 'Hujjat sanasi', contract_id: 'Shartnoma ID', address: 'Manzil (Uy)', receiver: 'Qarzdor FISH',
  contract_date: 'Shartnoma sanasi', contract_number: 'Shartnoma raqami', loan_amount: 'Kredit miqdori',
  loan_amount_words: "Kredit miqdori (so'zda)", total_debt: 'Jami qarzdorlik',
  total_debt_words: "Jami qarzdorlik (so'zda)", region: 'Viloyat (Region ID)', area: 'Tuman/Shahar (Area ID)',
};

// The Loan fields the talabnoma reads.
export interface TalabnomaLoan {
  pinfl: string | null;
  branchCode: string | null;
  clientName: string | null;
  postAddress: string | null;
  postAddressUz: string | null;   // cleaned Uzbek-Latin address (preferred over raw)
  regionName: string | null;
  ldId: string | null;
  dateToCr: Date | null;
  summKr: unknown;
  totalDebt: unknown;
  raw: unknown;               // needs raw.distr_name for the area id
}

export interface TalabnomaRow {
  date: Date;
  contract_id: string;
  address: string;
  receiver: string;
  contract_date: Date | null;
  contract_number: string;
  loan_amount: number;
  loan_amount_words: string;
  total_debt: number;
  total_debt_words: string;
  region: number;
  area: number;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ddmmyyyy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;

// Group ordered loans into per-(client × firm) talabnoma rows. `loans` MUST be
// ordered by (pinfl, branchCode) so each group is contiguous — same as the
// ariza export stream.
export function buildTalabnomaRows(loans: TalabnomaLoan[], docDate: Date): TalabnomaRow[] {
  const rows: TalabnomaRow[] = [];
  let seq = 0;
  let key: string | null = null;
  let group: TalabnomaLoan[] = [];

  const flush = () => {
    if (!group.length) return;
    const g0 = group[0]!;
    const loanAmount = Math.round(group.reduce((s, l) => s + num(l.summKr), 0));
    const totalDebt = Math.round(group.reduce((s, l) => s + num(l.totalDebt), 0));
    const distr = String((g0.raw as any)?.distr_name ?? '');
    const { regionId, areaId } = resolveHippoRegionArea(g0.regionName ?? '', distr);
    seq += 1;
    rows.push({
      date: docDate,
      contract_id: `${ddmmyyyy(docDate)}/${seq}`,
      // Prefer the cleaned Uzbek-Latin address (drops source junk like «Д. РС, КВ.»),
      // transliterated to Cyrillic for hippo — same address the ariza shows.
      address: latinToCyrillic(g0.postAddressUz || g0.postAddress || ''),
      receiver: latinToCyrillic(g0.clientName ?? ''),
      contract_date: group.map((l) => l.dateToCr).filter(Boolean).sort((a, b) => +a! - +b!)[0] ?? null,
      contract_number: group.map((l) => String(l.ldId ?? '').trim()).filter(Boolean).join('-'),
      loan_amount: loanAmount,
      loan_amount_words: numberToUzWords(loanAmount),
      total_debt: totalDebt,
      total_debt_words: numberToUzWords(totalDebt),
      region: regionId,
      area: areaId,
    });
    group = [];
  };

  let idx = 0;
  for (const l of loans) {
    // A null/blank PINFL must NOT group — else two different identity-less debtors
    // at the same branch collapse into one row (debts summed, attributed to one).
    const hasPinfl = l.pinfl != null && String(l.pinfl).trim() !== '';
    const k = hasPinfl ? `${l.pinfl}|${l.branchCode}` : `__nopinfl_${idx}__`;
    if (k !== key) { flush(); key = k; }
    group.push(l);
    idx++;
  }
  flush();
  return rows;
}

// Build the workbook in the exact hippo talabnoma layout.
function talabnomaWorkbook(rows: TalabnomaRow[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Ma'lumotlar");
  ws.addRow(TALABNOMA_COLUMNS as unknown as string[]);                       // row 1: machine header
  ws.addRow(TALABNOMA_COLUMNS.map((c) => HUMAN_LABELS[c]));                  // row 2: human labels
  for (const r of rows) {
    const row = ws.addRow(TALABNOMA_COLUMNS.map((c) => (r as any)[c] ?? ''));
    row.getCell(1).numFmt = 'yyyy-mm-dd';   // date
    row.getCell(5).numFmt = 'yyyy-mm-dd';   // contract_date
  }
  return wb;
}

// Write rows to an .xlsx in the exact hippo talabnoma layout.
export async function writeTalabnomaExcel(rows: TalabnomaRow[], filePath: string): Promise<void> {
  await talabnomaWorkbook(rows).xlsx.writeFile(filePath);
}

// Same layout, returned as an in-memory buffer (for the one-click packet ZIP).
export async function talabnomaExcelBuffer(rows: TalabnomaRow[]): Promise<Buffer> {
  const out = await talabnomaWorkbook(rows).xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
