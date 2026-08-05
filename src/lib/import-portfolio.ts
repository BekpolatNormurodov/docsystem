import Excel from 'exceljs';
import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { mapRowToLoan, type LoanInput } from '@/core/portfolio';

const BATCH_SIZE = 1000;

export interface ImportResult {
  rows: number;
  totalDebt: number;
  excludedCount: number;
}

/**
 * Streams the first pinfl-bearing worksheet of an xlsx file, maps each row to a Loan via
 * mapRowToLoan, and inserts them in batches. Worksheets whose header row lacks `pinfl` are
 * skipped entirely (used to ignore decoy/unrelated sheets).
 */
export async function importPortfolio(
  filePath: string,
  snapshotId: number,
  onProgress?: (n: number) => void,
  excludedPinfls?: Set<string>,
): Promise<ImportResult> {
  const workbook = new Excel.stream.xlsx.WorkbookReader(filePath, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    entries: 'emit',
  });

  let rows = 0;
  let totalDebt = 0;
  let excludedCount = 0;
  let batch: LoanInput[] = [];
  let foundWorksheet = false;

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    await prisma.loan.createMany({
      data: batch.map((l) => ({
        ...l,
        raw: l.raw as Prisma.InputJsonValue,
        snapshotId,
        excluded: !!(excludedPinfls && l.pinfl && excludedPinfls.has(l.pinfl)),
      })),
    });
    batch = [];
  }

  for await (const worksheet of workbook) {
    if (foundWorksheet) break; // only ever process the first matching worksheet

    let header: string[] | null = null;
    let isPortfolioSheet = false;

    for await (const row of worksheet) {
      // exceljs row.values is 1-indexed (index 0 is empty) — normalize to 0-based.
      const raw = row.values as unknown[];
      const values = Array.isArray(raw) ? raw.slice(1) : [];

      if (header === null) {
        header = values.map((v) => (v === null || v === undefined ? '' : String(v)));
        isPortfolioSheet = header.includes('pinfl');
        if (!isPortfolioSheet) break; // decoy/unrelated sheet — skip the rest of it
        foundWorksheet = true;
        continue;
      }

      const loan = mapRowToLoan(header, values);
      totalDebt += loan.totalDebt;
      if (excludedPinfls && loan.pinfl && excludedPinfls.has(loan.pinfl)) excludedCount += 1;
      batch.push(loan);
      rows += 1;

      if (batch.length >= BATCH_SIZE) {
        await flush();
        onProgress?.(rows);
        await prisma.snapshot.update({
          where: { id: snapshotId },
          data: { processedRows: rows, totalDebt },
        });
      }
    }
  }

  await flush();
  onProgress?.(rows);
  await prisma.snapshot.update({
    where: { id: snapshotId },
    data: { processedRows: rows, totalDebt },
  });

  return { rows, totalDebt, excludedCount };
}
