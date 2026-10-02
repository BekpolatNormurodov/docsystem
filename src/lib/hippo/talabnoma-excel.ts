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
// `pinfl` + `unique_code` — OXIRIDA (hippo ustunlari joyidan siljimaydi): har qatorda PINFL va mijozning
// shu firmadagi UNIKAL KODI bo'lishi shart (operator so'rovi, 2026-10-02) — reyestrni portfel/boshqa
// ro'yxatlar bilan solishtirish uchun. Hippo API (talabnomaRowsToMails) bu ustunlarni o'qimaydi.
export const TALABNOMA_COLUMNS = [
  'date', 'contract_id', 'address', 'receiver', 'contract_date', 'contract_number',
  'loan_amount', 'loan_amount_words', 'total_debt', 'overdue_debt', 'total_debt_words', 'region', 'area',
  'pinfl', 'unique_code',
] as const;

// Human labels (row 2) — copied from the reference file.
const HUMAN_LABELS: Record<(typeof TALABNOMA_COLUMNS)[number], string> = {
  date: 'Hujjat sanasi', contract_id: 'Shartnoma ID', address: 'Manzil (Uy)', receiver: 'Qarzdor FISH',
  contract_date: 'Shartnoma sanasi', contract_number: 'Shartnoma raqami', loan_amount: 'Kredit miqdori',
  loan_amount_words: "Kredit miqdori (so'zda)", total_debt: 'Jami qarzdorlik', overdue_debt: "Muddati o'tgan jami qarzdorlik",
  total_debt_words: "Jami qarzdorlik (so'zda)", region: 'Viloyat (Region ID)', area: 'Tuman/Shahar (Area ID)',
  pinfl: 'PINFL', unique_code: 'Unikalka',
};

/**
 * Mijozning FIRMA ICHIDAGI unikal kodi («Unikalka») — kredit hisob raqamining 10–17-xonalari.
 * Hisob raqami 20 xona: balans 5 + valyuta 3 + kalit 1 + MIJOZ KODI 8 + kredit tartib raqami 3
 * (14801000460158130001 → 60158130). Bir mijozning shu firmadagi hamma kreditida bir xil, boshqa
 * firmada esa boshqa (2026-10-02, 25.09 portfel: har firmada PINFL soni = kod soni).
 * `account` bo'lmasa — `acc_over` (muddati o'tgan hisob, xuddi shu tuzilma).
 */
export function clientUniqueCode(raw: unknown): string | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  for (const k of ['account', 'acc_over']) {
    const a = String(r[k] ?? '').replace(/\D/g, '');
    if (a.length === 20) return a.slice(9, 17);
  }
  return null;
}

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
  raw: unknown;               // raw.distr_name → area id; raw.account (yoki acc_over) → unique_code
  // Overdue parts (Loan.debtOverdue*) → «overdue_debt» (muddati o'tgan jami qarzdorlik); empty without them.
  debtOverduePrincipal?: unknown;
  debtOverdueInterest?: unknown;
}

export interface TalabnomaRow {
  // pinfl — reyestr Excel'ining oxirgi ustunlaridan biri (TALABNOMA_COLUMNS) + hippo external oqimida
  // PinflOrInn (talabnomaRowsToMails). Statistika/iz ham shundan.
  pinfl: string | null;
  /** Mijozning shu firmadagi unikal kodi (clientUniqueCode); kreditlarda turlicha bo'lsa «-» bilan. */
  unique_code?: string | null;
  date: Date;
  contract_id: string;
  address: string;
  receiver: string;
  contract_date: Date | null;
  contract_number: string;
  loan_amount: number;
  loan_amount_words: string;
  total_debt: number;
  overdue_debt: number | null; // muddati o'tgan asosiy qarz + muddati o'tgan foiz (butun so'm)
  total_debt_words: string;
  region: number;
  area: number;
  // Xatdagi summa turi (talabnoma-shakllantirish): 'overdue' → total_debt = muddati o'tgan qism, matn
  // «муддати ўтган қарзингиз…»; 'total' → jami qarz. Berilmasa — eski umumiy matn (boshqa oqimlar).
  amount_kind?: 'total' | 'overdue';
  full_debt?: number; // 'overdue' variantda asl jami qarz (ko'rik Excel'i uchun; hippo reyestriga chiqmaydi)
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
    // «Muddati o'tgan jami qarzdorlik» — overdue principal + overdue interest (the portfolio's
    // «Просроченный основной долг» + «Просроченный %»), whole so'm like total_debt.
    const hasOverdue = group.every((l) => l.debtOverduePrincipal != null && l.debtOverdueInterest != null);
    const overdue = hasOverdue
      ? Math.round(group.reduce((s, l) => s + num(l.debtOverduePrincipal) + num(l.debtOverdueInterest), 0))
      : null;
    const distr = String((g0.raw as any)?.distr_name ?? '');
    const codes = [...new Set(group.map((l) => clientUniqueCode(l.raw)).filter((c): c is string => !!c))];
    const { regionId, areaId } = resolveHippoRegionArea(g0.regionName ?? '', distr);
    seq += 1;
    rows.push({
      pinfl: g0.pinfl != null && String(g0.pinfl).trim() !== '' ? String(g0.pinfl) : null,
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
      overdue_debt: overdue,
      total_debt_words: numberToUzWords(totalDebt),
      region: regionId,
      area: areaId,
      unique_code: codes.length ? codes.join('-') : null,
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
