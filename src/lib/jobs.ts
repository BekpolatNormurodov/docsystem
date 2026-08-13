// In-process background job runner for portfolio imports. Fire-and-forget from the API route —
// the long-running server process carries the work; progress/state live in the Job/Snapshot rows.
import { prisma } from './db';
import { importPortfolio } from './import-portfolio';
import { parseExclusionPinfls } from './parse-exclusion';
import { syncCasesFromSnapshot } from './konveyer';

/**
 * Runs a portfolio import to completion, updating Job.progress as rows land and flipping
 * Job/Snapshot to their terminal state. Never throws — failures are recorded on the Job/Snapshot
 * rows so callers that don't await this (the API route) don't need a catch.
 *
 * Progress writes are naturally throttled: importPortfolio only invokes onProgress once per
 * insert batch (1000 rows), not per row, so this doesn't need its own throttling on top.
 */
export async function runImportJob(
  jobId: number,
  portfolioPath: string,
  snapshotId: number,
  exclusionPath: string,
): Promise<void> {
  // updateMany (not update) throughout: if the Job/Snapshot was deleted mid-import (e.g. a replace
  // for the same date), update() would throw "record not found" and — since callers fire-and-forget
  // this — surface as an unhandledRejection that crashes the request. updateMany is a no-op on 0 rows.
  await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'RUNNING' } });

  try {
    const excluded = await parseExclusionPinfls(exclusionPath);

    const result = await importPortfolio(
      portfolioPath,
      snapshotId,
      (n) => {
        // Only progress here — `total` was seeded on the Job (an estimate from file size) so the UI
        // can show a real percentage while streaming; overwriting it with `n` would peg it at 100%.
        // Fire-and-forget, guarded: a deleted Job here must not reject unhandled.
        prisma.job.updateMany({ where: { id: jobId }, data: { progress: n } }).catch(() => {});
      },
      excluded,
    );

    await prisma.job.updateMany({
      where: { id: jobId },
      data: { status: 'DONE', progress: result.rows, total: result.rows },
    });
    await prisma.snapshot.updateMany({
      where: { id: snapshotId },
      data: {
        status: 'READY',
        rowCount: result.rows,
        processedRows: result.rows,
        totalDebt: result.totalDebt,
        excludedCount: result.excludedCount,
      },
    });
    // Auto-populate the pipeline: create ArizaCase rows from the freshly-imported snapshot's
    // court-list clients, so the operator never has to click «Snapshot'dan yangilash» by hand.
    // Wrapped so a sync hiccup can't fail an import that already succeeded — it stays retryable
    // from the button. (Idempotent: re-running only adds newcomers.)
    try {
      const synced = await syncCasesFromSnapshot(snapshotId);
      console.log(`[import] auto-synced conveyor: +${synced.created} case(s) from snapshot ${snapshotId}`);
    } catch (e) {
      console.error('[import] auto-sync failed (retry from the «Snapshot\'dan yangilash» button)', e);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'FAILED', message } }).catch(() => {});
    await prisma.snapshot.updateMany({ where: { id: snapshotId }, data: { status: 'FAILED' } }).catch(() => {});
  }
}
