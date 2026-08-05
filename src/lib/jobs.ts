// In-process background job runner for portfolio imports. Fire-and-forget from the API route —
// the long-running server process carries the work; progress/state live in the Job/Snapshot rows.
import { prisma } from './db';
import { importPortfolio } from './import-portfolio';

/**
 * Runs a portfolio import to completion, updating Job.progress as rows land and flipping
 * Job/Snapshot to their terminal state. Never throws — failures are recorded on the Job/Snapshot
 * rows so callers that don't await this (the API route) don't need a catch.
 *
 * Progress writes are naturally throttled: importPortfolio only invokes onProgress once per
 * insert batch (1000 rows), not per row, so this doesn't need its own throttling on top.
 */
export async function runImportJob(jobId: number, filePath: string, snapshotId: number): Promise<void> {
  await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING' } });

  try {
    const result = await importPortfolio(filePath, snapshotId, (n) => {
      void prisma.job.update({ where: { id: jobId }, data: { progress: n, total: n } });
    });

    await Promise.all([
      prisma.job.update({
        where: { id: jobId },
        data: { status: 'DONE', progress: result.rows, total: result.rows },
      }),
      prisma.snapshot.update({
        where: { id: snapshotId },
        data: { status: 'READY', rowCount: result.rows, processedRows: result.rows, totalDebt: result.totalDebt },
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await Promise.all([
      prisma.job.update({ where: { id: jobId }, data: { status: 'FAILED', message } }),
      prisma.snapshot.update({ where: { id: snapshotId }, data: { status: 'FAILED' } }),
    ]);
  }
}
