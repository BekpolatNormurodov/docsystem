// Parse the two uploaded Excels into a reduced candidates.json:
//   · source (20.08…): Лист1 = per-person aggregate (total overdue + firm list), Лист2 = per-firm
//     overdue, Лист3 = firm code→name. Full-loaded (a few MB).
//   · портфель: 185k loan rows — STREAMED, keeping only rows whose pinfl is a Лист1 candidate, to
//     bound memory. Each kept row → contract detail for that person's letter/reyestr (via the shared
//     mapRowToLoan, so parsing matches the main portfolio import exactly).
import fs from 'node:fs/promises';
import Excel from 'exceljs';
import { mapRowToLoan } from '@/core/portfolio';
import { canonCode, DEFAULT_THRESHOLD, evaluate } from './filter';
import type { CandidatePerson, CandidatesFile } from './types';

function unwrap(v: unknown): unknown {
  if (v !== null && typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r?.text ?? '').join('');
    if (o.result !== undefined) return o.result;
    if (o.text !== undefined && !(v instanceof Date)) return o.text;
  }
  return v;
}
function num(v: unknown): number {
  v = unwrap(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').trim().replace(/[\s ']/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string | null {
  v = unwrap(v);
  if (v === '' || v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Pick worksheets by name, falling back to positional order (Лист1/2/3 ≈ sheet 0/1/2). */
function pickSheets(wb: Excel.Workbook) {
  const ws = wb.worksheets;
  const byName = (n: string) => wb.getWorksheet(n);
  return {
    l1: byName('Лист1') ?? ws[0],
    l2: byName('Лист2') ?? ws[1],
    l3: byName('Лист3') ?? ws[2],
  };
}

export interface ParseSummary {
  candidateCount: number;
  qualifiedCount: number;
  firms: { code: string; name: string; ready: boolean; personCount: number }[];
  readyPersonCount: number;
  unreadyPersonCount: number;
  portfolioMatched: number; // people who got ≥1 portfolio loan
}

export interface ParseOutput {
  file: CandidatesFile;
  summary: ParseSummary;
}

/** Read the source + stream the portfolio into a CandidatesFile. `docDate` = the talabnoma date. */
export async function parseTalabnomaForm(
  sourcePath: string,
  portfolioPath: string,
  docDate: Date,
  onProgress?: (rowsStreamed: number) => void | Promise<void>,
): Promise<ParseOutput> {
  const wb = new Excel.Workbook();
  await wb.xlsx.readFile(sourcePath);
  const { l1, l2, l3 } = pickSheets(wb);

  // Лист3 — firm code → name.
  const firmNameByCode: Record<string, string> = {};
  l3?.eachRow((row) => {
    const code = str(row.getCell(1).value);
    const name = str(row.getCell(2).value);
    if (code && name) firmNameByCode[canonCode(code)] = name;
  });

  // Лист1 — one person per row (header on row 1).
  const byPinfl = new Map<string, CandidatePerson>();
  l1?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const pinfl = str(row.getCell(1).value);
    if (!pinfl) return;
    const person: CandidatePerson = {
      pinfl,
      fio: str(row.getCell(2).value),
      totalOverdue: Math.abs(num(row.getCell(6).value)), // «12405%+16377%»
      address: str(row.getCell(7).value),
      phone: str(row.getCell(8).value),
      region: str(row.getCell(9).value),
      district: str(row.getCell(10).value),
      firmsText: str(row.getCell(11).value),
      perFirm: {},
      loans: [],
    };
    byPinfl.set(pinfl, person);
  });

  // Лист2 — per (firm × loan) overdue → accumulate per firm for each person.
  l2?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const pinfl = str(row.getCell(10).value);
    if (!pinfl) return;
    const person = byPinfl.get(pinfl);
    if (!person) return;
    const code = canonCode(row.getCell(2).value);
    const overdue = Math.abs(num(row.getCell(9).value));
    person.perFirm[code] = (person.perFirm[code] ?? 0) + overdue;
  });

  // Портфель — STREAM; keep only candidate rows, extract contract detail via mapRowToLoan.
  const reader = new Excel.stream.xlsx.WorkbookReader(portfolioPath, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    entries: 'emit',
  });
  const matched = new Set<string>();
  let foundWorksheet = false;
  let streamed = 0;
  for await (const worksheet of reader) {
    if (foundWorksheet) break; // only the first pinfl-bearing sheet
    let header: string[] | null = null;
    for await (const r of worksheet) {
      const raw = r.values as unknown[];
      const values = Array.isArray(raw) ? raw.slice(1) : [];
      if (header === null) {
        header = values.map((v) => (v === null || v === undefined ? '' : String(v)));
        if (!header.includes('pinfl')) break; // decoy sheet — skip the rest of it
        foundWorksheet = true;
        continue;
      }
      streamed += 1;
      if (onProgress && streamed % 2000 === 0) await onProgress(streamed);
      const loan = mapRowToLoan(header, values);
      if (!loan.pinfl) continue;
      const person = byPinfl.get(loan.pinfl);
      if (!person) continue;
      person.loans.push({
        branch: loan.branchCode,
        clientName: loan.clientName,
        ldId: loan.ldId,
        dateToCr: loan.dateToCr ? loan.dateToCr.toISOString() : null,
        summKr: loan.summKr,
        totalDebt: loan.totalDebt,
        postAddress: loan.postAddress,
        postAddressUz: loan.postAddressUz,
        regionName: loan.regionName,
        distrName: (loan.raw as any)?.distr_name != null ? String((loan.raw as any).distr_name) : null,
      });
      matched.add(loan.pinfl);
    }
  }

  const people = [...byPinfl.values()];
  const file: CandidatesFile = { docDate: docDate.toISOString(), firmNameByCode, people };

  const ev = evaluate(file, { thresholdTotal: DEFAULT_THRESHOLD, perFirmMin: 0 });
  const summary: ParseSummary = {
    candidateCount: people.length,
    qualifiedCount: ev.qualifiedPeople,
    firms: ev.firms.map((f) => ({ code: f.code, name: f.name, ready: f.ready, personCount: f.personCount })),
    readyPersonCount: ev.readyPersonCount,
    unreadyPersonCount: ev.unreadyPersonCount,
    portfolioMatched: matched.size,
  };
  return { file, summary };
}

export async function writeCandidates(path: string, file: CandidatesFile): Promise<void> {
  await fs.writeFile(path, JSON.stringify(file));
}
export async function readCandidates(path: string): Promise<CandidatesFile> {
  return JSON.parse(await fs.readFile(path, 'utf8')) as CandidatesFile;
}
