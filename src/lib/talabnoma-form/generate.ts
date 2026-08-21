// Turn a parsed CandidatesFile + filters into the two deliverables for ONE firm:
//   · reyestr .xlsx  — reuses buildTalabnomaRows + talabnomaExcelBuffer (the exact hippo layout);
//   · letters .zip   — one PDF per (person) via the EXISTING talabnoma document renderer, unchanged.
// A firm-row is included only when the person clears filter A (total ≥ threshold) and their overdue at
// this firm clears filter B (perFirmMin). Contract detail comes from the person's portfolio loans; if
// a person had no portfolio match we synth one aggregate row so they are never silently dropped.
import fs from 'node:fs';
import archiver from 'archiver';
import { prisma } from '@/lib/db';
import {
  buildTalabnomaRows,
  talabnomaExcelBuffer,
  type TalabnomaLoan,
  type TalabnomaRow,
} from '@/lib/hippo/talabnoma-excel';
import { renderTalabnomaPdf, type TalabnomaFirm } from '@/lib/hippo/talabnoma-pdf';
import { canonCode, passesTotal } from './filter';
import type { CandidatesFile, FilterOpts } from './types';

const safeName = (s: string) => s.replace(/[^\wА-Яа-яЎўҚқҒғҲҳ]+/g, '_').slice(0, 40) || 'x';

/** The portfolio's cleaned address often collapses to just «X tumani» (post_address is empty in these
 *  exports), while Лист1 carries the full street/house. Prefer the FULLEST address available so the
 *  letter never shows a bare district. */
function fullestAddress(...candidates: (string | null | undefined)[]): string | null {
  const cleaned = candidates.map((c) => (c ?? '').trim()).filter(Boolean);
  if (!cleaned.length) return null;
  return cleaned.reduce((best, c) => (c.length > best.length ? c : best));
}

/** Build the ordered TalabnomaLoan[] feeding one firm's reyestr/letters. Ordered by pinfl so each
 *  (pinfl × firm) group is contiguous for buildTalabnomaRows. */
export function buildLoansForFirm(file: CandidatesFile, firmCode: string, opts: FilterOpts): TalabnomaLoan[] {
  const code = canonCode(firmCode);
  const loans: TalabnomaLoan[] = [];
  const people = [...file.people].sort((a, b) => a.pinfl.localeCompare(b.pinfl));
  for (const p of people) {
    if (!passesTotal(p, opts)) continue;
    const firmOverdue = Math.abs(p.perFirm[code] ?? 0);
    if (firmOverdue <= 0 || firmOverdue < opts.perFirmMin) continue;
    const firmLoans = p.loans.filter((l) => canonCode(l.branch) === code);
    if (firmLoans.length) {
      for (const l of firmLoans) {
        loans.push({
          pinfl: p.pinfl,
          branchCode: code,
          clientName: l.clientName ?? p.fio,
          // Fullest address wins (List1 full street vs portfolio district-only). postAddressUz set null
          // so buildTalabnomaRows uses this chosen full address, not the collapsed cleaned one.
          postAddress: fullestAddress(p.address, l.postAddress, l.postAddressUz),
          postAddressUz: null,
          regionName: l.regionName ?? p.region,
          ldId: l.ldId,
          dateToCr: l.dateToCr ? new Date(l.dateToCr) : null,
          summKr: l.summKr ?? 0,
          totalDebt: l.totalDebt,
          raw: { distr_name: l.distrName ?? p.district ?? '' },
        });
      }
    } else {
      // No portfolio match — degraded aggregate row (overdue as the debt, no contract detail).
      loans.push({
        pinfl: p.pinfl,
        branchCode: code,
        clientName: p.fio,
        postAddress: p.address,
        postAddressUz: null,
        regionName: p.region,
        ldId: null,
        dateToCr: null,
        summKr: 0,
        totalDebt: firmOverdue,
        raw: { distr_name: p.district ?? '' },
      });
    }
  }
  return loans;
}

export function buildRowsForFirm(file: CandidatesFile, firmCode: string, opts: FilterOpts): TalabnomaRow[] {
  const docDate = file.docDate ? new Date(file.docDate) : new Date();
  return buildTalabnomaRows(buildLoansForFirm(file, firmCode, opts), docDate);
}

/** Firm letterhead from the DB Firm row (matched by canonical code). */
export async function firmLetterhead(firmCode: string): Promise<TalabnomaFirm | null> {
  const code = canonCode(firmCode);
  const firms = await prisma.firm.findMany({
    select: { code: true, legalName: true, shortName: true, address: true, stir: true, bankAccount: true, mfo: true, phone: true },
  });
  const f = firms.find((x) => canonCode(x.code) === code);
  return f ?? null;
}

export async function writeReyestr(rows: TalabnomaRow[], filePath: string): Promise<void> {
  const buf = await talabnomaExcelBuffer(rows);
  await fs.promises.writeFile(filePath, buf);
}

/** Render every row to a PDF letter and stream them into a .zip (reyestr .xlsx at the root too). */
export async function writeLettersZip(
  rows: TalabnomaRow[],
  firm: TalabnomaFirm | null,
  zipPath: string,
): Promise<void> {
  const { chromium } = await import('playwright');
  const out = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { store: true });
  archive.pipe(out);

  // reyestr at the zip root, like the pipeline's TALABNOMA job.
  archive.append(await talabnomaExcelBuffer(rows), { name: '_reyestr.xlsx' });

  const browser = await chromium.launch({ headless: true });
  const used = new Map<string, number>();
  try {
    for (const row of rows) {
      const pdf = await renderTalabnomaPdf(row, browser, firm);
      let name = `${row.contract_id.replace(/\//g, '-')}_${safeName(row.receiver)}.pdf`;
      const n = used.get(name) ?? 0;
      used.set(name, n + 1);
      if (n > 0) name = name.replace(/\.pdf$/, ` (${n}).pdf`);
      archive.append(pdf, { name });
      // Backpressure: let the zip flush to disk before queueing the next PDF (same as runTalabnomaJob).
      if (out.writableNeedDrain) await new Promise<void>((r) => out.once('drain', () => r()));
    }
  } finally {
    await browser.close();
  }
  await archive.finalize();
  await new Promise<void>((resolve, reject) => {
    out.on('close', resolve);
    out.on('error', reject);
  });
}
