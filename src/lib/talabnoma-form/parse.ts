// Parse the uploaded Excels into a reduced candidates.json. Data model (foydalanuvchi so'rovi):
//   · talabnoma manba: JUST a PINFL list (Latin PNFL/PINFL or Cyrillic, any case — the same tiny
//     file the istisno slot takes). It supplies ONLY the pinfl set; nothing else is read from it.
//   · portfel: 185k loan rows — STREAMED, keeping only rows whose pinfl is in that set, to bound
//     memory. EVERY other field (FIO, address, region, district, per-firm & total debt) is derived
//     from the portfolio via the shared mapRowToLoan, so it matches the main import exactly.
//   · firm names: from the DB Firm table (the letters already use DB letterhead), so no Лист3.
import fs from 'node:fs/promises';
import { prisma } from '@/lib/db';
import Excel from 'exceljs';
import { mapRowToLoan } from '@/core/portfolio';
import { parseExclusionPinfls } from '@/lib/parse-exclusion';
import { canonCode, DEFAULT_THRESHOLD, evaluate } from './filter';
import type { CandidatePerson, CandidatesFile } from './types';

/** Prefer the FULLEST address seen for a person (portfolio rows vary: some carry the full street,
 *  some collapse to «X tumani»). Longest non-empty wins. */
function fullest(...candidates: (string | null | undefined)[]): string | null {
  const cleaned = candidates.map((c) => (c ?? '').trim()).filter(Boolean);
  if (!cleaned.length) return null;
  return cleaned.reduce((best, c) => (c.length > best.length ? c : best));
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

/** Read the talabnoma PINFL list + stream the portfolio into a CandidatesFile. `docDate` = the
 *  talabnoma document date. Person identity/amounts come entirely from the portfolio. */
export async function parseTalabnomaForm(
  sourcePath: string,
  portfolioPath: string,
  docDate: Date,
  onProgress?: (rowsStreamed: number) => void | Promise<void>,
): Promise<ParseOutput> {
  // 1) Talabnoma manba → just the set of PINFLs to build letters for (robust Latin/Cyrillic header
  //    detection, reused from the istisno parser). No FIO/amount is taken from here.
  const wanted = await parseExclusionPinfls(sourcePath);

  // Seed a person per wanted pinfl so nobody is silently dropped even if the portfolio has no match.
  const byPinfl = new Map<string, CandidatePerson>();
  for (const pinfl of wanted) {
    byPinfl.set(pinfl, {
      pinfl,
      fio: null,
      totalOverdue: 0,
      address: null,
      phone: null,
      region: null,
      district: null,
      firmsText: null,
      perFirm: {},
      loans: [],
    });
  }

  // 2) Портфель — STREAM; keep only wanted rows, and derive ALL person detail from them.
  const reader = new Excel.stream.xlsx.WorkbookReader(portfolioPath, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    entries: 'emit',
  });
  const matched = new Set<string>();
  const firmCodes = new Set<string>();
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

      const distrName = (loan.raw as any)?.distr_name != null ? String((loan.raw as any).distr_name) : null;
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
        distrName,
      });

      // Identity / amounts — all from portfel.
      person.fio = person.fio ?? loan.clientName;
      person.address = fullest(person.address, loan.postAddressUz, loan.postAddress);
      person.region = person.region ?? loan.regionName;
      person.district = person.district ?? distrName;
      const code = canonCode(loan.branchCode);
      person.perFirm[code] = (person.perFirm[code] ?? 0) + Math.abs(loan.totalDebt);
      person.totalOverdue += Math.abs(loan.totalDebt);
      firmCodes.add(code);
      matched.add(loan.pinfl);
    }
  }

  // 3) Firm names from the DB (code → shortName/legalName), so the summary UI shows real names.
  const firmNameByCode = await firmNamesByCode(firmCodes);

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

/** DB Firm rows → canonical-code → display name map (shortName preferred, else legalName). */
async function firmNamesByCode(codes: Set<string>): Promise<Record<string, string>> {
  const firms = await prisma.firm.findMany({ select: { code: true, shortName: true, legalName: true } });
  const map: Record<string, string> = {};
  for (const f of firms) {
    const c = canonCode(f.code);
    if (codes.size === 0 || codes.has(c)) map[c] = f.shortName || f.legalName || c;
  }
  return map;
}

export async function writeCandidates(path: string, file: CandidatesFile): Promise<void> {
  await fs.writeFile(path, JSON.stringify(file));
}
export async function readCandidates(path: string): Promise<CandidatesFile> {
  return JSON.parse(await fs.readFile(path, 'utf8')) as CandidatesFile;
}
