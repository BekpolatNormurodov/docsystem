import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import Excel from 'exceljs';
import { prisma } from '@/lib/db';
import { runImportJob } from '@/lib/jobs';
import { makeFixture, DEFAULT_FIXTURE_ROWS } from '@/lib/make-fixture';

async function makeExclusionFixture(filePath: string, pinfls: string[]): Promise<void> {
  const workbook = new Excel.Workbook();
  const sheet = workbook.addWorksheet('Pnfl');
  sheet.addRow(['ПНФЛ', 'ФИО', 148.01, 124.05, 163.77, '12405%+16377%', 'ТЕЛ', 'ВИЛОЯТ', 'ТУМАН']);
  for (const p of pinfls) sheet.addRow([p, '', '', '', '', '', '', '', '']);
  await workbook.xlsx.writeFile(filePath);
}

describe('runImportJob', () => {
  let snapshotId: number | null = null;
  let jobId: number | null = null;
  let fixturePath: string | null = null;
  let exclusionPath: string | null = null;

  afterEach(async () => {
    if (jobId !== null) {
      await prisma.job.delete({ where: { id: jobId } });
      jobId = null;
    }
    if (snapshotId !== null) {
      await prisma.snapshot.delete({ where: { id: snapshotId } }); // cascades Loan
      snapshotId = null;
    }
    if (fixturePath) {
      await fs.rm(fixturePath, { force: true });
      fixturePath = null;
    }
    if (exclusionPath) {
      await fs.rm(exclusionPath, { force: true });
      exclusionPath = null;
    }
  });

  it('drives a Job from RUNNING to DONE and the Snapshot to READY', async () => {
    fixturePath = path.join(os.tmpdir(), `jobs-run-fixture-${Date.now()}.xlsx`);
    await makeFixture(fixturePath);
    exclusionPath = path.join(os.tmpdir(), `jobs-run-exclusion-${Date.now()}.xlsx`);
    await makeExclusionFixture(exclusionPath, ['10000000000002']);

    const snapshot = await prisma.snapshot.create({
      data: { reportDate: new Date('2026-08-02'), sourceFileName: 'fixture.xlsx' },
    });
    snapshotId = snapshot.id;

    const job = await prisma.job.create({
      data: { type: 'IMPORT', status: 'PENDING', snapshotId: snapshot.id },
    });
    jobId = job.id;

    await runImportJob(job.id, fixturePath, snapshot.id, exclusionPath);

    const finalJob = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finalJob.status).toBe('DONE');
    expect(finalJob.progress).toBe(3);
    expect(finalJob.total).toBe(3);

    const finalSnapshot = await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect(finalSnapshot.status).toBe('READY');
    expect(finalSnapshot.rowCount).toBe(3);
    expect(finalSnapshot.excludedCount).toBe(1);
    const expectedTotal = DEFAULT_FIXTURE_ROWS.reduce(
      (sum, r) => sum + r.summOstZe + r.sumprocEqv + r.summOstprZe + r.sumnachprEqv,
      0,
    );
    expect(Number(finalSnapshot.totalDebt)).toBe(expectedTotal);
  });
});
