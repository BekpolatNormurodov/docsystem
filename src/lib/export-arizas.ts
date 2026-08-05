// In-process background job runner for bulk ariza .docx ZIP exports. Fire-and-forget from the API
// route — the long-running server process carries the work; progress/state live on the Job row.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { prisma } from './db';
import { getSettings } from './settings';
import { buildArizaDocx } from './ariza-docx';
import { arizaZipPath, uniqueZipPath } from './export-paths';
import { loanToAriza, type ArizaFirm } from '@/core/ariza';
import { buildLoanWhere, type LoanFilters } from '@/core/loan-filters';

const EXPORTS_DIR = path.join(process.cwd(), 'exports');
const PAGE_SIZE = 500;
const PROGRESS_THROTTLE = 20;

export interface ExportFilters {
  snapshotId: number;
  q?: string;
  branch?: string;
  branches?: string[];
  minDebt?: number;
}

/**
 * Runs a bulk ariza export to completion: streams matching loans page by page, builds each
 * chamber ariza .docx (no QR, mirroring the single-ariza path), and appends it into a ZIP at
 * `exports/{jobId}.zip` under the sanitized folder tree from `arizaZipPath`. Never throws —
 * failures are recorded on the Job row so callers that fire-and-forget don't need a catch.
 */
export async function runExportJob(jobId: number, filters: ExportFilters): Promise<void> {
  // updateMany (not update) throughout: if the Job was deleted mid-run, update() would throw
  // "record not found" and — since callers fire-and-forget this — surface as an unhandledRejection.
  await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'RUNNING' } });

  try {
    const snapshot = await prisma.snapshot.findUniqueOrThrow({ where: { id: filters.snapshotId } });
    const settings = await getSettings();
    // minDebt filters by the CLIENT's TOTAL debt (the sum shown on the card), not a single loan.
    // Resolve the matching clients once, then skip other clients' loans while streaming.
    const where = buildLoanWhere(filters.snapshotId, {
      q: filters.q,
      branch: filters.branch,
      branches: filters.branches,
      page: 1,
    } satisfies LoanFilters);
    let allowedPinfls: Set<string> | null = null;
    if (filters.minDebt) {
      const groups = await prisma.loan.groupBy({
        by: ['pinfl'],
        where,
        having: { totalDebt: { _sum: { gte: filters.minDebt } } },
      });
      allowedPinfls = new Set(groups.map((g) => g.pinfl).filter((p): p is string => !!p));
    }

    const firmRows = await prisma.firm.findMany();
    const firmsByCode = new Map(firmRows.map((f) => [f.code, f]));

    await fsp.mkdir(EXPORTS_DIR, { recursive: true });
    const zipPath = path.join(EXPORTS_DIR, `${jobId}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip');
    const closed = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
    });
    archive.pipe(output);

    let processed = 0;
    let skip = 0;
    const usedNames = new Set<string>(); // dedupe same-named arizas (same client+firm+date)
    for (;;) {
      const loans = await prisma.loan.findMany({ where, skip, take: PAGE_SIZE, orderBy: { id: 'asc' } });
      if (loans.length === 0) break;
      skip += loans.length;

      for (const loan of loans) {
        if (allowedPinfls && (!loan.pinfl || !allowedPinfls.has(loan.pinfl))) continue;
        const firmRow = loan.branchCode ? firmsByCode.get(loan.branchCode) : undefined;
        const firm: ArizaFirm = {
          shortName: firmRow?.shortName ?? loan.branchCode ?? '',
          legalName: firmRow?.legalName ?? null,
          address: firmRow?.address ?? null,
          bankAccount: firmRow?.bankAccount ?? null,
          mfo: firmRow?.mfo ?? null,
          stir: firmRow?.stir ?? null,
        };
        const props = loanToAriza(loan, firm, settings, snapshot.reportDate);
        const buf = await buildArizaDocx(props);
        const name = uniqueZipPath(
          arizaZipPath(
            snapshot.reportDate,
            loan.clientName ?? '',
            loan.pinfl ?? '',
            firmRow?.shortName ?? loan.branchCode ?? '',
          ),
          usedNames,
        );
        archive.append(buf, { name });

        processed += 1;
        if (processed % PROGRESS_THROTTLE === 0) {
          await prisma.job.updateMany({ where: { id: jobId }, data: { progress: processed } }).catch(() => {});
        }
      }
    }

    await archive.finalize();
    await closed;

    await prisma.job.updateMany({
      where: { id: jobId },
      data: { status: 'DONE', progress: processed, total: processed, resultPath: `exports/${jobId}.zip` },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'FAILED', message } }).catch(() => {});
  }
}
